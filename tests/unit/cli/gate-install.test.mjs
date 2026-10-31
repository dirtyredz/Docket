// `docket gate install` reads hook.change (the shared report vocabulary); hook.state stays in the JSON
// only as a deprecated alias. Uses a stand-in promoted gate and template: no real promotion or push.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { makeRepo, runCli, tempDir } from "../../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

function setup() {
  const repo = makeRepo();
  const home = tempDir("docket gate home ");
  cleanups.push(repo.cleanup, home.cleanup);
  const gateRoot = path.join(home.dir, "gate");
  fs.mkdirSync(gateRoot, { recursive: true });
  fs.writeFileSync(path.join(gateRoot, "active.json"), '{"version": "0.0.0-test"}\n');
  fs.writeFileSync(path.join(gateRoot, "launcher.mjs"), "// stand-in\n");
  const template = path.join(home.dir, "pre-push.template.sh");
  fs.writeFileSync(template, "#!/bin/sh\n# structure-gate: managed hook\n# docket.gateLauncher\n");
  const env = { DOCKET_HOME: home.dir, DOCKET_HOOK_TEMPLATE: template };
  const install = () => runCli(["gate", "install", "--json", "--repo", repo.root], { env });
  return { repo, install };
}

test("hook.change drives the report; hook.state is the deprecated alias", () => {
  const { install } = setup();
  const first = install();
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(
    [first.json.data.hook.change, first.json.data.hook.state],
    ["created", "installed"],
  );
  const second = install().json.data.hook;
  assert.deepEqual([second.change, second.state], ["unchanged", "current"]);
});

test("a foreign hook is reported from hook.change and left alone", () => {
  const { repo, install } = setup();
  const hook = path.join(repo.root, ".git", "hooks", "pre-push");
  fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
  const out = install();
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.json.data.hook.change, "foreign");
  assert.match(out.json.warnings.map((w) => w.message).join("\n"), /not the managed hook/);
  assert.equal(fs.readFileSync(hook, "utf8"), "#!/bin/sh\necho mine\n");
});
