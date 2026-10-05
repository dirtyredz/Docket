# Markdown vs database as the source of truth for project docs and backlogs

*Research director report, 2026-10-04. Adversarial investigation: an optimist and a pessimist researcher, two rounds each, plus my own spot-checks of the first adopter repo repo.*

## Question and decision at stake

The owner is a solo developer running Claude Code and Codex agents across about 15 independent repos. The question is what the global docs/backlog viewer and editor should treat as the source of truth.

**Option A, the proposition:**
- Per-repo markdown is the source of truth, with a loose doc-set convention.
- The viewer handles structure, and falls back to raw markdown when it can't parse.
- Only BACKLOG.md gets a strict format, one item per line.
- A rebuildable SQLite index is optional and gitignored.

**Option B, the alternative:** a per-project SQLite, JSONL or ticket database as the source of truth, with a schema.

**Hard constraint:** no central database. State lives in each repo and travels with it in git.

**The decision this feeds:** which storage model to build on, and what to build first. A single-project version already exists in the first adopter repo (`tools/portal`).

## Bottom line

**Adopt Option A, with three amendments the evidence forces. Confidence: High.**

The storage format turned out not to be the real dispute. By round 2 the pessimist had conceded:
- the token argument;
- the concurrency race, now rated minor;
- the beads precedent, which turns out to favour files plus a local index at solo scale;
- the first adopter repo drift, which comes from duplicated fields, not from markdown.

That left one disagreement: **how writes are controlled.** The surviving risk is agents hand-editing a structured markdown file until it drifts from the format. A database does not solve that; a validating write path does. The three amendments:

1. **Every field has exactly one home.** Today the first adopter repo stores priority in the register row, in a P-heading in the shard, and in the entry's prose, and titles are copied between register and entry. That duplication is the cause of the drift observed. The new BACKLOG format should keep each field in one place, with no register table repeating entry fields.
2. **"One item per line" means one *header line* per item with a fixed field grammar, plus an optional indented free-prose body.** the first adopter repo's real entries are multi-paragraph narratives (`docs/work/backlog/open/engineering.md:11-29`). A strictly one-line format would be ignored, as it already has been.
3. **Structured writes go through one shared, validating tool.** That means a small `bl` CLI plus the viewer, both using the same parser and serializer. A lint check runs in every repo's test tier and pre-push hook. Hand edits become a fallback that the lint catches, not the normal path. Agents keep to a format when a checker enforces it, and drift where nothing does. the first adopter repo shows both: every entry carries its enforced bl-id marker, while priority and title, which nothing checks, drifted.

## The case for (claims that survived scrutiny)

1. **Agentic search with grep and glob is Anthropic's documented approach, and the Claude Code team measured it beating a vector database.**
   - Anthropic says Claude Code uses glob and grep "to retrieve files just-in-time, effectively bypassing the issues of stale indexing" ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), 2025-09-29, primary).
   - Boris Cherny reported that agentic search "outperformed everything else by a lot" after the team dropped a local vector database ([smartscope summary](https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/), secondary). He admitted the evidence was partly "vibes" plus internal benchmarks, so I rate this medium.
2. **Anthropic's own memory tool is a directory of files edited with view, str_replace and insert.** Bloat is handled by capping file sizes and paging long files, not by a schema ([memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), current, primary).
3. **Native file tools cost no extra tokens; MCP-exposed stores do.**
   - Anthropic measured about 55K tokens of tool definitions for 5 MCP servers ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), 2025-11-24, primary).
   - Calling tools through code instead of direct MCP calls cut one workflow from 150K to 2K tokens ([Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), 2025-11-04, primary).
   - A CLI keeps most of that saving, so write tooling should be a CLI, not an MCP server. Scalekit's benchmark found CLI calls used 4 to 32 times fewer tokens, with 100% success against MCP's 72%. That benchmark is secondary and vendor-adjacent, so treat it as directional.
4. **At backlog scale, a database query gives no token advantage.** The pessimist found no evidence that queries beat grep on tens to hundreds of one-line items, and conceded the point. Cross-repo joins and sorts, such as "all P1s across 15 repos by age," are exactly what the optional derived index is for.
5. **Prior art keeps landing on markdown as the truth, with a derived index or UI on top.**
   - Google's Open Knowledge Format (2026-06): markdown with YAML frontmatter and a per-folder `index.md`, with one required field (`type`) ([GitBook](https://www.gitbook.com/blog/what-is-okf-open-knowledge-format)).
   - Backlog.md: markdown tasks with a CLI, web Kanban and MCP, about 6.9k stars. Its own advice is to "prefer Backlog.md commands … over hand-editing" ([github.com/MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md), primary).
   - Obsidian Dataview: a derived query index over markdown.
   - AGENTS.md for Codex.
6. **The beads history supports Option A at solo scale.**
   - Beads moved to Dolt to grow "another order of magnitude" for Gastown and its thousands of agents.
   - The same DoltHub post admits the move "added friction for solo Beads users" ([Restoring beads classic](https://www.dolthub.com/blog/2026-04-02-restoring-beads-classic/), 2026-04-02, primary).
   - The fork `beads_rust`/`br` deliberately freezes the classic design: a file in git plus a local SQLite index, with no daemon ([gascity](https://gascity.com/guide/beads-vs-br/)).
   - Beads' core failure was **two writable copies of the data** (SQLite and JSONL) drifting apart. Option A avoids that by having one source of truth and a disposable index.
7. **The approach already works in the first adopter repo.**
   - The portal is markdown-authoritative, with hash-checked saves that return 409 on a stale write, narrow span patches that never re-serialize the file, atomic temp-file-and-rename writes, and a byte-checked deterministic migration (`the first adopter repo/tools/portal/README.md:9-14, 119-185`).
   - Measured size, excluding `node_modules`: about 50 files and 7,060 lines. Backlog code is about 1,470 lines, roughly half of `src/`. The pessimist's "about 100 files" figure included dependencies.

## The case against (claims that survived scrutiny)

1. **Parse fidelity under unrestricted writes. Severity: serious without enforcement, minor with it.**
   - the first adopter repo's grammar already needs paragraph-long rules: lazy continuation, a bold-lead exception, and five different "done" wordings (`tools/portal/README.md:110-133`).
   - Those rules exist because outside edits keep making entries parse differently than intended.
   - Across 15 repos, any repo where agents edit BACKLOG.md directly will drift. The viewer then quietly misparses or falls back to raw markdown, which *hides* the breakage instead of showing it.
   - This is the strongest surviving objection, and it drives amendment 3.
2. **Fields drift when duplicated or unenforced. Severity: serious, but a design flaw that can be fixed.**
   - Verified: bl-8e1d4c2a sits under a P1 heading in its shard while its prose and register row (`docs/BACKLOG.md:242`) say P2.
   - Titles differ between the register and the entry (also bl-640de104 at `BACKLOG.md:252` against `engineering.md:18`).
   - The README says the register row wins (README.md:120-124), so this is cosmetic rather than data loss. It is still a real signal.
3. **The "loose convention" is a schema in all but name.** The owner's line that "a database is a contract with the schema" applies to markdown too, just with weaker enforcement. Option A only honestly *rejects* a schema for the prose docs. For BACKLOG it chooses a schema enforced by a parser and lint instead of a database engine. That is the right trade, but it should be named that way.
4. **Structured metadata works better as key-value fields than as inline prose syntax. Severity: minor.**
   - Datacore makes inline fields opt-in because they parse slowly, and Obsidian's own Bases feature reads only YAML frontmatter ([obsidian.rocks](https://obsidian.rocks/dataview-vs-datacore-vs-obsidian-bases/), secondary).
   - If the header grammar grows beyond a few tokens, move to a `key:value` tail or frontmatter rather than adding more bold-lead rules.
5. **The write race cannot be fully closed. Severity: minor.** `src/storage/documents.mjs:4-5, 54-67` admits there is a window of milliseconds between the hash check and the rename. For one developer with mostly sequential agents that is near zero, and no in-git store fixes it anyway: agents can bypass any store that isn't opaque.

## Genuine conflicts and how I weighed them

| Conflict | Outcome | Why |
|---|---|---|
| Does the first adopter repo drift indict markdown? | **No. It indicts duplicated fields.** | I checked it myself: README:120-124 declares the register row authoritative and the prose priority historical. A denormalized database index would drift the same way. The pessimist conceded in round 2. |
| Beads moved to Dolt. Is that evidence for a database? | **Not at this scale. It is weak evidence for Option A.** | The stated reason was multi-agent scale. The maintainers acknowledged that solo users found Dolt heavy, and solo users created a fork that keeps the file-in-git design. The optimist fairly notes that the maintainers still answered with *embedded* Dolt, not files. |
| A database gives better token efficiency? | **No difference at backlog scale.** | Neither side found a benchmark. Grep over one-line headers returns about what a query returns. Token cost is driven by how much reaches the context window, not by the store. The real token lever is CLI over MCP, which is independent of storage. |
| A validating CLI vs hand-editing md | **Not a conflict once examined. Both sides end at "md as truth, writes through a validating tool."** | The pessimist said plainly that the only real difference from Option A is a tool-mediated write path plus a lint rejecting hand edits. The optimist accepted that as the best form of Option A. |
| Does a database prevent bloat? | **No. Size discipline does.** | the first adopter repo's 290 KB files came from append-only habits. A schema with a `notes TEXT` column bloats just the same, which both sides granted. A schema *can* cap field lengths. A size lint (the first adopter repo's `check.mjs` `DOC_SIZE`) does the same job for markdown. |

## Where each side overreached

- **Optimist:**
  - Cherny's RAG-versus-grep result is code-specific and partly "vibes." It does not show that grep wins over the first adopter repo's 7.6 MB of prose in `research/`, which is where embeddings could actually help.
  - The estimate that a single-home grammar parser is "well under 371 lines" is unmeasured.
  - Treating OKF as validation hides that OKF *requires* structured frontmatter. It is markdown plus a minimum schema, not loose markdown.
- **Pessimist:**
  - "About 100 files" counted `node_modules`.
  - "Three priorities" read the documented historical-priority prose as a contradiction.
  - Calling the race dealbreaker-class (later withdrawn) ignored that no in-git store fixes it.
  - The claim of "15 parsers" assumed per-repo formats. With one shared BACKLOG grammar and read-only raw markdown for everything else, the count is 2: one grammar parser and one generic renderer.
  - The Edit-tool multi-line bug evidence comes from issue trackers. Header-line edits through a CLI avoid it anyway.

## Interaction with the token and bloat concern (kept separate, as asked)

Storage choice barely affects token use. What matters:
1. Auto-loaded context, meaning CLAUDE.md and the memory index, is fixed by the planned slimming work, not by storage.
2. Size caps and the split between records and maps stop append-only growth, whichever store is used.
3. Returning narrow results: header-line grep, `bl list --pri P1` printing `id|pri|title` rows, and never reading the whole `research/` folder.

A database would move the bloat into rows rather than remove it. Embeddings (for example a local ChromaDB) are a reasonable *optional derived index* for the first adopter repo's `research/` prose later. They should not be the source of truth, and they are not needed for backlogs.

## Recommendation and first build step

**Build order:**
1. **Write the BACKLOG grammar spec first, one page, single-home fields.** For example:
   ```
   - [ ] P2 bl-8e1d4c2a eng Shipping target does not compile @2026-09-29 #release
     optional indented body: free prose that never restates fields
   ```
   - One `BACKLOG.md` per repo.
   - The order of lines within the file is the rank.
   - No register table, and no priority headings repeating the field.
   - Done items are `[x]` or move to a `## Done` section.
   - Bodies are free text.
   - Extension fields go in a `key:value` tail.
2. **Extract one shared package** from the first adopter repo's portal. It holds the parser and serializer for that grammar, byte-stable span patching, hash-checked atomic writes, and a lint (`bl check`). The pieces to lift are `parse.mjs`, `patch.mjs` and the `documents.mjs` write path. Drop the register/shard reconciliation (`migrate.mjs`, `diff.mjs`).
3. **Put a thin `bl` CLI on that package** (`add`, `set`, `done`, `list`, `check`). This is the agent write path for both Claude Code and Codex: shell calls, with no MCP overhead.
4. **Run `bl check` in each repo's test tier and pre-push hook.** One line of agent instruction says: "edit the backlog through `bl`."
5. **Migrate the first adopter repo first.** Use a deterministic, byte-checked script, as the portal's existing migration does. the first adopter repo has more than 240 rows and is the hardest case. Then migrate the other repos.
6. **Then build the global viewer.** It reads a list of repos, renders the backlog through the shared package, and renders all other docs as read-only raw markdown via markdown-it, which removes the parse-and-write-back risk for free-form docs. Show an unparsed or invalid badge instead of silently falling back.
7. **Later, only if needed:** a gitignored SQLite index for cross-repo sort and filter, and optionally embeddings over `research/`.

**Do not** make the viewer write back to free-form docs in v1. **Do not** build an MCP server for the backlog; a CLI is cheaper and more reliable.

## Open questions and what would resolve them

- **How often do two agents edit one backlog at the same time in this workflow?** Logging write collisions (409s) for two weeks would answer it. If it becomes common, for example with parallel worktree agents, the case for a transactional store such as embedded Dolt strengthens.
- **Will agents actually use `bl` rather than hand-editing?** Measure `bl check` failure rates after rollout.
- **Grep vs CLI token cost on real backlogs.** No benchmark exists. A one-hour measurement on the first adopter repo after migration would close it.
- **Whether the header grammar stays small.** If it grows past about 6 tokens, switch to frontmatter or one file per item, as Backlog.md does.
- **The other 14 repos' current backlog shapes** were not surveyed. Migration effort is unknown.
- I did not see the source Reddit thread myself. Its counterpoints were assessed from the brief.

## Sources

**Web:**
- Anthropic, Effective context engineering for AI agents (2025-09-29): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, Code execution with MCP (2025-11-04): https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic, Advanced tool use (2025-11-24): https://www.anthropic.com/engineering/advanced-tool-use
- Claude memory tool docs (current 2026-10): https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- smartscope, RAG vs agentic search (2026): https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/
- OfficeChai, Cherny on agentic search (2025): https://officechai.com/ai/claude-researcher-explains-how-agentic-search-performed-better-than-rag-for-code-generation/
- DoltHub, Restoring beads classic (2026-04-02): https://www.dolthub.com/blog/2026-04-02-restoring-beads-classic/
- DoltHub, A day in Gas Town (2026-01-15): https://dolthub.com/blog/2026-01-15-a-day-in-gas-town
- steveyegge/beads (fetched 2026-10-04): https://github.com/steveyegge/beads
- Yegge, Introducing beads (2025-10): https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a
- beads Dolt architecture: https://beads.gascity.com/architecture/dolt
- gascity, beads vs br (2026): https://gascity.com/guide/beads-vs-br/
- MrLesk/Backlog.md (fetched 2026-10-04): https://github.com/MrLesk/Backlog.md
- Backlog.md v1.50.0 release notes (2026): https://newreleases.io/project/github/MrLesk/Backlog.md/release/v1.50.0
- GitBook, What is OKF (2026): https://www.gitbook.com/blog/what-is-okf-open-knowledge-format
- the-decoder, Google OKF (2026-06): https://the-decoder.com/google-clouds-open-knowledge-format-turns-scattered-docs-into-markdown-files-for-ai-agents/
- Obsidian Dataview docs: https://blacksmithgu.github.io/obsidian-dataview/
- obsidian.rocks, Dataview vs Datacore vs Bases (2025): https://obsidian.rocks/dataview-vs-datacore-vs-obsidian-bases/
- OpenAI Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- Simon Willison, Tracking SQLite changes in git (2023-11-01): https://simonwillison.net/2023/Nov/1/tracking-sqlite-database-changes-in-git/
- git-bug: https://github.com/git-bug/git-bug
- MCP vs CLI benchmark (2026, vendor-adjacent): https://kaxil.substack.com/p/mcp-vs-cli-vs-rest
- Claude Code Edit-tool issues (2026, anecdotal): https://claudeissues.com/issue/78076-edit-tool-false-string-not-found-in-file-for-multi-line-old-string-byte-identica

**Code references (the first adopter repo):**
- `<game-repo>/tools/portal/README.md:9-14` (markdown authoritative)
- `<game-repo>/tools/portal/README.md:110-133` (parse rules)
- `<game-repo>/tools/portal/README.md:120-124` (register authoritative for priority)
- `<game-repo>/tools/portal/README.md:166-185` (migration)
- `<game-repo>/docs/BACKLOG.md:242`, `:252` (register rows that drifted)
- `<game-repo>/docs/work/backlog/open/engineering.md:8-29` (P-heading, multi-paragraph entries)
- `<game-repo>/tools/portal/src/backlog/parse.mjs:1-11` (never re-serialize)
- `<game-repo>/tools/portal/src/storage/documents.mjs:4-5, 54-67` (race window)
- `<game-repo>/tools/documentation/check.mjs` (DOC_SIZE lint)
