// Shared report vocabulary: every create/update step reads created | updated | unchanged, and a dry run
// prefixes the changed ones with "would be". Used by init, gate install and init --gate.

/** One report line: `<label>: <state>`, with "would be" before a changed state on a dry run. */
export function stateLine(label, state, dryRun) {
  return `  ${label}: ${state === "unchanged" || !dryRun ? "" : "would be "}${state}`;
}

/** Report lines for an installRepo result: git config keys and the hook. */
export function gateReport(result) {
  const { hook, dryRun } = result;
  return [
    ...result.config.map((c) => `  git config ${c.key}: ${c.state}`),
    hook.change === "foreign"
      ? `  hook ${hook.path}: foreign, left alone`
      : stateLine(`hook ${hook.path}`, hook.change, dryRun),
  ];
}
