// `docket serve [--port N]`: start the loopback viewer in the foreground until Ctrl+C. The server
// module is imported only here, at run time, so other commands (and the gate) never load it.
import { registryPath } from "../../state/registry/paths.mjs";
import { parseCommand, usageError } from "../args.mjs";

/** Resolves when the process is asked to stop (Ctrl+C or SIGTERM). */
function untilStopped() {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
    process.once("SIGBREAK", resolve);
  });
}

export async function serve(argv, io, { stopped = untilStopped } = {}) {
  const args = parseCommand(argv, { options: { port: { type: "string" } } });
  const port = args.port === undefined ? 0 : Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw usageError("--port must be an integer from 0 to 65535 (0 = any free port)");
  }
  const registryFile = registryPath(io.env ?? process.env);
  const { startServer } = await import("../../viewer/server/main.mjs");
  const server = await startServer({ registryFile, port });
  const data = { url: server.url, port: server.port, registry: registryFile };
  if (args.json) {
    io.stdout.write(`${JSON.stringify({ ok: true, command: "serve", data, warnings: [] })}\n`);
  } else {
    io.stdout.write(`docket viewer: ${server.url}  (registry ${registryFile}; Ctrl+C stops)\n`);
  }
  await stopped();
  await server.close();
  return { data, emitted: true };
}
