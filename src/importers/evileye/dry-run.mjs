// `docket import evileye --dry-run`: inventory the legacy register and shards, freeze their hashes,
// convert every entry into a staged item, persist the manifest and source map, then verify the run
// from disk (byte reconstruction, content accounting, core validation). Reads the legacy files only;
// never writes inside the source tree except the git-ignored staging directory.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ITEMS_DIR, KEYS, TOKEN_RE } from "../../core/format/schema.mjs";
import { parseItem } from "../../core/format/parse.mjs";
import { serializeItem } from "../../core/format/serialize.mjs";
import { localDate } from "../../core/identity/date.mjs";
import { currentBranch, resolveRepo, tryGit } from "../../repository/context.mjs";
import { listItemEntries } from "../../storage/item-store.mjs";
import {
  MANIFEST_VERSION,
  importRoot,
  priorAllocations,
  runName,
  stageRun,
  writeJson,
} from "../common/manifest.mjs";
import { decodeSource, gitBlobId, sha256, splitLines } from "../common/source-map.mjs";
import { verifyRun } from "../common/verify.mjs";
import {
  assignIdentities,
  assignRanks,
  convertEntry,
  entryKey,
  readOverrides,
} from "./convert.mjs";
import { firstSeenDates } from "./history.mjs";
import { parseRegisterIndex } from "./register.mjs";
import { fileSpans, ID_MARKER_RE, scanEntries } from "./shards.mjs";
import { summarize } from "./summary.mjs";

export const REGISTER = "docs/BACKLOG.md";
export const SHARD_ROOT = "docs/work/backlog";
const sourceError = (m) => Object.assign(new Error(m), { code: "DOCKET_IMPORT_SOURCE" });

/** Source files in import order: the register, then open shards, then done shards (alphabetical). */
export function inventory(root) {
  if (!fs.existsSync(path.join(root, REGISTER)))
    throw sourceError(`${REGISTER} not found under ${root}`);
  const sources = [{ rel: REGISTER, role: "register", area: "" }];
  const related = [];
  for (const role of ["open", "done"]) {
    const dir = path.join(root, SHARD_ROOT, role);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .sort()) {
      const area = name.replace(/\.md$/, "").toLowerCase();
      sources.push({
        rel: `${SHARD_ROOT}/${role}/${name}`,
        role,
        area: TOKEN_RE.test(area) ? area : "",
      });
    }
  }
  if (fs.existsSync(path.join(root, SHARD_ROOT))) {
    for (const name of fs.readdirSync(path.join(root, SHARD_ROOT)).sort()) {
      const rel = `${SHARD_ROOT}/${name}`;
      if (fs.statSync(path.join(root, rel)).isFile()) related.push({ rel });
    }
  }
  for (const s of [...sources, ...related]) s.bytes = fs.readFileSync(path.join(root, s.rel));
  return { sources, related };
}

function headBlobs(root, rels) {
  const out = tryGit(root, ["ls-tree", "HEAD", "--", ...rels]);
  const map = new Map();
  for (const row of (out ?? "").split("\n").filter(Boolean)) {
    const tab = row.indexOf("\t");
    map.set(row.slice(tab + 1), row.slice(0, tab).split(" ")[2]);
  }
  return map;
}

function overrideFor(overrides, key, legacyId, prior) {
  return (
    overrides.get(key) ??
    (legacyId && overrides.get(legacyId)) ??
    (prior.get(key) && overrides.get(prior.get(key))) ??
    null
  );
}

function buildItem(d) {
  const fields = { id: d.id, ...d.fields, parent: "", fixes: [], blocked_by: [], relates: [] };
  const ordered = Object.fromEntries(KEYS.map((k) => [k, fields[k]]));
  const text = serializeItem({ fields: ordered, rest: d.rest });
  const reparsed = parseItem(text);
  if (!isDeepStrictEqual(reparsed.fields, ordered) || reparsed.rest !== d.rest) {
    throw Object.assign(new Error(`serializer round trip failed for ${d.id}`), {
      code: "DOCKET_INTERNAL",
    });
  }
  return Buffer.from(text, "utf8");
}

/**
 * Run the dry run. options: {repo, out?, run?, overrides? (parsed JSON), now?, random?}.
 * Returns {runDir, manifestPath, manifest}.
 */
export function dryRunEvilEye({
  repo,
  out = null,
  run = null,
  overrides: overridesDoc = null,
  now = new Date(),
  random,
}) {
  const ctx = resolveRepo(repo);
  const importDate = localDate(now);
  const root = importRoot(ctx, out);
  const runId = run ?? runName("evileye", now);
  const runDir = `${root}/${runId}`;
  if (fs.existsSync(runDir))
    throw Object.assign(new Error(`run directory already exists: ${runDir}`), {
      code: "DOCKET_IMPORT_STAGING",
    });

  const { sources, related } = inventory(ctx.root);
  const blobs = headBlobs(
    ctx.root,
    [...sources, ...related].map((s) => s.rel),
  );
  const overrides = readOverrides(overridesDoc);
  const prior = priorAllocations(root, "evileye");
  const firstSeen = firstSeenDates(ctx.root, [REGISTER, SHARD_ROOT]);
  const fileDecisions = [];

  for (const s of sources) {
    s.text = decodeSource(s.bytes, s.rel);
    s.lines = splitLines(s.text);
    s.scan = scanEntries(s.lines);
    s.index = s.role === "register" ? parseRegisterIndex(s.lines) : null;
  }
  const register = sources[0];
  if (!register.index.found) throw sourceError(`${REGISTER} has no "## Ranking index"`);
  const rows = new Map();
  for (const row of register.index.rows) {
    for (const p of row.problems)
      fileDecisions.push({
        code: "row-problem",
        severity: "override",
        message: p,
        file: REGISTER,
        line: row.line,
      });
    if (rows.has(row.id)) {
      fileDecisions.push({
        code: "duplicate-row",
        severity: "override",
        message: `${row.id} has more than one register row; the first is used`,
        file: REGISTER,
        line: row.line,
      });
    } else rows.set(row.id, row);
  }

  const drafts = [];
  for (const s of sources) {
    s.drafts = s.scan.entries.map((entry) => {
      const span = s.text.slice(s.lines[entry.startLine].start, s.lines[entry.endLine].next);
      const legacyId = new RegExp(ID_MARKER_RE.source).exec(span)?.[1] ?? null;
      const key = entryKey(s.rel, s.lines[entry.startLine].text);
      return convertEntry({
        rel: s.rel,
        where: s.role === "done" ? "done" : "open",
        area: s.area,
        lines: s.lines,
        text: s.text,
        entry,
        row: legacyId ? rows.get(legacyId) : null,
        firstSeen: legacyId ? firstSeen.get(legacyId) : null,
        importDate,
        override: overrideFor(overrides, key, legacyId, prior.map),
      });
    });
    drafts.push(...s.drafts);
  }
  const targetEntries = listItemEntries(ctx).map(({ name, isFile, bytes }) => ({
    name,
    isFile,
    bytes,
  }));
  const taken = new Set([
    ...firstSeen.keys(),
    ...drafts.map((d) => d.legacyId).filter(Boolean),
    ...targetEntries.map((e) => e.name.replace(/\.md$/, "")),
  ]);
  assignIdentities(drafts, { taken, prior: prior.map, random, overrides });
  for (const d of drafts) {
    for (const e of d.steps.find((s) => s.op === "rebase")?.edits ?? []) {
      if (!fs.existsSync(path.join(ctx.root, e.resolved))) {
        d.decisions.push({
          code: "link-target-missing",
          severity: "review",
          message: `link ${e.from} points at ${e.resolved}, which does not exist`,
        });
      }
    }
  }
  assignRanks(drafts);

  const staged = drafts.map((d) => ({ id: d.id, bytes: buildItem(d) }));
  const sourceMap = { version: MANIFEST_VERSION, sources: sources.map((s) => mapSource(s)) };
  stageRun(runDir, { items: staged, sourceMap });

  const decisions = [
    ...fileDecisions,
    ...drafts.flatMap((d) =>
      d.decisions.map((x) => ({ id: d.id, file: d.source.file, line: d.source.firstLine, ...x })),
    ),
  ];
  const manifest = {
    version: MANIFEST_VERSION,
    importer: "evileye",
    run: runId,
    createdAt: now.toISOString(),
    importDate,
    dryRun: true,
    repo: {
      root: ctx.root,
      head: tryGit(ctx.root, ["rev-parse", "HEAD"]),
      branch: currentBranch(ctx.root),
    },
    staging: { runDir, items: "items/", sourceMap: "source-map.json", target: `${ITEMS_DIR}/` },
    priorRun: prior.run,
    sources: sources.map((s) => sourceRecord(s, blobs)),
    related: related.map((r) => ({
      path: r.rel,
      sha256: sha256(r.bytes),
      matchesHead: blobs.get(r.rel) === gitBlobId(r.bytes),
      reason: "not an entry file (conventions or living notes); hashed, not converted",
    })),
    items: drafts.map((d, i) => ({
      id: d.id,
      idOrigin: d.idOrigin,
      key: d.key,
      title: d.title,
      ...d.fields,
      flags: d.flags,
      source: d.source,
      staged: `items/${d.id}.md`,
      sha256: sha256(staged[i].bytes),
    })),
    decisions,
  };
  manifest.summary = summarize(manifest, { rows: register.index.rows, sourceMap });
  const manifestPath = `${runDir}/manifest.json`;
  writeJson(manifestPath, manifest);

  manifest.verification = verifyRun(runDir, {
    sourceRoot: ctx.root,
    targetEntries,
    today: importDate,
  });
  manifest.ready = manifest.verification.ok && manifest.verification.unresolved === 0;
  writeJson(manifestPath, manifest);
  const unresolved = decisions.filter((d) => d.severity === "override" && !d.resolved);
  if (unresolved.length) {
    writeJson(`${runDir}/overrides.template.json`, {
      version: 1,
      note: "Fill in a status (todo, wip, done, dropped), type or priority per entry, or keepAllocated: true for a duplicate ID; pass with --overrides.",
      entries: Object.fromEntries(
        unresolved.map((d) => [
          d.id,
          {
            decision: d.code,
            message: d.message,
            ...(d.code === "duplicate-id" ? { keepAllocated: false } : { status: null }),
          },
        ]),
      ),
    });
  }
  return { runDir, manifestPath, manifest };
}

function sourceRecord(s, blobs) {
  return {
    path: s.rel,
    role: s.role,
    area: s.area,
    bytes: s.bytes.length,
    length: s.text.length,
    lines: s.lines.length,
    sha256: sha256(s.bytes),
    headBlob: blobs.get(s.rel) ?? null,
    matchesHead: blobs.get(s.rel) === gitBlobId(s.bytes),
    entries: s.drafts.length,
  };
}

function mapSource(s) {
  const entryKeys = s.drafts.map((d) => d.id);
  const spans = fileSpans(s.text, s.lines, s.scan, {
    entryKeys,
    rowLines: s.index?.rowLines,
    tableLines: s.index?.tableLines,
  }).map((span) => {
    const { text, ...rest } = span;
    const record = { ...rest, sha256: sha256(Buffer.from(text, "utf8")) };
    if (span.disposition === "item") {
      const d = s.drafts[entryKeys.indexOf(span.item)];
      return { ...record, title: d.title, steps: d.steps };
    }
    return { ...record, text };
  });
  return { path: s.rel, length: s.text.length, sha256: sha256(s.bytes), spans };
}
