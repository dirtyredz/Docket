// Snapshots of a store: the working tree's `docs/items/`, or the same directory as committed at a Git
// ref. A snapshot is {source, entries: [{name, isFile, bytes, revision}], configError}.
import { CODES, docketError } from "../core/errors.mjs";
import { revisionOf } from "../storage/revision.mjs";
import { listItemEntries } from "../storage/item-store.mjs";
import { parseConfig, readConfigBytes } from "./config.mjs";
import { git } from "./context.mjs";
import { ITEMS_DIR } from "./paths.mjs";

export function workingSnapshot(ctx) {
  const entries = listItemEntries(ctx).map(({ name, isFile, bytes, revision }) => ({
    name,
    isFile,
    bytes,
    revision,
  }));
  return { source: "working tree", entries, configError: parseConfig(readConfigBytes(ctx)).error };
}

// `git cat-file --batch` output: "<sha> <type> <size>\n<content>\n" per object.
function readBlobs(root, shas) {
  if (!shas.length) return new Map();
  const out = git(root, ["cat-file", "--batch"], {
    input: shas.join("\n") + "\n",
    encoding: "buffer",
  });
  const blobs = new Map();
  let offset = 0;
  for (const sha of shas) {
    const nl = out.indexOf(0x0a, offset);
    const [, , size] = out.subarray(offset, nl).toString("utf8").split(" ");
    const start = nl + 1;
    blobs.set(sha, out.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  }
  return blobs;
}

/** Snapshot of docs/items/ (and docket.json) as committed at `ref`. Throws DOCKET_BAD_REF. */
export function refSnapshot(ctx, ref) {
  let commit;
  try {
    commit = git(ctx.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  } catch {
    throw docketError(CODES.BAD_REF, `not a commit: ${ref}`);
  }
  const listing = git(ctx.root, ["ls-tree", "-z", commit, "--", `${ITEMS_DIR}/`]);
  const rows = listing
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf("\t");
      const [mode, type, sha] = row.slice(0, tab).split(" ");
      return {
        name: row
          .slice(tab + 1)
          .split("/")
          .pop(),
        mode,
        type,
        sha,
      };
    });
  const blobs = readBlobs(
    ctx.root,
    rows.filter((r) => r.type === "blob" && r.mode !== "120000").map((r) => r.sha),
  );
  const entries = rows
    .map((r) => {
      const isFile = r.type === "blob" && r.mode !== "120000";
      const bytes = isFile ? blobs.get(r.sha) : undefined;
      return { name: r.name, isFile, bytes, revision: bytes ? revisionOf(bytes) : undefined };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const configRow = git(ctx.root, ["ls-tree", commit, "--", "docket.json"]).trim();
  const configBytes = configRow
    ? git(ctx.root, ["cat-file", "blob", configRow.split(/\s+/)[2]], { encoding: "buffer" })
    : null;
  return {
    source: `${ref} (${commit.slice(0, 12)})`,
    commit,
    entries,
    configError: parseConfig(configBytes).error,
  };
}
