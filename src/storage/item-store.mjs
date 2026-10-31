// Repository item I/O: list, read and write `docs/items/` files with revision checks.
// Callers that mutate hold the worktree lock (lockPathFor) around read-check-write.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";
import { atomicWrite } from "./atomic-write.mjs";
import { readWithRevision, revisionOf } from "./revision.mjs";

export const lockPathFor = (ctx) => path.join(ctx.docketDir, "items.lock");

/**
 * The one store-entry shape: {name, isFile, bytes?, revision?}. Working-tree and Git-ref snapshots, the
 * index and single-file reads all hand parseEntries this shape. `revision` defaults to the bytes' hash.
 */
export function storeEntry(name, bytes, { isFile = true, revision } = {}) {
  return { name, isFile, bytes, revision: revision ?? (bytes ? revisionOf(bytes) : undefined) };
}

/**
 * Every entry in the items directory, by name: a storeEntry (bytes and revision only `withBytes`) plus
 * the stat facts the index reuses: {path, mtimeMs, size}.
 */
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
    const isFile = stat.isFile();
    const bytes = withBytes && isFile ? fs.readFileSync(file) : undefined;
    return {
      ...storeEntry(name, bytes, { isFile }),
      path: file,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
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
