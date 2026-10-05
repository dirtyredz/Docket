// The seams introduced by the 2026-10-05 structure review: the error table, the round-trip guard,
// bodyOf, path identity, checkStore and setItem's claim-release dependency.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { exitCodeFor, EXIT } from "../../src/cli/output.mjs";
import { CODES, KIND_OF_CODE, docketError, notFound } from "../../src/core/errors.mjs";
import { newItemRest, bodyOf } from "../../src/core/format/content.mjs";
import { serializeChecked } from "../../src/core/format/serialize.mjs";
import { setItem } from "../../src/core/items/complete.mjs";
import { readItem } from "../../src/core/items/detail.mjs";
import { checkStore } from "../../src/core/validation/store.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { samePath, toSlash } from "../../src/repository/paths.mjs";
import * as claims from "../../src/state/claims/store.mjs";
import { loadIndex } from "../../src/state/index/build.mjs";
import { itemText, makeRepo } from "../helpers/repository.mjs";

const A = "dk-0000000a";

describe("core/errors", () => {
  test("docketError carries code and details; notFound names the item", () => {
    const err = docketError(CODES.CONFLICT, "boom", { id: A });
    assert.equal(err.code, "DOCKET_CONFLICT");
    assert.deepEqual(err.details, { id: A });
    assert.equal(docketError(CODES.USAGE, "x").details, undefined);
    const nf = notFound(A);
    assert.equal(nf.code, "DOCKET_NOT_FOUND");
    assert.equal(nf.message, `no item ${A}`);
    assert.deepEqual(nf.details, { id: A });
  });

  test("every code has an exit kind and the CLI maps it", () => {
    for (const code of Object.values(CODES)) {
      const kind = KIND_OF_CODE[code];
      assert.ok(["usage", "conflict", "notFound", "failed", "internal"].includes(kind), code);
      assert.equal(exitCodeFor({ code }), EXIT[kind], code);
    }
    assert.equal(exitCodeFor(new Error("plain")), EXIT.internal);
    assert.equal(exitCodeFor({ code: "DOCKET_UNLISTED" }), EXIT.failed);
    assert.equal(exitCodeFor({ code: CODES.INTERNAL }), EXIT.internal);
    assert.equal(KIND_OF_CODE[CODES.INTERNAL], "internal");
  });
});

describe("serialize helpers", () => {
  test("bodyOf is the inverse of newItemRest", () => {
    assert.equal(bodyOf(newItemRest("Title", "Line one\n\nLine two\n")), "Line one\n\nLine two\n");
    assert.equal(bodyOf(newItemRest("Title")), "");
  });

  test("serializeChecked returns the text and refuses fields the format cannot hold", () => {
    const fields = {
      id: A,
      type: "task",
      created: "2026-01-01",
      status: "todo",
      since: "2026-01-01",
      area: "",
      priority: "P2",
      rank: "n",
      parent: "",
      fixes: [],
      blocked_by: [],
      relates: [],
    };
    const text = serializeChecked({ fields, rest: "# T\n" });
    assert.ok(text.startsWith("---\nid: dk-0000000a\n"));
    assert.throws(
      () => serializeChecked({ fields: { ...fields, area: "two\nlines" }, rest: "# T\n" }),
      (err) => err.code === CODES.INTERNAL,
    );
  });
});

describe("path identity", () => {
  test("toSlash and samePath", () => {
    assert.equal(toSlash(["a", "b"].join(path.sep)), "a/b");
    assert.ok(samePath("C:/x/../y", "C:/y"));
    assert.ok(!samePath("C:/x", "C:/y"));
    if (process.platform === "win32") assert.ok(samePath("C:/Repo", "c:/repo"));
  });
});

describe("store operations that take claims as a dependency", () => {
  test("checkStore runs the checks; claims make unclaimed-wip visible", (t) => {
    const r = makeRepo({ [A]: itemText({ id: A, status: "wip" }) });
    t.after(r.cleanup);
    const ctx = resolveRepo(r.root);
    const without = checkStore(ctx, { today: "2026-10-05" });
    assert.equal(without.ok, true);
    assert.equal(without.warnings.length, 0);
    const withClaims = checkStore(ctx, { today: "2026-10-05", claims });
    assert.deepEqual(
      withClaims.warnings.map((w) => w.code),
      ["unclaimed-wip"],
    );
  });

  test("setItem releases the claim on completion and warns when release fails", (t) => {
    const r = makeRepo({ [A]: itemText({ id: A, status: "wip" }) });
    t.after(r.cleanup);
    const ctx = resolveRepo(r.root);
    claims.claimItem(ctx.commonDir, A, { worktree: ctx.root });
    const done = setItem(ctx, A, { status: "done" }, { today: "2026-10-05", claims });
    assert.equal(done.data.claimReleased, true);
    assert.deepEqual(done.warnings, []);
    assert.equal(claims.readClaims(ctx.commonDir).claims[A], undefined);

    const broken = {
      releaseItem() {
        throw new Error("disk");
      },
    };
    const B = "dk-0000000b";
    r.write(B, itemText({ id: B, status: "wip" }));
    const failed = setItem(ctx, B, { status: "dropped" }, { today: "2026-10-05", claims: broken });
    assert.equal(failed.data.claimReleased, false);
    assert.match(failed.warnings[0].message, /claim was not removed: disk/);
    assert.equal(
      setItem(ctx, B, { status: "dropped" }, { today: "x", claims: broken }).data.noop,
      true,
    );
  });

  test("readItem builds the detail model and throws not found", (t) => {
    const r = makeRepo({ [A]: itemText({ id: A }, { title: "Alpha", body: "Body.\n" }) });
    t.after(r.cleanup);
    const ctx = resolveRepo(r.root);
    const { records } = loadIndex(ctx);
    const { data, content } = readItem(ctx, A, { records, claims });
    assert.equal(data.title, "Alpha");
    assert.equal(data.body, "Body.\n");
    assert.equal(data.claim, null);
    assert.ok(content.startsWith("---\n"));
    assert.throws(() => readItem(ctx, "dk-ffffffff", { records, claims }), {
      code: CODES.NOT_FOUND,
    });
  });
});
