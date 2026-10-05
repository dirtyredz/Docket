#!/usr/bin/env node
// Docket CLI entry (`docket` and `dk`). Dispatch only: commands live in ./commands/*.mjs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { usageError } from "./args.mjs";
import { commandHelp } from "./help.mjs";
import { emitError, emitResult, EXIT } from "./output.mjs";
import * as coordination from "./commands/coordination.mjs";
import * as gate from "./commands/gate.mjs";
import * as items from "./commands/items.mjs";
import { init } from "./commands/init.mjs";
import * as validation from "./commands/validation.mjs";

const COMMANDS = {
  check: validation.check,
  add: items.add,
  set: items.set,
  link: items.link,
  list: items.list,
  show: items.show,
  index: items.index,
  claim: coordination.claim,
  release: coordination.release,
  gate: gate.gate,
  init,
};

const HELP = `docket (dk) - Markdown work items per repo

Usage: docket <command> [options]      every command takes --repo <path> and --json

  init    [--gate] [--dry-run]                             make this repo a Docket repo (idempotent)
  check   [--ref <rev>]                          validate every item (errors fail, warnings print)
  add     --type T --priority P --title "..."    create an item (ID and rank are assigned)
          [--body TEXT | --body-file F|-] [--area A] [--status S] [--parent ID]
          [--batch F|-]                        many items from a JSON array
          [--fixes ID]... [--blocked-by ID]... [--relates ID]...
  set     <id> [--status S] [--priority P] [--type T] [--area A]
          [--before ID | --after ID | --top | --bottom] [--expect REV]
  link    <id> [--parent ID | --clear-parent] [--fixes ID]... [--blocked-by ID]...
          [--relates ID]... [--remove] [--expect REV]
  list    [--status S]... [--type T]... [--priority P]... [--area A] [--parent ID]
          [--blocked] [--all] [--limit N] [--rank] [--count-by FIELD]
  show    <id>
  index   [--rebuild]                            refresh the per-worktree cache
  claim   <id> [--takeover] [--agent NAME]       advisory claim for this worktree
  release <id> [--force]
  gate    promote <tarball> | install [--dry-run] | status   last-good pre-push gate

  docket <command> --help   options and allowed values for one command

  --version, -v   print the version`;

export function packageVersion() {
  const pkg = new URL("../../package.json", import.meta.url);
  return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
}

export async function runCli(argv, io) {
  const [command, ...rest] = argv;
  if (command === "--version" || command === "-v") {
    io.stdout.write(`${packageVersion()}\n`);
    return EXIT.ok;
  }
  if (command === "help" && rest[0] && commandHelp(rest[0])) {
    io.stdout.write(`${commandHelp(rest[0])}
`);
    return EXIT.ok;
  }
  if (!command || command === "--help" || command === "-h" || command === "help") {
    io.stdout.write(`${HELP}\n`);
    return command ? EXIT.ok : EXIT.usage;
  }
  const json = rest.includes("--json");
  const handler = COMMANDS[command];
  if (!handler) {
    return emitError(
      io,
      command,
      usageError(`unknown command "${command}" (see docket --help)`),
      json,
    );
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout.write(`${commandHelp(command) ?? HELP}\n`);
    return EXIT.ok;
  }
  try {
    const result = await handler(rest, io);
    return emitResult(io, command, result, json);
  } catch (err) {
    return emitError(io, command, err, json);
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  const io = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  };
  process.exitCode = await runCli(process.argv.slice(2), io);
}
