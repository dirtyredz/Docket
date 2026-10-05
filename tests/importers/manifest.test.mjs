// Verification of a persisted run catches every way content can be lost or drift: dropped bytes,
// tampered staged items, changed sources, unexplained spans, orphan register rows. Then: a clean run
// verifies, and repeated runs are byte-identical.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { readJson, writeJson } from "../../src/importers/common/manifest.mjs";
import { coverageProblems } from "../../src/importers/common/source-map.mjs";
import { verifyRun } from "../../src/importers/common/verify.mjs";
import { dryRunEvilEye } from "../../src/importers/evileye/dry-run.mjs";
import { IMPORT_DATE_NOW, counterRandom, fixtureRepo, shard } from "../helpers/evileye.mjs";

const repos = [];
after(() => repos.forEach((r) => r.cleanup()));

function freshRun(opts = {}) {
  const r = fixtureRepo(opts);
  repos.push(r);
  const { runDir, manifest } = dryRunEvilEye({
    repo: r.root,
    now: IMPORT_DATE_NOW,
    random: counterRandom(),
    run: "t",
  });
  const verify = () => verifyRun(runDir, { sourceRoot: r.root, today: "2026-10-04" });
  return { r, runDir, manifest, verify };
}

const mapPath = (runDir) => path.join(runDir, "source-map.json");
const editMap = (runDir, fn) => {
  const map = readJson(mapPath(runDir));
  fn(map);
  writeJson(mapPath(runDir), map);
};
const shardSource = (map, rel) => map.sources.find((s) => s.path.endsWith(rel));

describe("failures are caught", () => {
  test("a dropped span is reported as dropped bytes and breaks reconstruction", () => {
    const { runDir, verify } = freshRun();
    editMap(runDir, (map) => {
      const src = shardSource(map, "open/world.md");
      const i = src.spans.findIndex((s) => s.disposition === "retained");
      src.spans.splice(i, 1);
    });
    const v = verify();
    assert.equal(v.reconstruction.ok, false);
    assert.ok(
      v.reconstruction.problems.some((p) => p.includes("dropped bytes")),
      v.reconstruction.problems.join("\n"),
    );
    assert.equal(v.ok, false);
  });

  test("a byte removed from a staged item body fails reconstruction of its source", () => {
    const { runDir, verify } = freshRun();
    const file = path.join(runDir, "items", "bl-00000005.md");
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("Continued sub-point", "Continued subpoint"),
    );
    const v = verify();
    assert.equal(v.reconstruction.ok, false);
    assert.ok(
      v.reconstruction.problems.some(
        (p) => p.includes("open/world.md") && p.includes("bl-00000005"),
      ),
    );
  });

  test("a changed recorded span text is detected", () => {
    const { runDir, verify } = freshRun();
    editMap(runDir, (map) => {
      const span = shardSource(map, "open/world.md").spans.find((s) => s.disposition === "wrapper");
      span.text = span.text.replace("Open", "Opened");
    });
    assert.equal(verify().reconstruction.ok, false);
  });

  test("a source edited after the dry run is reported as drift", () => {
    const { r, verify } = freshRun();
    fs.appendFileSync(shard(r.root, "open/world.md"), "- **Late entry.**\n");
    const v = verify();
    assert.equal(v.drift.ok, false);
    assert.ok(v.drift.problems[0].includes("open/world.md"));
  });

  test("a span without a reason is unexplained", () => {
    const { runDir, verify } = freshRun();
    editMap(runDir, (map) => {
      delete shardSource(map, "open/wishlist.md").spans.find((s) => s.disposition === "retained")
        .reason;
    });
    const v = verify();
    assert.equal(v.accounting.ok, false);
    assert.ok(v.accounting.problems.some((p) => p.includes("unexplained")));
  });

  test("a register row whose entry is missing fails accounting", () => {
    const { manifest } = freshRun({
      mutate: (root) => {
        const reg = path.join(root, "docs", "BACKLOG.md");
        const text = fs.readFileSync(reg, "utf8");
        fs.writeFileSync(
          reg,
          text.replace("| bl-0000000a |", "| bl-000000ff | P2 |  | Gone |\n| bl-0000000a |"),
        );
      },
    });
    assert.equal(manifest.verification.accounting.ok, false);
    assert.ok(manifest.verification.accounting.problems.some((p) => p.includes("bl-000000ff")));
  });

  test("an item span produced twice and a stray staged file are both reported", () => {
    const { runDir, verify } = freshRun();
    editMap(runDir, (map) => {
      const src = shardSource(map, "open/world.md");
      const items = src.spans.filter((s) => s.disposition === "item");
      items[1].item = items[0].item;
    });
    fs.writeFileSync(path.join(runDir, "items", "dk-ffffffff.md"), "stray");
    const v = verify();
    assert.ok(v.accounting.problems.some((p) => p.includes("produced by 2 spans")));
    assert.ok(v.accounting.problems.some((p) => p.includes("dk-ffffffff.md: not in the manifest")));
  });

  test("coverage reports overlaps and overruns", () => {
    const spans = [
      { start: 0, end: 5 },
      { start: 4, end: 12 },
    ];
    const problems = coverageProblems(spans, 10, "f");
    assert.ok(problems.some((p) => p.includes("overlaps")));
    assert.ok(problems.some((p) => p.includes("past the end")));
  });
});

describe("a clean run", () => {
  test("verifies again from disk", () => {
    const { verify } = freshRun();
    const v = verify();
    assert.equal(v.ok, true, JSON.stringify(v, null, 1));
    assert.equal(v.reconstruction.verified, v.reconstruction.files);
  });

  test("is repeatable: same IDs, ranks and bytes on a second run", () => {
    const { r, runDir, manifest } = freshRun();
    const second = dryRunEvilEye({
      repo: r.root,
      now: IMPORT_DATE_NOW,
      random: counterRandom(900),
      run: "t-again",
    });
    assert.deepEqual(
      second.manifest.items.map((i) => [i.id, i.rank, i.sha256]),
      manifest.items.map((i) => [i.id, i.rank, i.sha256]),
    );
    for (const name of fs.readdirSync(path.join(runDir, "items"))) {
      assert.equal(
        fs.readFileSync(path.join(second.runDir, "items", name), "utf8"),
        fs.readFileSync(path.join(runDir, "items", name), "utf8"),
      );
    }
  });

  test("an existing run directory is never overwritten", () => {
    const { r } = freshRun();
    assert.throws(
      () => dryRunEvilEye({ repo: r.root, now: IMPORT_DATE_NOW, run: "t" }),
      (err) => err.code === "DOCKET_IMPORT_STAGING",
    );
  });
});
