// The composed pre-push gate: managed template -> LFS -> Docket last-good launcher -> structure checks.
// Real `git push` runs against disposable bare remotes; nothing leaves the temp directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { installRepo } from "../../src/integration/gate/install.mjs";
import {
  TEMPLATE,
  addRemote,
  baselineTemplate,
  fakeLfs,
  promoteCheckout,
  push,
  runHook,
  templateAvailable,
  withPath,
} from "../helpers/gate.mjs";
import { git, itemText, makeRepo, tempDir } from "../helpers/repository.mjs";

const skip = templateAvailable() ? false : `managed hook template not found at ${TEMPLATE}`;
const GOOD = "dk-0000a001";
const BAD = "dk-0000b001";
const BROKEN = "---\nid: dk-0000b001\n---\n# broken\n";

let gateHome;
let gateRoot;
const cleanups = [];
before(() => {
  if (skip) return;
  gateHome = tempDir("docket gate ");
  gateRoot = path.join(gateHome.dir, "gate");
  promoteCheckout(gateRoot);
});
after(() => {
  gateHome?.cleanup();
  for (const c of cleanups) c();
});

/** Opted-in repo with a valid committed item and a bare origin. */
function setup({ install = true } = {}) {
  const r = makeRepo({ [GOOD]: itemText({ id: GOOD }) });
  cleanups.push(r.cleanup);
  r.commit("valid");
  r.remote = addRemote(r.root, r.dir);
  if (install) r.install = installRepo(r.root, { gateRoot, templatePath: TEMPLATE });
  return r;
}

const remoteHas = (r, ref) => {
  try {
    return git(r.remote, "rev-parse", "--verify", ref).trim();
  } catch {
    return null;
  }
};

/** Commit an invalid item, then remove it from the working tree so only the commit is bad. */
function commitBadTip(r) {
  r.write(BAD, BROKEN);
  const sha = r.commit("bad");
  fs.rmSync(path.join(r.root, "docs", "items", `${BAD}.md`));
  return sha;
}

describe("composed pre-push gate", { skip }, () => {
  test("install sets the opt-in config and installs the managed hook", () => {
    const r = setup();
    assert.equal(r.install.hook.state, "installed");
    assert.match(git(r.root, "config", "--get", "docket.gateLauncher"), /launcher\.mjs/);
    assert.equal(fs.readFileSync(r.install.hook.path, "utf8"), fs.readFileSync(TEMPLATE, "utf8"));
  });

  test("a valid push passes through check --ref", () => {
    const r = setup();
    const out = push(r.root, ["origin", "main"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stderr, /docket check \(/);
    assert.ok(remoteHas(r, "main"));
  });

  test("an invalid pushed tip is rejected even though the working tree is clean", () => {
    const r = setup();
    commitBadTip(r);
    assert.equal(git(r.root, "status", "--porcelain", "--", "docs/items/dk-0000a001.md"), "");
    const out = push(r.root, ["origin", "main"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /dk-0000b001\.md/);
    assert.equal(remoteHas(r, "main"), null);
  });

  test("a pushed tip with malformed Notes (check group 10) is rejected", () => {
    const r = setup();
    const notes = "## Notes\n\n### not-a-timestamp · open · owner\n\nQuestion.\n";
    r.write(BAD, itemText({ id: BAD }, { title: "Bad notes", body: `Facts.\n\n${notes}` }));
    r.commit("bad notes");
    const out = push(r.root, ["origin", "main"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /dk-0000b001\.md/);
    assert.match(out.stderr, /note/);
    assert.equal(remoteHas(r, "main"), null);
  });

  test("several refs: one bad tip rejects the push, all good passes", () => {
    const r = setup();
    git(r.root, "branch", "side");
    let out = push(r.root, ["origin", "main", "side"]);
    assert.equal(out.status, 0, out.stderr);
    git(r.root, "checkout", "-q", "side");
    commitBadTip(r);
    git(r.root, "checkout", "-q", "main");
    r.write("dk-0000a002", itemText({ id: "dk-0000a002", rank: "p" }));
    r.commit("another good");
    out = push(r.root, ["origin", "main", "side"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /refs\/heads\/side/);
  });

  test("deleted refs are skipped", () => {
    const r = setup();
    git(r.root, "checkout", "-q", "-b", "feature");
    commitBadTip(r);
    assert.equal(push(r.root, ["--no-verify", "origin", "feature"]).status, 0);
    git(r.root, "checkout", "-q", "main");
    const out = push(r.root, ["origin", "--delete", "feature"]);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(remoteHas(r, "feature"), null);
  });

  test("LFS runs first and both LFS and Docket read the full ref list", () => {
    const r = setup();
    fs.writeFileSync(
      path.join(r.root, ".gitattributes"),
      "*.bin filter=lfs diff=lfs merge=lfs -text\n",
    );
    r.commit("lfs attrs");
    const lfs = fakeLfs(r.dir);
    const env = withPath(lfs.bin, { LFS_LOG: lfs.log });
    let out = push(r.root, ["origin", "main"], env);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(out.stderr.indexOf("fake-lfs pre-push") < out.stderr.indexOf("docket check"));
    assert.match(
      fs.readFileSync(lfs.log, "utf8"),
      /^refs\/heads\/main [0-9a-f]{40} refs\/heads\/main /,
    );
    commitBadTip(r);
    out = push(r.root, ["origin", "main"], env);
    assert.notEqual(out.status, 0, "docket still saw the refs after LFS consumed them");
    assert.match(fs.readFileSync(lfs.log, "utf8"), /^refs\/heads\/main /);
  });

  for (const control of [".structure-review-paused", ".structure-review-optout"]) {
    test(`${control} does not skip Docket validation`, () => {
      const r = setup();
      fs.writeFileSync(path.join(r.root, control), "");
      commitBadTip(r);
      assert.notEqual(push(r.root, ["origin", "main"]).status, 0);
    });
  }

  test("pending structure review still blocks after Docket passes", () => {
    const r = setup();
    fs.writeFileSync(
      path.join(r.root, ".structure-review-pending"),
      '{"f":"x.mjs","c":3,"k":"code"}\n',
    );
    const out = push(r.root, ["origin", "main"]);
    assert.notEqual(out.status, 0);
    assert.ok(out.stderr.indexOf("docket check") < out.stderr.indexOf("PENDING REVIEW"));
  });

  test("a foreign pre-push hook is reported and left untouched", () => {
    const r = setup({ install: false });
    const hook = path.join(r.root, ".git", "hooks", "pre-push");
    fs.writeFileSync(hook, "#!/bin/sh\necho foreign\nexit 0\n");
    const result = installRepo(r.root, { gateRoot, templatePath: TEMPLATE });
    assert.equal(result.hook.state, "foreign");
    assert.equal(fs.readFileSync(hook, "utf8"), "#!/bin/sh\necho foreign\nexit 0\n");
  });

  test("core.hooksPath is preserved; a delegating wrapper replays stdin", () => {
    const r = setup({ install: false });
    const custom = path.join(r.root, "tools", "hooks");
    fs.mkdirSync(custom, { recursive: true });
    // Icon guard first, then the physical managed hook with the buffered ref list.
    fs.writeFileSync(
      path.join(custom, "pre-push"),
      '#!/bin/sh\nrefs=$(cat)\necho "icon guard ok" >&2\n' +
        'printf \'%s\\n\' "$refs" | "$(git rev-parse --git-common-dir)/hooks/pre-push" "$@"\n',
    );
    fs.chmodSync(path.join(custom, "pre-push"), 0o755);
    git(r.root, "config", "core.hooksPath", "tools/hooks");
    const result = installRepo(r.root, { gateRoot, templatePath: TEMPLATE });
    assert.equal(git(r.root, "config", "--get", "core.hooksPath").trim(), "tools/hooks");
    assert.deepEqual(result.hooksPath?.reaches, true);
    commitBadTip(r);
    const out = push(r.root, ["origin", "main"]);
    assert.notEqual(out.status, 0);
    assert.ok(out.stderr.indexOf("icon guard ok") < out.stderr.indexOf("docket check"));
  });

  test("a missing launcher fails closed with a recovery hint", () => {
    const r = setup();
    git(r.root, "config", "docket.gateLauncher", path.join(r.dir, "nope", "launcher.mjs"));
    const out = push(r.root, ["origin", "main"]);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /gate launcher not found/);
  });
});

// Backward compatibility of the harness template: a clone that never ran `docket gate install`
// must behave exactly like the template before the Docket callback existed.
const baseline = templateAvailable() ? baselineTemplate() : null;
describe(
  "un-opted repos behave exactly as before",
  { skip: baseline ? false : "baseline template unavailable" },
  () => {
    const scenarios = {
      clean: () => {},
      "pending code review": (r) =>
        fs.writeFileSync(
          path.join(r.root, ".structure-review-pending"),
          '{"f":"a.mjs","c":1,"k":"code"}\n',
        ),
      "docs-only marker": (r) =>
        fs.writeFileSync(
          path.join(r.root, ".structure-review-pending"),
          '{"f":"README.md","c":1,"k":"doc"}\n',
        ),
      "paused with pending": (r) => {
        fs.writeFileSync(path.join(r.root, ".structure-review-pending"), "a.mjs\n");
        fs.writeFileSync(path.join(r.root, ".structure-review-paused"), "");
      },
      "opted out with pending": (r) => {
        fs.writeFileSync(path.join(r.root, ".structure-review-pending"), "a.mjs\n");
        fs.writeFileSync(path.join(r.root, ".structure-review-optout"), "");
      },
      "lfs tracked": (r) =>
        fs.writeFileSync(path.join(r.root, ".gitattributes"), "*.bin filter=lfs\n"),
    };
    for (const [name, arrange] of Object.entries(scenarios)) {
      test(name, () => {
        const results = [];
        for (const text of [baseline, fs.readFileSync(TEMPLATE, "utf8")]) {
          const r = makeRepo({ [BAD]: BROKEN }); // invalid items are irrelevant when not opted in
          cleanups.push(r.cleanup);
          r.commit("c");
          arrange(r);
          const script = path.join(r.dir, "pre-push");
          fs.writeFileSync(script, text);
          const lfs = fakeLfs(r.dir);
          const input = `refs/heads/main ${"a".repeat(40)} refs/heads/main ${"0".repeat(40)}\n`;
          const out = runHook(script, r.root, input, withPath(lfs.bin, { LFS_LOG: lfs.log }));
          const lfsLog = fs.existsSync(lfs.log) ? fs.readFileSync(lfs.log, "utf8") : null;
          results.push({ status: out.status, stderr: out.stderr, lfsLog });
        }
        assert.deepEqual(results[1], results[0]);
      });
    }
  },
);
