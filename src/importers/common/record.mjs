// Committed provenance of an applied import, and the migration marker in docket.json.
//   docs/records/migrations/docket.json   what was imported from where: frozen source hashes and HEAD
//                                         blobs (the register's source commit/hash among them), the
//                                         reviewed decisions and overrides, every item's origin and
//                                         staged hash, and the acceptance results at apply time
//   docket.json  {version, migration}     published last, only after the installed set validates
import { sha256 } from "./source-map.mjs";

export const RECORD_PATH = "docs/records/migrations/docket.json";
export const RECORD_VERSION = 1;

const ITEM_COLUMNS = ["id", "idOrigin", "status", "file", "firstLine", "lastLine", "sha256"];

function itemRow(item) {
  return [
    item.id,
    item.idOrigin,
    item.status,
    item.source.file,
    item.source.firstLine,
    item.source.lastLine,
    item.sha256,
  ];
}

/** The record document. `acceptance` is what apply observed: {check, verification}. */
export function buildRecord(manifest, { appliedAt, acceptance }) {
  const reviewed = manifest.decisions.filter((d) => d.severity !== "info");
  return {
    version: RECORD_VERSION,
    importer: manifest.importer,
    run: manifest.run,
    importDate: manifest.importDate,
    dryRunAt: manifest.createdAt,
    appliedAt,
    sourceCommit: manifest.repo.head,
    sourceBranch: manifest.repo.branch,
    target: manifest.staging.target,
    note: "Sources are kept in place as historical evidence; the hashes below are their bytes at import. Any source file rewritten after the import (the register) is recoverable from sourceCommit.",
    sources: manifest.sources.map((s) => ({
      path: s.path,
      role: s.role,
      bytes: s.bytes,
      sha256: s.sha256,
      headBlob: s.headBlob,
      matchesHead: s.matchesHead,
      entries: s.entries,
    })),
    related: manifest.related,
    totals: {
      items: manifest.items.length,
      status: manifest.summary?.status ?? null,
      type: manifest.summary?.type ?? null,
      priority: manifest.summary?.priority ?? null,
      ids: manifest.summary?.ids ?? null,
      decisionCounts: manifest.summary?.decisionCounts ?? null,
    },
    transformations:
      "Each item body is its entry's text after recorded reversible steps only (eol, dedent, final-newline, remove ID comment, rebase relative links, append flags note); the H1 is a derived title. The dry run rebuilt every source byte for byte from the staged items before apply.",
    overrides: reviewed.filter((d) => d.severity === "override"),
    reviewed: reviewed.filter((d) => d.severity !== "override"),
    acceptance,
    itemColumns: ITEM_COLUMNS,
    items: manifest.items.map(itemRow),
  };
}

/** Pretty JSON with one item row per line (the item table stays diffable and compact). */
export function serializeRecord(record) {
  const { items, ...head } = record;
  const body = JSON.stringify({ ...head, items: "@ITEMS@" }, null, 2);
  const rows = items.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return `${body.replace('"@ITEMS@"', `[\n${rows}\n  ]`)}\n`;
}

/** The marker docket.json carries once a migration has completed. */
export function migrationMarker(manifest, { completedAt, recordBytes }) {
  return {
    state: "complete",
    importer: manifest.importer,
    run: manifest.run,
    completedAt,
    record: RECORD_PATH,
    recordSha256: sha256(recordBytes),
  };
}
