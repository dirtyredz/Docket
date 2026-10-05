// Cooperating-process exclusion: an exclusive-create lock file holding {pid, at, token}.
// A lock whose owner process is gone (and that is older than DEAD_OWNER_GRACE_MS), or that is older
// than staleMs, is broken and retaken. Breaking is rename-then-verify: the lock is moved aside and
// deleted only if it is still the one judged stale; a fresh lock moved by mistake is put back. A plain
// check-then-delete let a waiter delete a lock taken between its check and its delete (lost update).
// Only Docket writers honour it; external editors do not (see docs/GOTCHAS.md).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../core/errors.mjs";
import { sleepSync } from "./atomic-write.mjs";

const DEAD_OWNER_GRACE_MS = 1000;

function ownerAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but not ours to signal
  }
}

function readLock(lockPath) {
  try {
    const content = fs.readFileSync(lockPath, "utf8");
    return { content, ageMs: Date.now() - fs.statSync(lockPath).mtimeMs };
  } catch {
    return null; // vanished: just retry
  }
}

function judgedStale({ content, ageMs }, staleMs) {
  if (ageMs > staleMs) return true;
  if (ageMs < DEAD_OWNER_GRACE_MS) return false;
  try {
    const { pid } = JSON.parse(content);
    return Number.isInteger(pid) && !ownerAlive(pid);
  } catch {
    return false; // half-written by a live creator
  }
}

/** Break the lock only if it is still the exact lock judged stale. */
export function breakStale(lockPath, seen) {
  const aside = `${lockPath}.${process.pid}.${randomBytes(4).toString("hex")}.stale`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return; // someone else broke or released it
  }
  try {
    if (fs.readFileSync(aside, "utf8") !== seen.content) {
      try {
        fs.linkSync(aside, lockPath); // restore a fresh lock taken after our judgement
      } catch {
        /* slot already re-taken; the restored owner will find its token gone */
      }
    }
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

/** Acquire `lockPath`; returns a release function. Throws code DOCKET_LOCKED on timeout. */
export function acquireLock(lockPath, { timeoutMs = 10000, staleMs = 60000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const content = JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    token: randomBytes(8).toString("hex"),
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, content);
      fs.closeSync(fd);
      return () => {
        // Remove only our own lock (it may have been broken as stale and re-taken by now).
        try {
          if (fs.readFileSync(lockPath, "utf8") === content) fs.rmSync(lockPath, { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch (err) {
      if (err.code !== "EEXIST" && err.code !== "EPERM") throw err;
    }
    const seen = readLock(lockPath);
    if (seen && judgedStale(seen, staleMs)) {
      breakStale(lockPath, seen);
      continue;
    }
    if (Date.now() > deadline) {
      throw docketError(CODES.LOCKED, `timed out waiting for lock ${lockPath}`);
    }
    sleepSync(5 + Math.floor(Math.random() * Math.min(50, 5 * (attempt + 1))));
  }
}

export function withLock(lockPath, fn, options) {
  const release = acquireLock(lockPath, options);
  try {
    return fn();
  } finally {
    release();
  }
}
