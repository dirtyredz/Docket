// Durable replacement: temp file in the same directory, fsync, then rename (or hard-link for create-only).
// Windows can refuse a rename or link transiently while an editor, indexer or antivirus holds the
// destination open, so those steps retry with backoff before giving up. The temp file never survives.
import { CODES, docketError } from "../core/errors.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run fn, retrying transient Windows file errors with linear backoff. */
export function withRetry(fn, { attempts = 8, delayMs = 15 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (!TRANSIENT.has(err.code) || i >= attempts) throw err;
      sleepSync(delayMs * i);
    }
  }
}

const defaultOps = {
  rename: (from, to) => fs.renameSync(from, to),
  link: (from, to) => fs.linkSync(from, to),
};

/**
 * Write `data` to `target` atomically.
 * createOnly: fail with code DOCKET_EXISTS instead of replacing an existing file (hard link is atomic
 * no-overwrite). `ops` lets tests inject rename/link failures.
 */
export function atomicWrite(target, data, { createOnly = false, ops = defaultOps, retry } = {}) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  const fd = fs.openSync(tmp, "wx");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (createOnly) {
      try {
        withRetry(() => ops.link(tmp, target), retry);
      } catch (err) {
        if (err.code === "EEXIST") {
          throw docketError(CODES.EXISTS, `refusing to overwrite existing ${target}`);
        }
        throw err;
      }
    } else {
      withRetry(() => ops.rename(tmp, target), retry);
    }
  } finally {
    // After a rename the temp name is gone; after a link (or any failure) it must be removed.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already renamed away */
    }
  }
  syncDirectory(dir);
}

// Persist the directory entry where the platform allows it (Windows cannot open a directory to fsync).
function syncDirectory(dir) {
  if (process.platform === "win32") return;
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    /* best effort */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
