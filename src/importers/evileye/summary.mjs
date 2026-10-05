// The owner-facing summary of an EvilEye dry run: counts and the decisions worth reviewing, derived
// from the manifest only (so a re-read manifest summarizes identically).

const countBy = (list, key) => {
  const out = {};
  for (const x of list) {
    const k = typeof key === "function" ? key(x) : x[key];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const brief = (d) => ({ id: d.id, file: d.file, line: d.line, message: d.message });

/** Summary block for manifest.summary. context: {rows (register rows), sourceMap}. */
export function summarize(manifest, { rows, sourceMap }) {
  const { items, decisions } = manifest;
  const byCode = countBy(decisions, "code");
  const pick = (code) => decisions.filter((d) => d.code === code).map(brief);
  const spans = sourceMap.sources.flatMap((s) => s.spans.map((sp) => ({ ...sp, file: s.path })));
  const indexedIds = new Set(rows.map((r) => r.id));
  const withoutRow = items.filter((i) => !indexedIds.has(i.id));
  return {
    sources: manifest.sources.length,
    sourcesMatchingHead: manifest.sources.filter((s) => s.matchesHead).length,
    entries: items.length,
    entriesByRole: countBy(items, (i) =>
      i.source.file.split("/").slice(-2, -1)[0] === "done" ? "done shard" : "open shard",
    ),
    status: countBy(items, "status"),
    type: countBy(items, "type"),
    priority: countBy(items, "priority"),
    wishlistToIdea: items.filter((i) => i.type === "idea").length,
    ids: countBy(items, "idOrigin"),
    registerRows: rows.length,
    entriesWithoutRow: {
      total: withoutRow.length,
      open: withoutRow.filter((i) => i.status !== "done").length,
      done: withoutRow.filter((i) => i.status === "done").length,
      openList: withoutRow
        .filter((i) => i.status !== "done")
        .map((i) => ({
          id: i.id,
          priority: i.priority,
          file: i.source.file,
          line: i.source.firstLine,
          title: i.title,
        })),
    },
    priorityMismatches: pick("priority-mismatch"),
    leadPriority: pick("lead-priority"),
    doneWithRow: pick("done-with-register-row"),
    statusReview: [
      ...pick("status-partial"),
      ...pick("status-reopened"),
      ...pick("done-shard-no-marker"),
      ...pick("open-shard-done-marker"),
    ],
    needsOverride: decisions
      .filter((d) => d.severity === "override")
      .map((d) => ({ ...brief(d), code: d.code, resolved: Boolean(d.resolved) })),
    rowTitleDiffers: pick("row-title-differs"),
    linksRebased: decisions.filter((d) => d.code === "links-rebased").length,
    dates: {
      createdFromLead: byCode["created-from-lead"] ?? 0,
      createdFromHistory: byCode["created-from-history"] ?? 0,
      createdImportDate: byCode["created-from-import"] ?? 0,
      createdLowered: byCode["created-lowered"] ?? 0,
      sinceImportDate: byCode["since-import-date"] ?? 0,
    },
    spans: countBy(spans, "disposition"),
    retainedProse: spans
      .filter((s) => s.disposition === "retained")
      .map((s) => ({ file: s.file, lines: `${s.firstLine}-${s.lastLine}`, reason: s.reason })),
    decisionCounts: byCode,
  };
}
