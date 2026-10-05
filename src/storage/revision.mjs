// Content revisions: a short hash of a file's exact bytes. Used for optimistic concurrency.
import { createHash } from "node:crypto";
import fs from "node:fs";

export function revisionOf(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Read a file with its revision, or null when it does not exist. */
export function readWithRevision(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return { bytes, revision: revisionOf(bytes) };
}
