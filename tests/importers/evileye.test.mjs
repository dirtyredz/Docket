// EvilEye importer behaviour on the fixture backlog: priority and status mapping, identities, nested
// prose, flags, relative links, dates, duplicates, staging safety and the CLI surface.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { parseItem } from "../../src/core/format/parse.mjs";
import { dryRunEvilEye } from "../../src/importers/evileye/dry-run.mjs";
import { IMPORT_DATE_NOW, counterRandom, fixtureRepo, shard } from "../helpers/evileye.mjs";
import { runCli } from "../helpers/repository.mjs";

const repos = [];
const repo = (opts) => {
  const r = fixtureRepo(opts);
  repos.push(r);
  return r;
};
after(() => repos.forEach((r) => r.cleanup()));

const dryRun = (r, opts = {}) =>
  dryRunEvilEye({ repo: r.root, now: IMPORT_DATE_NOW, random: counterRandom(), run: "t", ...opts });

let r;
let m;
const byTitle = (t) => m.items.find((i) => i.title.startsWith(t));
const byId = (id) => m.items.find((i) => i.id === id);
const codes = (id) => m.decisions.filter((d) => d.id === id).map((d) => d.code);
const staged = (id) => fs.readFileSync(path.join(m.staging.runDir, "items", `${id}.md`), "utf8");

before(() => {
  r = repo();
  m = dryRun(r).manifest;
});

describe("inventory and accounting", () => {
  test("every entry of the register and shards becomes one staged item", () => {
    assert.equal(m.items.length, 18);
    assert.equal(m.summary.ids.preserved, 13);
    assert.equal(m.summary.ids.allocated, 5);
    assert.equal(fs.readdirSync(path.join(m.staging.runDir, "items")).length, 18);
  });

  test("the dry run verifies: no drift, byte reconstruction, accounting and docket check", () => {
    const v = m.verification;
    assert.deepEqual(v.drift.problems, []);
    assert.deepEqual(v.reconstruction.problems, []);
    assert.equal(v.reconstruction.verified, m.sources.length);
    assert.deepEqual(v.accounting.problems, []);
    assert.deepEqual(v.check.errors, []);
    assert.equal(v.ok, true);
  });

  test("ambiguity blocks readiness until overridden", () => {
    assert.equal(m.ready, false);
    const open = m.summary.needsOverride
      .filter((d) => !d.resolved)
      .map((d) => d.code)
      .sort();
    assert.deepEqual(open, ["duplicate-id", "status-ambiguous"]);
    assert.ok(fs.existsSync(path.join(m.staging.runDir, "overrides.template.json")));
  });

  test("sources record frozen hashes and whether they match HEAD", () => {
    assert.ok(m.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256) && s.matchesHead));
    assert.deepEqual(
      m.related.map((x) => x.path),
      ["docs/work/backlog/README.md"],
    );
  });

  test("non-entry prose is retained with a reason, never silently dropped", () => {
    const retained = m.summary.retainedProse.map((p) => `${p.file}:${p.lines}`);
    assert.ok(retained.includes("docs/work/backlog/open/wishlist.md:7-7"), retained.join(" "));
    assert.ok(
      retained.some((x) => x.startsWith("docs/work/backlog/open/world.md:")),
      "bold-lead paragraph",
    );
    assert.ok(
      retained.some((x) => x.startsWith("docs/BACKLOG.md:")),
      "known limitations",
    );
  });
});

describe("priority and rank", () => {
  test("register row wins over the shard section, and the mismatch is reported", () => {
    assert.equal(byId("bl-00000002").priority, "P1");
    assert.deepEqual(
      m.summary.priorityMismatches.map((d) => d.id),
      ["bl-00000002"],
    );
  });

  test("entries without a row use the section, or an explicit lead prefix", () => {
    assert.equal(byId("bl-00000003").priority, "P1");
    assert.ok(codes("bl-00000003").includes("created-from-lead"));
    const migration = byTitle("P1: distance model migration");
    assert.equal(migration.priority, "P1");
    assert.ok(codes(migration.id).includes("lead-priority"));
    assert.equal(byTitle("Decide the boss roster").priority, "P0");
  });

  test("wishlist entries become idea/P3", () => {
    for (const id of ["bl-0000000a", "bl-0000000b"]) {
      assert.equal(byId(id).type, "idea");
      assert.equal(byId(id).priority, "P3");
    }
    assert.equal(m.summary.type.task, 16);
  });

  test("bands order register rows, then unindexed open, then done", () => {
    const p0 = m.items
      .filter((i) => i.priority === "P0")
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    assert.deepEqual(
      p0.map((i) => i.title),
      [
        "Lighting levels",
        "Fixed seed input",
        "Decide the boss roster",
        "Menu traps the player",
        "Entry in a done shard without a marker",
      ],
    );
    assert.equal(new Set(p0.map((i) => i.rank)).size, p0.length);
  });
});

describe("status", () => {
  test("done shards become done, with done-row drift and a missing marker reported", () => {
    assert.equal(byId("bl-00000004").status, "done");
    assert.ok(codes("bl-00000004").includes("done-with-register-row"));
    assert.equal(byId("bl-0000000d").status, "done");
    assert.ok(codes("bl-0000000d").includes("done-shard-no-marker"));
  });

  test("partial and reopened map to todo with a review decision", () => {
    assert.equal(byId("bl-00000008").status, "todo");
    assert.ok(codes("bl-00000008").includes("status-partial"));
    assert.equal(byId("bl-0000000c").status, "todo");
    assert.ok(codes("bl-0000000c").includes("status-reopened"));
  });

  test("a struck lead without a status word needs an override", () => {
    assert.equal(byId("bl-00000006").status, "todo");
    assert.ok(codes("bl-00000006").includes("status-ambiguous"));
  });

  test("nested FIXED sub-points never close the parent", () => {
    assert.equal(byId("bl-00000005").status, "todo");
  });
});

describe("content", () => {
  test("nested prose, fences, tabs and trailing spaces survive; marker and indent are removed", () => {
    const text = staged("bl-00000005");
    const { rest, errors } = parseItem(Buffer.from(text));
    assert.deepEqual(errors, []);
    assert.ok(!text.includes("<!--"));
    assert.ok(rest.includes("1. First sub-point"));
    assert.ok(rest.includes("   Continued sub-point text."));
    assert.ok(rest.includes("```text\na fenced block\n\twith a tab line\n```"));
    assert.ok(rest.includes("Trailing spaces stay.  \n"));
  });

  test("relative links are rebased to docs/items and missing targets reported", () => {
    const text = staged("bl-00000005");
    assert.ok(text.includes("](../DECISIONS.md#lava)"));
    assert.ok(text.includes("](../work/backlog/done/world.md)"));
    assert.ok(codes("bl-00000005").includes("link-target-missing"));
  });

  test("register flags become a body note", () => {
    assert.ok(
      staged("bl-00000001").endsWith("\nLegacy register flags: research needed; ask me more.\n"),
    );
  });

  test("a lazy continuation joins its entry; a bold-lead paragraph does not", () => {
    const text = staged("bl-0000000c");
    assert.ok(text.includes("lazy continuation line of the reopened entry"));
    assert.ok(!text.includes("Bold lead paragraph"));
  });

  test("a heading without a list is itself an entry", () => {
    const h = byTitle("Heading entry with no list");
    assert.equal(h.idOrigin, "allocated");
    assert.ok(staged(h.id).includes("A heading whose body has no list is itself an entry."));
  });

  test("register titles that drifted are reported", () => {
    assert.ok(codes("bl-00000009").includes("row-title-differs"));
  });
});

describe("identity and dates", () => {
  test("a duplicated marker keeps the first copy and allocates for the second", () => {
    const copies = m.items.filter((i) => i.title.startsWith("Duplicate marker"));
    assert.deepEqual(
      copies.map((c) => c.idOrigin),
      ["preserved", "allocated"],
    );
    assert.equal(copies[0].id, "bl-00000007");
    assert.ok(codes(copies[1].id).includes("duplicate-id"));
  });

  test("dates: first-line date before history, future dates ignored, completion lowers created", () => {
    assert.equal(byId("bl-00000003").created, "2026-09-18");
    assert.equal(byId("bl-00000009").created, "2026-09-25");
    const fixed = byId("bl-00000004");
    assert.deepEqual([fixed.created, fixed.since], ["2026-09-20", "2026-09-20"]);
    const menu = byTitle("Menu traps the player");
    assert.deepEqual([menu.created, menu.since], ["2026-09-24", "2026-09-24"]);
    const noMarker = byId("bl-0000000d");
    assert.deepEqual([noMarker.created, noMarker.since], ["2026-09-25", "2026-10-04"]);
    assert.equal(byTitle("Decide the boss roster").created, "2026-09-26");
  });

  test("overrides resolve ambiguity and make the run ready; retries keep allocated IDs", () => {
    const dup = m.items.filter((i) => i.title.startsWith("Duplicate marker"))[1].id;
    const overrides = {
      version: 1,
      entries: { "bl-00000006": { status: "dropped" }, [dup]: { keepAllocated: true } },
    };
    const again = dryRun(r, { run: "t2", overrides, random: counterRandom(500) }).manifest;
    assert.equal(again.ready, true);
    assert.equal(again.items.find((i) => i.id === "bl-00000006").status, "dropped");
    assert.deepEqual(
      again.items.map((i) => i.id),
      m.items.map((i) => i.id),
    );
    assert.equal(again.summary.ids.reused, 5);
  });
});

describe("staging safety and CLI", () => {
  test("staging inside a repo whose .docket/ is not ignored is refused", () => {
    const bare = repo({ exclude: false });
    assert.throws(
      () => dryRun(bare),
      (err) => err.code === "DOCKET_IMPORT_STAGING",
    );
    assert.ok(!fs.existsSync(path.join(bare.root, ".docket")));
  });

  test("CRLF sources convert to LF and still reconstruct byte for byte", () => {
    const crlf = repo({
      mutate: (root) => {
        const f = shard(root, "open/wishlist.md");
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n/g, "\r\n"));
      },
    });
    const out = dryRun(crlf).manifest;
    assert.equal(
      out.verification.ok,
      true,
      JSON.stringify(out.verification.reconstruction.problems),
    );
    const item = path.join(out.staging.runDir, "items", "bl-0000000a.md");
    assert.ok(!fs.readFileSync(item, "utf8").includes("\r"));
  });

  test("docket import evileye --dry-run --json prints one bounded envelope", () => {
    const c = repo();
    const out = runCli(["import", "evileye", "--repo", c.root, "--dry-run", "--json"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(out.stderr, "");
    assert.equal(out.json.ok, true);
    const d = out.json.data;
    assert.ok(fs.existsSync(d.manifest));
    assert.equal(d.verification.reconstruction.ok, true);
    assert.equal(d.summary.entries, 18);
    assert.equal(d.ready, false);
    const verify = runCli(["import", "verify", "--manifest", d.manifest, "--json"]);
    assert.equal(verify.status, 0, verify.stdout);
    assert.equal(verify.json.data.verification.ok, true);
  });

  test("apply without --manifest and evileye without --dry-run are usage errors", () => {
    const c = repo();
    const apply = runCli(["import", "apply", "--repo", c.root, "--json"]);
    assert.equal(apply.status, 2);
    assert.equal(apply.json.error.code, "DOCKET_USAGE");
    const noFlag = runCli(["import", "evileye", "--repo", c.root, "--json"]);
    assert.equal(noFlag.status, 2);
  });
});
