// Parse then serialize: canonical input comes back byte for byte, bodies are never touched.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KEYS } from "../../src/core/format/schema.mjs";
import { parseItem } from "../../src/core/format/parse.mjs";
import { newItemRest } from "../../src/core/format/content.mjs";
import { serializeFrontmatter, serializeItem } from "../../src/core/format/serialize.mjs";
import { itemText } from "../helpers/repository.mjs";

const roundtrip = (text) => {
  const { fields, rest, errors } = parseItem(text);
  assert.deepEqual(errors, []);
  return serializeItem({ fields, rest });
};

const FIELDS = { fixes: ["dk-00000002"], blocked_by: ["dk-00000003", "bl-0c0ffee1"], area: "eng" };

describe("canonical roundtrip", () => {
  test("a full item with lists and an area", () => {
    const text = itemText({ type: "bug", ...FIELDS, parent: "dk-00000004" });
    assert.equal(roundtrip(text), text);
  });
  test("an item with every optional value empty", () => {
    const text = itemText();
    assert.equal(roundtrip(text), text);
  });
});

describe("body bytes are preserved", () => {
  const bodies = {
    "emoji and CJK": "Ship it \u{1F680} and 日本語 text.\n",
    "tabs and trailing spaces": "tab\there   \n\tindented \n",
    "markdown code fence": "```js\nconst a = 1;\n```\n",
    "no trailing newline": "last line without newline",
    "several trailing newlines": "text\n\n\n\n",
    "a body line that is ---": "before\n---\nafter\n",
    "only a fence line": "---\n",
    "no body at all": "",
  };
  for (const [name, body] of Object.entries(bodies)) {
    test(name, () => {
      const text = itemText({}, { body });
      const { rest } = parseItem(text);
      assert.equal(rest, text.slice(text.indexOf("# Test item")));
      assert.equal(roundtrip(text), text);
    });
  }

  test("a closing fence is the first --- line, later --- stays in the body", () => {
    const text = itemText({}, { body: "x\n---\ny\n" });
    assert.equal(parseItem(text).rest.includes("\n---\n"), true);
  });
});

describe("serializeFrontmatter", () => {
  test("writes the 12 keys in KEYS order", () => {
    const out = serializeFrontmatter(parseItem(itemText({ ...FIELDS, type: "bug" })).fields);
    const lines = out.split("\n");
    assert.equal(lines[0], "---");
    assert.equal(lines[13], "---");
    assert.equal(lines[14], "");
    assert.deepEqual(
      lines.slice(1, 13).map((l) => l.slice(0, l.indexOf(":"))),
      [...KEYS],
    );
  });
  test("writes `key:` for empty values and [a, b] for lists", () => {
    const out = serializeFrontmatter({
      id: "dk-00000001",
      type: "task",
      created: "2026-01-01",
      status: "todo",
      since: "2026-01-01",
      priority: "P2",
      rank: "n",
      blocked_by: ["dk-00000002", "dk-00000003"],
    });
    const lines = out.split("\n");
    assert.ok(lines.includes("area:"));
    assert.ok(lines.includes("parent:"));
    assert.ok(lines.includes("fixes: []"));
    assert.ok(lines.includes("blocked_by: [dk-00000002, dk-00000003]"));
    assert.ok(lines.includes("relates: []"));
  });
  test("field order of the input object does not matter", () => {
    const fields = parseItem(itemText({ area: "ui" })).fields;
    const reversed = Object.fromEntries(Object.entries(fields).reverse());
    assert.equal(serializeFrontmatter(reversed), serializeFrontmatter(fields));
  });
});

describe("newItemRest", () => {
  test("title only", () => assert.equal(newItemRest("Title"), "# Title\n"));
  test("title and body get a blank line and one trailing newline", () => {
    assert.equal(newItemRest("Title", "Body\n\n\n"), "# Title\n\nBody\n");
  });
  test("CRLF in the body is normalised to LF", () => {
    assert.equal(newItemRest("T", "a\r\nb\rc"), "# T\n\na\nb\nc\n");
  });
  test("whitespace-only body counts as empty", () => {
    assert.equal(newItemRest("T", " \n\n"), "# T\n");
  });
  test("the result parses as a valid H1 and body", () => {
    const text = serializeFrontmatter(parseItem(itemText()).fields) + newItemRest("Hello", "Body");
    const r = parseItem(text);
    assert.deepEqual(r.errors, []);
    assert.equal(r.title, "Hello");
  });
});

describe("encoding", () => {
  test("Buffer and string input give the same fields and rest", () => {
    const text = itemText({ ...FIELDS, type: "bug" }, { body: "café \u{1F680}\n" });
    const a = parseItem(text);
    const b = parseItem(Buffer.from(text, "utf8"));
    assert.deepEqual(b.fields, a.fields);
    assert.equal(b.rest, a.rest);
    assert.deepEqual(b.errors, a.errors);
  });
});
