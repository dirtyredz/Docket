import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { storePurityProblems } from "../../../src/tooling/layout-check.mjs";
import { ROOT } from "../../helpers/repository.mjs";
import path from "node:path";

test("the claims store has no item imports or item-mutation callbacks", () => {
  const text = fs.readFileSync(path.join(ROOT, "src/state/claims/store.mjs"), "utf8");
  assert.deepEqual(storePurityProblems(text), []);
});

test("the purity check rejects core/items imports and callbacks but allows the errors leaf", () => {
  assert.deepEqual(storePurityProblems('import { CODES } from "../../core/errors.mjs";'), []);
  assert.equal(storePurityProblems('import { x } from "../../core/items/set.mjs";').length, 1);
  assert.equal(storePurityProblems("function f({ enterWip }) {}").length, 1);
});
