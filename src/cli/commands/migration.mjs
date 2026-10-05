// `docket import`: legacy-backlog migration. Thin adapter over src/importers/.
//   import evileye --dry-run [--out DIR] [--run NAME] [--overrides FILE]   stage and verify a plan
//   import verify --manifest PATH                                          re-verify a staged run
//   import apply --manifest PATH                                           install a ready run (resumable)
import fs from "node:fs";
import path from "node:path";
import { localDate } from "../../core/identity/date.mjs";
import { applyRun } from "../../importers/common/apply.mjs";
import { dryRunEvilEye } from "../../importers/evileye/dry-run.mjs";
import { readJson } from "../../importers/common/manifest.mjs";
import { verifyRun } from "../../importers/common/verify.mjs";
import { resolveRepo } from "../../repository/context.mjs";
import { listItemEntries } from "../../storage/item-store.mjs";
import { parseCommand, usageError } from "../args.mjs";
import { EXIT } from "../output.mjs";

const str = { type: "string" };
const LIST_MAX = 50;

function verificationLines(v, ready) {
  const mark = (ok) => (ok ? "ok" : "FAILED");
  return [
    `  source drift:    ${mark(v.drift.ok)}${v.drift.problems.length ? ` (${v.drift.problems.length})` : ""}`,
    `  reconstruction:  ${mark(v.reconstruction.ok)} (${v.reconstruction.verified}/${v.reconstruction.files} files byte-identical)`,
    `  accounting:      ${mark(v.accounting.ok)}${v.accounting.problems.length ? ` (${v.accounting.problems.length} problem(s))` : ""}`,
    `  docket check:    ${mark(v.check.ok)} (${v.check.items} staged, ${v.check.errors.length} error(s), ${v.check.warnings.length} warning(s))`,
    `  unresolved:      ${v.unresolved} decision(s) need an override`,
    `  ready to apply:  ${ready ? "yes" : "no"}`,
  ];
}

function dryRunText(manifestPath, m) {
  const s = m.summary;
  const fmt = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  return [
    `docket import evileye (dry run): ${s.entries} entries from ${s.sources} source file(s)`,
    `  status: ${fmt(s.status)}; type: ${fmt(s.type)}; priority: ${fmt(s.priority)}`,
    `  IDs: ${fmt(s.ids)}; register rows ${s.registerRows}; entries without a row ${s.entriesWithoutRow.total} (open ${s.entriesWithoutRow.open})`,
    `  priority mismatches ${s.priorityMismatches.length}; status reviews ${s.statusReview.length}; overrides needed ${s.needsOverride.filter((d) => !d.resolved).length}`,
    ...verificationLines(m.verification, m.ready),
    `manifest: ${manifestPath}`,
  ].join("\n");
}

function bounded(list) {
  return { total: list.length, items: list.slice(0, LIST_MAX), truncated: list.length > LIST_MAX };
}

async function evileye(argv, io) {
  const args = parseCommand(argv, {
    options: { "dry-run": { type: "boolean" }, out: str, run: str, overrides: str },
  });
  if (!args["dry-run"]) {
    throw usageError(
      "only --dry-run is available; apply ships with the M2b cutover (docket import apply)",
    );
  }
  const overrides = args.overrides
    ? JSON.parse(fs.readFileSync(path.resolve(io.cwd, args.overrides), "utf8"))
    : null;
  const { manifestPath, manifest: m } = dryRunEvilEye({
    repo: args.repo ?? io.cwd,
    out: args.out ? path.resolve(io.cwd, args.out) : null,
    run: args.run ?? null,
    overrides,
  });
  const s = m.summary;
  return {
    data: {
      manifest: manifestPath,
      run: m.run,
      ready: m.ready,
      verification: {
        ok: m.verification.ok,
        drift: m.verification.drift,
        reconstruction: m.verification.reconstruction,
        accounting: m.verification.accounting,
        check: {
          ok: m.verification.check.ok,
          items: m.verification.check.items,
          errors: m.verification.check.errors.length,
          warnings: m.verification.check.warnings.length,
        },
        unresolved: m.verification.unresolved,
      },
      summary: {
        entries: s.entries,
        status: s.status,
        type: s.type,
        priority: s.priority,
        ids: s.ids,
        registerRows: s.registerRows,
        entriesWithoutRow: {
          total: s.entriesWithoutRow.total,
          open: s.entriesWithoutRow.open,
          done: s.entriesWithoutRow.done,
        },
        priorityMismatches: bounded(s.priorityMismatches),
        needsOverride: bounded(s.needsOverride),
        statusReview: bounded(s.statusReview),
      },
    },
    text: dryRunText(manifestPath, m),
    exitCode: m.verification.ok ? EXIT.ok : EXIT.failed,
  };
}

async function verify(argv, io) {
  const args = parseCommand(argv, { options: { manifest: str } });
  if (!args.manifest) throw usageError("missing --manifest <path>");
  const manifestPath = path.resolve(io.cwd, args.manifest);
  const runDir = path.dirname(manifestPath);
  const m = readJson(manifestPath);
  const ctx = resolveRepo(args.repo ?? m.repo.root);
  const targetEntries = listItemEntries(ctx).map(({ name, isFile, bytes }) => ({
    name,
    isFile,
    bytes,
  }));
  const v = verifyRun(runDir, { sourceRoot: ctx.root, targetEntries, today: localDate() });
  const ready = v.ok && v.unresolved === 0;
  const { warnings: _w, errors, ...check } = v.check;
  return {
    data: { manifest: manifestPath, ready, verification: { ...v, check: { ...check, errors } } },
    text: [`docket import verify: ${manifestPath}`, ...verificationLines(v, ready)].join("\n"),
    exitCode: v.ok ? EXIT.ok : EXIT.failed,
  };
}

async function apply(argv, io) {
  const args = parseCommand(argv, { options: { manifest: str } });
  if (!args.manifest) throw usageError("missing --manifest <path>");
  const r = applyRun({
    manifestPath: path.resolve(io.cwd, args.manifest),
    repo: args.repo ? path.resolve(io.cwd, args.repo) : null,
    today: localDate(),
  });
  const { warningList = [], ...check } = r.check ?? {};
  const text =
    r.state === "already-complete"
      ? `docket import apply: run ${r.run} was already applied (marker in docket.json); nothing to do`
      : [
          `docket import apply: run ${r.run} applied`,
          `  installed ${r.installed} item(s)${r.resumed ? `, ${r.resumed} already present (resumed)` : ""}`,
          `  docket check: ok (${check.items} items, ${check.warnings} warning(s))`,
          `  provenance:   ${r.record}`,
          `  marker:       docket.json migration ${r.marker.state} (${r.marker.run})`,
        ].join("\n");
  return { data: { ...r, check: r.check ? check : null }, warnings: warningList, text };
}

const SUB = { evileye, verify, apply };

export async function importCommand(argv, io) {
  const [sub, ...rest] = argv;
  const handler = SUB[sub];
  if (!handler)
    throw usageError(`docket import <evileye|verify|apply>; got ${sub ? `"${sub}"` : "nothing"}`);
  return handler(rest, io);
}
