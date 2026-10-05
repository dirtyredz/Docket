// `docket gate promote <tarball> | install | status`: the last-good pre-push gate.
import path from "node:path";
import { gateStatus, installRepo } from "../../integration/gate/install.mjs";
import { promoteTarball } from "../../integration/gate/promote.mjs";
import { parseCommand, usageError } from "../args.mjs";

export async function gate(argv, io) {
  const [sub, ...rest] = argv;
  const args = parseCommand(rest, { positionals: sub === "promote" ? 1 : 0 });
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
    const result = installRepo(args.repo ?? io.cwd, {});
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
        `gate installed: hook ${result.hook.state}, active ${result.active.version}`,
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
