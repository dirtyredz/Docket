// `import apply`: preconditions are checked before anything is written (not ready, source drift,
// tampered staging, conflicting target files, another migration), an interrupted apply resumes to the
// same result, a validation failure never publishes the marker, and a completed apply is a no-op.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { applyRun } from "../../src/importers/common/apply.mjs";
import { readJournal } from "../../src/importers/common/journal.mjs";
import { RECORD_PATH } from "../../src/importers/common/record.mjs";
import { dryRunEvilEye } from "../../src/importers/evileye/dry-run.mjs";
import { IMPORT_DATE_NOW, counterRandom, fixtureRepo, shard } from "../helpers/evileye.mjs";
import { git, runCli } from "../helpers/repository.mjs";

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));
const TODAY = "2026-10-04";
const fixedNow = () => new Date("2026-10-04T12:00:00Z");

/** A fixture repo with a ready run (the fixture's two ambiguities overridden). */
function readyRun(opts = {}) {
  const r = fixtureRepo(opts);
  repos.push(r);
  const first = dryRunEvilEye({
    repo: r.root,
    now: IMPORT_DATE_NOW,
    random: counterRandom(),
    run: "probe",
  });
  const dup = first.manifest.items.filter((i) => i.title.startsWith("Duplicate marker"))[1].id;
  const overrides = {
    version: 1,
    entries: { "bl-00000006": { status: "dropped" }, [dup]: { keepAllocated: true } },
  };
  const run = dryRunEvilEye({
    repo: r.root,
    now: IMPORT_DATE_NOW,
    random: counterRandom(500),
    run: "ready",
    overrides,
  });
  assert.equal(run.manifest.ready, true);
  const apply = (extra = {}) =>
    applyRun({ manifestPath: run.manifestPath, today: TODAY, now: fixedNow, ...extra });
  return { r, ...run, apply };
}

const itemsDir = (root) => path.join(root, "docs", "items");
const listed = (root) =>
  fs.existsSync(itemsDir(root)) ? fs.readdirSync(itemsDir(root)).sort() : [];
const config = (root) => {
  const file = path.join(root, "docket.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const ops = (runDir) => readJournal(runDir).events.map((e) => e.op);

describe("preconditions refuse before writing anything", () => {
  test("a run that is not ready", () => {
    const r = fixtureRepo();
    repos.push(r);
    const { manifestPath, manifest } = dryRunEvilEye({
      repo: r.root,
      now: IMPORT_DATE_NOW,
      random: counterRandom(),
      run: "t",
    });
    assert.equal(manifest.ready, false);
    assert.throws(
      () => applyRun({ manifestPath, today: TODAY }),
      (e) => e.code === "DOCKET_IMPORT_NOT_READY",
    );
    assert.deepEqual(listed(r.root), []);
  });

  test("source drift since the dry run", () => {
    const { r, apply, runDir } = readyRun();
    fs.appendFileSync(shard(r.root, "open/world.md"), "- **Late entry.**\n");
    assert.throws(
      () => apply(),
      (e) => e.code === "DOCKET_IMPORT_DRIFT" && /open\/world\.md/.test(e.message),
    );
    assert.deepEqual(listed(r.root), []);
    assert.equal(config(r.root), null);
    assert.ok(!ops(runDir).includes("begin"));
  });

  test("a staged file edited after the dry run", () => {
    const { r, apply, runDir, manifest } = readyRun();
    fs.appendFileSync(path.join(runDir, manifest.items[0].staged), "tamper\n");
    assert.throws(
      () => apply(),
      (e) => e.code === "DOCKET_IMPORT_STAGING",
    );
    assert.deepEqual(listed(r.root), []);
  });

  test("a conflicting pre-existing target file is never overwritten", () => {
    const { r, apply, manifest } = readyRun();
    const id = manifest.items[3].id;
    fs.mkdirSync(itemsDir(r.root), { recursive: true });
    fs.writeFileSync(path.join(itemsDir(r.root), `${id}.md`), "someone else's file\n");
    assert.throws(
      () => apply(),
      (e) => e.code === "DOCKET_IMPORT_CONFLICT" && e.details.conflicts.length === 1,
    );
    assert.deepEqual(listed(r.root), [`${id}.md`]);
    assert.equal(
      fs.readFileSync(path.join(itemsDir(r.root), `${id}.md`), "utf8"),
      "someone else's file\n",
    );
  });

  test("another run's migration marker", () => {
    const { r, apply } = readyRun();
    fs.writeFileSync(
      path.join(r.root, "docket.json"),
      JSON.stringify({ version: 1, migration: { state: "complete", run: "other" } }),
    );
    assert.throws(
      () => apply(),
      (e) => e.code === "DOCKET_IMPORT_CONFLICT",
    );
    assert.deepEqual(listed(r.root), []);
  });

  test("a manifest applied to a different repository", () => {
    const { manifestPath } = readyRun();
    const other = fixtureRepo();
    repos.push(other);
    assert.throws(
      () => applyRun({ manifestPath, repo: other.root, today: TODAY }),
      (e) => e.code === "DOCKET_IMPORT_TARGET",
    );
  });
});

describe("a clean apply", () => {
  test("installs every staged item byte for byte, then the record, then the marker", () => {
    const { r, apply, runDir, manifest } = readyRun();
    const result = apply();
    assert.equal(result.state, "applied");
    assert.equal(result.installed, manifest.items.length);
    assert.deepEqual(listed(r.root), manifest.items.map((i) => `${i.id}.md`).sort());
    for (const item of manifest.items) {
      assert.ok(
        fs
          .readFileSync(path.join(itemsDir(r.root), `${item.id}.md`))
          .equals(fs.readFileSync(path.join(runDir, item.staged))),
      );
    }
    const record = JSON.parse(fs.readFileSync(path.join(r.root, RECORD_PATH), "utf8"));
    assert.equal(record.run, "ready");
    assert.equal(record.sourceCommit, manifest.repo.head);
    assert.equal(record.items.length, manifest.items.length);
    assert.ok(record.sources.find((s) => s.path === "docs/BACKLOG.md").sha256);
    assert.deepEqual(record.overrides.map((d) => d.code).sort(), [
      "duplicate-id",
      "status-ambiguous",
    ]);
    assert.deepEqual(config(r.root).migration.run, "ready");
    assert.equal(config(r.root).migration.record, RECORD_PATH);
    assert.deepEqual(ops(runDir).slice(-4), ["validated", "record", "marker", "complete"]);
    const check = runCli(["check", "--repo", r.root, "--json"]);
    assert.equal(check.json.ok, true, check.stdout);
  });

  test("sources are left untouched", () => {
    const { r, apply } = readyRun();
    apply();
    assert.equal(git(r.root, "status", "--porcelain", "--", "docs/BACKLOG.md", "docs/work"), "");
  });

  test("a completed apply is a no-op, even after the register is replaced", () => {
    const { r, apply } = readyRun();
    apply();
    fs.writeFileSync(path.join(r.root, "docs", "BACKLOG.md"), "# BACKLOG\n\nNow in docs/items.\n");
    const again = apply();
    assert.equal(again.state, "already-complete");
  });

  test("the CLI applies with a JSON envelope", () => {
    const { r, manifestPath, manifest } = readyRun();
    const out = runCli(["import", "apply", "--manifest", manifestPath, "--json"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.json.ok, true);
    assert.equal(out.json.data.installed, manifest.items.length);
    assert.equal(out.json.data.marker.state, "complete");
    assert.equal(
      runCli(["import", "apply", "--manifest", manifestPath, "--json"]).json.data.state,
      "already-complete",
    );
    assert.equal(listed(r.root).length, manifest.items.length);
  });
});

describe("interrupted-apply recovery", () => {
  test("a crash mid-install resumes to the same result", () => {
    const { r, apply, runDir, manifest } = readyRun();
    assert.throws(
      () =>
        apply({
          hooks: {
            afterInstall: (_id, i) => {
              if (i === 4) throw new Error("simulated crash");
            },
          },
        }),
      /simulated crash/,
    );
    assert.equal(listed(r.root).length, 5);
    assert.equal(config(r.root), null, "no marker after an interrupted install");
    // A crash mid-append leaves a torn journal line; recovery must tolerate it.
    fs.appendFileSync(path.join(runDir, "apply-journal.jsonl"), '{"op":"inst');
    const result = apply();
    assert.equal(result.state, "applied");
    assert.equal(result.resumed, 5);
    assert.equal(result.installed, manifest.items.length - 5);
    assert.equal(listed(r.root).length, manifest.items.length);
    const { events, torn } = readJournal(runDir);
    assert.equal(torn, 1);
    assert.equal(events.filter((e) => e.op === "begin").length, 2);
    assert.equal(
      new Set(events.filter((e) => e.op === "install").map((e) => e.id)).size,
      manifest.items.length,
    );
    assert.equal(config(r.root).migration.state, "complete");
  });

  test("a crash between the record and the marker resumes and publishes the marker", () => {
    const { r, apply } = readyRun();
    assert.throws(
      () =>
        apply({
          hooks: {
            beforeMarker: () => {
              throw new Error("power cut");
            },
          },
        }),
      /power cut/,
    );
    assert.ok(fs.existsSync(path.join(r.root, RECORD_PATH)));
    assert.equal(config(r.root), null);
    const result = apply();
    assert.equal(result.state, "applied");
    assert.equal(result.installed, 0);
    assert.equal(config(r.root).migration.state, "complete");
  });

  test("source drift after a partial apply blocks the resume", () => {
    const { r, apply } = readyRun();
    assert.throws(() =>
      apply({
        hooks: {
          afterInstall: (_id, i) => {
            if (i === 1) throw new Error("crash");
          },
        },
      }),
    );
    fs.appendFileSync(shard(r.root, "open/world.md"), "- **Late entry.**\n");
    assert.throws(
      () => apply(),
      (e) => e.code === "DOCKET_IMPORT_DRIFT",
    );
    assert.equal(config(r.root), null);
  });

  test("an installed store that fails check stops before the marker", () => {
    const { r, apply, runDir } = readyRun();
    // An unrelated invalid item that appears after the preflight (between install and validation).
    assert.throws(
      () =>
        apply({
          hooks: {
            afterInstall: (_id, i) => {
              if (i === 0)
                fs.writeFileSync(path.join(itemsDir(r.root), "dk-0badf00d.md"), "not an item\n");
            },
          },
        }),
      (e) => e.code === "DOCKET_IMPORT_INVALID",
    );
    assert.equal(config(r.root), null);
    assert.equal(fs.existsSync(path.join(r.root, RECORD_PATH)), false);
    const last = readJournal(runDir).events.at(-1);
    assert.deepEqual([last.op, last.stage], ["failed", "validate"]);
  });
});
