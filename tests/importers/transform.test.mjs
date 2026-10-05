// The reversible body transform: every recorded step undoes exactly, for awkward inputs too.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  invertEntry,
  rebaseTarget,
  transformEntry,
} from "../../src/importers/common/transform.mjs";

const opts = {
  marker: "- ",
  width: 2,
  fromDir: "docs/work/backlog/open",
  toDir: "docs/items",
};
const roundTrip = (source, extra = {}) => {
  const { body, steps } = transformEntry(source, { ...opts, ...extra });
  assert.equal(invertEntry(body, steps), source);
  return body;
};

describe("transformEntry / invertEntry", () => {
  test("marker, indent and ID comment come off and go back", () => {
    const src = "- **Title** text <!-- bl-1234abcd -->\n  continued\n    nested deeper\n";
    const body = roundTrip(src, { remove: [" <!-- bl-1234abcd -->"] });
    assert.equal(body, "**Title** text\ncontinued\n  nested deeper\n");
  });

  test("lazy, short-indented, tab-indented and whitespace-only lines", () => {
    roundTrip("- a\nlazy\n continued by one\n\tTab\n   \n  end");
  });

  test("CRLF, mixed endings and a missing final newline", () => {
    const body = roundTrip("- a\r\n  b\r\n  c\n  d");
    assert.equal(body, "a\nb\nc\nd\n");
  });

  test("relative links rebase; absolute, anchors and URLs are untouched", () => {
    const src =
      "- [a](../../../BACKLOG.md) [b](../done/x.md#frag) [c](https://e.x/y) [d](#local) ![i](img.png)\n" +
      "[ref]: ../../ASTRA.md\n";
    const body = roundTrip(src);
    assert.ok(body.includes("[a](../BACKLOG.md)"));
    assert.ok(body.includes("[b](../work/backlog/done/x.md#frag)"));
    assert.ok(body.includes("[c](https://e.x/y)"));
    assert.ok(body.includes("[d](#local)"));
    assert.ok(body.includes("![i](../work/backlog/open/img.png)"));
    assert.ok(body.includes("[ref]: ../work/ASTRA.md"));
  });

  test("an appended note inverts", () => {
    const body = roundTrip("- x\n", { note: "Legacy register flags: ask me more." });
    assert.ok(body.endsWith("x\n\nLegacy register flags: ask me more.\n"));
  });

  test("a damaged body fails to invert or yields different text", () => {
    const { body, steps } = transformEntry("- [a](../x.md) b\n  c\n", opts);
    assert.throws(() => invertEntry(body.replace("../work", "../wrk"), steps));
    assert.throws(() => invertEntry(body.replace("c\n", "c\nextra\n"), steps));
    assert.notEqual(invertEntry(body.replace(" b", " B"), steps), "- [a](../x.md) b\n  c\n");
  });

  test("rebaseTarget keeps fragments and trailing slashes", () => {
    assert.equal(
      rebaseTarget("../../../research/", "docs/work/backlog/open", "docs/items"),
      "../research/",
    );
    assert.equal(
      rebaseTarget("../done/w.md#a", "docs/work/backlog/open", "docs/items"),
      "../work/backlog/done/w.md#a",
    );
  });

  test("an entry not starting with its marker is refused", () => {
    assert.throws(() => transformEntry("* x\n", opts), /does not start/);
  });
});
