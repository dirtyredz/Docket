// Verification of a staged import run, from what is on disk only (the manifest, the source map, the
// staged item files and the live sources):
//   drift           every source still hashes to its frozen value
//   reconstruction  every source is rebuilt byte for byte: recorded text for non-item spans, and the
//                   staged item body run back through its inverse steps for item spans
//   accounting      every span has a known disposition with a reason; every item span reaches exactly
//                   one staged item; no stray or missing item files; no duplicate identities; every
//                   metadata span describes a staged item; no staged file equals a source file
//   check           the staged items (plus any existing target items) pass core validation
//   ambiguity       decisions that need an override are resolved
import fs from "node:fs";
import path from "node:path";
import { parseItem } from "../../core/format/parse.mjs";
import { checkSnapshot } from "../../core/validation/check.mjs";
import { revisionOf } from "../../storage/revision.mjs";
import { readJson } from "./manifest.mjs";
import { reconstruct, sha256 } from "./source-map.mjs";
import { invertEntry } from "./transform.mjs";

const DISPOSITIONS = new Set(["item", "metadata", "wrapper", "retained", "blank"]);

function recoverer(runDir, itemsById) {
  return (span) => {
    if (span.disposition !== "item") {
      if (sha256(Buffer.from(span.text, "utf8")) !== span.sha256)
        throw new Error("recorded span text changed");
      return span.text;
    }
    const meta = itemsById.get(span.item);
    if (!meta) throw new Error(`span names ${span.item}, which is not in the manifest`);
    const file = path.join(runDir, "items", `${span.item}.md`);
    if (!fs.existsSync(file)) throw new Error(`staged item ${span.item}.md is missing`);
    const parsed = parseItem(fs.readFileSync(file));
    if (parsed.rest === null)
      throw new Error(`staged item ${span.item}.md has no readable frontmatter`);
    const head = `# ${meta.title}\n\n`;
    if (!parsed.rest.startsWith(head))
      throw new Error(`staged item ${span.item}.md no longer starts with its title`);
    const original = invertEntry(parsed.rest.slice(head.length), span.steps);
    if (sha256(Buffer.from(original, "utf8")) !== span.sha256) {
      throw new Error(`inverting ${span.item}.md does not give back the source span`);
    }
    return original;
  };
}

function accounting(manifest, sourceMap, runDir, sourceBytes) {
  const problems = [];
  const itemSpans = new Map();
  const ids = new Set(manifest.items.map((i) => i.id));
  if (ids.size !== manifest.items.length)
    problems.push("the manifest lists an item ID more than once");
  for (const src of sourceMap.sources) {
    for (const s of src.spans) {
      const where = `${src.path}:${s.firstLine}-${s.lastLine}`;
      if (!DISPOSITIONS.has(s.disposition))
        problems.push(`${where}: unknown disposition ${s.disposition}`);
      if ((s.disposition === "wrapper" || s.disposition === "retained") && !s.reason) {
        problems.push(`${where}: ${s.disposition} span without a reason (unexplained)`);
      }
      if (s.disposition === "item")
        itemSpans.set(s.item, [...(itemSpans.get(s.item) ?? []), where]);
      if (s.disposition === "metadata" && !ids.has(s.item)) {
        problems.push(`${where}: describes ${s.item}, which no entry carries`);
      }
    }
  }
  for (const [id, wheres] of itemSpans) {
    if (wheres.length > 1)
      problems.push(`${id}: produced by ${wheres.length} spans (${wheres.join(", ")})`);
  }
  for (const id of ids)
    if (!itemSpans.has(id)) problems.push(`${id}: staged without a source span`);
  const staged = fs.readdirSync(path.join(runDir, "items"));
  for (const name of staged) {
    if (!ids.has(name.replace(/\.md$/, ""))) problems.push(`items/${name}: not in the manifest`);
    const bytes = fs.readFileSync(path.join(runDir, "items", name));
    const hash = sha256(bytes);
    if (sourceBytes.some((b) => sha256(b) === hash))
      problems.push(`items/${name}: identical to a source file`);
  }
  return problems;
}

/**
 * Verify a run. options: {sourceRoot, targetEntries: [{name, isFile, bytes}], today}.
 * Returns {ok, drift, reconstruction, accounting, check, unresolved (count of open overrides)}.
 */
export function verifyRun(runDir, { sourceRoot, targetEntries = [], today }) {
  const manifest = readJson(path.join(runDir, "manifest.json"));
  const sourceMap = readJson(path.join(runDir, "source-map.json"));
  const itemsById = new Map(manifest.items.map((i) => [i.id, i]));

  const drift = [];
  const sourceBytes = [];
  for (const src of manifest.sources) {
    let bytes = null;
    try {
      bytes = fs.readFileSync(path.join(sourceRoot, src.path));
    } catch {
      drift.push(`${src.path}: missing`);
      continue;
    }
    sourceBytes.push(bytes);
    if (sha256(bytes) !== src.sha256)
      drift.push(`${src.path}: changed since the dry run (source drift)`);
  }

  const recover = recoverer(runDir, itemsById);
  const files = sourceMap.sources.map((src) => {
    const r = reconstruct(
      { rel: src.path, length: src.length, sha256: src.sha256, spans: src.spans },
      recover,
    );
    return { path: src.path, ok: r.ok, problems: r.problems };
  });
  const reconstruction = {
    ok: files.every((f) => f.ok),
    files: files.length,
    verified: files.filter((f) => f.ok).length,
    problems: files.flatMap((f) => f.problems),
  };

  const acct = accounting(manifest, sourceMap, runDir, sourceBytes);
  const stagedEntries = fs
    .readdirSync(path.join(runDir, "items"))
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(runDir, "items", name));
      return { name, isFile: true, bytes, revision: revisionOf(bytes) };
    });
  const clash = targetEntries
    .filter((t) => stagedEntries.some((s) => s.name === t.name))
    .map((t) => t.name);
  const result = checkSnapshot(
    { source: "staged import", entries: [...targetEntries, ...stagedEntries] },
    { today },
  );
  const check = {
    ok: result.ok && clash.length === 0,
    items: stagedEntries.length,
    existing: targetEntries.length,
    errors: result.errors,
    warnings: result.warnings,
    conflicts: clash,
  };
  const unresolved = manifest.decisions.filter((d) => d.severity === "override" && !d.resolved);
  return {
    // ok: lossless, accounted and valid. Readiness for apply also needs unresolved === 0.
    ok: drift.length === 0 && reconstruction.ok && acct.length === 0 && check.ok,
    drift: { ok: drift.length === 0, problems: drift },
    reconstruction,
    accounting: { ok: acct.length === 0, problems: acct },
    check,
    unresolved: unresolved.length,
  };
}
