#!/usr/bin/env node
// Docket CLI entry (`docket` and `dk`). Dispatch only: commands live in ./commands/*.mjs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { usageError } from "./args.mjs";
import { commandHelp, overview } from "./help.mjs";
import { emitError, emitResult, EXIT } from "./output.mjs";
import * as coordination from "./commands/coordination.mjs";
import * as gate from "./commands/gate.mjs";
import * as items from "./commands/items.mjs";
import { repo } from "./commands/registry.mjs";
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
  repo,
  init,
};

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
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    io.stdout.write(`${overview()}\n`);
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
    io.stdout.write(`${commandHelp(command) ?? overview()}\n`);
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
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  const io = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  };
  process.exitCode = await runCli(process.argv.slice(2), io);
}
