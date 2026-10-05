// `dk set --body-file`: a deliberate facts rewrite that keeps the Notes section.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { itemText, makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const A = "dk-aaaaaaaa";
const REF = "2026-10-05T10:00:00.000Z";
const NOTES = `## Notes\n\n### ${REF} · open · agent\n\nuntrusted remark\n`;
const WITH_NOTES = itemText({ id: A }, { title: "Title", body: `Old facts.\n\n${NOTES}` });
const repos = [];
const repo = (text = itemText({ id: A }, { title: "Title" })) => {
  const r = makeRepo({ [A]: text });
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const dk = (r, args, opts) => runCli([...args, "--json", "--repo", r.root], opts);
const rev = (r) => dk(r, ["show", A]).json.data.revision;
const setBody = (r, input, extra = ["--expect", rev(r)]) =>
  dk(r, ["set", A, "--body-file", "-", ...extra], { input });
const code = (out, status, name) => {
  assert.equal(out.status, status, out.stdout + out.stderr);
  assert.equal(out.json.ok, false);
  assert.equal(out.json.error.code, name);
  assert.equal(out.stderr, "");
};

describe("set --body-file", () => {
  test("replaces exactly the text after the H1 and keeps the Notes", () => {
    const r = repo(WITH_NOTES);
    const out = setBody(r, "\nNew facts.\n\nSecond para.\n");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.id, A);
    assert.equal(out.json.data.noop, false);
    assert.equal(out.json.data.revision, rev(r));
    const text = readItem(r.root, A);
    assert.ok(text.endsWith(`# Title\n\nNew facts.\n\nSecond para.\n\n${NOTES}`), text);
    assert.ok(text.startsWith("---\nid: dk-aaaaaaaa\n"));
  });

  test("reads from a file path too", () => {
    const r = repo();
    const f = path.join(r.dir, "body.md");
    fs.writeFileSync(f, "\nFrom a file.\n");
    const out = dk(r, ["set", A, "--body-file", f, "--expect", rev(r)]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(readItem(r.root, A).endsWith("# Title\n\nFrom a file.\n"));
  });

  test("empty input clears the body but keeps the Notes", () => {
    const r = repo(WITH_NOTES);
    const out = setBody(r, "");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const text = readItem(r.root, A);
    assert.ok(text.includes("# Title\n"));
    assert.ok(!text.includes("Old facts"));
    assert.ok(text.endsWith(NOTES), text);
    const show = dk(r, ["show", A]).json.data;
    assert.equal(show.body.trim(), "");
    assert.equal(show.openNoteCount, 1);
  });

  test("an unchanged body is a no-op with the current revision", () => {
    const r = repo(WITH_NOTES);
    const show = dk(r, ["show", A]).json.data;
    const before = readItem(r.root, A);
    const out = setBody(r, show.bodySource);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.noop, true);
    assert.equal(out.json.data.revision, show.revision);
    assert.equal(readItem(r.root, A), before);
  });

  test("human output", () => {
    const r = repo();
    const args = (r2) => ["set", A, "--body-file", "-", "--expect", rev(r2), "--repo", r2.root];
    const first = runCli(args(r), { input: "\nx\n" });
    assert.equal(first.stdout, `${A}: body\n`);
    const same = runCli(args(r), { input: "\nx\n" });
    assert.equal(same.stdout, `${A}: no change\n`);
  });

  test("missing --expect is usage (2) and writes nothing", () => {
    const r = repo();
    const before = readItem(r.root, A);
    code(setBody(r, "x\n", []), 2, "DOCKET_USAGE");
    assert.equal(readItem(r.root, A), before);
  });

  test("combined with other set flags is usage (2)", () => {
    const r = repo();
    const before = readItem(r.root, A);
    for (const flags of [["--status", "wip"], ["--title", "T"], ["--priority", "P0"], ["--top"]]) {
      code(setBody(r, "x\n", ["--expect", rev(r), ...flags]), 2, "DOCKET_USAGE");
    }
    assert.equal(readItem(r.root, A), before);
  });

  test("stale --expect is a conflict (3)", () => {
    const r = repo();
    const stale = rev(r);
    assert.equal(setBody(r, "\nfirst\n").status, 0);
    const before = readItem(r.root, A);
    code(setBody(r, "\nsecond\n", ["--expect", stale]), 3, "DOCKET_CONFLICT");
    assert.equal(readItem(r.root, A), before);
  });

  test("CRLF input and invalid UTF-8 are usage errors (2)", () => {
    const r = repo();
    const before = readItem(r.root, A);
    code(setBody(r, "a\r\nb\r\n"), 2, "DOCKET_USAGE");
    code(setBody(r, Buffer.from([0x61, 0xc3, 0x28, 0x0a])), 2, "DOCKET_USAGE");
    assert.equal(readItem(r.root, A), before);
  });

  test("a body with a `## Notes` line is invalid (1) and the file is unchanged", () => {
    const r = repo(WITH_NOTES);
    const before = readItem(r.root, A);
    code(setBody(r, "\nfacts\n\n## Notes\n\nsmuggled\n"), 1, "DOCKET_INVALID");
    assert.equal(readItem(r.root, A), before);
    const bare = repo();
    const bareBefore = readItem(bare.root, A);
    code(setBody(bare, "\nfacts\n## Notes\n"), 1, "DOCKET_INVALID");
    assert.equal(readItem(bare.root, A), bareBefore);
  });

  test("unknown item is not found (4)", () => {
    const r = repo();
    const out = dk(r, ["set", "dk-99999999", "--body-file", "-", "--expect", "x"], { input: "" });
    code(out, 4, "DOCKET_NOT_FOUND");
  });
});
