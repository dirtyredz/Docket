// Deterministic clock and randomness for tests.

/** A local Date for y-m-d h:m (local time zone, as `since` uses local dates). */
export const localTime = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

/** random(n) returning the given hex strings in order (then repeating the last). */
export function scriptedRandom(...hexes) {
  let i = 0;
  return (n) => {
    const hex = hexes[Math.min(i++, hexes.length - 1)];
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== n) throw new Error(`scripted random expects ${n} bytes`);
    return buf;
  };
}
