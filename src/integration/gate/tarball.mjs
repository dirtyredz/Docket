// Minimal reader for npm-pack tarballs (gzip + ustar, with pax and GNU long-name headers).
// Kept dependency-free so promotion works without network or system tar.
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { CODES, docketError } from "../../core/errors.mjs";

const field = (buf, start, len) => {
  const raw = buf.subarray(start, start + len);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul < 0 ? len : nul).toString("utf8");
};
const octal = (buf, start, len) => parseInt(field(buf, start, len).trim() || "0", 8);

function paxPath(body) {
  for (const record of body.toString("utf8").split("\n")) {
    const m = /^\d+ path=(.*)$/.exec(record);
    if (m) return m[1];
  }
  return null;
}

/** List regular-file entries: [{name, data}]. */
export function readTarball(gzBytes) {
  const tar = gunzipSync(gzBytes);
  const files = [];
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "L") {
      longName = type === "x" ? paxPath(body) : field(body, 0, size);
      continue;
    }
    if (type === "g") continue;
    const prefix = field(header, 345, 155);
    const name =
      longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = null;
    if (type === "0" || type === "\0") files.push({ name, data: Buffer.from(body) });
  }
  return files;
}

/** Extract regular files under `strip` into destDir, refusing any path that escapes it. */
export function extractTarball(gzBytes, destDir, { strip = "" } = {}) {
  const root = path.resolve(destDir);
  for (const { name, data } of readTarball(gzBytes)) {
    if (!name.startsWith(strip)) continue;
    const target = path.resolve(root, name.slice(strip.length));
    if (!target.startsWith(root + path.sep)) {
      throw docketError(CODES.BAD_TARBALL, `tarball entry escapes destination: ${name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
