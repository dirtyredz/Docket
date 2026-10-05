# DECISIONS

ADRs, newest first. ADRs 01-18 are dated 2026-10-04 (inception); ADRs 19-21 are 2026-10-05.
Evidence paths are relative to `docs/research/`.

## ADR-21: Batch entries may set historical dates

- **Context:** Moved-in items lost their real dates (everything read as created today), and agents were
  tempted to hand-edit item files to fix it.
- **Decision:** `add --batch` entries may carry `created` and/or `since` (ISO dates): real calendar dates,
  not in the future, `since >= created`; one given fills the other, none keeps today. IDs and ranks stay
  tool-assigned. Single-item `add` has no such flags; `set status` still stamps today.
- **Rejected:** hand-edited dates (re-opens hand-written files); date flags on single `add`.
- **Evidence:** second real move-in batch, 2026-10-05.

## ADR-20: Batch add is the move-in path; every write command can report before it writes

- **Context:** The first real move-in (6 items) needed one process per item, hand-rolled body files and
  guesswork about what `init` and `gate install` changed.
- **Decision:** `dk add --batch <file|->` takes a JSON array, validates every entry (enums, one-line
  title, string fields, no unknown keys) before writing, then goes through the normal transaction, so IDs
  and ranks stay tool-assigned. `init` and `gate install` report created/updated/unchanged per file,
  git config key and hook, and take `--dry-run`. Help is per command, built from the schema enums.
- **Rejected:** letting batch entries carry IDs, ranks or relations (re-opens hand-written identity);
  a separate importer (ADR-19).
- **Evidence:** first move-in report, 2026-10-05.

## ADR-19: Importers removed; init + agent move-in

- **Context:** Docket must be project-agnostic. The first adopter import was byte-verified because it ran once
  against one real backlog; its cutover is done. Other repos have seven different legacy shapes.
- **Decision:** Importer code (`src/importers/`, `docket import`) is deleted. New projects start with
  `docket init`; an existing repo moves in once, through an agent following `docs/MOVE-IN.md` (`dk add`
  and `dk set` per old entry, count check, owner review). `bl-` stays valid as a generic legacy-ID
  prefix. The superseded import ADRs (17, 18) moved to `records/decisions/2026-10.md`.
- **Rejected:** one importer per legacy shape (code to maintain for single-use runs); keeping the
  the first adopter importer as an example (its provenance and journal machinery only served that run).
- **Evidence:** owner ruling 2026-10-05.

> ADRs 17 and 18 (lossless import, resumable apply) moved to `records/decisions/2026-10.md`.

## ADR-16: Grammar strictness applies to the frontmatter; the body is free Markdown

- **Context:** ITEM-SPEC forbids tabs and trailing spaces in the strict YAML subset; the prototype
  applied that to the whole file, which rejects code blocks and Markdown hard line breaks in bodies.
- **Decision:** BOM, invalid UTF-8 and CR are rejected file-wide; tabs and trailing spaces only inside
  the frontmatter. Body bytes are never rewritten.
- **Rejected:** whole-file rule (punishes ordinary Markdown); no file-wide line-ending rule.
- **Evidence:** `tests/core/conformance.test.mjs` pins this and every other prototype difference.

## ADR-15: Gate opt-in is local git config, read by the managed template

- **Context:** M1c needs a per-repo switch in a template shared by every gated repo, and un-opted repos
  must behave exactly as before.
- **Decision:** `docket gate install` writes `docket.gateLauncher` / `docket.gateNode` to the clone's
  local git config (shared by its linked worktrees). The template branches on that key only; without it
  the hook runs its old steps unchanged. The launcher contract (`<entry> --repo <root> --pre-push`,
  refs on stdin) also carried the bootstrap checker, so the template change landed in M0, not M1c.
- **Rejected:** a committed flag in `docket.json` (a fresh clone has no installed gate to run); appending
  a call to installed hooks (hook-sync replaces managed hooks from the template); a Docket-owned
  `core.hooksPath` (clobbers the first adopter's wrapper).
- **Evidence:** `tests/integration/pre-push.test.mjs` "un-opted repos behave exactly as before" runs the
  pre-change template from the harness repo's HEAD against the new one in six scenarios.

## ADR-14: CLI output contract

- **Decision:** `--json` prints exactly one document on stdout, `{ok, command, data, warnings}` or
  `{ok:false, command, error:{code, message, details?}}`, and nothing on stderr. Exit codes: 0 ok,
  1 failed, 2 usage, 3 conflict (revision, lock, claim, existing file), 4 not found, 5 internal. `list`
  is bounded (default 50, max 500) and reports malformed files in `invalid` instead of hiding them.
- **Rejected:** NDJSON streams; warnings on stderr in JSON mode (agents would have to merge streams).

## ADR-13: Run on Node 22 LTS as well as 24

- **Context:** PLAN chose Node 24, but this machine runs Node 22.20 and installing 24 is a system change
  outside the milestone.
- **Decision:** `engines` is `>=22`. Code uses only APIs stable in 22 (`util.parseArgs`, `fs.cpSync`,
  `node --test` with quoted globs). Moving to 24 later needs no code change.
- **Rejected:** requiring Node 24 now (blocks every install on this machine).

## ADR-12: Fix the claims lock race with rename-then-verify

- **Context:** The parallel-claims test lost 1-2 of 40 claims in about 1 run in 5: a waiter judged a
  lock stale from a dead pid, the lock was released and re-taken, and the waiter deleted the new lock.
- **Decision:** A stale lock is renamed aside and deleted only if its content (with a random token)
  matches what was judged; a dead owner counts only after a 1-second grace; release removes only its
  own lock.
- **Evidence:** regression test in `tests/storage/atomic-write.test.mjs`.

## ADR-11: No central database

- **Context:** Several repos, each with its own history; a central store would own data that belongs to
  repos and cannot branch or merge with them.
- **Decision:** Items live only in their owning repo. The registry (`%LOCALAPPDATA%/Docket/`) holds
  paths and aliases, never items; indexes are per checkout.
- **Rejected:** a machine-wide SQLite/server store (loses branch semantics, needs sync); aggregating
  items into one repo.
- **Evidence:** `markdown-vs-db-project-docs.md`, `round2-md-vs-db-workflow.md`.

## ADR-10: the first adopter portal retired at M2

- **Context:** The first adopter backlog portal is the only writable frontend for legacy shards. Owner ruling
  2026-10-04: the portal is not in active use.
- **Decision:** Stop and retire it at the M2b cutover (startup retired, mutation path returns 410),
  before the viewer exists. The CLI is the early usable slice; no second writable frontend.
- **Rejected:** keeping the portal alive until the M4 viewer ships (two writers on one data set).
- **Evidence:** `PLAN.md` sections 2, 3 and 7; owner ruling 2026-10-04.

## ADR-09: Merge driver deferred; log conflicts for two weeks first

- **Context:** Remaining conflicts are same-field edits and concurrent relation-list appends; volume is
  unknown and probably low.
- **Decision:** No custom merge driver. From the first adopter cutover, record real conflicts
  (`docket conflicts`) for two weeks, then decide in `docs/records/conflicts/`.
- **Rejected:** building a field-level driver now (unproven need, installation burden on every clone).
- **Evidence:** `MERGE-TEST-RESULTS.md` implication 4, scenarios c5, g1, g2.

## ADR-08: Last-good gate for self-hosting

- **Context:** Docket validates its own items in pre-push; a broken working tree must not block or
  silently pass pushes.
- **Decision:** Pre-push runs a tested checker promoted into `%LOCALAPPDATA%/Docket/gate/versions/`,
  previous version retained, never a build or working-tree import. A quarantined prototype copy
  bridges M0 to M1b.
- **Rejected:** running the checkout's code in the hook; linking the working tree globally.
- **Evidence:** `PLAN.md` section 3 (M1b, M1c) and section 7.

## ADR-07: `add` assigns ID and rank

- **Context:** In the agent test, hand-written ranks collided immediately; hand-written IDs risk the
  same.
- **Decision:** `docket add` generates the ID (4 random bytes, collision retry) and the end-of-priority
  rank. Agents never supply either; reordering takes relative placement. Duplicate rank stays a
  warning because git cannot catch it.
- **Rejected:** agent-chosen ranks; sequential counters (merge hot spot).
- **Evidence:** `MERGE-TEST-RESULTS.md` implications 5 and 6, scenario i2; `ITEM-SPEC.md` Settled.

> ADRs 01-06 (inception: storage format, naming, CLI vs MCP, index, field order, `add`) moved to `records/decisions/2026-10.md`.
