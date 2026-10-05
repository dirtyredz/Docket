// `docket init`: scaffolding, idempotence, agent-file handling, non-git refusal and the --gate flag.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { checkStore } from "../../src/core/validation/store.mjs";
import { resolveRepo } from "../../src/repository/context.mjs";
import { TEMPLATE, promoteCheckout, templateAvailable } from "../helpers/gate.mjs";
import { git, makeRepo, runCli, tempDir } from "../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const repo = () => {
  const r = makeRepo();
  cleanups.push(r.cleanup);
  return r;
};
const init = (r, ...extra) => runCli(["init", "--json", "--repo", r.root, ...extra], { env: {} });
const text = (r, name) => fs.readFileSync(path.join(r.root, name), "utf8");
const count = (s, needle) => s.split(needle).length - 1;
const SNIPPET = "## Work items (Docket)";

describe("docket init", () => {
  test("fresh repo: items dir, docket.json, .gitignore entry, new CLAUDE.md; the store checks clean", () => {
    const r = repo();
    const out = init(r);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.initialised, true);
    assert.deepEqual(out.json.data.created, [
      "docs/items/",
      "docket.json",
      ".gitignore",
      "CLAUDE.md",
    ]);
    assert.ok(fs.statSync(path.join(r.root, "docs", "items")).isDirectory());
    assert.deepEqual(JSON.parse(text(r, "docket.json")), { version: 1 });
    assert.match(text(r, ".gitignore"), /^\.docket\/$/m);
    const claude = text(r, "CLAUDE.md");
    assert.ok(claude.startsWith(`# repo with space\n\n${SNIPPET}\n`));
    const result = checkStore(resolveRepo(r.root));
    assert.deepEqual(result.errors, []);
  });

  test("re-run changes nothing and reports already initialised", () => {
    const r = repo();
    init(r);
    const before = ["docket.json", ".gitignore", "CLAUDE.md"].map((n) => text(r, n));
    const again = runCli(["init", "--repo", r.root]);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already initialised/);
    assert.deepEqual(
      ["docket.json", ".gitignore", "CLAUDE.md"].map((n) => text(r, n)),
      before,
    );
    assert.equal(init(r).json.data.initialised, false);
    assert.equal(count(text(r, "CLAUDE.md"), SNIPPET), 1);
  });

  test("existing CLAUDE.md and AGENTS.md get the snippet appended once, content and CRLF kept", () => {
    const r = repo();
    fs.writeFileSync(path.join(r.root, "CLAUDE.md"), "# Mine\r\n\r\nKeep this.\r\n");
    fs.writeFileSync(path.join(r.root, "AGENTS.md"), "Agents rules");
    fs.writeFileSync(path.join(r.root, ".gitignore"), "node_modules/");
    init(r);
    init(r);
    const claude = text(r, "CLAUDE.md");
    assert.ok(claude.startsWith("# Mine\r\n\r\nKeep this.\r\n\r\n## Work items (Docket)\r\n"));
    assert.equal(count(claude, SNIPPET), 1);
    assert.ok(!/(^|[^\r])\n/.test(claude), "CRLF file stays CRLF");
    const agents = text(r, "AGENTS.md");
    assert.ok(agents.startsWith(`Agents rules\n\n${SNIPPET}`));
    assert.equal(count(agents, SNIPPET), 1);
    assert.equal(text(r, ".gitignore"), "node_modules/\n.docket/\n");
  });

  test("no agent file creates CLAUDE.md only; AGENTS.md alone does not get a CLAUDE.md", () => {
    const none = repo();
    init(none);
    assert.ok(fs.existsSync(path.join(none.root, "CLAUDE.md")));
    assert.ok(!fs.existsSync(path.join(none.root, "AGENTS.md")));
    const agentsOnly = repo();
    fs.writeFileSync(path.join(agentsOnly.root, "AGENTS.md"), "# A\n");
    init(agentsOnly);
    assert.ok(!fs.existsSync(path.join(agentsOnly.root, "CLAUDE.md")));
    assert.equal(count(text(agentsOnly, "AGENTS.md"), SNIPPET), 1);
  });

  test("an existing docket.json and .docket/ ignore line are left alone", () => {
    const r = repo();
    fs.writeFileSync(path.join(r.root, "docket.json"), '{"version":1,"x":1}');
    fs.writeFileSync(path.join(r.root, ".gitignore"), "/.docket\n");
    const d = init(r).json.data;
    assert.ok(!d.created.includes("docket.json") && !d.created.includes(".gitignore"));
    assert.equal(text(r, "docket.json"), '{"version":1,"x":1}');
    assert.equal(text(r, ".gitignore"), "/.docket\n");
  });

  test("refuses inside a non-git directory", () => {
    const t = tempDir("docket nogit ");
    cleanups.push(t.cleanup);
    const out = runCli(["init", "--json", "--repo", t.dir]);
    assert.equal(out.status, 2);
    assert.equal(out.json.error.code, "DOCKET_NOT_A_REPO");
    assert.deepEqual(fs.readdirSync(t.dir), []);
  });

  test(
    "--gate installs the opt-in and the managed hook; re-run is still a no-op for the files",
    { skip: templateAvailable() ? false : `no hook template at ${TEMPLATE}` },
    () => {
      const home = tempDir("docket gate home ");
      cleanups.push(home.cleanup);
      promoteCheckout(path.join(home.dir, "gate"));
      const env = { DOCKET_HOME: home.dir };
      const r = repo();
      const first = runCli(["init", "--gate", "--json", "--repo", r.root], { env });
      assert.equal(first.status, 0, first.stdout + first.stderr);
      assert.equal(first.json.data.gate.hook.state, "installed");
      assert.equal(first.json.data.gate.hook.change, "created");
      assert.match(git(r.root, "config", "--get", "docket.gateLauncher"), /launcher\.mjs/);
      const second = runCli(["init", "--gate", "--json", "--repo", r.root], { env });
      assert.equal(second.json.data.initialised, false);
      assert.equal(second.json.data.gate.hook.state, "current");
      assert.equal(second.json.data.gate.hook.change, "unchanged");
    },
  );
});

describe("docket init --dry-run and report", () => {
  const snapshot = (r) => {
    const out = {};
    for (const n of ["docket.json", ".gitignore", "CLAUDE.md", "AGENTS.md"]) {
      const f = path.join(r.root, n);
      out[n] = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
    }
    out.itemsDir = fs.existsSync(path.join(r.root, "docs"));
    return out;
  };

  test("fresh repo: reports every file as created and writes nothing", () => {
    const r = repo();
    const before = snapshot(r);
    const out = init(r, "--dry-run");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.data.dryRun, true);
    const states = Object.fromEntries(out.json.data.files.map((f) => [f.path, f.state]));
    assert.deepEqual(states, {
      "docs/items/": "created",
      "docket.json": "created",
      ".gitignore": "created",
      "CLAUDE.md": "created",
    });
    assert.deepEqual(snapshot(r), before);
    assert.equal(snapshot(r).itemsDir, false);
  });

  test("text mode names each file's state; a real run then reports unchanged", () => {
    const r = repo();
    fs.writeFileSync(path.join(r.root, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(r.root, "CLAUDE.md"), "# Mine\n");
    const dry = runCli(["init", "--dry-run", "--repo", r.root]);
    assert.match(dry.stdout, /dry run, nothing written/);
    assert.match(dry.stdout, /\.gitignore: would be updated/);
    assert.match(dry.stdout, /CLAUDE\.md: would be updated/);
    assert.match(dry.stdout, /docket\.json: would be created/);
    runCli(["init", "--repo", r.root]);
    const again = runCli(["init", "--dry-run", "--repo", r.root]);
    assert.match(again.stdout, /docket\.json: unchanged/);
    assert.match(again.stdout, /CLAUDE\.md: unchanged/);
    assert.equal(
      JSON.parse(runCli(["init", "--dry-run", "--json", "--repo", r.root]).stdout).data.initialised,
      false,
    );
  });

  test(
    "--gate --dry-run reports git config keys and the hook without writing them; gate install matches",
    { skip: templateAvailable() ? false : `no hook template at ${TEMPLATE}` },
    () => {
      const home = tempDir("docket gate home ");
      cleanups.push(home.cleanup);
      promoteCheckout(path.join(home.dir, "gate"));
      const env = { DOCKET_HOME: home.dir };
      const r = repo();
      const hook = path.join(r.root, ".git", "hooks", "pre-push");
      const dry = runCli(["init", "--gate", "--dry-run", "--json", "--repo", r.root], { env });
      assert.equal(dry.status, 0, dry.stdout + dry.stderr);
      const g = dry.json.data.gate;
      assert.deepEqual(
        g.config.map((c) => c.state),
        ["created", "created"],
      );
      assert.equal(g.hook.state, "installed");
      const dryInit = runCli(["init", "--gate", "--dry-run", "--repo", r.root], { env });
      assert.match(dryInit.stdout, /git config docket\.gateLauncher: would be created/);
      assert.match(dryInit.stdout, /git config docket\.gateNode: would be created/);
      assert.doesNotMatch(dryInit.stdout, /git config \S+: created/);
      assert.equal(spawnGit(r, "config", "--get", "docket.gateLauncher"), "");
      assert.equal(fs.existsSync(hook), false);

      const dryInstall = runCli(["gate", "install", "--dry-run", "--repo", r.root], { env });
      assert.match(dryInstall.stdout, /dry run, nothing written/);
      assert.match(dryInstall.stdout, /git config docket\.gateLauncher: would be created/);
      assert.match(dryInstall.stdout, /hook .*: would be created/);
      assert.equal(fs.existsSync(hook), false);

      const real = runCli(["gate", "install", "--repo", r.root], { env });
      assert.match(real.stdout, /git config docket\.gateNode: created/);
      assert.match(real.stdout, /hook .*: created/);
      const next = runCli(["gate", "install", "--repo", r.root], { env });
      assert.match(next.stdout, /git config docket\.gateLauncher: unchanged/);
      assert.match(next.stdout, /hook .*: unchanged/);
      fs.appendFileSync(hook, "# managed hook: structure-gate: managed hook\n");
      const dryUpdate = runCli(["gate", "install", "--dry-run", "--repo", r.root], { env });
      assert.match(dryUpdate.stdout, /hook .*: would be updated/);
      assert.match(fs.readFileSync(hook, "utf8"), /managed hook\n$/);
    },
  );
});

function spawnGit(r, ...args) {
  try {
    return git(r.root, ...args).trim();
  } catch {
    return "";
  }
}

describe("docket init: Prettier (0.4.4)", () => {
  const mk = () => {
    const r = makeRepo();
    cleanups.push(r.cleanup);
    return r;
  };
  const run = (r, ...extra) => runCli(["init", "--json", "--repo", r.root, ...extra], { env: {} });
  const state = (out) => out.json.data.files.find((f) => f.path === ".prettierignore")?.state;
  const ignorePath = (r) => path.join(r.root, ".prettierignore");

  test("no Prettier: .prettierignore is neither created nor reported", () => {
    const r = mk();
    assert.equal(state(run(r)), undefined);
    assert.equal(fs.existsSync(ignorePath(r)), false);
  });

  for (const [label, file, body] of [
    [".prettierrc", ".prettierrc", "{}"],
    [".prettierrc.json", ".prettierrc.json", "{}"],
    ["prettier.config.mjs", "prettier.config.mjs", "export default {};"],
    ["package.json key", "package.json", '{"prettier":{}}'],
    ["package.json devDependencies", "package.json", '{"devDependencies":{"prettier":"^3"}}'],
  ]) {
    test(`detects Prettier via ${label}: creates .prettierignore`, () => {
      const r = mk();
      fs.writeFileSync(path.join(r.root, file), body);
      const out = run(r);
      assert.equal(state(out), "created");
      assert.ok(out.json.data.created.includes(".prettierignore"));
      assert.equal(fs.readFileSync(ignorePath(r), "utf8"), "docs/items/\n");
    });
  }

  test("existing .prettierignore is appended to (CRLF kept); re-run is unchanged", () => {
    const r = mk();
    fs.writeFileSync(path.join(r.root, ".prettierrc"), "{}");
    fs.writeFileSync(ignorePath(r), "dist\r\ncoverage");
    assert.equal(state(run(r)), "updated");
    assert.equal(fs.readFileSync(ignorePath(r), "utf8"), "dist\r\ncoverage\r\ndocs/items/\r\n");
    const again = run(r);
    assert.equal(state(again), "unchanged");
    assert.equal(fs.readFileSync(ignorePath(r), "utf8"), "dist\r\ncoverage\r\ndocs/items/\r\n");
  });

  test("an equivalent entry (/docs/items, docs/items/**) counts as already listed", () => {
    for (const entry of ["/docs/items", "docs/items/**", "docs/items"]) {
      const r = mk();
      fs.writeFileSync(path.join(r.root, ".prettierrc"), "{}");
      fs.writeFileSync(ignorePath(r), `${entry}\n`);
      assert.equal(state(run(r)), "unchanged");
      assert.equal(fs.readFileSync(ignorePath(r), "utf8"), `${entry}\n`);
    }
  });

  test("dry-run reports would-be and writes nothing", () => {
    const r = mk();
    fs.writeFileSync(path.join(r.root, ".prettierrc"), "{}");
    const out = runCli(["init", "--dry-run", "--repo", r.root], { env: {} });
    assert.match(out.stdout, /\.prettierignore: would be created/);
    assert.equal(fs.existsSync(ignorePath(r)), false);
  });
});
