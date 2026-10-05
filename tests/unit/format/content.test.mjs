// Item content grammar: body/Notes slices, rule-10 errors, exact-byte edits.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allocateNoteRef,
  appendNote,
  bodyOf,
  contentView,
  isNoteRef,
  newItemRest,
  parseContent,
  withBody,
  withNoteState,
  withTitle,
} from "../../../src/core/format/content.mjs";
import { parseItem } from "../../../src/core/format/parse.mjs";
import { itemText } from "../../helpers/repository.mjs";

const R1 = "2026-10-05T14:03:00.000Z";
const R2 = "2026-10-05T14:04:00.000Z";
const hdr = (ref = R1, state = "open", author = "owner") => `### ${ref} · ${state} · ${author}`;
const notesRest = `# T\n\nBody.\n\n## Notes\n\n${hdr()}\n\nQuestion text.\n`;
const parse = (rest, offset) => parseContent(rest, offset);
const codes = (rest) => parse(rest).errors.map((e) => e.code);

describe("legacy items (no Notes)", () => {
  test("bodySource is everything after the H1 line; bodyOf is unchanged", () => {
    const rest = "# T\n\nLegacy body.\n\nMore.\n";
    const c = parse(rest);
    assert.equal(c.hasNotes, false);
    assert.deepEqual(c.errors, []);
    assert.equal(contentView(rest, c).bodySource, "\nLegacy body.\n\nMore.\n");
    assert.equal(bodyOf(rest), "Legacy body.\n\nMore.\n");
    assert.equal(rest.slice(0, c.titleEnd), "# T\n");
  });

  test("newItemRest round-trips through bodyOf", () => {
    assert.equal(bodyOf(newItemRest("T", "Facts\n")), "Facts\n");
    assert.equal(newItemRest("T"), "# T\n");
  });

  test("withTitle rewrites only the H1", () => {
    assert.equal(withTitle(notesRest, "New"), notesRest.replace("# T", "# New"));
  });
});

describe("empty Notes section", () => {
  for (const [label, rest] of [
    ["with trailing newline", "# T\n\nBody.\n\n## Notes\n"],
    ["at EOF without newline", "# T\n\nBody.\n\n## Notes"],
  ]) {
    test(label, () => {
      const c = parse(rest);
      assert.deepEqual(c.errors, []);
      assert.equal(c.hasNotes, true);
      assert.deepEqual(c.notes, []);
    });
  }
});

describe("rule 10 errors", () => {
  const cases = [
    ["note-outside", `# T\n\n${hdr()}\n\nx\n`],
    ["note-header", "# T\n\n## Notes\n\n### not a header\n\nx\n"],
    ["note-header", `# T\n\n## Notes\n\n### ${R1} · maybe · owner\n\nx\n`],
    ["note-header", `# T\n\n## Notes\n\n### ${R1} · open · robot\n\nx\n`],
    ["note-header", "# T\n\n## Notes\n\n### 2026-02-30T00:00:00.000Z · open · owner\n\nx\n"],
    ["note-duplicate", `# T\n\n## Notes\n\n${hdr()}\n\na\n\n${hdr()}\n\nb\n`],
    ["notes-section", "# T\n\n## Notes\n\n## Notes\n"],
    ["notes-section", `# T\n\n## Notes\n\n${hdr()}\n\na\n\n# Heading\n`],
    ["notes-section", `# T\n\n## Notes\n\n${hdr()}\n\na\n\n## Other\n`],
    ["notes-stray", "# T\n\n## Notes\n\nstray text\n"],
    ["notes-fence", `# T\n\n## Notes\n\n${hdr()}\n\n\`\`\`\nunclosed\n`],
    ["note-empty", `# T\n\n## Notes\n\n${hdr()}\n`],
    ["note-empty", `# T\n\n## Notes\n\n${hdr()}\n\n   \n\n${hdr(R2)}\n\nb\n`],
  ];
  for (const [code, rest] of cases) {
    test(`${code}: ${JSON.stringify(rest.slice(0, 70))}`, () => {
      const errors = parse(rest).errors;
      assert.ok(
        errors.some((e) => e.code === code && e.rule === 10),
        JSON.stringify(errors),
      );
    });
  }

  test("a `## Notes` line inside a fence in the body is not the section", () => {
    const rest = "# T\n\n```md\n## Notes\n\n### x\n```\n";
    assert.deepEqual(parse(rest).errors, []);
    assert.equal(parse(rest).hasNotes, false);
  });

  test("a header-shaped line inside a body fence is fine", () => {
    assert.deepEqual(codes(`# T\n\n~~~\n${hdr()}\n~~~\n`), []);
  });
});

describe("fences", () => {
  const fences = [
    ["backtick", "```", "```"],
    ["tilde", "~~~", "~~~"],
    ["longer closing fence", "```", "`````"],
    ["info string", "```markdown", "```"],
    ["tilde with info", "~~~ md", "~~~~"],
  ];
  for (const [label, open, close] of fences) {
    test(`${label}: headings inside a Notes fence are payload`, () => {
      const payload = `${open}\n## Notes\n# H\n### bogus\n${hdr(R2)}\n${close}`;
      const rest = `# T\n\n## Notes\n\n${hdr()}\n\n${payload}\n`;
      const c = parse(rest);
      assert.deepEqual(c.errors, []);
      assert.equal(c.notes.length, 1);
      assert.equal(contentView(rest, c).notes[0].text, payload);
    });

    test(`${label}: a fenced example in the body is not a section or note`, () => {
      const rest = `# T\n\n${open}\n## Notes\n${hdr()}\n${close}\n\n## Notes\n\n${hdr()}\n\nq\n`;
      const c = parse(rest);
      assert.deepEqual(c.errors, []);
      assert.equal(c.notes.length, 1);
    });
  }

  test("a shorter closing fence does not close", () => {
    assert.ok(
      codes(`# T\n\n## Notes\n\n${hdr()}\n\n\`\`\`\`\nx\n\`\`\`\n`).includes("notes-fence"),
    );
  });
});

describe("content bytes", () => {
  test("Unicode, tabs, trailing spaces and hard breaks are preserved exactly in source", () => {
    const payload = "\n\tTabbed é中😀  \nhard break  \nend   \n";
    const rest = `# T\n\n## Notes\n\n${hdr()}\n${payload}`;
    const c = parse(rest);
    assert.deepEqual(c.errors, []);
    assert.equal(contentView(rest, c).notes[0].source, payload);
  });

  test("separator ownership: body excludes the LF before `## Notes`", () => {
    const c = parse(notesRest);
    assert.equal(notesRest.slice(c.titleEnd, c.bodyEnd), "\nBody.\n");
    assert.equal(notesRest.slice(c.bodyEnd).startsWith("\n## Notes\n"), true);
  });

  test("separator ownership: payload excludes the LF before the next header", () => {
    const rest = `# T\n\n## Notes\n\n${hdr()}\n\nfirst\n\n${hdr(R2)}\n\nsecond\n`;
    const c = parse(rest);
    const v = contentView(rest, c);
    assert.equal(v.notes[0].source, "\nfirst\n");
    assert.equal(v.notes[0].text, "first");
    assert.equal(v.notes[1].source, "\nsecond\n");
    assert.equal(rest.slice(c.notes[0].payloadEnd, c.notes[1].headerStart), "\n");
  });

  test("openNoteCount counts open notes", () => {
    const rest = `# T\n\n## Notes\n\n${hdr(R1, "resolved")}\n\na\n\n${hdr(R2)}\n\nb\n`;
    assert.equal(contentView(rest, parse(rest)).openNoteCount, 1);
  });

  test("lineOffset shifts error line numbers", () => {
    const rest = "# T\n\n## Notes\n\n### nope\n\nx\n";
    const line = (offset) => parse(rest, offset).errors.find((e) => e.code === "note-header").line;
    assert.equal(line(0), 5);
    assert.equal(line(20), 25);
  });
});

describe("appendNote", () => {
  const note = { ref: R1, author: "owner", text: "Q?" };

  test("missing terminal newline: the original text is an exact prefix", () => {
    const rest = "# T\n\nBody";
    const out = appendNote(rest, parse(rest), note);
    assert.ok(out.startsWith(rest));
    assert.equal(out, `# T\n\nBody\n\n## Notes\n\n${hdr()}\n\nQ?\n`);
    assert.deepEqual(parse(out).errors, []);
  });

  test("appending twice keeps the first result as an exact prefix", () => {
    const first = appendNote("# T\n\nBody.\n", parse("# T\n\nBody.\n"), note);
    const second = appendNote(first, parse(first), {
      ...note,
      ref: R2,
      author: "agent",
      text: "A",
    });
    assert.ok(second.startsWith(first));
    const c = parse(second);
    assert.deepEqual(c.errors, []);
    assert.deepEqual(
      c.notes.map((n) => [n.ref, n.author]),
      [
        [R1, "owner"],
        [R2, "agent"],
      ],
    );
  });
});

describe("withNoteState", () => {
  test("changes only the state token of the header line", () => {
    const rest = `# T\n\nBody.\n\n## Notes\n\n${hdr(R1)}\n\na\n\n${hdr(R2)}\n\nb\n`;
    const c = parse(rest);
    const out = withNoteState(rest, c.notes[1], "resolved");
    assert.equal(out, rest.replace(hdr(R2), hdr(R2, "resolved")));
    assert.equal(out.length, rest.length + 4);
  });
});

describe("withBody", () => {
  test("keeps the title prefix and Notes suffix byte for byte", () => {
    const c = parse(notesRest);
    const out = withBody(notesRest, c, "\nNew facts.\n\nSecond.\n");
    assert.ok(out.startsWith("# T\n"));
    assert.equal(out.slice(out.indexOf("\n## Notes")), notesRest.slice(c.bodyEnd));
    assert.equal(out, notesRest.replace("\nBody.\n", "\nNew facts.\n\nSecond.\n"));
  });

  test("an empty body keeps the suffix", () => {
    const c = parse(notesRest);
    const out = withBody(notesRest, c, "");
    assert.equal(out, `# T\n${notesRest.slice(c.bodyEnd)}`);
    assert.deepEqual(parse(out).errors, []);
  });
});

describe("isNoteRef / allocateNoteRef", () => {
  test("accepts canonical refs", () => assert.equal(isNoteRef(R1), true));
  for (const bad of [
    "2026-02-30T00:00:00.000Z",
    "2026-10-05T14:03:00Z",
    "2026-10-05T14:03:00.000+00:00",
    "2026-10-05T14:03:00.000",
    "2026-10-05 14:03:00.000Z",
    "2026-13-05T14:03:00.000Z",
    "",
    null,
  ]) {
    test(`rejects ${JSON.stringify(bad)}`, () => assert.equal(isNoteRef(bad), false));
  }

  test("advances one millisecond per collision", () => {
    const now = new Date(R1);
    assert.equal(allocateNoteRef(now, []), R1);
    assert.equal(allocateNoteRef(now, [R1]), "2026-10-05T14:03:00.001Z");
    assert.equal(
      allocateNoteRef(now, [R1, "2026-10-05T14:03:00.001Z", "2026-10-05T14:03:00.002Z"]),
      "2026-10-05T14:03:00.003Z",
    );
  });
});

describe("parseItem integration", () => {
  test("a malformed Notes header is a rule-10 error with a file line", () => {
    const text = itemText({}, { body: "Body.\n\n## Notes\n\n### broken header\n\nx\n" });
    const r = parseItem(text);
    const e = r.errors.find((x) => x.rule === 10);
    assert.equal(e.code, "note-header");
    assert.equal(e.line, text.split("\n").findIndex((l) => l === "### broken header") + 1);
  });

  test("frontmatter + rest reassemble the file exactly", () => {
    const text = itemText({}, { body: `Body.\n\n## Notes\n\n${hdr()}\n\nq\n` });
    const r = parseItem(text);
    assert.deepEqual(r.errors, []);
    assert.equal(r.frontmatter + r.rest, text);
    assert.equal(r.content.notes.length, 1);
  });
});
