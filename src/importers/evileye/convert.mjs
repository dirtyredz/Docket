// Conversion of segmented legacy entries into Docket item drafts: identity, type, status, priority,
// dates and the reversible body transform, each choice recorded as a decision for the manifest.
// Ranks are assigned per band afterwards (assignRanks), through core rank generation.
import { createHash } from "node:crypto";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { ENUMS } from "../../core/format/schema.mjs";
import { newItemRest } from "../../core/format/serialize.mjs";
import { allocateId } from "../../core/identity/id.mjs";
import { spreadRanks } from "../../core/identity/rank.mjs";
import { ITEMS_DIR } from "../../repository/paths.mjs";
import { transformEntry } from "../common/transform.mjs";
import { ID_MARKER_RE } from "./shards.mjs";
import {
  completionDate,
  datesIn,
  detectStatus,
  extractTitle,
  leadPriority,
  mentionedPriorities,
  plain,
} from "./status.mjs";

/** Severity: info (recorded), review (owner should look), override (blocks apply until resolved). */
const decision = (code, severity, message, extra = {}) => ({ code, severity, message, ...extra });

/** Leading text of an entry: up to its first three lines, marker and ID comments removed. */
export function entryLead(lines, entry) {
  const parts = [];
  for (let i = entry.startLine; i <= Math.min(entry.endLine, entry.startLine + 2); i++) {
    parts.push(lines[i].text);
  }
  const lead = parts.join(" ").replace(new RegExp(ID_MARKER_RE.source, "g"), "");
  return entry.kind === "heading" ? lead.replace(/^#+\s*/, "") : lead.slice(entry.marker.length);
}

/** Stable key of an entry across runs: file plus a hash of its first line (without ID comments). */
export function entryKey(rel, firstLine) {
  const norm = firstLine.replace(new RegExp(ID_MARKER_RE.source, "g"), "").trim();
  return `${rel}#${createHash("sha256").update(norm).digest("hex").slice(0, 10)}`;
}

/** Validate an overrides document; returns Map<key-or-id, override>. Throws DOCKET_IMPORT_OVERRIDES. */
export function readOverrides(doc) {
  const bad = (m) => docketError(CODES.IMPORT_OVERRIDES, `overrides: ${m}`);
  if (!doc) return new Map();
  if (doc.version !== 1 || typeof doc.entries !== "object")
    throw bad('expected {"version": 1, "entries": {...}}');
  const out = new Map();
  for (const [k, o] of Object.entries(doc.entries)) {
    for (const f of ["status", "type", "priority"]) {
      if (o[f] !== undefined && !ENUMS[f].includes(o[f]))
        throw bad(`${k}: ${f} must be one of ${ENUMS[f].join(", ")}`);
    }
    out.set(k, o);
  }
  return out;
}

function chooseStatus(entry, lead, where, decisions) {
  const s = detectStatus(lead);
  if (where === "done") {
    if (s.status !== "done") {
      decisions.push(
        decision(
          "done-shard-no-marker",
          "review",
          "in a done shard without a completion marker; imported as done",
        ),
      );
    }
    return { status: "done", clause: s.status === "done" ? s.clause : "" };
  }
  if (s.status === "done") {
    decisions.push(
      decision(
        "open-shard-done-marker",
        "review",
        "open shard, but the lead says done; imported as done",
      ),
    );
    return { status: "done", clause: s.clause };
  }
  if (s.status === "partial" || s.status === "reopened") {
    decisions.push(
      decision(
        `status-${s.status}`,
        "review",
        `lead reads as ${s.status}; imported as todo (no explicit active work)`,
      ),
    );
  }
  if (s.status === "ambiguous") {
    decisions.push(
      decision(
        "status-ambiguous",
        "override",
        "struck through without a recognised status word; staged as todo until an override sets the status",
      ),
    );
  }
  return { status: "todo", clause: "" };
}

function choosePriority({ row, entry, lead, wishlist }, decisions) {
  const section = entry.section.priority;
  if (row) {
    const p = row.priority === "U" ? "P3" : row.priority;
    if (row.priority !== section) {
      decisions.push(
        decision(
          "priority-mismatch",
          "review",
          `register row says ${row.priority}, shard section says ${section}; register wins (${p})`,
          {
            register: row.priority,
            shard: section,
          },
        ),
      );
    }
    return p;
  }
  if (wishlist) return "P3";
  const explicit = leadPriority(lead);
  if (explicit && explicit !== section) {
    decisions.push(
      decision(
        "lead-priority",
        "review",
        `no register row; the lead's explicit ${explicit} wins over section ${section}`,
      ),
    );
    return explicit;
  }
  const mentioned = mentionedPriorities(lead).filter((p) => p !== section);
  if (mentioned.length) {
    decisions.push(
      decision(
        "lead-mentions-priority",
        "info",
        `lead mentions ${mentioned.join(", ")}; section ${section} used`,
      ),
    );
  }
  return section;
}

function chooseDates({ leadLine, clause, status, firstSeen, importDate }, decisions) {
  const titleDate = datesIn(leadLine, importDate)[0] ?? null;
  const candidates = [titleDate, firstSeen].filter(Boolean).sort();
  let created = candidates[0] ?? importDate;
  const source = !candidates.length ? "import" : created === titleDate ? "lead" : "history";
  decisions.push(
    decision(
      `created-from-${source}`,
      "info",
      `created ${created} (${source === "import" ? "no reliable date; import date" : source === "lead" ? "earliest date on the entry's first line" : "first Git record of the ID marker"})`,
    ),
  );
  if (status === "todo") return { created, since: created };
  if (status === "done") {
    const done = completionDate(clause, importDate);
    if (!done) {
      decisions.push(
        decision("since-import-date", "info", "completion date unknown; since is the import date"),
      );
      return { created, since: importDate };
    }
    if (done < created) {
      decisions.push(
        decision(
          "created-lowered",
          "info",
          `created lowered from ${created} to the completion date ${done}`,
        ),
      );
      created = done;
    }
    return { created, since: done };
  }
  decisions.push(
    decision(
      "since-import-date",
      "info",
      `status ${status} set by override; since is the import date`,
    ),
  );
  return { created, since: importDate };
}

/**
 * Convert one entry. input: {rel, where (open|done|register), area, lines, text, entry, row,
 * firstSeen, importDate, override}. Returns a draft {key, id?, title, fields (no id/rank), body,
 * steps, decisions, flags, order}.
 */
export function convertEntry(input) {
  const { rel, where, area, lines, entry, row, override } = input;
  const decisions = [];
  const lead = entryLead(lines, entry);
  const wishlist = entry.section.priority === "U";
  const title = extractTitle(lead);
  const { status: autoStatus, clause } = chooseStatus(entry, lead, where, decisions);
  let priority = choosePriority({ row, entry, lead, wishlist }, decisions);
  let type = wishlist ? "idea" : "task";
  if (wishlist)
    decisions.push(decision("wishlist-idea", "info", "wishlist entry: type idea, priority P3"));
  if (row && where === "done") {
    decisions.push(
      decision(
        "done-with-register-row",
        "review",
        `done entry still has register row (line ${row.line}); row used for priority and rank only`,
      ),
    );
  }
  let status = autoStatus;
  if (override) {
    if (override.status) status = override.status;
    if (override.type) type = override.type;
    if (override.priority) priority = override.priority;
    decisions.push(decision("override-applied", "info", `override: ${JSON.stringify(override)}`));
    for (const d of decisions) if (d.severity === "override") d.resolved = true;
  }
  const dates = chooseDates(
    {
      leadLine: lines[entry.startLine].text,
      clause: status === autoStatus ? clause : "",
      status,
      firstSeen: input.firstSeen,
      importDate: input.importDate,
    },
    decisions,
  );

  const flags = row?.flags ?? [];
  if (flags.length)
    decisions.push(
      decision("flags-as-prose", "info", `register flags kept as a body note: ${flags.join("; ")}`),
    );
  const markerMatch = new RegExp(ID_MARKER_RE.source).exec(
    input.text.slice(lines[entry.startLine].start, lines[entry.endLine].next),
  );
  const width = entry.kind === "heading" ? 0 : entry.marker.length;
  const { body, steps } = transformEntry(
    input.text.slice(lines[entry.startLine].start, lines[entry.endLine].next),
    {
      marker: entry.marker,
      width,
      remove: markerMatch ? [markerMatch[0]] : [],
      fromDir: path.posix.dirname(rel),
      toDir: ITEMS_DIR,
      note: flags.length ? `Legacy register flags: ${flags.join("; ")}.` : "",
    },
  );
  const rebase = steps.find((s) => s.op === "rebase");
  if (rebase)
    decisions.push(
      decision(
        "links-rebased",
        "info",
        `${rebase.edits.length} relative link(s) rebased to ${ITEMS_DIR}/`,
      ),
    );
  if (row && plainCompare(row.entry, title)) {
    decisions.push(
      decision(
        "row-title-differs",
        "review",
        `register entry text "${row.entry}" does not match the title "${title}"`,
      ),
    );
  }

  return {
    key: entryKey(rel, lines[entry.startLine].text),
    legacyId: markerMatch ? markerMatch[1] : null,
    title,
    fields: { type, created: dates.created, status, since: dates.since, area, priority },
    body,
    steps,
    rest: newItemRest(title, "") + "\n" + body,
    decisions,
    flags,
    order: { indexed: Boolean(row), rowLine: row?.line ?? null, done: status === "done" },
    source: {
      file: rel,
      firstLine: entry.startLine + 1,
      lastLine: entry.endLine + 1,
      section: entry.section.title,
      group: entry.group,
      registerRow: row?.line ?? null,
    },
  };
}

/** True when a register "Entry" cell is not a (possibly truncated) copy of the title. */
function plainCompare(cell, title) {
  const norm = (s) =>
    plain(s)
      .replace(/[…\s.:;,—–-]+$/, "")
      .toLowerCase();
  const a = norm(cell);
  const b = norm(title);
  return !(a && (b.startsWith(a) || a.startsWith(b)));
}

/**
 * Give drafts identities: keep bl- markers (first occurrence wins; later duplicates get a new ID and
 * an override-severity decision), reuse prior allocations by entry key, else allocate through core.
 * taken: Set of IDs already in use (all legacy markers, existing target items).
 */
export function assignIdentities(
  drafts,
  { taken, prior = new Map(), random, overrides = new Map() },
) {
  const used = new Set();
  const allocate = (d) => {
    const reuse = prior.get(d.key);
    if (reuse && !taken.has(reuse) && !used.has(reuse)) {
      d.decisions.push(
        decision("reused-id", "info", `ID ${reuse} reused from the previous dry run`),
      );
      return { id: reuse, origin: "reused" };
    }
    const id = allocateId({ taken: (x) => taken.has(x) || used.has(x), random });
    d.decisions.push(decision("allocated-id", "info", `no legacy ID; allocated ${id}`));
    return { id, origin: "allocated" };
  };
  for (const d of drafts) {
    if (d.legacyId && !used.has(d.legacyId)) {
      d.id = d.legacyId;
      d.idOrigin = "preserved";
    } else {
      const { id, origin } = allocate(d);
      if (d.legacyId) {
        const ov = overrides.get(d.key) ?? overrides.get(id);
        d.decisions.push(
          decision(
            "duplicate-id",
            "override",
            `${d.legacyId} already used by an earlier entry; given the new ID ${id}`,
            {
              resolved: Boolean(ov?.keepAllocated),
            },
          ),
        );
      }
      d.id = id;
      d.idOrigin = origin;
    }
    used.add(d.id);
  }
  return drafts;
}

/**
 * Rank each priority band: register rows in row order, then unindexed open entries, then done entries,
 * each in stable source order (drafts arrive in source order).
 */
export function assignRanks(drafts) {
  const bands = new Map();
  for (const d of drafts) {
    const p = d.fields.priority;
    if (!bands.has(p)) bands.set(p, []);
    bands.get(p).push(d);
  }
  const tier = (d) => (d.order.indexed ? 0 : d.order.done ? 2 : 1);
  for (const list of bands.values()) {
    const ordered = list
      .map((d, i) => ({ d, i }))
      .sort(
        (a, b) =>
          tier(a.d) - tier(b.d) || (a.d.order.rowLine ?? 0) - (b.d.order.rowLine ?? 0) || a.i - b.i,
      )
      .map((x) => x.d);
    spreadRanks(ordered.length).forEach((rank, i) => {
      ordered[i].fields.rank = rank;
    });
  }
  return drafts;
}
