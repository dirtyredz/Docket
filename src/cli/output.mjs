// Output contract. JSON mode: exactly one JSON document on stdout, nothing on stderr:
//   {"ok":true,"command":"list","data":{...},"warnings":[...]}
//   {"ok":false,"command":"set","error":{"code":"DOCKET_CONFLICT","message":"...","details":{...}}}
// Human mode: results on stdout; warnings and errors on stderr.
// Exit codes: 0 ok, 1 failed (validation errors, operation refused), 2 usage, 3 conflict, 4 not found,
// 5 internal error.

import { CODES, KIND_OF_CODE } from "../core/errors.mjs";
import { formatWarning } from "../core/validation/report.mjs";

export const EXIT = Object.freeze({
  ok: 0,
  failed: 1,
  usage: 2,
  conflict: 3,
  notFound: 4,
  internal: 5,
});

/** Exit code for an error: its code's kind in the errors table; unlisted DOCKET_* codes fail; the rest are internal. */
export function exitCodeFor(err) {
  const kind = KIND_OF_CODE[err.code];
  if (kind) return EXIT[kind];
  return typeof err.code === "string" && err.code.startsWith("DOCKET_")
    ? EXIT.failed
    : EXIT.internal;
}

/**
 * Write a command result. result: {data, text?: string, warnings?: [], exitCode?: number}.
 * Returns the exit code.
 */
export function emitResult(io, command, result, json) {
  const warnings = result.warnings ?? [];
  const exitCode = result.exitCode ?? EXIT.ok;
  if (json) {
    const ok = exitCode === EXIT.ok;
    io.stdout.write(JSON.stringify({ ok, command, data: result.data, warnings }) + "\n");
  } else {
    if (result.text) io.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    for (const w of warnings) io.stderr.write(`${formatWarning(w)}\n`);
  }
  return exitCode;
}

export function emitError(io, command, err, json) {
  const exitCode = exitCodeFor(err);
  const code = err.code && String(err.code).startsWith("DOCKET_") ? err.code : CODES.INTERNAL;
  if (json) {
    const error = { code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    io.stdout.write(JSON.stringify({ ok: false, command, error }) + "\n");
  } else {
    io.stderr.write(`docket ${command ?? ""}: ${err.message}\n`.replace("docket : ", "docket: "));
    if (exitCode === EXIT.internal && err.stack) io.stderr.write(`${err.stack}\n`);
  }
  return exitCode;
}
