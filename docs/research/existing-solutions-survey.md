# Existing-solutions survey: adopt or adapt, vs. build `bl` plus a global viewer

*Research director synthesis, 2026-10-04. Adversarial method: an optimist and a pessimist researcher ran in round 1, and the director spot-checked the decisive Backlog.md issues. Round 2 was skipped because the two sides converged on the ranking and on the hybrid shape. What remains open is empirical and needs a hands-on test, not more research (see Open questions).*

---

## Question and decision at stake

**Question:** Does an existing tool already cover the owner's need well enough to adopt or adapt, instead of building a `bl` CLI plus a global viewer on the first adopter repo portal code?

**The need:**
- About 30 independent git repos, each with a living markdown doc set: STRUCTURE, ARCHITECTURE, DECISIONS, FEATURES, ROADMAP, BACKLOG, GOTCHAS.
- A global viewer and editor across all of them.
- A backlog with a status workflow (kanban) and relations: blocks, parent/child, and bugs attached to features.

**Hard constraints:** no central database; state lives in the repo and travels with git; cheap for agents to read and write; works on Windows 11; free.

**Decision:** adopt X, borrow X's format, or build from scratch. Plus what to try first in under a day.

## Bottom line (confidence: Medium-High)

**No existing tool meets the need on its own.**
- **The global, cross-repo viewer doesn't exist anywhere.** Every tool that keeps state in files inside the repo is scoped to one repo. Their "multi-project" features route work within one workspace; they are not dashboards across 30 repos.
- **No candidate covers the free-form doc set.** STRUCTURE, ARCHITECTURE and GOTCHAS are outside every tracker's model.

**Building everything from scratch is also not justified.**
- Backlog.md (MIT, ~6.9k stars, very active, Windows-supported) already provides most of the per-repo layer: one markdown task file per item with YAML frontmatter, configurable statuses, dependencies, parent/subtasks, `type`, a per-repo web kanban, a CLI with paging and JSON output, and an MCP server.
- wedow/ticket (`tk`) has a nearly identical frontmatter vocabulary.

**Recommendation: hybrid.**
1. **Borrow the per-item format** (Backlog.md-compatible frontmatter, one file per item).
2. **Optionally adopt Backlog.md's CLI and MCP** for agents in repos without parallel worktrees.
3. **Build only the global viewer**, a read-mostly aggregator across repos, reusing the first adopter repo portal's conflict-checked atomic writes and its post-edit re-parse check.
4. **Do not use Obsidian as the primary global editor.** It is fine as an optional read view.

The confidence is not High because two things are still untested: Backlog.md's ID behaviour with parallel agents in this owner's workflow, and how Obsidian rewrites frontmatter.

## Ranked shortlist (fit against the hard constraints)

These are director scores, reconciled from both sides; their raw scores are in brackets (optimist / pessimist).

| # | Option | Fit /10 | Why |
|---|---|---|---|
| 1 | **Hybrid: Backlog.md-format files per repo + a custom global viewer (reusing portal write/verify code)** | **8.5** | Meets every hard constraint. The only thing built is the part nobody offers. |
| 2 | **Backlog.md as is** | **7** (7/7) | Plain markdown in the repo, CLI, MCP, kanban, relations, Windows OK. Against it: no cross-repo view, sequential IDs that collide across branches, the MCP ignores worktrees, and it wants its own folder layout. |
| 3 | **Build everything (`bl` + viewer from scratch)** | **6.5** | Meets every constraint and fits the doc set exactly. Against it: roughly 3-4.5k lines, and the owner maintains it alone forever. Most of the portal's parser is first-adopter-specific and would be rewritten, not lifted. |
| 4 | **Backlog.md + Obsidian (Bases kanban) as the global viewer** | **6** (8/4) | Obsidian is free, one window, covers the free-form docs too. Against it: Obsidian warns against symlinks and junctions, a vault rooted at `projects\` indexes node_modules and the UE folders, native Bases kanban is early access in 1.14, and frontmatter rewriting is untested. |
| 5 | **tk / ticket (wedow)** | 5 | Ideal frontmatter vocabulary (statuses, deps with cycle detection, parent, links, type). But it's a POSIX bash script (Git Bash or WSL on Windows), with no UI and one repo at a time. ~905 stars. |
| 5 | **beads_rust (`br`)** | 5 | JSONL in git plus a rebuildable SQLite index, rich dependency types, cross-workspace routing. But Windows means WSL or Scoop, the author doesn't accept contributions, JSONL isn't a doc format, there's no UI, and nothing for docs. |
| 7 | **beans (hmans)** | 4-5 | Markdown in `.beans/`, a terminal UI and GraphQL queries. Self-described as unstable, Windows unknown, no MCP, no cross-repo view. |
| 8 | **beads (`bd`)** | 3 | Best relation model. But the source of truth is Dolt under `refs/dolt/data`, so it doesn't travel with code branches. 962 open issues, ~129 matching "windows", and Windows memory exhaustion on dolt push/pull (#7082). A release was retracted. |
| 8 | **task-master-ai** | 3 | Single JSON store (`.taskmaster/`) per project. MIT plus Commons Clause. MCP tools cost ~5-21k tokens. Nothing for docs. |
| 8 | **git-bug** | 3 | In the repo, but as git objects that grep and Read can't see. Only open and closed statuses, no relations. |
| 11 | todo.txt / org-mode | 2 | todo.txt has no relations; org-mode effectively needs Emacs. |
| 11 | Taskwarrior 3 | 2 | Central `~/.task` SQLite by default; a per-repo copy means a binary database in git. |
| 13 | GitHub Issues/Projects, Linear, Plane, Fossil tickets, Shrimp MCP | 1 | Central database, Fossil instead of git, or a global data directory plus WSL2. These break the hard constraint. |
| n/a | **Google Open Knowledge Format (OKF)** | n/a | **Real.** v0.1 came out 2026-06-12 under Apache 2.0: markdown with YAML, one required `type` field, optional per-folder `index.md` and `log.md`. It's a convention to borrow for the non-task docs, not a tracker. Both sides confirmed it through secondary sources only. |

Not assessed (all recent and small): trackfile, tkr, grite, slips, Claude-Project-Tracker. Logseq, Foam and Dendron were not researched in depth; both sides flagged this gap. None of them meets the agent-CLI or kanban-with-relations need without plugins, so the risk to the verdict is low.

## The case for adopting or adapting (what survived)

- **Backlog.md's data model matches most of the backlog need.**
  - Fields written by the serializer: `id, title, status, assignee, labels, milestone, dependencies, references, documentation, parent_task_id, subtasks, priority, type, ordinal, due_date` (`src/markdown/serializer.ts`).
  - Statuses are configurable.
  - Dependency graphs and readiness arrived in v1.51; paging and `--json` in v1.52 and v1.53.
  - Decisions are separate dated files.
  - One file per task means parallel agents rarely edit the same file.
  - Sources: README, releases, serializer (fetched 2026-10-04).
- **Backlog.md is active and maintained.**
  - v1.53.0 released 2026-09-24, ~1.4k commits, ~60 open issues, issues filed daily.
  - Its Windows bugs are fixed (#936 closed 2026-09-01, #657 closed 2026-05-30). The pessimist conceded the Windows risk is largely disproven.
- **The escape hatch is cheap.** Plain markdown with YAML under MIT. Leaving Backlog.md costs nothing; files stay readable by `cat` and grep. That makes "borrow the format" nearly free even if the tool is dropped later.
- **Building everything gives up the ecosystem.** That means upstream fixes, an MCP the agents already know, and a kanban UI. Both sides agree the files-versus-database debate is settled (markdown is the source of truth, plus a validating CLI), so the real fork is "whose CLI and format", not storage.

## The case against adopting as is (what survived, with severity)

- **No cross-repo view in any candidate.** Severity: **High**; it's half the stated need.
  - Backlog.md's "projects" are a `project:` field inside one backlog (#1005). The multi-project requests (#597, #334) are closed.
  - No community tool aggregates many Backlog.md repos.
- **Sequential IDs collide with parallel agents.** Severity: **Medium-High** for this owner, who runs Claude Code and Codex in parallel worktrees.
  - Director-verified: #711, "Collision-free task ID mode", closed as *not planned*, no visible rationale, 2026-07-01. #1052, "IDs reused after archiving", open since 2026-10-02.
  - Mitigation: because the filename includes the title, two `TASK-3` files from different branches will usually merge without a git conflict. But you then have duplicate IDs, which a lint or wrapper must catch.
- **The MCP server ignores worktrees.** Severity: **Medium**.
  - Director-verified: #1034 (open, 2026-09-21, no maintainer reply). The MCP writes to the main checkout, not the agent's worktree. The optimist cited MCP-roots support (#570, 2026-03-21) as the fix for discovery; #1034 shows it doesn't solve worktrees.
  - Workaround: in worktrees, have agents use the CLI with `--cwd`, not the MCP.
- **Layout and doc-set mismatch.** Severity: **Medium**.
  - Backlog.md wants `backlog/tasks|docs|decisions`. The owner's doc set is single files at fixed paths that the structure-gate hooks look up by basename.
  - Full adoption means restructuring and teaching the hooks a new layout; partial adoption means two homes for project knowledge.
- **It changes fast and breaks things.** Severity: **Low-Medium**. Examples: CLI reads became local-only and config validation fatal in 1.50.x; 1.51 rewrites references on archive. It's a single maintainer, which is offset by MIT and plain files. Release-year metadata was inconsistent in one fetch; probably 2026.
- **No typed "relates-to / duplicates / supersedes".** Severity: **Low**. A bug attached to a feature is a convention (`type: bug` plus `parent_task_id` or `references`), not a dedicated relation.

## Genuine conflicts and how I weighed them

1. **Is Obsidian a viable global viewer?** Optimist yes (8), pessimist no (4). **The pessimist wins on evidence, though not completely.**
   - Obsidian's own help strongly advises against symlinks, citing data loss and indexing staleness.
   - Rooting a vault at `projects\` means indexing UE5 and node_modules; forum reports say exclusions don't stop indexing.
   - Native Bases kanban is early access (Catalyst) in 1.14. The free fallback plugin has ~965 downloads at v1.0.1, and the classic Kanban plugin is seeking maintainers.
   - Backlog.md itself says to prefer the CLI over hand edits, and Obsidian's property editor is a hand edit.
   - These are primary sources (vendor help, changelogs, the tool's README), against an untested optimistic plan.
   - The optimist was right that Obsidian is the only off-the-shelf thing that shows the docs and tasks together, so it stays as an optional read view, not the editor of record.
2. **How serious are Backlog.md's ID and worktree bugs?** Optimist: "unproven." Pessimist: a disqualifier. **Resolved by director spot-check: real, open or closed-not-planned, but containable.** They downgrade Backlog.md from "adopt as is" to "borrow the format, and wrap or replace ID minting", and they argue for using random IDs as the portal already does (`patch.mjs:20-25`).
3. **How much portal code is reusable?** The brief implied a lossless parser ready for reuse. **The pessimist's code reading (with file:line refs) wins.**
   - What carries over: atomic writes, span patching, the post-edit re-parse check, line handling, random IDs, and path containment. About 200-300 lines plus the technique.
   - What doesn't: `parse.mjs` and `patch.mjs` (~865 lines) are bound to the first adopter repo's priority-section, ranking-table and strikethrough format. They would mostly be rewritten.
   - The server is single-repo.
   - So building everything from scratch costs more than "reuse the portal" suggests.

## Where each side overreached

- **The optimist:**
  - Scored Backlog.md + Obsidian at 8 while its own counter-evidence (no switcher, symlink warning, early-access kanban, hand-edit warning) undercut almost every pillar.
  - Treated the MCP's "a single user-scope server covers every repo" as solving the multi-repo question. It covers agents, not a human dashboard, and #1034 shows it fails on worktrees.
  - Rated ID collisions "unproven" when #711 is a maintainer won't-fix.
- **The pessimist:**
  - Was assigned "build everything" but argued itself into the hybrid. That's honest and correct, and it means the pure-build baseline isn't defended even by its advocate.
  - The 3-4.5k-line estimate is unmeasured.
  - The Obsidian node_modules complaints are partly old forum threads.
  - Treated task-master's single-file merge conflicts as fact; they are inferred.
  - tk's POSIX-only status was scored as near-disqualifying, but it doesn't matter if you borrow only the format.
- **Both** leaned on secondary sources for OKF and left Logseq, Foam and Dendron shallow. Neither gap is likely to change the verdict.

## Recommendation

**Borrow, don't build the format; build only the viewer.**

1. **Per-repo format:** one markdown file per backlog item with Backlog.md-compatible YAML frontmatter: `id, title, status, type, priority, parent_task_id, dependencies, references, labels`.
   - Use **random IDs** (`bl-xxxxxx`, as the portal already does) rather than sequential ones, or wrap Backlog.md's ID minting.
   - Decide where items live (for example `docs/backlog/`) and keep `docs/BACKLOG.md` as a generated or hand-written index, so the structure-gate hooks still find it.
   - Leave STRUCTURE, ARCHITECTURE and GOTCHAS unchanged. Add an OKF-style `type:` field only if the viewer needs it.
2. **Agent interface:** try the Backlog.md CLI first. If its config accepts non-sequential IDs, or the duplicates are tolerable with a lint, you get CLI, MCP and per-repo kanban free. Otherwise write a thin `bl` CLI (add / set / status / link / list / check, ~400-600 lines) over the same format.
3. **Global viewer:** build a small local web app that reads a repo registry and aggregates all repos' item files and docs. It provides:
   - a cross-repo kanban,
   - relation display,
   - conflict-checked writes reusing `tools\portal\src\storage\documents.mjs:17-83` and the post-edit re-parse check (`patch.mjs:478-494`).

   Estimated at ~1.5-2.5k lines, versus ~3-4.5k for building everything.
4. **Obsidian:** optional read-only view later, never the write path.

### Try first (under a day)

1. **(1h)** `npm i -g backlog.md`. Run `backlog init` in the first adopter repo plus one small Vite app, with a custom folder (`docs/backlog`) and statuses To Do / In Progress / Done. Have an agent migrate 10 items, including one parent/child pair and one dependency.
2. **(1h) The decisive test.** Run two agents in parallel worktrees that each create tasks, then merge. Check for duplicate IDs and conflicts. Also confirm #1034: create a task through the MCP from inside a worktree and see where it lands.
3. **(30m)** Check whether the Backlog.md config supports a non-sequential ID scheme or a custom prefix per agent. Measure tokens for `task list --json --max-count 20` against `cat` of one file.
4. **(1-2h)** Write a ~100-line Node script that walks a registry of repo paths, parses the frontmatter of every `docs/backlog/**/*.md`, and prints or serves one cross-repo board. This is the seed of the viewer and proves the aggregation is cheap.

**Decision rule after the day:**
- If step 2 shows only duplicate-ID collisions a lint can catch, keep the Backlog.md CLI and build only the viewer.
- If collisions or worktree misrouting cause real damage, drop the Backlog.md tool but keep its format, and write the thin `bl` CLI with random IDs.
- Either way, the format is settled and the viewer is the only real build.

## Open questions and what would resolve them

- **Backlog.md ID behaviour under parallel worktrees** in practice. Resolved by try-first step 2.
- **Whether Backlog.md's config supports random or prefixed IDs.** Resolved by reading the config schema or source.
- **Whether Obsidian frontmatter edits round-trip cleanly** through Backlog.md's parser (quoting, key order). Resolved by a 30-minute test; matters only if Obsidian is used for writes.
- **Real token cost** of the Backlog.md MCP tools versus the CLI versus raw `cat`. Unmeasured by either side.
- **The shape of the existing BACKLOG.md files across ~30 repos.** Unsurveyed; it sets the migration cost.
- **Logseq, Foam and Dendron, and OKF's primary repo.** Not verified in depth; low expected impact.

## Sources (fetched 2026-10-04 unless noted)

**Backlog.md**
- Repo, README, releases: https://github.com/MrLesk/Backlog.md, https://raw.githubusercontent.com/MrLesk/Backlog.md/main/README.md, https://github.com/MrLesk/Backlog.md/releases (v1.50.0 2026-08-09 through v1.53.0 2026-09-24)
- Serializer fields: https://raw.githubusercontent.com/MrLesk/Backlog.md/main/src/markdown/serializer.ts
- Issues, verified by the director:
  - #1034 (open, 2026-09-21) https://github.com/MrLesk/Backlog.md/issues/1034
  - #1052 (open, 2026-10-02) https://github.com/MrLesk/Backlog.md/issues/1052
  - #711 (closed not planned, 2026-07-01) https://github.com/MrLesk/Backlog.md/issues/711
- Issues cited by the researchers: #1005 https://github.com/MrLesk/Backlog.md/issues/1005; #936 and #657 (Windows, closed)

**Other trackers**
- beads: https://github.com/steveyegge/beads, https://github.com/steveyegge/beads/releases (v1.3.1 2026-09-30), https://beads.gascity.com/core-concepts/sync-concepts, https://www.dolthub.com/blog/2026-04-02-restoring-beads-classic/
- beads_rust: https://github.com/Dicklesworthstone/beads_rust
- tk / ticket: https://github.com/wedow/ticket, https://news.ycombinator.com/item?id=46487580
- beans: https://github.com/hmans/beans
- git-bug: https://github.com/git-bug/git-bug
- task-master-ai: https://github.com/eyaltoledano/claude-task-master
- Shrimp: https://github.com/cjo4m06/mcp-shrimp-task-manager
- Taskwarrior 3: https://taskwarrior.org/news/news.20240324/

**Obsidian**
- Help: https://obsidian.md/help/bases/views/kanban, https://obsidian.md/help/symlinks
- Changelogs: https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/, https://obsidian.md/changelog/2026-09-29-desktop-v1.14.3/
- Plugins: https://community.obsidian.md/plugins/bases-kanban, https://github.com/mgmeyers/obsidian-kanban
- Forum: https://forum.obsidian.md/t/ignore-completely-a-folder-from-all-obsidian-indexers-and-parsers/52025, https://forum.obsidian.md/t/obsidian-does-not-respect-windows-file-links-created-using-mklink-on-junction/12958 (2021-era)

**OKF** (secondary sources)
- https://www.gitbook.com/blog/what-is-okf-open-knowledge-format, https://heise.de/-11332310, https://noqta.tn/en/news/google-cloud-open-knowledge-format-okf-ai-agents-2026

**the first adopter repo portal code**
- `<game-repo>/tools/portal/src/storage/documents.mjs:4-5, 17-83` (atomic, hash-checked writes)
- `<game-repo>/tools/portal/src/backlog/patch.mjs:20-25` (random IDs), `:27-50` (span patching), `:478-494` (post-edit re-parse check), `:136-160, 268-310, 403-428` (first-adopter-specific)
- `<game-repo>/tools/portal/src/backlog/parse.mjs:5-11, 33-51, 267-316`
- `<game-repo>/tools/portal/src/backlog/status.mjs:25-37`
- `<game-repo>/tools/portal/src/documents/paths.mjs:52` (single repo)

**Prior research**
- `...\scratchpad\research\markdown-vs-db-project-docs.md:60, 114-132`
