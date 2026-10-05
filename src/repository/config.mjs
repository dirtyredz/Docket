// `docket.json`: committed store version. No configurable vocabulary.
import fs from "node:fs";
import { atomicWrite } from "../storage/atomic-write.mjs";

/** Highest docket.json store version this build reads. */
export const STORE_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({ version: STORE_VERSION });

/** Parse docket.json bytes. Returns {config, error}; error is a check issue or null. */
export function parseConfig(bytes) {
  if (bytes == null) return { config: DEFAULT_CONFIG, error: null };
  let config;
  try {
    config = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return {
      config: DEFAULT_CONFIG,
      error: { rule: 0, code: "config", message: "not valid JSON" },
    };
  }
  if (!Number.isInteger(config?.version) || config.version < 1) {
    return {
      config,
      error: { rule: 0, code: "config", message: "version must be a positive integer" },
    };
  }
  if (config.version > STORE_VERSION) {
    return {
      config,
      error: {
        rule: 0,
        code: "config-version",
        message: `store version ${config.version} needs a newer docket (this one supports ${STORE_VERSION})`,
      },
    };
  }
  return { config, error: null };
}

export function readConfigBytes(ctx) {
  try {
    return fs.readFileSync(ctx.configPath);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Replace docket.json atomically (pretty JSON, LF, trailing newline). */
export function writeConfig(ctx, config) {
  atomicWrite(ctx.configPath, `${JSON.stringify(config, null, 2)}\n`);
}
