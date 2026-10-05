// Locked, atomic persistence of registry.json. A missing file reads as empty; a corrupt or
// unknown-version file is refused and left byte-for-byte untouched (never "repaired" by a write).
// Updates run read-modify-write under <registry>.lock, so concurrent `repo` commands do not lose entries.
import fs from "node:fs";
import { CODES, docketError } from "../../core/errors.mjs";
import { atomicWrite } from "../../storage/atomic-write.mjs";
import { withLock } from "../../storage/lock.mjs";
import { emptyRegistry, validateRegistry } from "./schema.mjs";

/** Read and validate the registry at `file`. Missing = empty. Throws DOCKET_INVALID when unreadable. */
export function readRegistry(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return emptyRegistry();
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw docketError(CODES.INVALID, `registry: ${file} is not valid JSON (left untouched)`, {
      file,
    });
  }
  try {
    return validateRegistry(doc);
  } catch (err) {
    throw docketError(CODES.INVALID, `${err.message} in ${file} (left untouched)`, { file });
  }
}

/**
 * Update the registry: change(registry) mutates or returns a registry and a value
 * ({registry?, value}); the result is validated and written atomically under the lock.
 * `dryRun` computes the same result without writing. Returns {registry, value, written}.
 */
export function updateRegistry(file, change, { dryRun = false } = {}) {
  const run = () => {
    const current = readRegistry(file);
    const before = JSON.stringify(current);
    const draft = structuredClone(current);
    const out = change(draft) ?? {};
    const registry = validateRegistry(out.registry ?? draft);
    const text = `${JSON.stringify(registry, null, 2)}\n`;
    const changed = JSON.stringify(registry) !== before;
    if (changed && !dryRun) atomicWrite(file, text);
    return { registry, value: out.value, written: changed && !dryRun };
  };
  return dryRun ? run() : withLock(`${file}.lock`, run);
}
