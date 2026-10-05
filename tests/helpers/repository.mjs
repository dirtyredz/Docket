// Disposable git repositories and item text builders for tests.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLI = path.join(ROOT, "src", "cli", "main.mjs");

const KEYS = [
  "id",
  "type",
  "created",
  "status",
  "since",
  "area",
  "priority",
  "rank",
  "parent",
  "fixes",
  "blocked_by",
  "relates",
];

/** Canonical item text. `fields` overrides defaults; lists are arrays. `title`/`body` set the rest. */
export function itemText(fields = {}, { title = "Test item", body = "Body text.\n" } = {}) {
  const f = {
    id: "dk-00000001",
    type: "task",
    created: "2026-01-01",
    status: "todo",
    since: "2026-01-01",
    area: "",
    priority: "P2",
    rank: "n",
    parent: "",
    fixes: [],
    blocked_by: [],
    relates: [],
    ...fields,
  };
  const lines = KEYS.map((k) => {
    const v = f[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    return v === "" ? `${k}:` : `${k}: ${v}`;
  });
  return `---\n${lines.join("\n")}\n---\n# ${title}\n${body ? `\n${body}` : ""}`;
}

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A temp dir removed by the returned cleanup (call it in t.after). Paths may contain spaces. */
export function tempDir(prefix = "docket test ") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Fresh git repo with optional items {id: text}. Returns {root, cleanup, write, commit}. */
export function makeRepo(items = {}, { branch = "main", prefix } = {}) {
  const { dir, cleanup } = tempDir(prefix);
  const root = path.join(dir, "repo with space");
  fs.mkdirSync(root);
  git(root, "init", "-q", "-b", branch);
  git(root, "config", "user.email", "test@docket");
  git(root, "config", "user.name", "test");
  git(root, "config", "core.autocrlf", "false");
  const write = (id, text) => {
    fs.mkdirSync(path.join(root, "docs", "items"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "items", id.endsWith(".md") ? id : `${id}.md`), text);
  };
  for (const [id, text] of Object.entries(items)) write(id, text);
  const commit = (message = "commit") => {
    git(root, "add", "-A");
    git(root, "commit", "-q", "--allow-empty", "-m", message);
    return git(root, "rev-parse", "HEAD").trim();
  };
  return { root, dir, cleanup, write, commit };
}

/** Run the CLI as a child process. Returns {status, stdout, stderr, json} (json parsed when possible). */
export function runCli(args, { cwd = ROOT, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* human output */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

export function readItem(root, id) {
  return fs.readFileSync(path.join(root, "docs", "items", `${id}.md`), "utf8");
}
