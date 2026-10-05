// Persisted import runs: where a run is staged, how it is named, how it is written, and how a later
// run finds the identities an earlier one allocated (so retries keep the same new IDs).
// A run directory holds:
//   manifest.json     summary, sources with frozen hashes, items, decisions, verification, ready flag
//   source-map.json   every span of every source with its disposition (text for non-item spans,
//                     inverse transform steps for item spans)
//   items/<id>.md     the staged item files
//   overrides.template.json   unresolved decisions, ready to fill in (only when there are any)
import fs from "node:fs";
import path from "node:path";
import { tryGit } from "../../repository/context.mjs";

export const MANIFEST_VERSION = 1;
const pad = (n) => String(n).padStart(2, "0");

/** Run name `<importer>-YYYYMMDD-HHMMSS` in local time. */
export function runName(importer, now = new Date()) {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${importer}-${d}-${t}`;
}

const importError = (message, details) =>
  Object.assign(new Error(message), {
    code: "DOCKET_IMPORT_STAGING",
    ...(details ? { details } : {}),
  });

/**
 * Directory that holds runs. Default `<root>/.docket/import`, which must be git-ignored so staging can
 * never be committed by accident (add `.docket/` to .git/info/exclude, or pass `out`).
 */
export function importRoot(ctx, out = null) {
  if (out) return path.resolve(out).split(path.sep).join("/");
  const dir = `${ctx.docketDir}/import`;
  const probe = ".docket/import/probe/manifest.json";
  const ignored = tryGit(ctx.root, ["check-ignore", "--no-index", "-q", probe]) !== null;
  if (!ignored) {
    throw importError(
      `${ctx.root}/.docket/ is not git-ignored; add ".docket/" to .git/info/exclude (local) or pass --out <dir>`,
      { root: ctx.root },
    );
  }
  return dir;
}

/** Identities allocated by the newest earlier run of `importer`: Map<entry key, id>. */
export function priorAllocations(root, importer) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return { run: null, map: new Map() };
  }
  const runs = [];
  for (const name of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, name, "manifest.json"), "utf8"));
      if (m.importer === importer && m.version === MANIFEST_VERSION) runs.push(m);
    } catch {
      /* not a run directory */
    }
  }
  runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const latest = runs[0];
  const map = new Map();
  for (const item of latest?.items ?? []) {
    if (item.idOrigin === "allocated" || item.idOrigin === "reused") map.set(item.key, item.id);
  }
  return { run: latest?.run ?? null, map };
}

/** Create the run directory (it must not exist) and write staged items and the source map. */
export function stageRun(runDir, { items, sourceMap }) {
  if (fs.existsSync(runDir)) throw importError(`run directory already exists: ${runDir}`);
  fs.mkdirSync(path.join(runDir, "items"), { recursive: true });
  for (const it of items)
    fs.writeFileSync(path.join(runDir, "items", `${it.id}.md`), it.bytes, { flag: "wx" });
  writeJson(path.join(runDir, "source-map.json"), sourceMap);
}

export function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw importError(`cannot read ${file}: ${err.message}`);
  }
}
