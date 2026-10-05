# Round 2: an item store with status workflow and relations. Markdown, SQLite or JSONL as the source of truth?

*Research director report, 2026-10-04. Adversarial investigation with two researcher rounds per side, plus my own spot-checks of git's merge code and the first adopter repo portal. It builds on the round 1 report (`markdown-vs-db-project-docs.md`) and the 31-repo survey (`doc-set-survey.md`).*

## Question and decision at stake

The owner's real workflow needs four things round 1 did not weigh:

- **Status moves.** Items move through todo, in-work and done, kanban style.
- **Typed relations.** Bugs attach to features. Items can block other items, have a parent, and some relations are many-to-many.
- **A global viewer that edits.** It reviews and edits items across about 20 repos.
- **One typed item store.** Features need IDs, so FEATURES and BACKLOG merge into a single store with a `type` field.

The hard constraints are unchanged. There is no central database. Each repo owns its state in git. Claude Code and Codex agents edit constantly, sometimes in parallel worktrees.

**The proposition under test:**
- per-repo markdown items with inline header-line fields;
- a gitignored, rebuildable SQLite index;
- a `bl` CLI with `check`.

It claims this is better than two alternatives:
- **(B)** per-repo SQLite as the source of truth, optionally with a committed text dump;
- **(C)** per-repo JSONL as the source of truth, with markdown views generated from it.

**What this decides:** the item schema, and what to build first.

## Bottom line

**Keep markdown as the source of truth, but not in the form proposed. Confidence: High on the storage choice, Medium on schema details.**

**The storage choice survived.**
- Neither SQLite nor JSONL as truth holds up for this workflow.
- Committed SQLite cannot be merged, so parallel worktrees lose work.
- JSONL as a mutable snapshot hits the same per-record conflicts as markdown. Its diffs are worse, and `merge=union` corrupts it.
- Beads, the main prior art for JSONL, abandoned that path.
- The pessimist conceded both points in round 2.

**Both parts of the proposed form failed under evidence.**

1. **One shared file loses to one file per item.**
   - Git's 3-way merge treats changes on touching lines as a conflict. I verified this in `xdiff/xmerge.c`, where the non-overlap test is a strict `xscr1->i1 + xscr1->chg1 < xscr2->i1`.
   - In a single file, two worktree agents adding at the same place, or editing neighbouring items, always conflict.
   - With one file per item, creates never conflict, and edits to different items never conflict.
   - This axis matters more than markdown vs JSONL vs SQLite. Both researchers reached it independently.
2. **A one-line header loses to strict-subset YAML frontmatter, one field per line.**
   - With a header line, two branches changing *different* fields of the same item (one sets status, one adds a link) always conflict, and `git blame` or `log -G` cannot isolate when the status changed.
   - Frontmatter also works with Obsidian Bases, GitHub rendering and Backlog.md, the closest prior art.
   - The optimist conceded this point.

**The design both sides converged on:**
- one `.md` file per item, which never moves;
- random, immutable IDs;
- each relation stored on one side only, with reverse lookups served by the gitignored index;
- tombstones instead of deletes;
- a fractional `rank`;
- a `since:` stamp on the current status;
- `bl check` as a hard pre-push gate.

## The case for markdown (claims that survived scrutiny)

1. **One file per item is proven prior art for exactly this feature set.**
   - Backlog.md keeps one markdown file per task with YAML frontmatter, and runs a kanban web UI, a CLI and an MCP server on top.
   - Status is a frontmatter field, not a folder.
   - Its serializer writes `id, title, status, assignee, created_date, labels, dependencies`, plus `parent_task_id, priority, type, ordinal, updated_date` when they are set.
   - Its own repo dogfoods about 100 task files.
   - Sources: [serializer.ts](https://raw.githubusercontent.com/MrLesk/Backlog.md/main/src/markdown/serializer.ts) and the [repo `backlog/` tree](https://github.com/MrLesk/Backlog.md/tree/main/backlog), both primary and fetched 2026-10-04.
2. **Merge behaviour favours files per item.**
   - Touching hunks conflict ([git/xdiff/xmerge.c](https://raw.githubusercontent.com/git/git/master/xdiff/xmerge.c), primary, which I verified myself).
   - GitLab cut changelog merge conflicts by about 90% by moving to one file per entry ([GitLab blog](https://about.gitlab.com/blog/gitlab-reduced-merge-conflicts-by-90-percent-with-changelog-placeholders/), primary but from 2015).
3. **Committed SQLite cannot work with parallel worktrees.**
   - A binary blob cannot be merged, so one side's changes are lost.
   - Foreign keys are off by default and must be enabled on every connection ([sqlite.org/foreignkeys](https://sqlite.org/foreignkeys.html), primary). An agent running `sqlite3` bypasses them.
   - Foreign keys never span branches anyway: each branch holds its own copy.
4. **JSONL as a mutable store failed in practice.**
   - Beads' SQLite-plus-JSONL era produced "stale-database overwrites, deleted-issue resurrection, JSONL merge handling … split-brain failures" ([gascity beads-vs-br](https://gascity.com/guide/beads-vs-br/), secondary, reviewed 2026-08).
   - Beads needed a field-level custom merge driver, `bd merge` ([pkg.go.dev beads v0.24.3](https://pkg.go.dev/github.com/steveyegge/beads@v0.24.3), primary).
   - Current beads keeps JSONL only as an export or fallback, with Dolt holding the truth ([beads git-integration](https://beads.gascity.com/reference/git-integration.md), primary).
5. **A derived SQL index over text is established practice.** Fossil's ticket tables "can always be reconstructed" from the synced change artifacts ([fossil tickets](https://fossil-scm.org/home/doc/trunk/www/tickets.wiki), primary). A gitignored index is the same pattern.
6. **Random IDs avoid allocation races across branches.**
   - Beads switched to hash IDs in v0.20.1 after collisions between concurrent branches.
   - Backlog.md's sequential IDs needed a branch scan and a "fresh bounded remote snapshot" ([v1.50.1 notes](https://newreleases.io/project/github/MrLesk/Backlog.md/release/v1.50.1), secondary).
   - the first adopter repo already generates random IDs (`<game-repo>/tools/portal/src/backlog/patch.mjs:22`).
7. **An explicit status field removes a whole class of parser.** the first adopter repo's `status.mjs:4-12` guesses done, reopened or partial from about ten prose wordings. A `status:` field replaces all of it.
8. **The harness doesn't object to about 390 item files.** `<harness>/hooks/structure/internals/filetypes.js:14-17` has no `md` in `CODE_EXT`, and `placement.js:158,179` counts only code files toward the fan-out cap.

## The case against (claims that survived, with severity)

1. **In-work status in a worktree branch is invisible from main until the merge. Severity: serious.**
   - This hits every per-branch store equally: A, B and C.
   - The kanban "in-work" column is empty exactly when it matters.
   - Prior art built special machinery for it:
     - beads moved its data to `refs/dolt/data` ([sync-concepts](https://beads.gascity.com/core-concepts/sync-concepts.md), primary);
     - Backlog.md scans every branch active in the last 30 days, which took about 394 git operations and 4.4 s before caching (v1.50.1 notes).
   - Storage format does not solve this. Design does (see recommendation).
2. **YAML frontmatter is fragile under agent edits. Severity: serious without enforcement.**
   - Backlog.md's own task BACK-682 (2026-09-02) reports that frontmatter shapes its preprocessor didn't handle caused "records to vanish from listings" ([BACK-682](https://raw.githubusercontent.com/MrLesk/Backlog.md/main/backlog/tasks/back-682%20-%20Make-frontmatter-preprocessing-robust-to-valid-YAML-shapes.md), primary).
   - Claude Code has produced unquoted-colon YAML ([claudeissues #4700](https://claudeissues.com/issue/4700-agent-yaml-parsing-fails-with-valid-line-breaks-in-frontmatter), anecdotal).
   - Mitigation:
     - use a strict subset: plain scalar tokens and one inline flow list per key, with no free text;
     - put the title in the H1;
     - have `bl check` reject anything else loudly rather than drop it.
3. **No transactions across files. Severity: minor.** A crash halfway through a multi-item change leaves partial state. Immutable IDs mean renames never cascade, git is the transaction log (`git diff`, `git checkout -- docs/items/`), and `bl check` catches dangling references.
4. **Git history is an unreliable audit trail. Severity: minor for this owner.**
   - Squash merges and rebases rewrite timestamps, and commit time is not the time of the change ([git-blame](https://git-scm.com/docs/git-blame)).
   - A stored `since:` stamp fixes "how long has it been in this status".
   - A complete transition history needs a real event log, which is a flip trigger (below).
5. **`bl check` detects problems; it doesn't prevent them. Severity: minor.**
   - A clean merge can combine "A tombstoned X" with "B linked to X".
   - Tombstones (never delete) turn that into a warning instead of a dangling reference.
6. **Touching frontmatter lines still conflict. Severity: minor.**
   - Concurrent edits to two adjacent keys of the same item conflict. So do two branches appending to the same relation list.
   - Mitigations:
     - order the keys so that keys which change often are separated by keys that rarely change;
     - a field-level merge driver can remove the rest later.
   - Custom drivers need per-clone `.git/config` setup ([gitattributes](https://git-scm.com/docs/gitattributes)), which `bl init` can do.
7. **The one-page scan is lost. Severity: minor.** Mitigated by `bl list`, a gitignored generated `BACKLOG.view.md`, and the viewer.

## Answers to the brief's specific questions

### Status transitions and history

| Option | "When did it move to in-work?" |
|---|---|
| Markdown, one file per item, frontmatter | A `since:` stamp, written by `bl` on every status change. `git log -G'^status:' -- docs/items/bl-x.md` gives the full trail per item; it works because status sits on its own line, which the header-line design could not offer. Squashes blur the timing. |
| SQLite as truth | An event table gives exact timestamps, but only inside one copy. Two worktrees' event rows cannot be merged. |
| JSONL as truth | A mutable snapshot has the same blame problem as markdown. An *append-only* JSONL event log with the built-in `merge=union` merges concurrent appends with no per-clone setup. That is its one real strength. |

On the first adopter repo's out-of-git event log: the pessimist cited `events.jsonl` in %LOCALAPPDATA% as proof that history lives outside git. I checked it. It is the portal's per-checkout *Claude review queue* (`<game-repo>/tools/portal/README.md:187-192`, `src\storage\state.mjs:1-2`), not item history. It is evidence of nothing either way.

### Relations

- Store each relation on its source item only:
  - `parent:` on the child;
  - `blocked_by:` on the blocked item;
  - `fixes:` on the bug;
  - `relates:` on either item.
- Many-to-many is simply a list on the source item.
- Reverse lookups come from the gitignored index ("bugs against feature X", "what does X block").
- Referential integrity: `bl check` verifies that every target exists, that IDs are unique, that there are no cycles in `parent` or `blocked_by`, and that each type and relation pairing is legal.
- Cascades: none are needed. IDs never change and deletes are tombstones (`status: dropped`).
- SQL foreign keys would give write-time enforcement, but only within one copy and only when the pragma is on. Neither holds across git branches.

### Concurrent writes and merges

| Store | Two agents create items | Two agents edit different items | Two agents edit the same item |
|---|---|---|---|
| One BACKLOG.md | Conflict when both add at the same point, e.g. end of file | Conflict if the items are adjacent | Conflict |
| One file per item, header line | Clean | Clean | Always conflicts |
| One file per item, frontmatter | Clean | Clean | Clean when the edited lines aren't adjacent; otherwise a conflict, which a merge driver can fix |
| JSONL snapshot | Conflict at the same point; `union` makes duplicates | Conflict if the lines are adjacent | Conflict |
| Committed SQLite | Binary: one side wins | Binary | Binary |
| SQL/JSONL dump | As JSONL, plus regenerated ordering churn | As JSONL | Conflict |

### Agent ergonomics and tokens

All figures below are estimates. Neither side found a benchmark.

| Operation | Approximate cost |
|---|---|
| `bl set bl-x status:wip` | ~40 tokens, the same as a `sqlite3` UPDATE |
| Hand edit of one item file | Read plus Edit of a ~400-byte file, ~200 tokens |
| Hand edit of an 86 KB single BACKLOG.md | ~20k tokens for the Read alone |
| Hand edit of a JSONL line | Exact-match editing through `\n` and `\"` escapes, which is the most error-prone; Aider measured worse output when content goes inside JSON ([aider](https://aider.chat/2024/08/14/code-in-json.html), 2024, indirect) |
| Listing all items | ~15 tokens per item with a header line; ~13 lines per item with frontmatter |

Two consequences:
- **Listing must go through `bl list` (compact rows, or `--json`)**, never `cat`. That was the header line's one real advantage, and it moves into the tool.
- **Claude Code and Codex are equivalent here.** Both call the shell CLI. Codex's `apply_patch` on a small item file is cheap.

### Migration from the 7 shapes

- Every shape needs rewriting whatever the target, so the importers cost about the same for any store.
- Markdown keeps prose bodies verbatim and diffs readable.
- **Shape 1** (priority H2 sections plus checkboxes) covers about 18 of the 31 repos: a game prototype, a budgeting app, an MCP server repo, an education-data sync, the a mod collection mods and the harness. One importer covers most of the fleet.
- **the first adopter repo:**
  - keep the existing `bl-` IDs;
  - the register row's priority wins (as its README already says);
  - done shards become `status: done`.
- **FEATURES:** these are prose and status tables. Their migration to `type: feature` items is partly manual. Seed them on first reference rather than by mass conversion.
- **Bloated docs:** the 120-230 KB docs (a game prototype, a family dashboard PWA) are mostly STRUCTURE, DECISIONS and GOTCHAS history, which is out of scope for the item store. Their BACKLOGs (86-96 KB, 150-270 bullets) migrate. Done items can move as `status: done` or be cut off at a date.

### When the answer flips

- **Toward an append-only JSONL event log alongside the items, not instead of them:** when cycle-time or status-history analytics become a real need. Use `merge=union` and one line per transition.
- **Toward embedded Dolt, or a shared-ref store as in beads and git-bug:**
  - when live coordination across machines or cloud sandboxes matters, i.e. seeing another machine's in-work claim before the merge;
  - or with dozens of concurrent agents.
  - Beads moved for exactly this "order of magnitude" reason, and its maintainers admitted the move hurt solo users.
- **Toward SQLite as truth:** only if git stops being the sync mechanism, for example a single always-on writer. That conflicts with the hard constraint.
- **Item count is not the trigger.** Hundreds to low thousands of items per repo are fine. Above roughly 10k items per repo, or with heavy atomic operations across many items, revisit.

## Genuine conflicts and how I weighed them

| Conflict | Outcome | Why |
|---|---|---|
| Header line vs frontmatter | **Frontmatter** | The merge-granularity argument (xmerge.c, which I verified), blame isolation, and tool compatibility outweigh the header's grep and token advantage. That advantage is recovered by `bl list`, and the YAML-fragility risk is contained by a strict subset plus `bl check`. |
| Capped in-file `## Log` (optimist) vs `since:` stamp only (pessimist) | **`since:` only in v1** | The log is a second copy of status, so it can drift and needs its own check. Appends at end of file conflict. It is also the same append-only habit that produced the 120-230 KB docs. Add the separate `events.jsonl` with `merge=union` only if analytics are ever needed. |
| Scanning worktrees vs a claims file in the shared git dir for in-work visibility | **Both, layered** | A claims file at `$(git rev-parse --git-common-dir)/bl-claims.json` is the coordination point: shared by every worktree of a clone, never committed, and it expires when its worktree path disappears. The viewer also reads each worktree's `docs/items/` (from `git worktree list --porcelain`) as a hint that includes uncommitted edits. In-work is ephemeral local coordination, like an editor lock, so keeping it out of the committed state does not violate "state travels with code". The durable `status: wip` plus `since:` still lands with the branch. |
| Field-level merge driver now vs later | **Later** | It is per-clone config and more to build. Ordering keys apart removes most conflicts. Log real conflicts first. |
| Slug in the filename (pessimist) vs ID only | **ID only** | A slug changes when the title changes, which changes the path and breaks plain `git log`. The viewer and `bl list` supply readable names. |
| Type-neutral `bl-` prefix vs typed `ft-`/`bug-` prefixes | **Type-neutral `bl-`** | Retyping an idea into a feature must not break references, and the first adopter repo's existing IDs stay valid. |

## Where each side overreached

**Optimist:**
- Round 1's single file plus header line was defended until the evidence made the optimist give it up.
- "JSONL needs a per-clone custom merge driver" is only half true: the built-in `union` driver needs no setup. The point does stand for *mutable* JSONL.
- The token figures were estimates.
- "Worktree scan is cheaper than Backlog.md's branch scan" is unbenchmarked.

**Pessimist:**
- The `events.jsonl` evidence was misread: it is a review queue, not item history.
- `updated:` was proposed as a field. It guarantees conflicts, as Backlog.md's `updated_date` shows.
- The in-file `## Log` was proposed, then withdrawn.
- The round 1 framing that git history is "useless" was too strong: with one field per line, `log -G'^status:'` works.

## Recommendation

### Item schema (v1 spec)

Path: `docs/items/bl-8e1d4c2a.md`. Files are flat and never move. Done items stay where they are.

```markdown
---
id: bl-8e1d4c2a
status: wip
since: 2026-10-04
type: bug
priority: P1
created: 2026-09-30
rank: m
area: eng
parent: bl-0c0ffee1
fixes: [bl-1a2b3c4d]
blocked_by: [bl-77aa0011]
relates: []
---
# Shipping target does not compile

Free prose: description, acceptance criteria. It never restates a field.
```

**Field rules:**

- **Format.** Strict YAML subset:
  - one key per line;
  - values are plain tokens, dates or one inline flow list of IDs;
  - no quotes, block scalars, anchors, comments or free text.
- **Title.** The title is the H1, never a field.
- **No `updated:` field.** Git records it.
- **Key order.** The order shown is part of the spec and keeps keys that change often apart:
  - `status` and `since` change together, so they sit next to each other;
  - `type` separates them from `priority`;
  - `created` separates `priority` from `rank`;
  - `area` separates `rank` from the relation lists.
- **Types.** `feature | bug | task | idea`, extensible per repo.
- **Status.**
  - Values: `todo | wip | done | dropped`, where `dropped` is the tombstone.
  - "Blocked" is derived from `blocked_by`, not stored.
- **IDs.**
  - Format: `bl-` plus 8 random hex characters, type-neutral and immutable.
  - Keep the first adopter repo's existing IDs as they are.
  - Cross-repo references use `repo#bl-xxxxxxxx`.
- **Relations.** Stored on the source only: `parent` (scalar), `fixes`, `blocked_by`, `relates` (lists). Reverse lookups come from the index. A new relation kind is a new list key, registered in a per-repo `docs/items/_schema` or in the `bl` defaults.
- **Rank.** A fractional key (LexoRank style), so re-ranking edits one file.

**Local state, outside the committed items:**

- **Index:** `.bl/index.sqlite`, gitignored, rebuilt when file hashes or mtimes change.
- **Claims:** `<git-common-dir>/bl-claims.json`.
- **Optional, only if analytics are needed later:** a committed `docs/items/_events.jsonl` with `merge=union`.

### What to build first

1. **Write the one-page spec** above: grammar, key order, enums, relation keys and `check` rules. Decide the type and relation vocabulary once, for every repo.
2. **Build a shared `bl` core package**, lifted from `<game-repo>/tools/portal`:
   - Keep the hash-checked atomic write path from `src/storage/documents.mjs`.
   - Replace the single-file span patcher with a strict frontmatter parser and serializer. Small per-item files make full rewrites safe, as long as key order is preserved byte-for-byte.
   - Drop `status.mjs`'s prose-wording heuristics and the register-reconciliation code.
3. **Build the `bl` CLI** with `add`, `set`, `link`, `list` (compact rows and `--json`), `show`, `check` and `index`. `check` runs in each repo's test tier and as a hard pre-push gate. One line of agent instruction says: "change items through `bl`; list through `bl list`."
4. **Migrate the first adopter repo first** with a deterministic importer: register priority wins, done shards become `status: done`, IDs are preserved. Then write the shape 1 importer, which covers about 18 repos, then the remaining shapes.
5. **Adapt the global viewer** to read each repo's `docs/items/` through the core package, show the kanban from `status`, edit only through `bl`'s write path (hash check, 409 on a stale write), and overlay claims and worktree status read-only.
6. **Measure for two weeks:** merge conflicts on `docs/items/`, `bl check` failures and hand-edit rate. Add the field-level merge driver only if conflicts are real.

## Open questions and what would resolve them

- **How often do parallel worktree agents touch the *same* item?** Conflict logging after rollout. This decides whether the merge driver is worth building.
- **Will agents hand-edit frontmatter and break it despite `bl`?** Track the `bl check` failure rate. If it's high, consider whether the header-line grammar would have fared better; the trade-off flips only if YAML breakage clearly outweighs the merge cost.
- **Is status-history analytics a real need?** If yes, add the union-merged `_events.jsonl`.
- **Cross-machine or Codex-cloud in-work visibility.** Unsolved by design and accepted for a solo developer. If it starts to hurt, a pushed claims ref (git-bug style) is the next step.
- **Untested:** none of these was run against real git or real agents.
  - adjacent-key merge behaviour (it rests on the xmerge.c source);
  - the `ort` strategy, which shares xdiff and is expected to behave the same;
  - token costs;
  - the cost of scanning worktrees.

## Sources

**Web (fetched 2026-10-04 unless dated):**
- git xdiff merge source: https://raw.githubusercontent.com/git/git/master/xdiff/xmerge.c
- gitattributes (merge drivers, union): https://git-scm.com/docs/gitattributes
- git-blame: https://git-scm.com/docs/git-blame
- Peff on adjacent-change conflicts (2015-04): https://lore.kernel.ime.usp.br/git/20150429023509.GB438@peff.net/
- jgit adjacent modifications: https://gerrit.googlesource.com/jgit/+/99771f04bcb6b1a79d4b9c5edff21c994104f8da
- GitLab changelog conflicts, about 90% fewer (2015): https://about.gitlab.com/blog/gitlab-reduced-merge-conflicts-by-90-percent-with-changelog-placeholders/
- Backlog.md repo: https://github.com/MrLesk/Backlog.md
- Backlog.md serializer: https://raw.githubusercontent.com/MrLesk/Backlog.md/main/src/markdown/serializer.ts
- Backlog.md backlog tree: https://github.com/MrLesk/Backlog.md/tree/main/backlog
- Backlog.md ADVANCED-CONFIG: https://raw.githubusercontent.com/MrLesk/Backlog.md/main/ADVANCED-CONFIG.md
- Backlog.md v1.50.1 notes (2026-09): https://newreleases.io/project/github/MrLesk/Backlog.md/release/v1.50.1
- Backlog.md BACK-682 (2026-09-02): https://raw.githubusercontent.com/MrLesk/Backlog.md/main/backlog/tasks/back-682%20-%20Make-frontmatter-preprocessing-robust-to-valid-YAML-shapes.md
- Backlog.md BACK-548: https://raw.githubusercontent.com/MrLesk/Backlog.md/main/backlog/tasks/back-548%20-%20Expose-bidirectional-dependency-graphs-in-task-details.md
- beads v0.24.3 (hash IDs, `bd merge` driver): https://pkg.go.dev/github.com/steveyegge/beads@v0.24.3
- beads git-integration (2026): https://beads.gascity.com/reference/git-integration.md
- beads sync-concepts: https://beads.gascity.com/core-concepts/sync-concepts.md
- gascity beads vs br (reviewed 2026-08-07): https://gascity.com/guide/beads-vs-br/
- DoltHub, Restoring beads classic (2026-04-02): https://www.dolthub.com/blog/2026-04-02-restoring-beads-classic/
- git-bug data model: https://github.com/git-bug/git-bug/blob/master/doc/design/data-model.md
- Fossil tickets: https://fossil-scm.org/home/doc/trunk/www/tickets.wiki
- SQLite foreign keys: https://sqlite.org/foreignkeys.html
- Obsidian Bases syntax: https://obsidian.md/help/bases/syntax
- todo.txt: https://github.com/todotxt/todo.txt
- Aider, code in JSON (2024-08-14): https://aider.chat/2024/08/14/code-in-json.html
- Let Me Speak Freely (arXiv 2408.02442, 2024-10): https://arxiv.org/abs/2408.02442
- claudeissues #4700 (YAML frontmatter, anecdotal): https://claudeissues.com/issue/4700-agent-yaml-parsing-fails-with-valid-line-breaks-in-frontmatter

**Code references:**
- `<game-repo>/tools/portal/README.md:187-192` (`events.jsonl` is the Claude review queue)
- `<game-repo>/tools/portal/src/storage/state.mjs:1-2,16-20` (per-checkout state in %LOCALAPPDATA%)
- `<game-repo>/tools/portal/src/backlog/patch.mjs:22` (random ID generation)
- `<game-repo>/tools/portal/src/backlog/parse.mjs:18` (ID validation)
- `<game-repo>/tools/portal/src/backlog/status.mjs:4-12` (prose status heuristics, which v1 removes)
- `<game-repo>/tools/portal/src/storage/documents.mjs` (hash-checked atomic writes, which v1 reuses)
- `<harness>/hooks/structure/internals/filetypes.js:14-17` (no `md` in `CODE_EXT`)
- `<harness>/hooks/structure/internals/placement.js:158,179` (fan-out counts code only)
