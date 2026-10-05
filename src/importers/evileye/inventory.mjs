// What an EvilEye repo holds that the importer reads: the register, the open and done shards, and the
// other files beside them (hashed, not converted). Plus the committed blob ids those files had at HEAD.
import fs from "node:fs";
import path from "node:path";
import { CODES, docketError } from "../../core/errors.mjs";
import { TOKEN_RE } from "../../core/format/schema.mjs";
import { tryGit } from "../../repository/context.mjs";

export const REGISTER = "docs/BACKLOG.md";
export const SHARD_ROOT = "docs/work/backlog";

/** Source files in import order: the register, then open shards, then done shards (alphabetical). */
export function inventory(root) {
  if (!fs.existsSync(path.join(root, REGISTER)))
    throw docketError(CODES.IMPORT_SOURCE, `${REGISTER} not found under ${root}`);
  const sources = [{ rel: REGISTER, role: "register", area: "" }];
  const related = [];
  for (const role of ["open", "done"]) {
    const dir = path.join(root, SHARD_ROOT, role);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .sort()) {
      const area = name.replace(/\.md$/, "").toLowerCase();
      sources.push({
        rel: `${SHARD_ROOT}/${role}/${name}`,
        role,
        area: TOKEN_RE.test(area) ? area : "",
      });
    }
  }
  if (fs.existsSync(path.join(root, SHARD_ROOT))) {
    for (const name of fs.readdirSync(path.join(root, SHARD_ROOT)).sort()) {
      const rel = `${SHARD_ROOT}/${name}`;
      if (fs.statSync(path.join(root, rel)).isFile()) related.push({ rel });
    }
  }
  for (const s of [...sources, ...related]) s.bytes = fs.readFileSync(path.join(root, s.rel));
  return { sources, related };
}

/** Map<repo-relative path, git blob id at HEAD> for the given files (absent when untracked). */
export function headBlobs(root, rels) {
  const out = tryGit(root, ["ls-tree", "HEAD", "--", ...rels]);
  const map = new Map();
  for (const row of (out ?? "").split("\n").filter(Boolean)) {
    const tab = row.indexOf("\t");
    map.set(row.slice(tab + 1), row.slice(0, tab).split(" ")[2]);
  }
  return map;
}
