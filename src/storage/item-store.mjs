// Repository item I/O: list, read and write `docs/items/` files with revision checks.
// Callers that mutate hold the worktree lock (lockPathFor) around read-check-write.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";
import { atomicWrite } from "./atomic-write.mjs";
import { readWithRevision, revisionOf } from "./revision.mjs";

export const lockPathFor = (ctx) => path.join(ctx.docketDir, "items.lock");

/** Every entry in the items directory: {name, path, isFile, bytes?, revision?, mtimeMs?, size?}. */
export function listItemEntries(ctx, { withBytes = true } = {}) {
  let names;
  try {
    names = fs.readdirSync(ctx.itemsDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return names.sort().map((name) => {
    const file = path.join(ctx.itemsDir, name);
    const stat = fs.statSync(file);
    const entry = {
      name,
      path: file,
      isFile: stat.isFile(),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
    if (withBytes && entry.isFile) {
      entry.bytes = fs.readFileSync(file);
      entry.revision = revisionOf(entry.bytes);
    }
    return entry;
  });
}

export function itemPath(ctx, id) {
  return path.join(ctx.itemsDir, `${id}.md`);
}

export function readItemFile(ctx, id) {
  return readWithRevision(itemPath(ctx, id));
}

/**
 * Write an item file. expectedRevision: the revision the caller based its change on (null = the file
 * must not exist yet). A mismatch throws code DOCKET_CONFLICT with {expected, actual}.
 */
export function writeItemFile(ctx, id, bytes, { expectedRevision, ops } = {}) {
  const target = itemPath(ctx, id);
  const current = readWithRevision(target);
  const actual = current ? current.revision : null;
  if (expectedRevision !== undefined && expectedRevision !== actual) {
    throw docketError(CODES.CONFLICT, `${id} changed since it was read`, {
      id,
      expected: expectedRevision,
      actual,
    });
  }
  atomicWrite(target, bytes, { createOnly: actual === null, ops });
  return revisionOf(bytes);
}
