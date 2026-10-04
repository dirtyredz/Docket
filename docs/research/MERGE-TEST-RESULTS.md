# Merge test results (ITEM-SPEC v1)

Run 2026-10-04, git 2.51.0 (Windows, `ort` strategy), Node 22. Harness: `run.mjs` (+ `lib.mjs`, `bl-check.mjs`, `agent.mjs`) in the scratchpad `merge-test/` dir; `node run.mjs` rebuilds everything (about 4 min, mostly Windows git worktree overhead) and writes `results.json`. 20 seeded items; each scenario is 2 (or 3) worktrees on separate branches, merged into main one after another.

Outcome definitions: **clean** = git merged without conflict AND the result equals the semantic expectation AND `bl check` passes. **conflict** = git stopped. **silent-wrong** = clean merge but wrong or invalid result. Three layouts: **file-per-item** (the spec, flow lists), **one BACKLOG.md** (one item per line, same 12 fields on the line), **multiline-lists** (spec variant: `fixes:` then `  - id` per line).

## Scenario x outcome

| id | scenario | file-per-item (spec) | one BACKLOG.md | multiline-lists |
|---|---|---|---|---|
| a1 | both ADD 1 item | clean | **conflict** | clean |
| a2 | both ADD 3 items | clean | **conflict** | clean |
| a3 | ADD at distant positions (index 2 vs 17) | clean | clean | clean |
| b1 | edit DIFFERENT items, adjacent lines | clean | **conflict** | clean |
| b2 | edit DIFFERENT items, distant lines | clean | clean | clean |
| c1 | same item: status move (status+since) vs priority | clean | **conflict** | clean |
| c2 | same item: status move vs `type` (adjacent to since) | **conflict** | conflict | conflict |
| c3 | same item: status move vs fixes append (non-adjacent) | clean | **conflict** | clean |
| c4 | same item: area vs rank (adjacent) | **conflict** | conflict | conflict |
| c5 | same item: fixes append vs blocked_by append (adjacent lists) | **conflict** | conflict | conflict |
| c6 | same item: priority vs rank (one line apart) | clean | **conflict** | clean |
| c7 | same item: status only vs type (one line apart) | clean | **conflict** | clean |
| c8 | same item: status only vs priority | clean | **conflict** | clean |
| d1 | SAME field, SAME value | clean | clean | clean |
| d2 | SAME field, different value (status) | conflict | conflict | conflict |
| d3 | SAME field, different value (priority) | conflict | conflict | conflict |
| e1 | body edit vs status move | clean | n/a | clean |
| e2 | H1 title edit vs last frontmatter key (`relates`) | clean | n/a | clean |
| e3 | body paragraph 1 vs paragraph 2 | clean | n/a | clean |
| e4 | same body line | conflict | n/a | conflict |
| g1 | fixes [a] -> [a,b] vs [a,c] | **conflict** | conflict | conflict |
| g2 | relates [] -> [b] vs [c] | **conflict** | conflict | conflict |
| h1 | 3 worktrees: each adds 2 items + moves a different item | clean | **conflict** | clean |
| i1 | A drops item 6, B adds a relation to 6 | clean (semantically dangling) | clean | clean |
| i2 | both add an item with the same rank | clean (duplicate rank) | conflict | clean |

Totals: file-per-item 8 of 25 conflict; multiline-lists 8 of 25; one BACKLOG.md 17 of 21 (the e-scenarios do not apply). On the 21 shared scenarios, file-per-item conflicts in 7, BACKLOG.md in 17: ten conflicts disappear.

**Silent-wrong count: 0** in the scripted scenarios. (One early false alarm: a test set a bug to `type: task` while it still had `fixes`; `bl check` rule 8 flagged it. That is the legal-state rule firing, not a merge artefact, and the test was changed.) The clean-but-semantically-off cases (i1 relation to a tombstone, i2 duplicate rank) are not caught by git; they are what `bl check` rule 9 warnings are for.

## Real-agent check (two Haiku helpers, spec file only, no CLI)

Each helper got only `ITEM-SPEC.md` in its worktree and was told to create 3 items and change the status of 2 existing items by hand.
- **YAML/spec violations introduced: 0 for both.** The validator (`bl-check.mjs`, 54 lines) found 0 errors on each branch and on the merged result; all 26 files valid (20 seed + 6 new). Grammar, key order, empty `parent:`/`area:`, flow lists and H1 titles were all reproduced correctly.
- Both helpers happened to pick the same existing item and set it to `wip` with the same date: identical edits, git merged clean (same as d1). The prompt suggested "one to wip", so this is partly induced.
- **What the validator would NOT catch today:** the helpers invented `rank` values by hand and collided with the seed and each other (duplicate ranks `a, b, c, m` in the merged tree). Both also created a near-identical "Dark mode toggle" feature (semantic duplicate; no tool detects that). Duplicate ranks are a rule 9 warning in the spec but not implemented in the prototype.
- Weak evidence: n=2, one task, a capable model with a clear spec. Read it as "Haiku follows the grammar when handed the spec", not as proof of robustness under long sessions.

## Notable surprises
1. Frontmatter conflicts are driven purely by line adjacency, exactly as xmerge.c predicts: a one-line gap (c6, c7, c8) merges clean; touching lines (c2, c4, c5) conflict. Confirmed empirically.
2. **c2 is the one realistic hot spot:** a status move rewrites `status` and `since` (lines 2-3), and `type` (line 4) touches it. In the spec order `since` is adjacent to `type`.
3. One-entry-per-line lists did not help: g1, g2 and c5 still conflict. Both branches append at the same insertion point, and going from empty `fixes: []` to a non-empty list rewrites the key line, which touches its neighbour.
4. A single BACKLOG.md conflicts on every pair of concurrent adds at end of file, and on every same-item edit. It merges clean only for edits at distant lines or identical edits.
5. Body vs frontmatter (e1-e3) never conflicted, including title vs the last frontmatter key; the closing `---` fence acts as a separator.
6. The harness is slow on Windows (about 4 min for 71 merge runs, mostly worktree add/remove). Irrelevant for product use.

## Implications for the spec
1. **Keep file-per-item.** Adds, cross-item edits and the 3-way merge are all clean.
2. **Keep flow lists.** Multiline lists showed no merge benefit (surprise 3) and cost more lines per item.
3. **Field order: superseded by the re-test below.** The candidate order was adopted in ITEM-SPEC.md; c2 flips to clean, with minor new adjacencies (see Re-test).
4. **Concurrent relation-list appends (g1, g2, c5) will conflict.** Only a field-level merge driver fixes this. Volume is probably low; log real conflicts first, as round 2 already suggests.
5. **`bl add` must assign `rank` (and the ID), not the agent.** Hand-written ranks collided immediately. Compute a rank at the end of the priority band in `bl add`.
6. **Implement rule 9 warnings** (relation to a dropped item, duplicate rank within a priority); they catch exactly the two clean-but-wrong cases (i1, i2).
7. The strict 12-key grammar is checkable in about 54 lines and passed real agent output unchanged.

## Re-test (field order)

Run 2026-10-04, same harness (`KEYS` now overridable via `BL_KEYS`; seeding, writing and scenarios all derive from it). Three new same-item scenarios were added (c9 status move vs `area`, c10 `area` vs `priority`, c11 status move vs `parent`), so the old order was re-run on all 28 scenarios for a fair baseline. The Haiku agent step was skipped. Silent-wrong: 0 in every run.

Orders compared (file-per-item layout; multiline-lists gave identical outcomes everywhere):
- **old**: `id, status, since, type, priority, created, rank, area, parent, fixes, blocked_by, relates`
- **new**: `id, type, created, status, since, area, priority, rank, parent, fixes, blocked_by, relates`
- **alt** (status/since fenced by `created` above and `parent` below): `id, type, created, status, since, parent, area, priority, rank, fixes, blocked_by, relates`

| id | scenario | old | new | alt |
|---|---|---|---|---|
| c2 | status move vs `type` | conflict | **clean** | **clean** |
| c4 | `area` vs `rank` | conflict | **clean** | **clean** |
| c6 | `priority` vs `rank` | clean | **worse: conflict** | conflict |
| c9 | status move vs `area` (new) | clean | **worse: conflict** | clean |
| c10 | `area` vs `priority` (new) | clean | **worse: conflict** | conflict |
| c11 | status move vs `parent` (new) | clean | clean | **worse: conflict** |
| c5, g1, g2 | relation-list appends | conflict | conflict | conflict |
| d2, d3, e4 | same field / same line | conflict | conflict | conflict |
| all others (a1-a3, b1, b2, c1, c3, c7, c8, d1, e1-e3, h1, i1, i2) | | clean | clean | clean |

Conflicts out of 28 (file-per-item): old 8, new 9, alt 9. One-BACKLOG.md: 20 of 24 in all three orders (new scenarios conflict there regardless).

Findings:
1. **c2 flips to clean** with the new order, as predicted, and so does c4. Both orders trade them for new adjacencies: whichever fields end up next to each other conflict, there is no order with no adjacent pair.
2. **What got worse in `new`:** `since` is now adjacent to `area` (c9), `area` to `priority` (c10), `priority` to `rank` (c6, previously separated by `created`). Net +1 conflict on the scripted set.
3. **`alt` does not beat `new`.** Fencing `since` with `parent` just moves the conflict (c9 clean, c11 conflict) and still conflicts on c6 and c10. Only three fields (`id`, `type`, `created`) are near-immutable, so there are not enough inert fields to fence both sides of the status pair.
4. **Why `new` is still the choice:** the scenarios it loses (`area`, `priority`/`rank` edited concurrently by different agents on the same item) are rarer than concurrent status moves, and `priority`/`rank` are normally changed together by one agent as a single hunk. The status move is the most frequent concurrent edit, and under `new` it conflicts only with a same-time `area` change. `new` and `alt` tie on the count (9 each); `new` was kept as the simpler, predicted order and is now in ITEM-SPEC.md.
5. The remaining conflicts (relation-list appends, same-field edits) are unchanged and need a merge driver or hand resolution; per the spec, log real conflicts first.
