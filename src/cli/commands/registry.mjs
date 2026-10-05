// `docket repo add|list|remove|scan`: thin adapter over state/registry. The registry is per machine
// (registryPath: DOCKET_HOME or %LOCALAPPDATA%/Docket); nothing here touches a repo's files.
import { registryPath } from "../../state/registry/paths.mjs";
import {
  describeRegistry,
  inspectCheckout,
  parseDocOverrides,
  registerCheckout,
  unregister,
} from "../../state/registry/registration.mjs";
import { mergeDiscovered, scanForRepos } from "../../state/registry/scan.mjs";
import { readRegistry, updateRegistry } from "../../state/registry/store.mjs";
import { many, parseCommand, requirePositional, usageError } from "../args.mjs";

const fileOf = (io) => registryPath(io.env ?? process.env);

function add(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: {
      alias: { type: "string" },
      preferred: { type: "boolean" },
      doc: { type: "string", multiple: true },
    },
  });
  const target = requirePositional(args, "path");
  const docs = parseDocOverrides(many(args.doc));
  const info = inspectCheckout(target);
  const { value } = updateRegistry(fileOf(io), (reg) => ({
    value: registerCheckout(reg, info, {
      alias: args.alias,
      prefer: Boolean(args.preferred),
      docs,
    }),
  }));
  const { repo, checkout, change } = value;
  return {
    data: { change, repo, checkout },
    text: `${repo.alias}: ${change} (${checkout.path}${repo.preferred === checkout.id ? ", preferred" : ""})`,
  };
}

function list(argv, io) {
  parseCommand(argv);
  const repos = describeRegistry(readRegistry(fileOf(io)));
  const lines = [];
  for (const r of repos) {
    lines.push(`${r.alias}  (${r.id})`);
    for (const c of r.checkouts) {
      const flags = [
        c.preferred ? "preferred" : null,
        c.available ? null : `UNAVAILABLE: ${c.reason}`,
      ];
      const note = flags.filter(Boolean).join("; ");
      lines.push(`  ${c.path}${note ? `  [${note}]` : ""}`);
    }
    for (const [name, rel] of Object.entries(r.docs)) lines.push(`  doc ${name} = ${rel}`);
  }
  return { data: { registry: fileOf(io), repos }, text: lines.join("\n") || "no repos registered" };
}

function remove(argv, io) {
  const args = parseCommand(argv, { positionals: 1, options: { checkout: { type: "string" } } });
  const alias = requirePositional(args, "alias");
  const { value } = updateRegistry(fileOf(io), (reg) => ({
    value: unregister(reg, alias, { checkout: args.checkout }),
  }));
  const text =
    value.removed === "repo"
      ? `${value.repo.alias}: registration removed (files untouched)`
      : `${value.repo.alias}: checkout ${value.checkout.path} removed` +
        (value.preferred ? `; preferred is now ${value.preferred.path}` : "");
  return { data: value, text };
}

const STATUS = { created: "new", joined: "updated", unchanged: "existing" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Text report: one line per repo and a totals line; --verbose adds checkout paths and every skip. */
function scanLines(found, value, { dryRun, verbose }) {
  const lines = [`${dryRun ? "dry run, nothing written: " : ""}scanned ${found.root}`];
  for (const r of value.repos) {
    lines.push(`  ${r.alias}  ${STATUS[r.change]}  ${plural(r.checkouts.length, "checkout")}`);
    if (verbose) for (const c of r.added) lines.push(`    + ${c}`);
  }
  for (const a of value.aliases) lines.push(`  alias ${a.alias}: ${a.reason}`);
  if (verbose) for (const s of found.skipped) lines.push(`  skipped ${s.path}: ${s.reason}`);
  if (!value.repos.length) lines.push("  no Docket repos found");
  const parts = Object.keys(STATUS)
    .map((change) => [value.repos.filter((r) => r.change === change).length, STATUS[change]])
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  const checkouts = value.repos.reduce((n, r) => n + r.checkouts.length, 0);
  let total = `${plural(value.repos.length, "repo")}${parts.length ? ` (${parts.join(", ")})` : ""}, ${plural(checkouts, "checkout")}`;
  if (found.skipped.length) {
    total += `; skipped ${plural(found.skipped.length, "folder")}${verbose ? "" : ", use --verbose to list"}`;
  }
  lines.push(total);
  return lines;
}

function scan(argv, io) {
  const args = parseCommand(argv, {
    positionals: 1,
    options: { "dry-run": { type: "boolean" }, verbose: { type: "boolean" } },
  });
  const dir = requirePositional(args, "dir");
  const dryRun = Boolean(args["dry-run"]);
  const found = scanForRepos(dir);
  const { value } = updateRegistry(fileOf(io), (reg) => ({ value: mergeDiscovered(reg, found) }), {
    dryRun,
  });
  const lines = scanLines(found, value, { dryRun, verbose: Boolean(args.verbose) });
  return {
    data: { dryRun, root: found.root, ...value, skipped: found.skipped },
    text: lines.join("\n"),
  };
}

const SUB = { add, list, remove, scan };

export async function repo(argv, io) {
  const [sub, ...rest] = argv;
  const handler = SUB[sub];
  if (!handler) {
    throw usageError(
      sub ? `unknown repo command "${sub}" (add | list | remove | scan)` : "missing repo command",
    );
  }
  return handler(rest, io);
}
