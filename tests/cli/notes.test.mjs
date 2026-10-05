// `dk note`: append and resolve discussion notes through real child processes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { itemText, makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const A = "dk-aaaaaaaa";
const REF = "2026-10-05T10:00:00.000Z";
const NOTED = itemText(
  { id: A },
  { body: `Facts.\n\n## Notes\n\n### ${REF} · open · owner\n\nexisting\n` },
);
const repos = [];
const repo = (items = { [A]: itemText({ id: A }) }) => {
  const r = makeRepo(items);
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const dk = (r, args, opts) => runCli([...args, "--json", "--repo", r.root], opts);
const revisionOf = (r) => dk(r, ["show", A]).json.data.revision;
const noStderr = (out) => assert.equal(out.stderr, "", out.stderr);
const usage = (out) => {
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.equal(out.json.ok, false);
  assert.equal(out.json.error.code, "DOCKET_USAGE");
  noStderr(out);
};

describe("note add", () => {
  test("appends an owner note and reports data", () => {
    const r = repo();
    const out = dk(r, ["note", A, "hello\nworld"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const d = out.json.data;
    assert.equal(d.id, A);
    assert.match(d.ref, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(d.author, "owner");
    assert.equal(d.state, "open");
    assert.equal(d.noop, false);
    assert.equal(d.revision, revisionOf(r));
    assert.ok(readItem(r.root, A).includes(`### ${d.ref} · open · owner\n\nhello\nworld\n`));
    noStderr(out);
  });

  test("human output names the ref, author and state", () => {
    const r = repo();
    const out = runCli(["note", A, "x", "--author", "agent", "--repo", r.root]);
    assert.equal(out.status, 0);
    assert.match(out.stdout, new RegExp(`^${A}: note \\d{4}-[\\d\\-T:.]+Z \\(agent, open\\)\\n$`));
    assert.equal(out.stderr, "");
  });

  test("--author agent is recorded", () => {
    const r = repo();
    const out = dk(r, ["note", A, "from an agent", "--author", "agent"]);
    assert.equal(out.json.data.author, "agent");
    assert.match(readItem(r.root, A), / · open · agent\n/);
  });

  test("two notes get distinct refs and keep order", () => {
    const r = repo();
    const one = dk(r, ["note", A, "one"]).json.data.ref;
    const two = dk(r, ["note", A, "two"]).json.data.ref;
    assert.notEqual(one, two);
    const text = readItem(r.root, A);
    assert.ok(text.indexOf(one) < text.indexOf(two));
  });

  test("--file reads a file and --file - reads stdin", () => {
    const r = repo();
    const f = path.join(r.dir, "note.txt");
    fs.writeFileSync(f, "from file ü\n");
    assert.equal(dk(r, ["note", A, "--file", f]).status, 0);
    const out = dk(r, ["note", A, "--file", "-"], { input: "from stdin\nline two\n" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const text = readItem(r.root, A);
    assert.ok(text.includes("from file ü"));
    assert.ok(text.includes("from stdin\nline two"));
  });

  test("--expect with the current revision succeeds; a stale one is a conflict", () => {
    const r = repo();
    const rev = revisionOf(r);
    assert.equal(dk(r, ["note", A, "ok", "--expect", rev]).status, 0);
    const before = readItem(r.root, A);
    const stale = dk(r, ["note", A, "late", "--expect", rev]);
    assert.equal(stale.status, 3);
    assert.equal(stale.json.error.code, "DOCKET_CONFLICT");
    noStderr(stale);
    assert.equal(readItem(r.root, A), before);
  });

  test("unknown item is not found (4)", () => {
    const r = repo();
    const out = dk(r, ["note", "dk-99999999", "x"]);
    assert.equal(out.status, 4);
    assert.equal(out.json.error.code, "DOCKET_NOT_FOUND");
    noStderr(out);
  });

  test("usage errors: both sources, no source, CR, unknown author, bad input", () => {
    const r = repo();
    const before = readItem(r.root, A);
    usage(dk(r, ["note", A, "text", "--file", "-"], { input: "other\n" }));
    usage(dk(r, ["note", A]));
    usage(dk(r, ["note", A, "has\r\ncr"]));
    usage(dk(r, ["note", A, "x", "--author", "robot"]));
    usage(dk(r, ["note", A, "--file", "-"], { input: "has\r\ncr\n" }));
    usage(dk(r, ["note", A, "--file", "-"], { input: Buffer.from([0x68, 0xff, 0xfe, 0x0a]) }));
    usage(dk(r, ["note", A, "--file", path.join(r.dir, "does-not-exist.txt")]));
    assert.equal(readItem(r.root, A), before);
  });

  test("a note containing a bare heading is refused (1) and the file is unchanged", () => {
    const r = repo();
    const before = readItem(r.root, A);
    const out = dk(r, ["note", A, "intro\n## Notes\nmore"]);
    assert.equal(out.status, 1, out.stdout);
    assert.equal(out.json.error.code, "DOCKET_INVALID");
    noStderr(out);
    assert.equal(readItem(r.root, A), before);
  });
});

describe("note resolve", () => {
  test("resolves one note, changing only its state token", () => {
    const r = repo({ [A]: NOTED });
    const before = readItem(r.root, A);
    const out = dk(r, ["note", "resolve", A, REF]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const d = out.json.data;
    assert.deepEqual(
      { id: d.id, ref: d.ref, state: d.state, noop: d.noop },
      { id: A, ref: REF, state: "resolved", noop: false },
    );
    assert.equal(d.revision, revisionOf(r));
    assert.equal(readItem(r.root, A), before.replace("· open ·", "· resolved ·"));
  });

  test("resolving again is a no-op carrying the current revision", () => {
    const r = repo({ [A]: NOTED });
    dk(r, ["note", "resolve", A, REF]);
    const rev = revisionOf(r);
    const text = readItem(r.root, A);
    const out = dk(r, ["note", "resolve", A, REF]);
    assert.equal(out.status, 0);
    assert.equal(out.json.data.noop, true);
    assert.equal(out.json.data.state, "resolved");
    assert.equal(out.json.data.revision, rev);
    assert.equal(readItem(r.root, A), text);
  });

  test("absent ref is not found (4); malformed ref is usage (2)", () => {
    const r = repo({ [A]: NOTED });
    const gone = dk(r, ["note", "resolve", A, "2020-01-01T00:00:00.000Z"]);
    assert.equal(gone.status, 4);
    assert.equal(gone.json.error.code, "DOCKET_NOT_FOUND");
    noStderr(gone);
    usage(dk(r, ["note", "resolve", A, "yesterday"]));
  });

  test("stale --expect is a conflict (3); the current revision works", () => {
    const r = repo({ [A]: NOTED });
    const stale = dk(r, ["note", "resolve", A, REF, "--expect", "0000000000000000"]);
    assert.equal(stale.status, 3);
    assert.equal(stale.json.error.code, "DOCKET_CONFLICT");
    noStderr(stale);
    assert.equal(dk(r, ["note", "resolve", A, REF, "--expect", revisionOf(r)]).status, 0);
  });

  test("human output", () => {
    const r = repo({ [A]: NOTED });
    const out = runCli(["note", "resolve", A, REF, "--repo", r.root]);
    assert.equal(out.stdout, `${A}: resolved ${REF}\n`);
    const again = runCli(["note", "resolve", A, REF, "--repo", r.root]);
    assert.equal(again.stdout, `${A}: note ${REF} already resolved\n`);
  });

  test("missing arguments are usage errors", () => {
    const r = repo({ [A]: NOTED });
    usage(dk(r, ["note", "resolve", A]));
    usage(dk(r, ["note", "resolve", A, REF, "extra"]));
  });
});
