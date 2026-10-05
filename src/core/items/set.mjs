// `set`: edit scalar fields. id and created never change. A real status change rewrites `since`; a
// no-op status assignment does not. Reordering takes relative placement, never a caller-supplied rank.
import { CODES, docketError, notFound } from "../errors.mjs";
import { CLOSED_STATUSES } from "../format/schema.mjs";
import { rankAtEnd, rankAtStart, rankBetween } from "../identity/rank.mjs";
import { editableRecord } from "./transaction.mjs";
import { withTitle } from "../format/serialize.mjs";
import { bandRanks, cleanTitle } from "./add.mjs";
import { assertRevision } from "./revisions.mjs";

const usage = (message) => docketError(CODES.USAGE, message);

/**
 * Rank for `id` in `priority` given placement {before|after: id} or {top|bottom: true}.
 * Ranks of duplicates are skipped over with strict comparisons, so a duplicate never blocks a move.
 */
export function placeRank(records, id, priority, placement) {
  const band = bandRanks(records, priority, id);
  if (placement.top) return rankAtStart(band);
  if (placement.bottom) return rankAtEnd(band);
  const anchorId = placement.before ?? placement.after;
  const anchor = records.find((r) => r.id === anchorId);
  if (!anchor?.fields) throw notFound(anchorId);
  if (anchorId === id) throw usage("cannot place an item relative to itself");
  if (anchor.fields.priority !== priority) {
    throw usage(`${anchorId} is in ${anchor.fields.priority}, not ${priority}`);
  }
  const r = anchor.fields.rank;
  if (placement.before) {
    const lo = band.filter((x) => x < r).reduce((m, x) => (m === null || x > m ? x : m), null);
    return rankBetween(lo, r);
  }
  const hi = band.filter((x) => x > r).reduce((m, x) => (m === null || x < m ? x : m), null);
  return rankBetween(r, hi);
}

/**
 * Plan a set. changes: {status?, priority?, type?, area?, title?, placement?}. title rewrites only the H1. A placement relative to another
 * item adopts that item's priority when --priority is not given. A supplied `expect` must match the
 * current revision, even when the change turns out to be a no-op.
 */
export function planSet({ records, byId }, id, changes, { today, expect }) {
  const rec = editableRecord(byId, id);
  assertRevision(rec, expect);
  const before = rec.fields;
  const f = { ...before };
  if (changes.type !== undefined) f.type = changes.type;
  if (changes.area !== undefined) f.area = changes.area;
  if (changes.status !== undefined && changes.status !== before.status) {
    f.status = changes.status;
    f.since = today;
  }
  const placement = changes.placement;
  const anchorId = placement?.before ?? placement?.after;
  const anchorPriority = anchorId ? byId.get(anchorId)?.fields?.priority : undefined;
  if (changes.priority !== undefined) f.priority = changes.priority;
  else if (anchorPriority) f.priority = anchorPriority;
  if (placement) f.rank = placeRank(records, id, f.priority, placement);
  else if (f.priority !== before.priority) f.rank = rankAtEnd(bandRanks(records, f.priority, id));

  const changed = Object.keys(f).filter((k) => f[k] !== before[k]);
  let rest = rec.rest;
  if (changes.title !== undefined) {
    const title = cleanTitle(changes.title);
    if (title !== rec.title) {
      rest = withTitle(rest, title);
      changed.push("title");
    }
  }
  const value = {
    id,
    changed,
    fields: f,
    completed: changed.includes("status") && CLOSED_STATUSES.includes(f.status),
  };
  if (!changed.length) return { writes: [], value };
  return {
    writes: [{ id, fields: f, rest, expectedRevision: expect ?? rec.revision }],
    value,
  };
}
