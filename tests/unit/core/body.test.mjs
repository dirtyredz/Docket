// Body replacement on real temp repositories: only the facts change, framing and Notes stay byte for byte.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { replaceBody } from "../../../src/core/items/content/body.mjs";
import { parseEntries } from "../../../src/core/validation/check.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { workingSnapshot } from "../../../src/repository/snapshot.mjs";
import { readItemFile } from "../../../src/storage/item-store.mjs";
import { itemText, makeRepo, readItem as fileOf } from "../../helpers/repository.mjs";

const A = "dk-0000a001";
const R = "2026-10-05T14:03:00.000Z";
const HEADER = `### ${R} · open · owner`;
const NOTES = `\n## Notes\n\n${HEADER}\n\nQuestion text.\n`;
const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function setup(body = `Old facts.\n${NOTES}`, fields = {}) {
  const r = makeRepo({ [A]: itemText({ id: A, ...fields }, { title: "A", body }) });
  repos.push(r);
  return { r, ctx: resolveRepo(r.root) };
}
const rev = (ctx) => readItemFile(ctx, A).revision;
const replace = (ctx, body, opts = { expect: rev(ctx) }) => replaceBody(ctx, A, body, opts);
const fieldsOf = (ctx) => parseEntries(workingSnapshot(ctx).entries)[0].fields;
const split = (text) => ({
  head: text.slice(0, text.indexOf("# A\n") + 4),
  tail: text.slice(text.indexOf("\n## Notes")),
});

describe("replaceBody", () => {
  test("keeps frontmatter, the H1 line and the Notes suffix byte for byte", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    const res = replace(ctx, "\nNew facts.\n\nSecond paragraph.\n");
    const after = fileOf(r.root, A);
    assert.equal(res.noop, false);
    assert.equal(split(after).head, split(before).head);
    assert.equal(split(after).tail, split(before).tail);
    assert.equal(after, before.replace("\nOld facts.\n", "\nNew facts.\n\nSecond paragraph.\n"));
    assert.equal(res.revision, rev(ctx));
  });

  test("an empty body clears the facts and leaves Notes intact", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    replace(ctx, "");
    const after = fileOf(r.root, A);
    assert.equal(split(after).tail, split(before).tail);
    assert.ok(after.includes("# A\n\n## Notes\n"));
    assert.doesNotMatch(after, /Old facts/);
  });

  test("works on a legacy item without Notes", () => {
    const { r, ctx } = setup("Old facts.\n");
    replace(ctx, "\nNew.\n");
    assert.ok(fileOf(r.root, A).endsWith("# A\n\nNew.\n"));
  });

  test("missing expect is DOCKET_USAGE", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    assert.throws(() => replaceBody(ctx, A, "\nx\n", {}), { code: "DOCKET_USAGE" });
    assert.throws(() => replaceBody(ctx, A, "\nx\n"), { code: "DOCKET_USAGE" });
    assert.equal(fileOf(r.root, A), before);
  });

  test("a stale expect is a conflict, even when the body is unchanged", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    assert.throws(() => replace(ctx, "\nx\n", { expect: "0000000000000000" }), {
      code: "DOCKET_CONFLICT",
    });
    assert.throws(() => replace(ctx, "\nOld facts.\n", { expect: "0000000000000000" }), {
      code: "DOCKET_CONFLICT",
    });
    assert.equal(fileOf(r.root, A), before);
  });

  test("an unchanged body is a no-op with the current revision and no write", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    const res = replace(ctx, "\nOld facts.\n");
    assert.equal(res.noop, true);
    assert.equal(res.revision, rev(ctx));
    assert.equal(fileOf(r.root, A), before);
  });

  test("a `## Notes` line in the body is DOCKET_INVALID and unchanged", () => {
    for (const setupBody of ["Old facts.\n", `Old facts.\n${NOTES}`]) {
      const { r, ctx } = setup(setupBody);
      const before = fileOf(r.root, A);
      assert.throws(() => replace(ctx, "\nfacts\n\n## Notes\n\nmore\n"), {
        code: "DOCKET_INVALID",
      });
      assert.equal(fileOf(r.root, A), before);
    }
  });

  test("a note-header-shaped line in the body is DOCKET_INVALID and unchanged", () => {
    for (const setupBody of ["Old facts.\n", `Old facts.\n${NOTES}`]) {
      const { r, ctx } = setup(setupBody);
      const before = fileOf(r.root, A);
      assert.throws(
        () => replace(ctx, `\nfacts\n\n${HEADER.replace(R, "2026-11-01T00:00:00.000Z")}\n`),
        {
          code: "DOCKET_INVALID",
        },
      );
      assert.equal(fileOf(r.root, A), before);
    }
  });

  test("an unclosed fence is DOCKET_INVALID when the item has Notes", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    assert.throws(() => replace(ctx, "\n```\nopen fence\n"), { code: "DOCKET_INVALID" });
    assert.equal(fileOf(r.root, A), before);
  });

  test("fenced examples of Notes syntax are accepted", () => {
    const { ctx } = setup();
    assert.doesNotThrow(() => replace(ctx, `\n\`\`\`md\n## Notes\n\n${HEADER}\n\`\`\`\n`));
  });

  test("since and rank are unchanged", () => {
    const { ctx } = setup(undefined, { since: "2026-02-02", rank: "q" });
    const before = fieldsOf(ctx);
    replace(ctx, "\nNew.\n");
    assert.deepEqual(fieldsOf(ctx), before);
  });

  test("CR in the body is DOCKET_INVALID", () => {
    const { r, ctx } = setup();
    const before = fileOf(r.root, A);
    assert.throws(() => replace(ctx, "\nline\r\nline\n"), { code: "DOCKET_INVALID" });
    assert.equal(fileOf(r.root, A), before);
  });

  test("an item with malformed Notes cannot have its body replaced", () => {
    const { r, ctx } = setup("Old.\n\n## Notes\n\nstray\n");
    const before = fileOf(r.root, A);
    assert.throws(() => replace(ctx, "\nx\n"), { code: "DOCKET_INVALID" });
    assert.equal(fileOf(r.root, A), before);
  });
});
