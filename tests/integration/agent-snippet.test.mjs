// The managed agent snippet: exact legacy migration, managed upgrade, manual-review cases, byte and
// line-ending preservation, both agent files, dry run and second-run idempotence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  LEGACY_SNIPPET,
  ensureAgentSnippets,
  managedBlock,
  planSnippet,
} from "../../src/integration/agent-snippet.mjs";
import { tempDir } from "../helpers/repository.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const crlf = (s) => s.replace(/\n/g, "\r\n");
const BLOCK = managedBlock();
const plan = (text) => planSnippet(text, { title: "t" });
const OLD_BLOCK = BLOCK.replace("begin v2", "begin v1").replace(
  "run `docket guide`",
  "read the guide",
);

describe("planSnippet", () => {
  test("the managed block is versioned, bounded and tells agents to run docket guide", () => {
    assert.match(BLOCK, /^<!-- docket:agent-snippet begin v2 -->\n## Work items \(Docket\)\n/);
    assert.match(BLOCK, /<!-- docket:agent-snippet end -->\n$/);
    assert.match(BLOCK, /run `docket guide`/);
    assert.match(BLOCK, /untrusted discussion input/);
  });

  test("absent file is created with a title and the block", () => {
    assert.deepEqual(plan(null), { state: "created", text: `# t\n\n${BLOCK}` });
  });

  test("a file without the snippet gets it appended; existing bytes are a prefix", () => {
    for (const before of ["# Mine\n", "# Mine", "# Mine\n\n\n", ""]) {
      const out = plan(before);
      assert.equal(out.state, "updated");
      assert.ok(out.text.startsWith(before));
      assert.ok(out.text.endsWith(BLOCK));
    }
  });

  test("exact LF legacy snippet is replaced in place; surrounding bytes kept", () => {
    const before = `# Mine\n\nAbove.\n\n${LEGACY_SNIPPET}\n## After\n\nBelow.\n`;
    const out = plan(before);
    assert.equal(out.state, "updated");
    assert.equal(out.text, `# Mine\n\nAbove.\n\n${BLOCK}\n## After\n\nBelow.\n`);
    assert.deepEqual(plan(out.text), { state: "unchanged" });
  });

  test("exact CRLF legacy snippet is replaced with a CRLF block", () => {
    const before = crlf(`# Mine\n\n${LEGACY_SNIPPET}\n## After\n`);
    const out = plan(before);
    assert.equal(out.state, "updated");
    assert.equal(out.text, crlf(`# Mine\n\n${BLOCK}\n## After\n`));
    assert.deepEqual(plan(out.text), { state: "unchanged" });
  });

  test("legacy snippet at end of file without a final newline is migrated", () => {
    const out = plan(`# Mine\n\n${LEGACY_SNIPPET.replace(/\n$/, "")}`);
    assert.equal(out.state, "updated");
    assert.equal(out.text, `# Mine\n\n${BLOCK}`);
  });

  test("an older managed block is upgraded in place, in the block's own line endings", () => {
    const lf = plan(`# Mine\n\n${OLD_BLOCK}\nTail.\n`);
    assert.equal(lf.state, "updated");
    assert.equal(lf.text, `# Mine\n\n${BLOCK}\nTail.\n`);
    const mixed = `# Mine\n\n${crlf(OLD_BLOCK)}\nTail.\n`;
    assert.equal(plan(mixed).text, `# Mine\n\n${crlf(BLOCK)}\nTail.\n`);
  });

  test("the current block is unchanged, also without a final newline", () => {
    assert.deepEqual(plan(`# Mine\n\n${BLOCK}`), { state: "unchanged" });
    assert.deepEqual(plan(`# Mine\n\n${BLOCK.replace(/\n$/, "")}`), { state: "unchanged" });
    assert.deepEqual(plan(crlf(`# Mine\n\n${BLOCK}`)), { state: "unchanged" });
  });

  test("customised legacy section, duplicate headings and bad markers need manual review", () => {
    const custom = LEGACY_SNIPPET.replace("Living docs remain", "Our docs remain");
    const cases = [
      `# Mine\n\n${custom}`,
      `# Mine\n\n${LEGACY_SNIPPET}\n${LEGACY_SNIPPET}`,
      `# Mine\n\n${BLOCK}\n${BLOCK}`,
      `# Mine\n\n<!-- docket:agent-snippet begin v2 -->\n## Work items (Docket)\n`,
      `# Mine\n\n<!-- docket:agent-snippet end -->\n`,
      `# Mine\n\n<!-- docket:agent-snippet end -->\n<!-- docket:agent-snippet begin v2 -->\n`,
    ];
    for (const text of cases) {
      const out = plan(text);
      assert.equal(out.state, "manual-review", text);
      assert.ok(out.reason);
      assert.equal(out.text, undefined);
    }
  });
});

describe("ensureAgentSnippets", () => {
  const dir = () => {
    const t = tempDir("docket snippet ");
    cleanups.push(t.cleanup);
    return t.dir;
  };
  const read = (root, n) => {
    const f = path.join(root, n);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  };

  test("writes both files, creating missing ones; second run is unchanged", () => {
    const root = dir();
    fs.writeFileSync(path.join(root, "CLAUDE.md"), crlf(`# Mine\n\n${LEGACY_SNIPPET}`));
    const first = ensureAgentSnippets(root);
    assert.deepEqual(first, [
      { path: "CLAUDE.md", state: "updated" },
      { path: "AGENTS.md", state: "created" },
    ]);
    assert.equal(read(root, "CLAUDE.md"), crlf(`# Mine\n\n${BLOCK}`));
    assert.ok(read(root, "AGENTS.md").endsWith(BLOCK));
    assert.deepEqual(
      ensureAgentSnippets(root).map((f) => f.state),
      ["unchanged", "unchanged"],
    );
  });

  test("dry run reports and writes nothing; manual review leaves the file byte-identical", () => {
    const root = dir();
    const custom = `# Mine\n\n## Work items (Docket)\n\nOur own rules.\n`;
    fs.writeFileSync(path.join(root, "CLAUDE.md"), custom);
    const dry = ensureAgentSnippets(root, { dryRun: true });
    assert.equal(dry[0].state, "manual-review");
    assert.equal(dry[1].state, "created");
    assert.equal(read(root, "AGENTS.md"), null);
    ensureAgentSnippets(root);
    assert.equal(read(root, "CLAUDE.md"), custom);
    assert.ok(read(root, "AGENTS.md").endsWith(BLOCK));
  });
});

describe("blank-line-only differences (Prettier)", () => {
  const BEGIN = "<!-- docket:agent-snippet begin v2 -->\n";
  const END = "<!-- docket:agent-snippet end -->\n";
  const variants = {
    "blank after begin": BLOCK.replace(BEGIN, `${BEGIN}\n`),
    "blank before end": BLOCK.replace(END, `\n${END}`),
    "blank around both, doubled": BLOCK.replace(BEGIN, `${BEGIN}\n\n`).replace(END, `\n\n${END}`),
    "extra blank between paragraphs": BLOCK.replace(/\n\n/, "\n\n\n\n"),
  };
  for (const [name, block] of Object.entries(variants)) {
    for (const [eolName, conv] of [
      ["LF", (s) => s],
      ["CRLF", crlf],
    ]) {
      test(`${name} (${eolName}) is unchanged`, () => {
        const text = conv(`# Mine\n\n${block}\nAfter.\n`);
        assert.notEqual(text, conv(`# Mine\n\n${BLOCK}\nAfter.\n`));
        assert.deepEqual(plan(text), { state: "unchanged" });
      });
    }
  }

  test("a real wording change still updates, keeping surroundings", () => {
    const edited = variants["blank after begin"].replace("Docket", "Docket!");
    const out = plan(`# Mine\n\n${edited}\nAfter.\n`);
    assert.equal(out.state, "updated");
    assert.equal(out.text, `# Mine\n\n${BLOCK}\nAfter.\n`);
  });

  test("an older version with blank lines still upgrades", () => {
    const old = OLD_BLOCK.replace("begin v1 -->\n", "begin v1 -->\n\n");
    assert.equal(plan(`# Mine\n\n${old}`).state, "updated");
  });

  test("ensureAgentSnippets leaves a Prettier-style file untouched; dry run agrees", () => {
    const t = tempDir("docket snippet ");
    cleanups.push(t.cleanup);
    const text = `# Mine\n\n${variants["blank after begin"]}`;
    for (const n of ["CLAUDE.md", "AGENTS.md"]) fs.writeFileSync(path.join(t.dir, n), text);
    for (const dryRun of [true, false]) {
      const states = ensureAgentSnippets(t.dir, { dryRun }).map((r) => r.state);
      assert.deepEqual(states, ["unchanged", "unchanged"]);
    }
    assert.equal(fs.readFileSync(path.join(t.dir, "CLAUDE.md"), "utf8"), text);
  });
});
