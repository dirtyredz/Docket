// Browser acceptance of the editor conflict flow (Playwright library, node:test runner): a draft
// survives a CLI edit, the save returns 409 without losing input, explicit reconciliation saves, drafts
// survive checkout switching, only the selected checkout changes, and a reverse-stored relation is
// removed from the other item's file. A second test covers facts and discussion notes: add a note,
// board badge and overview counts, edit facts, resolve, history kept, and body / note-input conflicts
// that keep their text across navigation and refresh until an explicit rebase. Uses Playwright's Chromium when installed, else the system's
// Edge or Chrome; skips (never fakes) when no browser can start.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";
import { itemText, readItem, runCli } from "../helpers/repository.mjs";

const F = "dk-0000f001";
const C = "dk-0000c001";
const N = "dk-0000d001";

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    return { reason: `playwright not installed: ${err.message}` };
  }
  const reasons = [];
  for (const options of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try {
      return { browser: await chromium.launch(options), how: options.channel ?? "chromium" };
    } catch (err) {
      reasons.push(`${options.channel ?? "chromium"}: ${err.message.split("\n")[0]}`);
    }
  }
  return { reason: `no browser could start (${reasons.join("; ")})` };
}

let env;
let browser;
let skip = false;
let how = null;
before(async () => {
  const launched = await launch();
  if (!launched.browser) {
    skip = launched.reason;
    return;
  }
  browser = launched.browser;
  how = launched.how;
  const home = appData();
  const r = docketRepo({
    [F]: itemText({ id: F, type: "feature" }, { title: "Feature", body: "Body stays.\n" }),
    [C]: itemText({ id: C, rank: "c", relates: [F] }, { title: "Related" }),
    [N]: itemText(
      { id: N, type: "feature", rank: "d" },
      { title: "Discuss me", body: "Original fact.\n" },
    ),
  });
  const wt = addWorktree(r, "wt", "side");
  const main = register(home.registryFile, r.root);
  const side = register(home.registryFile, wt);
  const v = await viewer(home.registryFile);
  env = {
    home,
    r,
    wt,
    v,
    repoId: main.repo.id,
    mainId: main.checkout.id,
    sideId: side.checkout.id,
  };
});
after(async () => {
  await browser?.close();
  if (env) {
    await env.v.close();
    env.r.cleanup();
    env.home.cleanup();
  }
});

const itemUrl = (checkout, id) => `${env.v.server.url}#/r/${env.repoId}/${checkout}/board/${id}`;

test("conflict flow, reconciliation, checkout targeting and relation removal", async (t) => {
  if (skip) return t.skip(skip);
  t.diagnostic(`browser: ${how}`);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sideBefore = readItem(env.wt, F);

  // 1. Draft a title change in the main checkout.
  await page.goto(itemUrl(env.mainId, F));
  await page.getByTestId("edit-title").fill("Draft title");

  // 2. Someone changes the item through the CLI meanwhile.
  const cli = runCli(["set", F, "--priority", "P0", "--repo", env.r.root]);
  assert.equal(cli.status, 0, cli.stderr);

  // 3. Save: 409, the draft survives, the server's values are shown beside it.
  await page.getByTestId("save").click();
  await page.getByTestId("conflict").waitFor();
  assert.equal(await page.getByTestId("edit-title").inputValue(), "Draft title");
  assert.equal(await page.getByTestId("server-priority").textContent(), "P0");
  assert.equal(await page.getByTestId("mine-title").textContent(), "Draft title");
  assert.match(readItem(env.r.root, F), /^# Feature$/m, "nothing was written by the failed save");

  // 4. Switch to the other checkout and back: the draft is still there.
  await page.getByTestId("checkout-select").selectOption(env.sideId);
  await page.waitForURL(new RegExp(`/${env.sideId}/board`));
  await page.goto(itemUrl(env.mainId, F));
  await page.getByTestId("conflict").waitFor();
  assert.equal(await page.getByTestId("edit-title").inputValue(), "Draft title");

  // 5. Explicit reconciliation, then save against the current revision.
  await page.getByTestId("keep-mine").click();
  await page.getByTestId("save").waitFor();
  assert.equal(await page.getByTestId("conflict").count(), 0);
  await page.getByTestId("save").click();
  await page.getByTestId("detail-title").filter({ hasText: "Draft title" }).waitFor();
  const saved = readItem(env.r.root, F);
  assert.match(saved, /^# Draft title$/m);
  assert.match(saved, /^priority: P0$/m, "the CLI's change was kept");
  assert.match(saved, /Body stays\.\n$/);
  assert.equal(readItem(env.wt, F), sideBefore, "the other checkout is untouched");

  // 6. Edit through the worktree checkout: only its file changes.
  const mainBefore = readItem(env.r.root, F);
  await page.goto(itemUrl(env.sideId, F));
  await page.getByTestId("edit-status").selectOption("wip");
  await page.getByTestId("save").click();
  await page.getByTestId("card-" + F).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="editor-message"]') !== null,
  );
  await waitFor(() => /^status: wip$/m.test(readItem(env.wt, F)));
  assert.equal(readItem(env.r.root, F), mainBefore, "the main checkout is untouched");

  // 7. Remove the relates edge stored on C from F's editor (main checkout).
  await page.goto(itemUrl(env.mainId, F));
  await page.getByTestId(`rel-remove-relates-${C}`).click();
  await waitFor(() => /^relates: \[\]$/m.test(readItem(env.r.root, C)));
  await page.getByTestId(`rel-remove-relates-${C}`).waitFor({ state: "detached" });

  assert.deepEqual(errors, []);
  await page.close();
});

test("facts, untrusted notes, discussion filters and draft-safe conflicts", async (t) => {
  if (skip) return t.skip(skip);
  t.diagnostic(`browser: ${how}`);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const set = (...args) => {
    const cli = runCli(["set", N, ...args, "--repo", env.r.root]);
    assert.equal(cli.status, 0, cli.stderr);
  };
  const only = (n) => new RegExp(`^${n}$`);

  // 1. Add an owner note; its payload is plain text, never markup.
  await page.goto(itemUrl(env.mainId, N));
  await page.getByTestId("note-add-input").fill("Is <b>this</b> right?");
  await page.getByTestId("note-add").click();
  await page.getByTestId("note").waitFor();
  assert.equal(await page.getByTestId("note-text").textContent(), "Is <b>this</b> right?");
  assert.equal(await page.locator('[data-testid="notes-panel"] b').count(), 0);
  assert.match(readItem(env.r.root, N), /^## Notes$/m);
  const noteRef = await page.getByTestId("note").getAttribute("data-ref");
  assert.match(await page.getByTestId("notes-panel").textContent(), /untrusted discussion/);

  // 2. Board badge, discussion filter in the URL, overview counts and filter.
  await page.getByTestId(`card-${N}`).filter({ hasText: "Needs discussion · 1" }).waitFor();
  await page.getByTestId("filter-discussion").check();
  await page.waitForURL(/discussion=1/);
  assert.equal(await page.getByTestId(`card-${F}`).count(), 0, "filter hides items without notes");
  await page.getByTestId(`card-${N}`).waitFor();
  await page.goto(`${env.v.server.url}#/`);
  await page
    .getByTestId("overview-open-notes")
    .first()
    .filter({ hasText: only(1) })
    .waitFor();
  await page
    .getByTestId("overview-discussion")
    .first()
    .filter({ hasText: only(1) })
    .waitFor();
  await page.getByTestId("filter-discussion").check();
  await page.waitForURL(/#\/\?discussion=1/);
  await page.reload();
  await page.getByTestId("overview-discussion").first().waitFor();
  assert.equal(await page.getByTestId("filter-discussion").isChecked(), true);
  await page.getByTestId("filter-discussion").uncheck();

  // 3. Edit the facts and save; the note survives byte for byte.
  await page.goto(itemUrl(env.mainId, N));
  await page.getByTestId("body-edit").click();
  await page.getByTestId("body-textarea").fill("Edited fact.\n");
  await page.getByTestId("body-save").click();
  await page.getByTestId("facts-panel").getByText("Edited fact.").waitFor();
  const afterBody = readItem(env.r.root, N);
  assert.match(afterBody, /Edited fact\./);
  assert.match(afterBody, /Is <b>this<\/b> right\?/);

  // 4. Resolve it right after the body save; history stays and the badge goes.
  await page.getByTestId("note-resolve").click();
  await page.locator('[data-testid="note"][data-state="resolved"]').waitFor();
  assert.equal(await page.getByTestId("note").getAttribute("data-ref"), noteRef);
  assert.equal(await page.getByTestId("note-resolve").count(), 0);
  assert.match(readItem(env.r.root, N), /· resolved · owner/);
  await page.getByTestId(`card-${N}`).waitFor();
  assert.equal(await page.getByTestId("discussion-badge").count(), 0);

  // 5. Body draft + CLI change: Save conflicts, the text stays, and it survives navigation and refresh.
  await page.getByTestId("body-edit").click();
  await page.getByTestId("body-textarea").fill("Draft body.\n");
  set("--title", "Retitled once");
  await page.getByTestId("body-save").click();
  await page.getByTestId("body-conflict").waitFor();
  assert.equal(await page.getByTestId("body-textarea").inputValue(), "Draft body.\n");
  assert.match(await page.getByTestId("body-current").textContent(), /Edited fact\./);
  assert.match(readItem(env.r.root, N), /Edited fact\./, "the failed save wrote nothing");
  assert.equal(await page.getByTestId("body-save").isDisabled(), true, "no retry before rebase");
  await page.goto(itemUrl(env.mainId, C));
  await page.goto(itemUrl(env.mainId, N));
  await page.getByTestId("body-conflict").waitFor();
  await page.locator("#refresh").click();
  await page.getByTestId("body-conflict").waitFor();
  assert.equal(await page.getByTestId("body-textarea").inputValue(), "Draft body.\n");
  await page.getByTestId("body-rebase").click();
  await page.getByTestId("body-save").waitFor();
  assert.equal(await page.getByTestId("body-conflict").count(), 0);
  await page.getByTestId("body-save").click();
  await page.getByTestId("facts-panel").getByText("Draft body.").waitFor();
  assert.match(readItem(env.r.root, N), /Draft body\./);
  assert.match(readItem(env.r.root, N), /^# Retitled once$/m, "the CLI's change was kept");

  // 6. A note being typed conflicts too, and keeps its text until reconciled.
  await page.getByTestId("note-add-input").fill("Second thought");
  set("--title", "Retitled twice");
  await page.getByTestId("note-add").click();
  await page.getByTestId("note-conflict").waitFor();
  assert.equal(await page.getByTestId("note-add-input").inputValue(), "Second thought");
  assert.equal(await page.getByTestId("note-add").isDisabled(), true);
  assert.doesNotMatch(readItem(env.r.root, N), /Second thought/);
  await page.getByTestId("note-rebase").click();
  await page.getByTestId("note-add").click();
  await page.locator('[data-testid="note"][data-state="open"]').waitFor();
  assert.match(readItem(env.r.root, N), /Second thought/);

  assert.deepEqual(errors, []);
  await page.close();
});

async function waitFor(check, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 50));
  }
}
