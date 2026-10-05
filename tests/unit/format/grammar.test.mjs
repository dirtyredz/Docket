// Strict item grammar: every forbidden form is rejected with the expected rule and code.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseItem } from "../../../src/core/format/parse.mjs";
import { checkItemFields } from "../../../src/core/validation/items.mjs";
import { itemText } from "../../helpers/repository.mjs";

const NAME = "dk-00000001.md";
const errorsOf = (input) => parseItem(input).errors;
const has = (errors, rule, code) => errors.some((e) => e.rule === rule && e.code === code);

/** Replace the whole frontmatter line starting with `key:` (or insert extra lines after it). */
function withLine(key, replacement) {
  return itemText().replace(new RegExp(`^${key}:.*$`, "m"), replacement);
}

function expectRejected(text, rule, code) {
  const errors = errorsOf(text);
  assert.ok(
    has(errors, rule, code),
    `expected rule ${rule} ${code}, got ${JSON.stringify(errors)}`,
  );
}

describe("canonical input", () => {
  test("a canonical item parses with no errors", () => {
    const r = parseItem(itemText());
    assert.deepEqual(r.errors, []);
    assert.equal(r.title, "Test item");
    assert.equal(r.fields.id, "dk-00000001");
  });
});

describe("forbidden value forms (rule 3)", () => {
  const cases = [
    ["double quotes", 'area: "x"'],
    ["single quotes", "area: 'x'"],
    ["literal block scalar", "area: |"],
    ["folded block scalar", "area: >"],
    ["anchor", "area: &a"],
    ["alias", "area: *a"],
    ["trailing comment", "area: eng # c"],
    ["free text with spaces", "area: two words"],
    ["two spaces after the colon", "area:  eng"],
    ["rank not [a-z]+ (uppercase)", "rank: ABC"],
    ["rank not [a-z]+ (digit)", "rank: a1"],
    ["parent not an ID", "parent: not-an-id"],
    ["required key empty", "rank:"],
    ["list without spaces", "relates: [dk-00000002,dk-00000003]"],
    ["list with a blank member", "relates: [ ]"],
    ["list with non-ID members", "blocked_by: [one, two]"],
    ["cross-repo reference in a list", "relates: [other#dk-00000002]"],
    ["scalar given a list", "area: [dk-00000002]"],
    ["date with wrong shape", "created: 2026-1-1"],
  ];
  for (const [name, line] of cases) {
    test(name, () => {
      const key = line.slice(0, line.indexOf(":"));
      expectRejected(withLine(key, line), 3, "value");
    });
  }

  test("key:value without a space is not a key line", () => {
    expectRejected(withLine("area", "area:eng"), 3, "line");
  });
  test("a comment line inside the frontmatter", () => {
    expectRejected(itemText().replace("area:", "# comment\narea:"), 3, "line");
  });
  test("nested map (indented sub key)", () => {
    expectRejected(withLine("area", "area:\n  sub: x"), 3, "line");
  });
  test("multi-line value", () => {
    expectRejected(withLine("area", "area: eng\n  continued"), 3, "line");
  });
  test("tab in frontmatter", () => {
    expectRejected(withLine("area", "area:\teng"), 3, "tab");
  });
  test("trailing space in frontmatter", () => {
    expectRejected(withLine("area", "area: eng "), 3, "trailing-space");
  });
  test("CRLF line endings", () => {
    expectRejected(itemText().replaceAll("\n", "\r\n"), 3, "crlf");
  });
});

describe("keys (rule 2)", () => {
  test("duplicate key", () => {
    expectRejected(withLine("area", "area:\narea:"), 2, "duplicate-key");
  });
  test("unknown key", () => {
    expectRejected(withLine("area", "area:\nowner: me"), 2, "unknown-key");
  });
  test("missing key", () => {
    expectRejected(itemText().replace(/^relates:.*\n/m, ""), 2, "missing-key");
  });
  test("keys out of order", () => {
    const swapped = itemText().replace(
      "type: task\ncreated: 2026-01-01",
      "created: 2026-01-01\ntype: task",
    );
    expectRejected(swapped, 2, "key-order");
  });
});

describe("encoding (rule 3)", () => {
  test("UTF-8 BOM, as bytes", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(itemText())]);
    const r = parseItem(bytes);
    assert.equal(r.fields, null);
    assert.ok(has(r.errors, 3, "bom"));
  });
  test("invalid UTF-8 bytes", () => {
    const bytes = Buffer.concat([Buffer.from(itemText()), Buffer.from([0xff, 0xfe, 0x80])]);
    const r = parseItem(bytes);
    assert.equal(r.fields, null);
    assert.ok(has(r.errors, 3, "utf8"));
  });
});

describe("fences (rule 1)", () => {
  test("missing opening fence", () => {
    const r = parseItem(itemText().replace(/^---\n/, ""));
    assert.equal(r.fields, null);
    assert.ok(has(r.errors, 1, "fence"));
  });
  test("unclosed fence", () => {
    const r = parseItem(itemText().replace(/\n---\n/, "\n"));
    assert.equal(r.fields, null);
    assert.ok(has(r.errors, 1, "fence"));
  });
});

describe("H1 (rule 5)", () => {
  const fm = itemText().split("# Test item")[0];
  test("missing H1", () => expectRejected(`${fm}just prose\n`, 5, "title"));
  test("empty file after the fence", () => expectRejected(fm, 5, "title"));
  test("# without a space", () => expectRejected(`${fm}#Title\n`, 5, "title"));
  test("empty H1 text", () => expectRejected(`${fm}# \n`, 5, "title"));
  test("H2 is not an H1", () => expectRejected(`${fm}## Title\n`, 5, "title"));
  test("body text before the H1", () => expectRejected(`${fm}intro\n# Title\n`, 5, "title"));
  test("blank lines before the H1 are fine", () => {
    const r = parseItem(`${fm}\n\n\n# Title\n\nbody\n`);
    assert.deepEqual(r.errors, []);
    assert.equal(r.title, "Title");
  });
});

describe("body freedom", () => {
  test("tabs and trailing spaces in the body are allowed", () => {
    const text = itemText({}, { body: "line with tab\there \n\ttabbed   \n" });
    assert.deepEqual(errorsOf(text), []);
  });
});

describe("dates (rule 4, via checkItemFields)", () => {
  const codes = (fields) => checkItemFields({ ...parseItem(itemText(fields)).fields }, NAME);
  test("2026-02-30 is not a real date", () => {
    assert.ok(has(codes({ created: "2026-02-30", since: "2026-03-01" }), 4, "date"));
  });
  test("2026-13-01 is not a real date", () => {
    assert.ok(has(codes({ since: "2026-13-01" }), 4, "date"));
  });
  test("2024-02-29 (leap day) is accepted", () => {
    assert.deepEqual(codes({ created: "2024-02-29", since: "2024-02-29" }), []);
  });
  test("2026-02-29 (not a leap year) is rejected", () => {
    assert.ok(has(codes({ created: "2026-02-29", since: "2026-03-01" }), 4, "date"));
  });
  test("since before created is rejected", () => {
    assert.ok(
      has(codes({ created: "2026-05-02", since: "2026-05-01" }), 4, "since-before-created"),
    );
  });
  test("since equal to created is accepted", () => {
    assert.deepEqual(codes({ created: "2026-05-01", since: "2026-05-01" }), []);
  });
});
