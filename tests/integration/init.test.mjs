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
      assert.match(git(r.root, "config", "--get", "docket.gateLauncher"), /launcher\.mjs/);
      const second = runCli(["init", "--gate", "--json", "--repo", r.root], { env });
      assert.equal(second.json.data.initialised, false);
      assert.equal(second.json.data.gate.hook.state, "current");
    },
  );
});
