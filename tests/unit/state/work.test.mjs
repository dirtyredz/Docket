import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { makeRepo, itemText } from "../../helpers/repository.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { claimsPath, readWork } from "../../../src/state/claims/store.mjs";
import { workClaims as claims } from "../../../src/library/claims.mjs";
import { claimWork } from "../../../src/state/claims/work.mjs";
import { setItem } from "../../../src/library/items/set.mjs";

test("headless set records work through the claims facade and legacy release retains evidence", (t) => {
  const id = "dk-00000001";
  const repo = makeRepo({ [id]: itemText() });
  t.after(repo.cleanup);
  const ctx = resolveRepo(repo.root);
  setItem(ctx, id, { status: "wip" }, { today: "2026-11-20", claims });
  assert.deepEqual(readWork(ctx.commonDir)[id], { branch: "main", worktree: ctx.root });
  fs.writeFileSync(
    claimsPath(ctx.commonDir),
    JSON.stringify({
      version: 1,
      claims: { [id]: { branch: "legacy", worktree: ctx.root } },
    }),
  );
  claims.releaseItem(ctx.commonDir, id, { worktree: ctx.root });
  assert.deepEqual(readWork(ctx.commonDir)[id], { branch: "legacy", worktree: ctx.root });
  assert.deepEqual(claims.readClaims(ctx.commonDir).claims, {});
});

test("a failed bindings write is reported identically for the claim and set-to-wip paths", (t) => {
  const ids = ["dk-00000001", "dk-00000002"];
  const repo = makeRepo({ [ids[0]]: itemText(), [ids[1]]: itemText() });
  t.after(repo.cleanup);
  const ctx = resolveRepo(repo.root);
  fs.mkdirSync(claimsPath(ctx.commonDir));
  const fail = (run) => {
    try {
      run();
    } catch (err) {
      return err;
    }
    assert.fail("expected the bindings write to fail");
  };
  const viaClaim = fail(() => claimWork(ctx, ids[0], { worktree: ctx.root }));
  const viaSet = fail(() =>
    setItem(ctx, ids[1], { status: "wip" }, { today: "2026-11-20", claims }),
  );
  for (const [err, id] of [
    [viaClaim, ids[0]],
    [viaSet, ids[1]],
  ]) {
    assert.equal(err.partial, true);
    assert.deepEqual(
      err.written.map((w) => w.id),
      [id],
    );
    assert.match(err.message, /^items saved, but work bindings were not saved/);
  }
});
