// Per-worktree disposable cache: <repo>/.docket/index.json. Rebuilt from source hashes; a missing,
// stale, corrupt or foreign-version cache just rebuilds. `check` never reads it.
// A file is reused by (size, mtime) only when its mtime is safely older than the cache itself (the
// racy-git rule); otherwise it is re-hashed, so a same-size rewrite inside one clock tick is caught.
import fs from "node:fs";
import path from "node:path";
import { parseEntries } from "../../core/validation/check.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { listItemEntries } from "../../storage/item-store.mjs";
import { revisionOf } from "../../storage/revision.mjs";

export const INDEX_VERSION = 1;
const RACY_MS = 2000;

export const indexPath = (ctx) => path.join(ctx.docketDir, "index.json");

function readCache(ctx) {
  try {
    const data = JSON.parse(fs.readFileSync(indexPath(ctx), "utf8"));
    if (data?.version !== INDEX_VERSION || typeof data.files !== "object")
      return { files: {}, state: "corrupt" };
    return { files: data.files, builtAt: data.builtAt ?? 0, state: "ok" };
  } catch (err) {
    return { files: {}, state: err.code === "ENOENT" ? "missing" : "corrupt" };
  }
}

/**
 * Load the index, refreshing it from the files. Returns {records, stats}; records have the same shape
 * as parseEntries() output (plus revision). stats: {total, reused, parsed, removed, cache}.
 */
export function loadIndex(ctx, { rebuild = false } = {}) {
  const cache = rebuild ? { files: {}, state: "rebuild" } : readCache(ctx);
  const entries = listItemEntries(ctx, { withBytes: false });
  const files = {};
  let needsWrite = cache.state !== "ok";
  const stats = { total: entries.length, reused: 0, parsed: 0, removed: 0, cache: cache.state };
  for (const entry of entries) {
    const cached = cache.files[entry.name];
    const trustStat = cached && entry.mtimeMs < (cache.builtAt ?? 0) - RACY_MS;
    if (cached && trustStat && cached.size === entry.size && cached.mtimeMs === entry.mtimeMs) {
      files[entry.name] = cached;
      stats.reused++;
      continue;
    }
    const bytes = entry.isFile ? fs.readFileSync(entry.path) : undefined;
    const hash = bytes ? revisionOf(bytes) : null;
    if (cached && cached.hash === hash && hash) {
      files[entry.name] = { ...cached, size: entry.size, mtimeMs: entry.mtimeMs };
      needsWrite = true;
      stats.reused++;
      continue;
    }
    const [record] = parseEntries([
      { name: entry.name, isFile: entry.isFile, bytes, revision: hash },
    ]);
    files[entry.name] = {
      name: entry.name,
      id: record.id,
      hash,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      fields: record.fields,
      title: record.title,
      errors: record.errors,
    };
    stats.parsed++;
  }
  stats.removed = Object.keys(cache.files).filter((n) => !(n in files)).length;
  if (needsWrite || stats.parsed || stats.removed) {
    try {
      const data = { version: INDEX_VERSION, builtAt: Date.now(), files };
      atomicWrite(indexPath(ctx), JSON.stringify(data) + "\n");
    } catch {
      stats.cache = `${stats.cache} (not saved)`; // a cache that cannot be written is still correct
    }
  }
  const records = Object.values(files).map((f) => ({
    name: f.name,
    id: f.id,
    fields: f.fields,
    title: f.title,
    errors: f.errors,
    revision: f.hash,
  }));
  return { records, stats };
}
