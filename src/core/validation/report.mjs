// Plain-text rendering of validation results, shared by `docket check` and the pre-push gate.

const line = (e) => `  ${e.file}: [${e.rule}] ${e.message}${e.line ? ` (line ${e.line})` : ""}`;

/** Header plus one line per error. */
export function formatCheck(result) {
  const head = `docket check (${result.source}): ${result.count} item file(s), ${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
  return [head, ...result.errors.map(line)].join("\n");
}

export const formatWarning = (w) => `warning: ${w.file ? `${w.file}: ` : ""}${w.message}`;
