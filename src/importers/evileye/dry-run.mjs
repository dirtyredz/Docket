// `docket import evileye --dry-run`: inventory the legacy register and shards, freeze their hashes,
// convert every entry into a staged item, persist the manifest and source map, then verify the run
// from disk (byte reconstruction, content accounting, core validation). Reads the legacy files only;
// never writes inside the source tree except the git-ignored staging directory.
// This file sequences the steps; reusable mechanics live in importers/common.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { localDate } from "../../core/identity/date.mjs";
import { currentBranch, resolveRepo, tryGit } from "../../repository/context.mjs";
import { ITEMS_DIR } from "../../repository/paths.mjs";
import { listItemEntries } from "../../storage/item-store.mjs";
import {
  MANIFEST_VERSION,
  buildItem,
  importRoot,
  priorAllocations,
  runName,
  stageRun,
  writeJson,
  writeOverridesTemplate,
} from "../common/manifest.mjs";
import {
  decodeSource,
  gitBlobId,
  mapSource,
  sha256,
  sourceRecord,
  splitLines,
} from "../common/source-map.mjs";
import { verifyRun } from "../common/verify.mjs";
import {
  assignIdentities,
  assignRanks,
  convertEntry,
  entryKey,
  readOverrides,
} from "./convert.mjs";
import { firstSeenDates } from "./history.mjs";
import { REGISTER, SHARD_ROOT, headBlobs, inventory } from "./inventory.mjs";
import { parseRegisterIndex } from "./register.mjs";
import { fileSpans, ID_MARKER_RE, scanEntries } from "./shards.mjs";
import { summarize } from "./summary.mjs";

function overrideFor(overrides, key, legacyId, prior) {
  return (
    overrides.get(key) ??
    (legacyId && overrides.get(legacyId)) ??
    (prior.get(key) && overrides.get(prior.get(key))) ??
    null
  );
}

/** Decode, split and scan every source file in place; returns the register's rows and their problems. */
function scanSources(sources) {
  for (const s of sources) {
    s.text = decodeSource(s.bytes, s.rel);
    s.lines = splitLines(s.text);
    s.scan = scanEntries(s.lines);
    s.index = s.role === "register" ? parseRegisterIndex(s.lines) : null;
  }
  const register = sources[0];
  if (!register.index.found) {
    throw docketError(CODES.IMPORT_SOURCE, `${REGISTER} has no "## Ranking index"`);
  }
  const decisions = [];
  const rows = new Map();
  for (const row of register.index.rows) {
    for (const p of row.problems)
      decisions.push({
        code: "row-problem",
        severity: "override",
        message: p,
        file: REGISTER,
        line: row.line,
      });
    if (rows.has(row.id)) {
      decisions.push({
        code: "duplicate-row",
        severity: "override",
        message: `${row.id} has more than one register row; the first is used`,
        file: REGISTER,
        line: row.line,
      });
    } else rows.set(row.id, row);
  }
  return { register, rows, decisions };
}

/** Convert every entry of every source into a draft (stored on `s.drafts`); returns all drafts. */
function draftEntries(sources, { rows, firstSeen, importDate, overrides, prior }) {
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
  return drafts;
}

/** Flag rebased links whose target is not in the checkout. */
function noteMissingLinkTargets(drafts, root) {
  for (const d of drafts) {
    for (const e of d.steps.find((s) => s.op === "rebase")?.edits ?? []) {
      if (!fs.existsSync(path.join(root, e.resolved))) {
        d.decisions.push({
          code: "link-target-missing",
          severity: "review",
          message: `link ${e.from} points at ${e.resolved}, which does not exist`,
        });
      }
    }
  }
}

/** The line spans of a scanned source, ready for common mapSource. */
function spansOf(s) {
  return fileSpans(s.text, s.lines, s.scan, {
    entryKeys: s.drafts.map((d) => d.id),
    rowLines: s.index?.rowLines,
    tableLines: s.index?.tableLines,
  });
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
    throw docketError(CODES.IMPORT_STAGING, `run directory already exists: ${runDir}`);

  const { sources, related } = inventory(ctx.root);
  const blobs = headBlobs(
    ctx.root,
    [...sources, ...related].map((s) => s.rel),
  );
  const overrides = readOverrides(overridesDoc);
  const prior = priorAllocations(root, "evileye");
  const firstSeen = firstSeenDates(ctx.root, [REGISTER, SHARD_ROOT]);

  const { register, rows, decisions: fileDecisions } = scanSources(sources);
  const drafts = draftEntries(sources, { rows, firstSeen, importDate, overrides, prior });
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
  noteMissingLinkTargets(drafts, ctx.root);
  assignRanks(drafts);

  const staged = drafts.map((d) => ({ id: d.id, bytes: buildItem(d) }));
  const sourceMap = {
    version: MANIFEST_VERSION,
    sources: sources.map((s) => mapSource(s, spansOf(s))),
  };
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
  writeOverridesTemplate(runDir, decisions);
  return { runDir, manifestPath, manifest };
}
