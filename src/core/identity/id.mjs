// Random identity allocation: `dk-` + 4 random bytes as lowercase hex, retried until unused.
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { CODES, docketError } from "../errors.mjs";
import { NEW_ID_PREFIX } from "../format/schema.mjs";

/**
 * Allocate a new ID. `taken(id)` reports existing identities (files present in the store).
 * `random(n)` is injectable for collision tests. Throws DOCKET_ID_EXHAUSTED after `attempts`.
 */
export function allocateId({ taken, random = cryptoRandomBytes, attempts = 32 }) {
  for (let i = 0; i < attempts; i++) {
    const id = `${NEW_ID_PREFIX}-${random(4).toString("hex")}`;
    if (!taken(id)) return id;
  }
  throw docketError(CODES.ID_EXHAUSTED, `no free ID after ${attempts} attempts`);
}
