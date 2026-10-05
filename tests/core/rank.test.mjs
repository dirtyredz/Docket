import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { rankAtEnd, rankAtStart, rankBetween } from "../../src/core/identity/rank.mjs";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertWellFormed(rank) {
  assert.match(rank, /^[a-z]+$/);
  assert.ok(!rank.endsWith("a"), `${rank} must not end in "a"`);
}

const gapCode = (fn) => assert.throws(fn, (err) => err.code === "DOCKET_RANK_GAP");

describe("rankBetween", () => {
  test("unbounded on both sides gives a single letter", () => {
    const r = rankBetween(null, null);
    assert.match(r, /^[a-z]$/);
    assertWellFormed(r);
  });

  test("lies strictly between neighbours", () => {
    const cases = [
      ["a", "z"],
      ["b", "c"],
      ["n", "o"],
      ["n", "nb"],
      ["an", "b"],
      ["y", "z"],
      [null, "b"],
      [null, "n"],
      ["m", null],
      ["zz", null],
      ["abc", "abd"],
      ["az", "b"],
    ];
    for (const [lo, hi] of cases) {
      const r = rankBetween(lo, hi);
      assertWellFormed(r);
      if (lo !== null) assert.ok(r > lo, `${r} > ${lo}`);
      if (hi !== null) assert.ok(r < hi, `${r} < ${hi}`);
    }
  });

  test("repeated insertion at the same spot keeps working", () => {
    let hi = "n";
    for (let i = 0; i < 50; i++) {
      const r = rankBetween(null, hi);
      assert.ok(r < hi);
      assertWellFormed(r);
      hi = r;
    }
  });

  test("seeded fuzz: 2000 insertions keep the list strictly sorted with short keys", () => {
    const rand = mulberry32(20261004);
    const list = [rankBetween(null, null)];
    for (let i = 0; i < 2000; i++) {
      const slot = Math.floor(rand() * (list.length + 1));
      const lo = slot === 0 ? null : list[slot - 1];
      const hi = slot === list.length ? null : list[slot];
      const r = rankBetween(lo, hi);
      assertWellFormed(r);
      list.splice(slot, 0, r);
    }
    for (let i = 1; i < list.length; i++)
      assert.ok(list[i - 1] < list[i], `${list[i - 1]} < ${list[i]}`);
    assert.equal(new Set(list).size, list.length);
    const maxLen = Math.max(...list.map((r) => r.length));
    assert.ok(maxLen < 20, `max key length ${maxLen}`);
  });
});

describe("rankAtEnd / rankAtStart", () => {
  test("rankAtEnd is above every rank, with duplicates and unsorted input", () => {
    const ranks = ["n", "c", "x", "c", "x", "b"];
    const r = rankAtEnd(ranks);
    assertWellFormed(r);
    for (const x of ranks) assert.ok(r > x);
  });

  test("rankAtEnd on an empty band gives a valid rank", () => {
    assertWellFormed(rankAtEnd([]));
  });

  test("rankAtEnd repeated appends stay sorted", () => {
    const list = [];
    for (let i = 0; i < 100; i++) list.push(rankAtEnd(list));
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1] < list[i]);
  });

  test("rankAtStart is below every rank, with duplicates and unsorted input", () => {
    const ranks = ["n", "x", "c", "x", "c"];
    const r = rankAtStart(ranks);
    assertWellFormed(r);
    for (const x of ranks) assert.ok(r < x);
  });

  test("rankAtStart on an empty band gives a valid rank", () => {
    assertWellFormed(rankAtStart([]));
  });

  test("rankAtStart repeated prepends stay sorted", () => {
    const list = ["n"];
    for (let i = 0; i < 100; i++) list.unshift(rankAtStart(list));
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1] < list[i]);
  });
});

describe("DOCKET_RANK_GAP", () => {
  test("nothing sorts between b and ba", () => gapCode(() => rankBetween("b", "ba")));
  test("nothing sorts below a", () => gapCode(() => rankAtStart(["a"])));
  test("lo equal to hi", () => gapCode(() => rankBetween("m", "m")));
  test("lo greater than hi", () => gapCode(() => rankBetween("z", "b")));
  test("gap error carries the bounds", () => {
    try {
      rankBetween("b", "ba");
      assert.fail("expected throw");
    } catch (err) {
      assert.equal(err.details.lo, "b");
      assert.equal(err.details.hi, "ba");
    }
  });
});
