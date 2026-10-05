// Reversible text transforms that turn a legacy entry's source span into an item body. Every step
// returns its output plus exactly the data needed to undo it, so byte verification can rebuild the
// original span from the staged item file alone. Steps (forward order):
//   eol      CRLF -> LF, recording which lines had CR
//   dedent   list marker off the first line, continuation indent off the rest (wrapper removal)
//   final-newline  guarantee one trailing \n
//   remove   cut one exact substring (historical metadata, e.g. an ID comment)
//   rebase   rewrite relative Markdown link targets for the new location
//   append   add a recorded note at the end (legacy fields that have no schema home)
import path from "node:path";

function eolForward(text) {
  if (!text.includes("\r")) return null;
  const lines = text.split("\n");
  const crlf = [];
  lines.forEach((l, i) => {
    if (l.endsWith("\r") && i < lines.length - 1) crlf.push(i);
  });
  const stripped = lines.map((l, i) => (crlf.includes(i) ? l.slice(0, -1) : l));
  if (stripped.some((l) => l.includes("\r"))) {
    throw Object.assign(new Error("lone carriage return in an entry"), {
      code: "DOCKET_IMPORT_SOURCE",
    });
  }
  return { text: stripped.join("\n"), step: { op: "eol", crlf } };
}

function dedentForward(text, { marker, width }) {
  const lines = text.split("\n");
  if (!lines[0].startsWith(marker))
    throw new Error(`entry does not start with ${JSON.stringify(marker)}`);
  const strip = [0];
  const out = [lines[0].slice(marker.length)];
  for (let i = 1; i < lines.length; i++) {
    let n = 0;
    while (n < width && lines[i][n] === " ") n++;
    strip.push(n);
    out.push(lines[i].slice(n));
  }
  // The split's last element is "" after a trailing newline; it never carries indent.
  return { text: out.join("\n"), step: { op: "dedent", marker, strip } };
}

/** Relative Markdown link targets: inline `](target)` and reference definitions `[x]: target`. */
const LINK_RE = /(\]\()([^)\s]+)((?:\s+"[^"]*")?\))|(^\[[^\]\n]+\]:[ \t]+)(\S+)/gm;
const isRelative = (t) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/|\\)/i.test(t);

/** Rewrite a target relative to `fromDir` so it resolves the same from `toDir` (posix, repo-relative). */
export function rebaseTarget(target, fromDir, toDir) {
  const hash = target.indexOf("#");
  const file = hash >= 0 ? target.slice(0, hash) : target;
  const frag = hash >= 0 ? target.slice(hash) : "";
  if (!file) return target;
  const resolved = path.posix.normalize(path.posix.join(fromDir, file));
  let rel = path.posix.relative(toDir, resolved) || ".";
  if (file.endsWith("/") && !rel.endsWith("/")) rel += "/";
  return rel + frag;
}

function rebaseForward(text, { fromDir, toDir }) {
  const edits = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const prefix = m[1] ?? m[4];
    const target = m[2] ?? m[5];
    if (!isRelative(target)) continue;
    const next = rebaseTarget(target, fromDir, toDir);
    if (next === target) continue;
    const at = m.index + prefix.length;
    out += text.slice(last, at);
    edits.push({
      at: out.length,
      from: target,
      to: next,
      resolved: path.posix.join(fromDir, target.split("#")[0]),
    });
    out += next;
    last = at + target.length;
  }
  if (!edits.length) return null;
  return { text: out + text.slice(last), step: { op: "rebase", edits } };
}

/**
 * Forward transform. options: {marker, width, remove: [string], fromDir, toDir, note}.
 * Returns {body, steps} where body ends with exactly the transformed text plus one trailing \n.
 */
export function transformEntry(source, { marker, width, remove = [], fromDir, toDir, note = "" }) {
  const steps = [];
  let text = source;
  const apply = (result) => {
    if (!result) return;
    text = result.text;
    steps.push(result.step);
  };
  apply(eolForward(text));
  apply(dedentForward(text, { marker, width }));
  if (!text.endsWith("\n")) apply({ text: `${text}\n`, step: { op: "final-newline" } });
  for (const cut of remove) {
    const at = text.indexOf(cut);
    if (at < 0) throw new Error(`cannot remove ${JSON.stringify(cut)}: not found`);
    apply({
      text: text.slice(0, at) + text.slice(at + cut.length),
      step: { op: "remove", at, text: cut },
    });
  }
  if (fromDir !== undefined && toDir !== undefined) apply(rebaseForward(text, { fromDir, toDir }));
  if (note) apply({ text: `${text}\n${note}\n`, step: { op: "append", text: `\n${note}\n` } });
  return { body: text, steps };
}

const fail = (msg) => {
  throw new Error(msg);
};

/** Undo `steps` (as recorded by transformEntry) on `body`, returning the original source text. */
export function invertEntry(body, steps) {
  let text = body;
  for (const step of [...steps].reverse()) {
    switch (step.op) {
      case "append":
        if (!text.endsWith(step.text)) fail("appended note is missing from the item body");
        text = text.slice(0, -step.text.length);
        break;
      case "rebase":
        for (const e of [...step.edits].reverse()) {
          if (text.slice(e.at, e.at + e.to.length) !== e.to)
            fail(`rebased link ${e.to} moved or changed`);
          text = text.slice(0, e.at) + e.from + text.slice(e.at + e.to.length);
        }
        break;
      case "remove":
        text = text.slice(0, step.at) + step.text + text.slice(step.at);
        break;
      case "final-newline":
        if (!text.endsWith("\n")) fail("trailing newline is missing");
        text = text.slice(0, -1);
        break;
      case "dedent": {
        const lines = text.split("\n");
        if (lines.length !== step.strip.length) fail("item body line count changed");
        text = lines
          .map((l, i) => (i === 0 ? step.marker + l : " ".repeat(step.strip[i]) + l))
          .join("\n");
        break;
      }
      case "eol": {
        const lines = text.split("\n");
        text = lines.map((l, i) => (step.crlf.includes(i) ? `${l}\r` : l)).join("\n");
        break;
      }
      default:
        fail(`unknown transform ${step.op}`);
    }
  }
  return text;
}
