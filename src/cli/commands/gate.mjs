// `docket gate promote <tarball> | install | status`: the last-good pre-push gate.
import path from "node:path";
import { gateStatus, installRepo } from "../../integration/gate/install.mjs";
import { promoteTarball } from "../../integration/gate/promote.mjs";
import { parseCommand, usageError } from "../args.mjs";

const HOOK_WORD = { installed: "created", current: "unchanged", updated: "updated" };

/** Report lines for an installRepo result: git config keys and the hook, each created/updated/unchanged. */
export function gateReport(result) {
  const would = result.dryRun ? "would be " : "";
  const hook = result.hook;
  const hookWord = HOOK_WORD[hook.state];
  return [
    ...result.config.map((c) => `  git config ${c.key}: ${c.state}`),
    hookWord
      ? `  hook ${hook.path}: ${hookWord === "unchanged" ? "" : would}${hookWord}`
      : `  hook ${hook.path}: foreign, left alone`,
  ];
}

export async function gate(argv, io) {
  const [sub, ...rest] = argv;
  const args = parseCommand(rest, {
    positionals: sub === "promote" ? 1 : 0,
    options: sub === "install" ? { "dry-run": { type: "boolean" } } : {},
  });
  if (sub === "promote") {
    const tarball = args._[0];
    if (!tarball) throw usageError("missing <tarball>");
    const active = promoteTarball(path.resolve(io.cwd, tarball), {});
    return {
      data: active,
      text: `promoted ${active.version} (previous: ${active.previous?.version ?? "none"})`,
    };
  }
  if (sub === "install") {
    const result = installRepo(args.repo ?? io.cwd, { dryRun: Boolean(args["dry-run"]) });
    const notes = [];
    if (result.hook.state === "foreign") {
      notes.push(
        `pre-push at ${result.hook.path} is not the managed hook; make it call the managed template or run: node "${result.launcher}" <root> "$@" < refs`,
      );
    }
    if (result.hooksPath && !result.hooksPath.reaches) {
      notes.push(
        `core.hooksPath=${result.hooksPath.path} does not reach .git/hooks/pre-push; delegate to it`,
      );
    }
    return {
      data: result,
      text: [
        `${result.dryRun ? "dry run, nothing written: gate would be installed" : "gate installed"} (active ${result.active.version})`,
        ...gateReport(result),
        ...notes,
      ].join("\n"),
      warnings: notes.map((message) => ({ message })),
    };
  }
  if (sub === "status") {
    const status = gateStatus(args.repo ?? io.cwd);
    return {
      data: status,
      text: [
        `gate root: ${status.gateRoot}`,
        `active: ${status.active ? `${status.active.version} (previous ${status.active.previous?.version ?? "none"})` : "none"}`,
        `versions: ${status.versions.join(", ") || "none"}`,
        `this repo: ${status.repoLauncher ? "opted in" : "not opted in"}`,
      ].join("\n"),
    };
  }
  throw usageError("usage: docket gate promote <tarball> | install | status");
}
