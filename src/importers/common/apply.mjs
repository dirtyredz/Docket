// `docket import apply`: install a verified, ready run into its target repository.
// Sequence (each step journaled, see journal.mjs):
//   1. preconditions  the run is ready; the target is the manifest's repo; no other migration marker;
//                     every source still has its frozen hash; every staged file has its manifest hash;
//                     the full run verification passes again; no target file conflicts
//   2. install        under the worktree lock, each staged item is created (never overwritten); an item
//                     already present with identical bytes counts as installed (resume)
//   3. validate       the whole target store passes `check`; otherwise stop, marker unpublished
//   4. record         write docs/records/migrations/docket.json (committed provenance)
//   5. marker         publish the migration marker in docket.json, last
// Re-running after an interruption resumes from what is on disk. Once complete, apply is a no-op that
// re-checks nothing (the register may since have been replaced by its navigation page).
// Sources are only read; a failure at any step leaves them intact and the cutover incomplete.
import fs from "node:fs";
import path from "node:path";
import { checkSnapshot } from "../../core/validation/check.mjs";
import { parseConfig, readConfigBytes, writeConfig } from "../../repository/config.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { workingSnapshot } from "../../repository/snapshot.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { itemPath, listItemEntries, lockPathFor } from "../../storage/item-store.mjs";
import { withLock } from "../../storage/lock.mjs";
import { isComplete, openJournal, readJournal } from "./journal.mjs";
import { readJson } from "./manifest.mjs";
import { RECORD_PATH, buildRecord, migrationMarker, serializeRecord } from "./record.mjs";
import { sha256 } from "./source-map.mjs";
import { verifyRun } from "./verify.mjs";

const fail = (code, message, details) =>
  Object.assign(new Error(message), { code, ...(details ? { details } : {}) });

const samePath = (a, b) => {
  const norm = (p) => path.resolve(p).split(path.sep).join("/");
  return process.platform === "win32"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
};

/** Classify each staged item against the target: missing, installed (same bytes) or conflicting. */
function compareTarget(ctx, manifest, runDir) {
  const existing = new Map(listItemEntries(ctx).map((e) => [e.name, e]));
  const staged = [];
  const conflicts = [];
  const tampered = [];
  for (const item of manifest.items) {
    const bytes = fs.readFileSync(path.join(runDir, item.staged));
    if (sha256(bytes) !== item.sha256) tampered.push(item.staged);
    const name = `${item.id}.md`;
    const there = existing.get(name);
    const state = !there
      ? "missing"
      : there.isFile && there.bytes.equals(bytes)
        ? "same"
        : "differs";
    if (state === "differs") conflicts.push(`${ctx.itemsDir.slice(ctx.root.length + 1)}/${name}`);
    staged.push({ item, name, bytes, state });
  }
  const runNames = new Set(staged.map((s) => s.name));
  const others = [...existing.values()].filter((e) => !runNames.has(e.name));
  return { staged, conflicts, tampered, others };
}

function markerOf(ctx) {
  const { config } = parseConfig(readConfigBytes(ctx));
  return { config, marker: config?.migration ?? null };
}

/**
 * Apply a run. options: {manifestPath, repo?, now?, today?, hooks?}. hooks (tests only):
 * {afterInstall(id, index), beforeMarker()} may throw to simulate an interruption.
 * Returns {state: "applied" | "already-complete", run, installed, resumed, record, marker, check}.
 */
export function applyRun({ manifestPath, repo = null, now = () => new Date(), today, hooks = {} }) {
  const runDir = path.dirname(path.resolve(manifestPath));
  const manifest = readJson(path.resolve(manifestPath));
  const ctx = resolveRepo(repo ?? manifest.repo.root);
  if (!samePath(ctx.root, manifest.repo.root)) {
    throw fail(
      "DOCKET_IMPORT_TARGET",
      `manifest was staged for ${manifest.repo.root}, not ${ctx.root}`,
    );
  }
  const { events } = readJournal(runDir);
  const { config, marker } = markerOf(ctx);
  if (marker && marker.run !== manifest.run) {
    throw fail(
      "DOCKET_IMPORT_CONFLICT",
      `docket.json already records migration run ${marker.run}; refusing to apply ${manifest.run}`,
      { marker },
    );
  }
  if (isComplete(events) && marker?.run === manifest.run) {
    return { state: "already-complete", run: manifest.run, installed: 0, resumed: 0, marker };
  }
  if (!manifest.ready) {
    throw fail(
      "DOCKET_IMPORT_NOT_READY",
      `run ${manifest.run} is not ready (verification failed or overrides open); see docket import verify`,
    );
  }

  const append = openJournal(runDir);
  const attempt = events.filter((e) => e.op === "begin").length + 1;
  const stop = (stage, err) => {
    append({ op: "failed", at: now().toISOString(), stage, message: err.message });
    return err;
  };

  return withLock(lockPathFor(ctx), () => {
    // 1. Preconditions, before anything is written.
    const cmp = compareTarget(ctx, manifest, runDir);
    if (cmp.tampered.length) {
      throw fail(
        "DOCKET_IMPORT_STAGING",
        `staged files changed since the dry run: ${cmp.tampered.join(", ")}`,
        { tampered: cmp.tampered },
      );
    }
    if (cmp.conflicts.length) {
      throw fail(
        "DOCKET_IMPORT_CONFLICT",
        `target already has different files: ${cmp.conflicts.join(", ")}`,
        { conflicts: cmp.conflicts },
      );
    }
    const v = verifyRun(runDir, {
      sourceRoot: ctx.root,
      targetEntries: cmp.others.map(({ name, isFile, bytes }) => ({ name, isFile, bytes })),
      today,
    });
    if (!v.drift.ok) {
      throw fail(
        "DOCKET_IMPORT_DRIFT",
        `sources changed since the dry run: ${v.drift.problems.join("; ")}`,
        { drift: v.drift.problems },
      );
    }
    if (!v.ok || v.unresolved) {
      throw fail("DOCKET_IMPORT_NOT_READY", "run no longer verifies; see docket import verify", {
        reconstruction: v.reconstruction.problems,
        accounting: v.accounting.problems,
        check: v.check.errors,
        unresolved: v.unresolved,
      });
    }
    append({ op: "begin", at: now().toISOString(), attempt });

    // 2. Install. Create-only, so a file that appeared since the comparison is never overwritten.
    let installed = 0;
    let resumed = 0;
    const journaled = new Set(events.filter((e) => e.op === "install").map((e) => e.id));
    for (const [index, s] of cmp.staged.entries()) {
      if (s.state === "same") {
        resumed++;
        if (!journaled.has(s.item.id))
          append({ op: "install", id: s.item.id, sha256: s.item.sha256, found: true });
      } else {
        try {
          atomicWrite(itemPath(ctx, s.item.id), s.bytes, { createOnly: true });
        } catch (err) {
          throw stop("install", err);
        }
        append({ op: "install", id: s.item.id, sha256: s.item.sha256 });
        installed++;
      }
      hooks.afterInstall?.(s.item.id, index);
    }

    // 3. Validate the whole target store as it now stands.
    const result = checkSnapshot(workingSnapshot(ctx), { today });
    if (!result.ok) {
      throw stop(
        "validate",
        fail(
          "DOCKET_IMPORT_INVALID",
          `installed store fails check (${result.errors.length} error(s)); marker not published`,
          {
            errors: result.errors.slice(0, 50),
          },
        ),
      );
    }
    append({ op: "validated", items: result.count, warnings: result.warnings.length });

    // 4. Provenance record, then 5. the marker, last.
    const at = now().toISOString();
    const check = { ok: true, items: result.count, errors: 0, warnings: result.warnings.length };
    const record = buildRecord(manifest, {
      appliedAt: at,
      acceptance: {
        check,
        verification: {
          drift: "ok",
          reconstruction: `${v.reconstruction.verified}/${v.reconstruction.files} files byte-identical`,
          accounting: "ok",
          stagedCheck: `${v.check.items} staged, ${v.check.errors.length} error(s)`,
          unresolved: v.unresolved,
        },
      },
    });
    const recordBytes = Buffer.from(serializeRecord(record), "utf8");
    try {
      atomicWrite(path.join(ctx.root, RECORD_PATH), recordBytes);
    } catch (err) {
      throw stop("record", err);
    }
    append({ op: "record", path: RECORD_PATH, sha256: sha256(recordBytes) });
    hooks.beforeMarker?.();
    const published = migrationMarker(manifest, { completedAt: at, recordBytes });
    try {
      writeConfig(ctx, { ...config, migration: published });
    } catch (err) {
      throw stop("marker", err);
    }
    append({ op: "marker", path: "docket.json" });
    append({ op: "complete", at: now().toISOString() });
    return {
      state: "applied",
      run: manifest.run,
      installed,
      resumed,
      record: RECORD_PATH,
      marker: published,
      check: { ...check, warningList: result.warnings },
    };
  });
}
