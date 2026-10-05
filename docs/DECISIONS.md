# DECISIONS

ADRs, newest first. ADRs 01-18 are dated 2026-10-04 (inception); ADRs 19-28 are 2026-10-05.
Evidence paths are relative to `docs/research/`.

## ADR-28: Managed, versioned agent snippet and a tool-neutral guide

- **Context:** The 0.5 snippet was an unmarked block detected by its heading: it could not be upgraded, and
  it carried all agent guidance inline in two instruction files.
- **Decision:** `init` writes a short block between `<!-- docket:agent-snippet begin v2 -->` and `end`
  markers into both CLAUDE.md and AGENTS.md (creating either), and re-running upgrades it in place. Only an
  older managed block or the exact pre-0.6 unmarked text is migrated; line endings and surrounding bytes
  stay. Duplicate or incomplete markers and a customised `## Work items (Docket)` section are reported
  "needs manual review", untouched, never given a second block. The full guide ships as
  `docs/AGENT-GUIDE.md`, tool-neutral, printed by `docket guide`; the snippet points at it.
- **Rejected:** rewriting customised sections (destroys owner edits); heading-only detection (cannot tell
  versions apart); an agent-specific guide (Docket serves any agent).
- **Evidence:** `tests/integration` init and snippet cases; owner ruling 2026-10-05.

## ADR-27: Independent content mutations; body writes are allowed

- **Context:** Facts and notes change for different reasons and by different people; one whole-file save
  would let one overwrite the other.
- **Decision:** Body replacement, note append and note resolve are separate revision-checked writes. Each
  touches only its own bytes: frontmatter, title and untouched content stay verbatim, through a
  preserved-prefix transaction path. Settling a note is two writes, save the facts then resolve, so an
  interruption leaves the note open. The CLI and viewer share the operations; the viewer gains body and
  note endpoints, so documents stay read-only but item bodies are editable. This supersedes ADR-25's
  body restriction.
- **Rejected:** one combined save (hides which part conflicted); resolve copying text into the body
  (invents facts); body editing without `--expect` (silent overwrite).
- **Evidence:** `tests/unit/core`, `tests/unit/viewer` and `tests/e2e` content cases.

## ADR-26: Facts and discussion are separate: item body versus Notes

- **Context:** Agents read item text as instructions. Mixing owner discussion into the body let a stray
  comment pass as a fact.
- **Decision:** The body is authoritative facts. An optional final `## Notes` section holds notes
  (`### <UTC ms timestamp ref> · open|resolved · owner|agent`): untrusted discussion, never facts,
  instructions or authorization. Those lines are reserved and validated (check group 10, also on pushed
  tips). This refines ADR-16: the body is still free Markdown except the Notes grammar.
- **Rejected:** a sidecar notes file (splits one item across files and merges); free-form comments in the
  body (no trust boundary); editable or deletable notes (history).
- **Evidence:** `research/ITEM-SPEC.md` amendment 2026-10-05; `tests/unit/format/content.test.mjs`.

## ADR-25: Documents and item bodies are read-only in the viewer (Superseded in part by ADR-27)

- **Context:** The viewer could edit more than the CLI exposes, and Markdown editing needs merge, draft
  and sanitization rules the format does not give.
- **Decision:** No document-write or body-write endpoint exists. Living docs render read-only (a per-repo
  override wins, then the repo root, then `docs/`). Only title, status, priority and relations are
  editable, all through the core operations the CLI uses.
- **Rejected:** a Markdown body editor (re-opens body-byte guarantees); document editing (any write path
  to arbitrary repo files).
- **Evidence:** owner ruling 2026-10-05 (`plans/PLAN-VIEWER.md` section 7); `tests/unit/viewer/` route tests.

## ADR-24: Relation actions are single-edge and revision-checked inside the lock

- **Context:** A form that saved scalars and relations together could overwrite a concurrent edit, and
  `link` can write a second file (a relation stored on the other side).
- **Decision:** Scalar Save (title, status, priority) is separate from single-edge relation actions. Each
  request carries the revisions it read: the item, plus every relation holder it will touch (including
  reverse-stored `relates`). Core asserts them inside the lock, before planning, also for no-ops. A 409 is
  never retried automatically and keeps the browser draft. The CLI's `--expect` shares the same checks.
- **Rejected:** one combined save (hides which edge conflicted); asserting outside the lock (race);
  auto-retry (silently overwrites).
- **Evidence:** `core/items/revisions.mjs`; `tests/unit/core` and `tests/unit/viewer` conflict cases.

## ADR-23: Native-module viewer, lazy sanitized Markdown

- **Context:** The viewer ships in the same tarball the pre-push gate promotes, so UI dependencies must
  not reach the checker.
- **Decision:** Server on `node:http`, UI as native ES modules; no framework, bundler or build step.
  Markdown uses `marked` then `sanitize-html` with a strict allowlist (no scripts, styles, forms, event
  handlers or remote images). Both are imported dynamically inside `docket serve` only, so the CLI and
  the gate never load them.
- **Rejected:** a framework or bundler (a build in the gate path); client-side rendering of raw Markdown;
  a denylist sanitizer.
- **Evidence:** `tests/unit/viewer/` sanitization cases; packaging test imports the gate without them.

## ADR-22: One logical repo per Git common dir; the overview counts the preferred checkout

- **Context:** Linked worktrees of one clone repeat the same items. Counting each would inflate totals,
  and falling back to another branch would show wrong work.
- **Decision:** The registry groups checkouts by canonical Git common directory: linked worktrees join a
  group, independent clones stay separate. Overview and search read one preferred checkout per group,
  never failing over silently when it disappears (it reports unavailable). Editing needs an explicit
  checkout selection.
- **Rejected:** counting every worktree; automatic failover to any available checkout; one entry per path.
- **Evidence:** owner ruling 2026-10-05; `tests/unit/state/registry/` grouping cases.

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
- **Evidence:** `tests/unit/core/conformance.test.mjs` pins this and every other prototype difference.

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

> ADRs 13 and 14 (Node 22, CLI output contract) moved to `records/decisions/2026-10.md`.

> ADRs 07-12 moved to `records/decisions/2026-10.md`.
