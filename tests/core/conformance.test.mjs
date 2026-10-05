// Conformance of the recovered prototype checker (src/bootstrap/prototype-check.mjs) with the
// production checkSnapshot: they agree on what the prototype covers, then each documented
// difference is pinned by its own test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkDir } from "../../src/bootstrap/prototype-check.mjs";
import { checkSnapshot } from "../../src/core/validation/check.mjs";
import { itemText, tempDir } from "../helpers/repository.mjs";

const A = "dk-0000000a";
const B = "dk-0000000b";

/** Files = {name: text|Buffer}. Writes them to a temp store and runs both checkers. */
function both(t, files) {
  const { dir, cleanup } = tempDir("docket conformance ");
  t.after(cleanup);
  const items = path.join(dir, "docs", "items");
  fs.mkdirSync(items, { recursive: true });
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(items, name), content);
  const entries = Object.entries(files).map(([name, content]) => ({
    name,
    isFile: true,
    bytes: Buffer.from(content),
  }));
  const production = checkSnapshot({ source: "test", entries });
  const prototype = checkDir(dir);
  return { production, prototype, prodOk: production.ok, protoOk: prototype.length === 0 };
}

const one = (fields, opts) => {
  const id = fields.id ?? A;
  return { [`${id}.md`]: itemText({ ...fields, id }, opts) };
};
const text = (fields = {}, edit = (s) => s) => {
  const id = fields.id ?? A;
  return { [`${id}.md`]: edit(itemText({ ...fields, id })) };
};

function agree(t, files, expectOk) {
  const r = both(t, files);
  assert.equal(r.prodOk, expectOk, `production: ${JSON.stringify(r.production.errors)}`);
  assert.equal(r.protoOk, expectOk, `prototype: ${JSON.stringify(r.prototype)}`);
}

test("both pass a valid store", (t) => {
  agree(
    t,
    {
      ...one({ id: A, relates: [B], rank: "a" }),
      ...one({ id: B, type: "bug", fixes: [A], rank: "b" }),
    },
    true,
  );
});

const rejectedByBoth = {
  "bad filename": { "README.md": itemText({ id: A }) },
  "missing fence": text({}, (s) => s.replace(/^---\n/, "")),
  "wrong key order": text({}, (s) =>
    s.replace("type: task\ncreated: 2026-01-01\n", "created: 2026-01-01\ntype: task\n"),
  ),
  "bad enum": one({ status: "open" }),
  "bad date shape": one({ created: "2026-1-01", since: "2026-1-01" }),
  "id differs from filename": { [`${A}.md`]: itemText({ id: B }) },
  "dangling ref": one({ blocked_by: [B] }),
  "self ref": one({ parent: A }),
  "fixes on non-bug": {
    ...one({ id: A, type: "task", fixes: [B] }),
    ...one({ id: B, type: "feature", rank: "o" }),
  },
  "parent cycle": { ...one({ id: A, parent: B }), ...one({ id: B, parent: A, rank: "o" }) },
  "blocked_by cycle": {
    ...one({ id: A, blocked_by: [B] }),
    ...one({ id: B, blocked_by: [A], rank: "o" }),
  },
  "since before created": one({ created: "2026-03-01", since: "2026-02-01" }),
};

for (const [label, files] of Object.entries(rejectedByBoth)) {
  test(`both reject: ${label}`, (t) => agree(t, files, false));
}

// Documented difference (premise corrected): the prototype has no BOM check, but it only rejects a
// BOM by accident (the BOM breaks its line-1 fence test). Both fail; only production names the cause.
test("difference: both reject a UTF-8 BOM, but only production reports it as a BOM", (t) => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(itemText({ id: A }))]);
  const r = both(t, { [`${A}.md`]: bytes });
  assert.equal(r.prodOk, false);
  assert.ok(r.production.errors.some((e) => e.code === "bom"));
  assert.equal(r.protoOk, false);
  assert.ok(r.prototype.every((m) => !/bom|byte-order/i.test(m)));
});

// Documented difference: Date.parse accepts 2026-02-30 (rolls over), production checks a real date.
test("difference: production rejects an impossible date, the prototype passes it", (t) => {
  const r = both(t, one({ created: "2026-02-30", since: "2026-02-30" }));
  assert.equal(r.prodOk, false);
  assert.ok(r.production.errors.some((e) => e.code === "date"));
  assert.equal(r.protoOk, true);
});

// Documented difference: the prototype never checks the type of a fixes target.
test("difference: production rejects a fixes target of type idea, the prototype passes it", (t) => {
  const r = both(t, {
    ...one({ id: A, type: "bug", fixes: [B] }),
    ...one({ id: B, type: "idea", rank: "o" }),
  });
  assert.equal(r.prodOk, false);
  assert.ok(r.production.errors.some((e) => e.code === "fixes-target"));
  assert.equal(r.protoOk, true);
});

// Documented difference: the prototype scans the whole file for tabs and trailing spaces, body
// included; production applies the whitespace rules to the frontmatter only.
test("difference: production allows a tab in the body, the prototype rejects it", (t) => {
  const r = both(t, { [`${A}.md`]: itemText({ id: A }, { body: "col1\tcol2\n" }) });
  assert.equal(r.prodOk, true);
  assert.equal(r.protoOk, false);
});

test("difference: production allows trailing spaces in the body, the prototype rejects them", (t) => {
  const r = both(t, { [`${A}.md`]: itemText({ id: A }, { body: "line with trailing  \nnext\n" }) });
  assert.equal(r.prodOk, true);
  assert.equal(r.protoOk, false);
});

// Documented difference: the prototype has no rule 9 warnings at all.
test("difference: duplicate rank passes silently in the prototype, warns in production", (t) => {
  const r = both(t, {
    ...one({ id: A, rank: "m" }),
    ...one({ id: B, rank: "m" }),
  });
  assert.equal(r.prodOk, true);
  assert.deepEqual(
    r.production.warnings.map((w) => w.code),
    ["duplicate-rank", "duplicate-rank"],
  );
  assert.equal(r.protoOk, true);
});
