// Lead-text interpretation for legacy EvilEye entries: completion status, display title, dates and an
// explicit priority prefix, read ONLY from an entry's leading text (nested sub-points never close their
// parent). The recognised forms follow the EvilEye portal's status contract
// (EvilEye tools/portal/src/backlog/status.mjs, by the same owner), re-implemented here for import only:
//   ~~**Title**~~ Done 2026-09-24 / FIXED ... / **Fixed** ... / **Closed (...)**     -> done
//   **FIXED (2026-09-24).** text / **FIXED (date): title.** / **FIXED - title:**     -> done
//   **FIXED (date), then reopened, ...**                                            -> reopened
//   **Title - done except item 1.** / "partially fixed" in the bold lead            -> partial
//   ~~**Title**~~ followed by anything else                                         -> ambiguous
// Everything else is open.
import { isRealDate } from "../../core/identity/date.mjs";

const DONE_WORD = /^(?:fixed|done|closed|resolved|completed|shipped)\b/i;
const DATE_G = /\b(\d{4}-\d{2}-\d{2})\b/g;
const TITLE_MAX = 160;

function boldLead(s) {
  const m = /^\*\*([\s\S]*?)\*\*/.exec(s);
  return m ? { inner: m[1], rest: s.slice(m[0].length) } : null;
}

/** Markdown emphasis, code markers and link syntax removed, whitespace collapsed. */
export function plain(s) {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/~~/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** {status: open|done|partial|reopened|ambiguous, clause}. clause is the status text (for dates). */
export function detectStatus(lead) {
  const s = lead.trim();
  const strike = /^~~([\s\S]*?)~~/.exec(s);
  if (strike) {
    const after = s
      .slice(strike[0].length)
      .replace(/^[\s:.,—–-]+/, "")
      .replace(/^\*+/, "");
    if (DONE_WORD.test(after)) return { status: "done", clause: after };
    return { status: "ambiguous", clause: after };
  }
  const bold = boldLead(s);
  const head = bold ? bold.inner.trim() : s;
  if (DONE_WORD.test(head)) {
    if (/re-?opened/i.test(head)) return { status: "reopened", clause: head };
    return { status: "done", clause: head };
  }
  if (bold && /\bdone except\b|\bpartially (?:fixed|done)\b/i.test(head)) {
    return { status: "partial", clause: head };
  }
  return { status: "open", clause: "" };
}

function trimTitle(t) {
  let s = plain(t).replace(/[\s.:;,—–-]+$/, "");
  if (s.length > TITLE_MAX) s = `${s.slice(0, TITLE_MAX - 1).trimEnd()}…`;
  return s;
}

function firstSentence(s) {
  const t = plain(s);
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  return m ? m[1] : t;
}

/** One-line display title (never empty: falls back to "Untitled legacy entry"). */
export function extractTitle(lead) {
  const s = lead.trim();
  let title;
  const strike = /^~~([\s\S]*?)~~/.exec(s);
  const bold = boldLead(s);
  if (strike) title = trimTitle(strike[1]);
  else if (bold) {
    const inner = bold.inner.trim();
    const status = /^(?:fixed|done|closed|resolved|completed|shipped)\b\s*(?:\([^)]*\))?\s*/i.exec(
      inner,
    );
    if (!status) title = trimTitle(inner);
    else {
      const remainder = inner.slice(status[0].length).replace(/^[:—–-]\s*/, "");
      title =
        remainder && !/^[,.]/.test(remainder) && !/^then\b/i.test(remainder)
          ? trimTitle(remainder)
          : trimTitle(firstSentence(bold.rest) || inner);
    }
  } else title = trimTitle(firstSentence(s));
  return title || "Untitled legacy entry";
}

/** Real calendar dates in `s`, not after `today`, sorted ascending. */
export function datesIn(s, today) {
  return [...s.matchAll(DATE_G)]
    .map((m) => m[1])
    .filter((d) => isRealDate(d) && d <= today)
    .sort();
}

/** The completion date stated right after a done word ("FIXED (2026-09-25)", "Done 2026-09-25"). */
export function completionDate(clause, today) {
  const m =
    /^(?:fixed|done|closed|resolved|completed|shipped)\b[^0-9\n]{0,16}?(\d{4}-\d{2}-\d{2})/i.exec(
      plain(clause),
    );
  return m && isRealDate(m[1]) && m[1] <= today ? m[1] : null;
}

/** An explicit priority prefix on the lead ("**P1: distance model migration**"), else null. */
export function leadPriority(lead) {
  const m = /^(?:~~)?(?:\*\*)?\s*(P[0-2])\s*:/.exec(lead.trim());
  return m ? m[1] : null;
}

/** P-levels mentioned anywhere in the lead ("(Codex sign-off, 2026-10-02, P1)"). */
export function mentionedPriorities(lead) {
  return [...new Set([...lead.matchAll(/\bP([0-2])\b/g)].map((m) => `P${m[1]}`))];
}
