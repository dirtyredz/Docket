// Browser acceptance of the editor conflict flow (Playwright library, node:test runner): a draft
// survives a CLI edit, the save returns 409 without losing input, explicit reconciliation saves, drafts
// survive checkout switching, only the selected checkout changes, and a reverse-stored relation is
// removed from the other item's file. Uses Playwright's Chromium when installed, else the system's
// Edge or Chrome; skips (never fakes) when no browser can start.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addWorktree, appData, docketRepo, register, viewer } from "../helpers/viewer.mjs";
import { itemText, readItem, runCli } from "../helpers/repository.mjs";

const F = "dk-0000f001";
const C = "dk-0000c001";

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

async function waitFor(check, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 50));
  }
}
