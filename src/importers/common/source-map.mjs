// Byte accounting for a legacy source file: decode it losslessly, split it into lines with offsets, and
// describe it as contiguous, non-overlapping spans that together cover every character. Reconstruction
// concatenates the spans' recovered text and compares the hash with the frozen source hash.
import { createHash } from "node:crypto";
import { CODES, docketError } from "../../core/errors.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Git blob id of some bytes (what `git ls-tree` reports), to compare a working file with HEAD. */
export function gitBlobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Decode source bytes exactly: a BOM stays as U+FEFF, invalid UTF-8 throws DOCKET_IMPORT_SOURCE. */
export function decodeSource(bytes, rel) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw docketError(CODES.IMPORT_SOURCE, `${rel} is not valid UTF-8`);
  }
}

/**
 * Lines with offsets: {start, end, next, text}. `end` excludes the line break (\n or \r\n); `next` is
 * the following line's start. The last line has next === text.length.
 */
export function splitLines(text) {
  const lines = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) {
      lines.push({ start: pos, end: text.length, next: text.length });
      break;
    }
    const end = nl > pos && text[nl - 1] === "\r" ? nl - 1 : nl;
    lines.push({ start: pos, end, next: nl + 1 });
    pos = nl + 1;
  }
  for (const l of lines) l.text = text.slice(l.start, l.end);
  return lines;
}

/** A span over whole lines [first, last] (inclusive), including the last line's break. */
export function lineSpan(text, lines, first, last, props) {
  const start = lines[first].start;
  const end = lines[last].next;
  return {
    start,
    end,
    firstLine: first + 1,
    lastLine: last + 1,
    ...props,
    text: text.slice(start, end),
  };
}

/** Problems with span coverage of a text of `length` characters (gaps, overlaps, bad bounds). */
export function coverageProblems(spans, length, rel) {
  const problems = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start !== pos) {
      problems.push(
        s.start > pos
          ? `${rel}: characters ${pos}-${s.start} belong to no span (dropped bytes)`
          : `${rel}: span at ${s.start} overlaps the previous span (ends ${pos})`,
      );
    }
    if (s.end < s.start) problems.push(`${rel}: span at ${s.start} ends before it starts`);
    pos = Math.max(pos, s.end);
  }
  if (pos !== length) {
    problems.push(
      pos < length
        ? `${rel}: characters ${pos}-${length} belong to no span (dropped bytes)`
        : `${rel}: spans run past the end of the file (${pos} > ${length})`,
    );
  }
  return problems;
}

/**
 * Rebuild a file from its spans. recover(span) returns the span's original text (from the recorded
 * text, or by inverting a staged item); a thrown error is reported per span. Returns
 * {ok, sha256, problems}. ok requires matching coverage and the frozen hash.
 */
export function reconstruct({ rel, length, sha256: expected, spans }, recover) {
  const problems = coverageProblems(spans, length, rel);
  const parts = [];
  for (const span of spans) {
    try {
      parts.push(recover(span));
    } catch (err) {
      problems.push(`${rel}: lines ${span.firstLine}-${span.lastLine}: ${err.message}`);
      parts.push("");
    }
  }
  const actual = sha256(Buffer.from(parts.join(""), "utf8"));
  if (actual !== expected) {
    problems.push(
      `${rel}: reconstructed bytes hash ${actual.slice(0, 12)}, source is ${expected.slice(0, 12)}`,
    );
  }
  return { ok: problems.length === 0, sha256: actual, problems };
}

/** The manifest record of a source file: identity, frozen hash, HEAD blob, and entry count. */
export function sourceRecord(s, blobs) {
  return {
    path: s.rel,
    role: s.role,
    area: s.area,
    bytes: s.bytes.length,
    length: s.text.length,
    lines: s.lines.length,
    sha256: sha256(s.bytes),
    headBlob: blobs.get(s.rel) ?? null,
    matchesHead: blobs.get(s.rel) === gitBlobId(s.bytes),
    entries: s.drafts.length,
  };
}

/**
 * The source-map record of a source file. `spans` are its line spans (from the importer's scanner,
 * each with `disposition` and, for items, `item` = draft ID); `s.drafts` carry the title and inverse
 * steps. Item spans store steps and a hash; every other span stores its text so it can be replayed.
 */
export function mapSource(s, spans) {
  const ids = s.drafts.map((d) => d.id);
  const records = spans.map((span) => {
    const { text, ...rest } = span;
    const record = { ...rest, sha256: sha256(Buffer.from(text, "utf8")) };
    if (span.disposition === "item") {
      const d = s.drafts[ids.indexOf(span.item)];
      return { ...record, title: d.title, steps: d.steps };
    }
    return { ...record, text };
  });
  return { path: s.rel, length: s.text.length, sha256: sha256(s.bytes), spans: records };
}
