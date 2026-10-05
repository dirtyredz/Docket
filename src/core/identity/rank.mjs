// Fractional ordering within a priority band. Ranks are `[a-z]+` compared bytewise; 'a' is digit 0 and
// 'z' digit 25. Generated keys never end in 'a', which keeps a gap available below every generated key.
// A legal hand-written key can still leave no representable gap (nothing sorts between "b" and "ba",
// or below "a"): that raises DOCKET_RANK_GAP instead of silently rewriting the whole band.
import { CODES, docketError } from "../errors.mjs";

const A = 97;
const digit = (ch) => ch.charCodeAt(0) - A;
const char = (d) => String.fromCharCode(A + d);

const gapError = (lo, hi) =>
  docketError(CODES.RANK_GAP, `no rank fits between "${lo || "(start)"}" and "${hi ?? "(end)"}"`, {
    lo,
    hi,
  });

function mid(lo, hi) {
  // hi === null means unbounded above; lo === "" means unbounded below.
  if (hi !== null) {
    let n = 0;
    while (n < hi.length && (lo[n] ?? "a") === hi[n]) n++;
    if (n === hi.length) throw gapError(lo, hi);
    if (n > 0) return hi.slice(0, n) + mid(lo.slice(n), hi.slice(n));
  }
  const dl = lo ? digit(lo[0]) : 0;
  const dh = hi !== null ? digit(hi[0]) : 26;
  if (dh - dl > 1) return char(Math.floor((dl + dh) / 2));
  if (hi !== null && hi.length > 1) return hi[0];
  return char(dl) + mid(lo.slice(1), null);
}

/** A rank strictly between lo and hi. lo: string or null (start); hi: string or null (end). */
export function rankBetween(lo, hi) {
  const a = lo ?? "";
  if (hi !== null && hi !== undefined && a >= hi) throw gapError(a, hi);
  const result = mid(a, hi ?? null);
  if (!(result > a) || (hi != null && !(result < hi))) throw gapError(a, hi);
  return result;
}

/** Rank for the end of a band whose ranks are `ranks` (any order, duplicates allowed). */
export function rankAtEnd(ranks) {
  const max = ranks.reduce((m, r) => (r > m ? r : m), "");
  return rankBetween(max || null, null);
}

/** Rank for the start of a band. */
export function rankAtStart(ranks) {
  if (!ranks.length) return rankBetween(null, null);
  const min = ranks.reduce((m, r) => (r < m ? r : m));
  return rankBetween(null, min);
}

/**
 * `count` ranks for a fresh band, evenly spread and strictly increasing, all the same length and never
 * ending in 'a' (so each keeps a gap below it). Used by importers to rank a whole band at once instead
 * of appending one at a time, which would grow keys by a letter every few items.
 */
export function spreadRanks(count) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("count must be a whole number");
  let width = 1;
  while (26 ** width < 2 * (count + 1)) width++;
  const space = 26 ** width;
  const ranks = [];
  for (let i = 1; i <= count; i++) {
    let n = Math.floor((i * space) / (count + 1));
    if (n % 26 === 0) n++; // never end in 'a'; spacing >= 2 keeps it below the next key
    let s = "";
    for (let d = 0; d < width; d++) {
      s = char(n % 26) + s;
      n = Math.floor(n / 26);
    }
    ranks.push(s);
  }
  return ranks;
}
