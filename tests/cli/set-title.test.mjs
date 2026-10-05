// 0.4.3: `set --title` rewrites the H1 only.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { makeRepo, readItem, runCli } from "../helpers/repository.mjs";

const repos = [];
const repo = () => {
  const r = makeRepo();
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const body = "Line one\n\n  indented  \n- bullet\n\n# not the title\ntail\n";
const addItem = (r) =>
  JSON.parse(
    runCli([
      "add",
      "--type",
      "task",
      "--priority",
      "P2",
      "--title",
      "Old",
      "--body",
      body,
      "--json",
      "--repo",
      r.root,
    ]).stdout,
  );
const fm = (text) => text.slice(0, text.indexOf("\n---", 4));
const rest = (text) => text.slice(text.indexOf("\n---", 4));

describe("set --title", () => {
  test("renames the H1 and leaves frontmatter and body bytes alone", () => {
    const r = repo();
    const id = addItem(r).data.id;
    const before = readItem(r.root, id);
    const out = runCli(["set", id, "--title", "  New title  ", "--repo", r.root]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /title/);
    const after = readItem(r.root, id);
    assert.equal(fm(after), fm(before));
    assert.equal(rest(after), rest(before).replace("# Old", "# New title"));
    assert.equal(runCli(["check", "--repo", r.root]).status, 0);
  });

  test("same title is a no-op", () => {
    const r = repo();
    const id = addItem(r).data.id;
    const before = readItem(r.root, id);
    const out = runCli(["set", id, "--title", "Old", "--repo", r.root]);
    assert.match(out.stdout, /no change/);
    assert.equal(readItem(r.root, id), before);
  });

  for (const [name, title] of [
    ["empty", ""],
    ["blank", "   "],
    ["multiline", "a\nb"],
  ]) {
    test(`rejects ${name} title and changes nothing`, () => {
      const r = repo();
      const id = addItem(r).data.id;
      const before = readItem(r.root, id);
      const out = runCli(["set", id, "--title", title, "--repo", r.root]);
      assert.notEqual(out.status, 0);
      assert.equal(readItem(r.root, id), before);
    });
  }

  test("works with --json", () => {
    const r = repo();
    const id = addItem(r).data.id;
    const out = runCli(["set", id, "--title", "Json title", "--json", "--repo", r.root]);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(JSON.parse(out.stdout).data.changed.includes("title"));
    assert.match(readItem(r.root, id), /\n# Json title\n/);
  });
});
