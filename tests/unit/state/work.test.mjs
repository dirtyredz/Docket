import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { makeRepo, itemText } from "../../helpers/repository.mjs";
import { resolveRepo } from "../../../src/repository/context.mjs";
import { claimsPath, readWork } from "../../../src/state/claims/store.mjs";
import * as claims from "../../../src/library/claims.mjs";
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
