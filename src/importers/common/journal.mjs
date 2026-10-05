// Recovery journal for `import apply`: an append-only JSON-lines file in the run directory. Each step
// of an apply appends one event and fsyncs it, so an interrupted apply leaves an exact trail:
//   {op: "begin", at, attempt}            an apply attempt started (preconditions passed)
//   {op: "install", id, sha256}           one staged item now exists in the target, byte-identical
//   {op: "validated", items, warnings}    the target store passed `check` with every item installed
//   {op: "record", path, sha256}          the committed provenance record was written
//   {op: "marker", path}                  docket.json now carries the migration marker
//   {op: "complete", at}                  cutover finished; later applies are no-ops
//   {op: "failed", at, stage, message}    the attempt stopped; the marker was not published
// The filesystem stays the authority for what is installed (apply re-compares bytes on resume); the
// journal records what happened and whether the run already completed. A torn final line (a crash
// mid-append) is ignored.
import fs from "node:fs";
import path from "node:path";

export const JOURNAL = "apply-journal.jsonl";

export const journalPath = (runDir) => path.join(runDir, JOURNAL);

/** Events in order. Unparseable lines (only possible as a torn last line) are skipped and counted. */
export function readJournal(runDir) {
  let text;
  try {
    text = fs.readFileSync(journalPath(runDir), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { events: [], torn: 0 };
    throw err;
  }
  const events = [];
  let torn = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      torn++;
    }
  }
  return { events, torn };
}

/** Open the journal for appending; returns append(event), which writes one line and fsyncs. */
export function openJournal(runDir) {
  const file = journalPath(runDir);
  // A torn last line has no newline; start a fresh line so the next event parses.
  let needsBreak = false;
  try {
    const text = fs.readFileSync(file, "utf8");
    needsBreak = text.length > 0 && !text.endsWith("\n");
  } catch {
    /* new journal */
  }
  return (event) => {
    const fd = fs.openSync(file, "a");
    try {
      fs.writeSync(fd, `${needsBreak ? "\n" : ""}${JSON.stringify(event)}\n`);
      fs.fsyncSync(fd);
      needsBreak = false;
    } finally {
      fs.closeSync(fd);
    }
  };
}

export const isComplete = (events) => events.some((e) => e.op === "complete");
