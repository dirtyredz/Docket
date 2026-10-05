// Note lifecycle on real temp repositories: append, resolve, refusals, byte preservation.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { addNote, resolveNote } from "../../src/core/items/content/notes.mjs";
import { readItem } from "../../src/core/items/detail.mjs";
import { parseEntries } from "../../src/core/validation/check.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { workingSnapshot } from "../../src/repository/snapshot.mjs";
import { readItemFile } from "../../src/storage/item-store.mjs";
import { itemText, makeRepo, readItem as fileOf } from "../helpers/repository.mjs";

const A = "dk-0000a001";
const B = "dk-0000b002";
const NOW = new Date("2026-10-05T14:03:00.000Z");
const STALE = "0000000000000000";
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

const hdr = (ref, state = "open", author = "owner") => `### ${ref} · ${state} · ${author}`;

function setup(items) {
  const r = makeRepo(items ?? { [A]: itemText({ id: A }, { title: "A" }) });
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}
const rev = (ctx, id = A) => readItemFile(ctx, id).revision;
const add = (ctx, text, extra = {}, opts = {}) =>
  addNote(ctx, A, { text, ...extra }, { now: NOW, ...opts });
const frontmatterOf = (text) => text.slice(0, text.indexOf("\n---\n", 4) + 5);
const withNotes = (body) => itemText({ id: A }, { title: "A", body });

describe("addNote", () => {
  test("appending to a legacy item keeps the original bytes as a prefix", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    const res = add(ctx, "Question?");
    const after = fileOf(r.root, A);
    assert.ok(after.startsWith(before));
    assert.equal(after, `${before}\n## Notes\n\n${hdr(res.ref)}\n\nQuestion?\n`);
    assert.equal(res.ref, "2026-10-05T14:03:00.000Z");
    assert.equal(res.state, "open");
    assert.equal(res.noop, false);
    assert.equal(res.revision, rev(ctx));
  });

  test("frontmatter bytes are identical after an append", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    add(ctx, "Q");
    assert.equal(frontmatterOf(fileOf(r.root, A)), frontmatterOf(before));
  });

  test("author defaults to owner; agent is accepted; others are rejected", () => {
    const { r, ctx } = setup();
    assert.equal(add(ctx, "one").author, "owner");
    assert.equal(add(ctx, "two", { author: "agent" }).author, "agent");
    const text = fileOf(r.root, A);
    assert.match(text, / · open · owner\n/);
    assert.match(text, / · open · agent\n/);
    for (const author of ["robot", "Owner", "", "owner · x"]) {
      assert.throws(() => add(ctx, "bad", { author }), { code: "DOCKET_INVALID" }, author);
    }
    assert.equal(fileOf(r.root, A), text);
  });

  test("a second append keeps the first byte for byte", () => {
    const { r, ctx } = setup();
    add(ctx, "first");
    const first = fileOf(r.root, A);
    addNote(ctx, A, { text: "second" }, { now: new Date("2026-10-05T15:00:00.000Z") });
    assert.ok(fileOf(r.root, A).startsWith(first));
  });

  test("two appends with the same now get .000Z and .001Z", () => {
    const { ctx } = setup();
    assert.equal(add(ctx, "a").ref, "2026-10-05T14:03:00.000Z");
    assert.equal(add(ctx, "b").ref, "2026-10-05T14:03:00.001Z");
  });

  test("a stale expect is DOCKET_CONFLICT and writes nothing", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    assert.throws(() => add(ctx, "q", {}, { expect: STALE }), { code: "DOCKET_CONFLICT" });
    assert.equal(fileOf(r.root, A), before);
    assert.doesNotThrow(() => add(ctx, "q", {}, { expect: rev(ctx) }));
  });

  test("blank text and CR text are rejected", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    for (const text of ["", "   ", "\n\n", "a\r\nb", "a\rb"]) {
      assert.throws(() => add(ctx, text), { code: "DOCKET_INVALID" }, JSON.stringify(text));
    }
    assert.equal(fileOf(r.root, A), before);
  });

  test("text with an unfenced heading is rejected and the file is unchanged", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    for (const text of [
      "## Heading\nmore",
      "intro\n\n# Title",
      "ok\n\n### 2026-10-05T14:03:00.000Z · open · owner\n\nx",
    ]) {
      assert.throws(() => add(ctx, text), { code: "DOCKET_INVALID" }, text);
    }
    assert.equal(fileOf(r.root, A), before);
  });

  test("fenced headings in note text are accepted", () => {
    const { ctx } = setup();
    assert.doesNotThrow(() => add(ctx, "Example:\n\n```md\n## Heading\n```"));
  });

  test("a target with malformed Notes is DOCKET_INVALID and unchanged", () => {
    const { r, ctx } = setup({ [A]: withNotes("Body.\n\n## Notes\n\nstray text\n") });
    const before = fileOf(r.root, A);
    assert.throws(() => add(ctx, "q"), { code: "DOCKET_INVALID" });
    assert.equal(fileOf(r.root, A), before);
  });

  test("an unrelated malformed item does not block an append", () => {
    const { r, ctx } = setup({
      [A]: itemText({ id: A }, { title: "A" }),
      [B]: itemText({ id: B, rank: "b" }, { title: "B", body: "x\n\n## Notes\n\n### nope\n" }),
    });
    const broken = fileOf(r.root, B);
    assert.doesNotThrow(() => add(ctx, "fine"));
    assert.equal(fileOf(r.root, B), broken);
  });

  test("a missing item is DOCKET_NOT_FOUND", () => {
    const { ctx } = setup();
    assert.throws(() => addNote(ctx, "dk-0000ffff", { text: "q" }, { now: NOW }), {
      code: "DOCKET_NOT_FOUND",
    });
  });
});

describe("resolveNote", () => {
  const R = "2026-10-05T14:03:00.000Z";
  const R2 = "2026-10-05T14:04:00.000Z";
  const twoNotes = `Body.\n\n## Notes\n\n${hdr(R)}\n\nfirst\n\n${hdr(R2)}\n\nsecond\n`;

  test("changes only the state token", () => {
    const { r, ctx } = setup({ [A]: withNotes(twoNotes) });
    const before = fileOf(r.root, A);
    const res = resolveNote(ctx, A, R2, { expect: rev(ctx) });
    assert.equal(res.noop, false);
    assert.equal(res.state, "resolved");
    assert.equal(fileOf(r.root, A), before.replace(hdr(R2), hdr(R2, "resolved")));
    assert.equal(res.revision, rev(ctx));
  });

  test("an absent ref is DOCKET_NOT_FOUND", () => {
    const { ctx } = setup({ [A]: withNotes(twoNotes) });
    assert.throws(() => resolveNote(ctx, A, "2026-01-01T00:00:00.000Z"), {
      code: "DOCKET_NOT_FOUND",
    });
  });

  test("a malformed ref is DOCKET_USAGE", () => {
    const { ctx } = setup({ [A]: withNotes(twoNotes) });
    assert.throws(() => resolveNote(ctx, A, "yesterday"), { code: "DOCKET_USAGE" });
  });

  test("an already-resolved note is a no-op with the current revision", () => {
    const { r, ctx } = setup({
      [A]: withNotes(`Body.\n\n## Notes\n\n${hdr(R, "resolved")}\n\nfirst\n`),
    });
    const before = fileOf(r.root, A);
    const res = resolveNote(ctx, A, R);
    assert.equal(res.noop, true);
    assert.equal(res.revision, rev(ctx));
    assert.equal(fileOf(r.root, A), before);
  });

  test("a stale expect on a no-op resolve is still a conflict", () => {
    const { ctx } = setup({
      [A]: withNotes(`Body.\n\n## Notes\n\n${hdr(R, "resolved")}\n\nfirst\n`),
    });
    assert.throws(() => resolveNote(ctx, A, R, { expect: STALE }), { code: "DOCKET_CONFLICT" });
  });

  test("a stale expect on a real resolve is a conflict and writes nothing", () => {
    const { r, ctx } = setup({ [A]: withNotes(twoNotes) });
    const before = fileOf(r.root, A);
    assert.throws(() => resolveNote(ctx, A, R, { expect: STALE }), { code: "DOCKET_CONFLICT" });
    assert.equal(fileOf(r.root, A), before);
  });
});

describe("readItem", () => {
  test("shows notes separate from the facts body, with the open count", () => {
    const { r, ctx } = setup({
      [A]: withNotes(
        `Facts here.\n\n## Notes\n\n${hdr("2026-10-05T14:03:00.000Z", "resolved")}\n\nold\n\n${hdr("2026-10-05T14:04:00.000Z", "open", "agent")}\n\nnew\n`,
      ),
    });
    const claims = { readClaims: () => ({ claims: {} }) };
    const records = parseEntries(workingSnapshot(ctx).entries);
    const { data } = readItem(ctx, A, { records, claims });
    assert.equal(data.body, "Facts here.\n");
    assert.equal(data.bodySource, "\nFacts here.\n");
    assert.doesNotMatch(data.body, /Notes|old|new/);
    assert.equal(data.openNoteCount, 1);
    assert.equal(data.notesMalformed, false);
    assert.equal(data.notesSource, null);
    assert.deepEqual(
      data.notes.map((n) => [n.ref, n.state, n.author, n.text]),
      [
        ["2026-10-05T14:03:00.000Z", "resolved", "owner", "old"],
        ["2026-10-05T14:04:00.000Z", "open", "agent", "new"],
      ],
    );
    assert.ok(r.root);
  });

  test("malformed Notes are flagged and surfaced as raw source, not folded into the body", () => {
    const { ctx } = setup({ [A]: withNotes("Facts.\n\n## Notes\n\nstray\n") });
    const claims = { readClaims: () => ({ claims: {} }) };
    const records = parseEntries(workingSnapshot(ctx).entries);
    const { data } = readItem(ctx, A, { records, claims });
    assert.equal(data.notesMalformed, true);
    assert.match(data.notesSource, /^\n## Notes\n/);
    assert.doesNotMatch(data.body, /stray/);
  });
});
