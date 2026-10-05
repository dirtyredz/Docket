## 1. Goal

Build Docket as a Windows 11 CLI and local viewer/editor over independently versioned, per-repo Markdown items. Deliver a self-hosting CLI and hard validation gate on Docket and the first adopter before building the viewer; keep all indexes rebuildable and all item data inside its owning repo.

## 2. Placement

**Authority and stack.** Docket currently contains only `.git/` and `docs/research/`; no existing application callers or living architecture documents exist. Bootstrap `STRUCTURE.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` before scaffolding.

Use Node 24 LTS, JavaScript ESM (`.mjs`), npm, `node:test`, and a small browser UI using native modules. Package one private npm artifact with `docket` and `dk` pointing to the same CLI entry. Install tested tarballs globally; avoid working-tree links and network-dependent invocation. Node 24 is an LTS release, and npm installs global executables directly into its prefix on Windows. [Node release schedule](https://github.com/nodejs/Release#release-schedule), [npm installation layout](https://docs.npmjs.com/cli/v11/configuring-npm/folders)

Use a CLI with bounded JSON output for agents; no MCP server in this scope. Choose `.docket/index.json` over SQLite initially: it avoids a database dependency at this scale, at the cost of whole-cache replacement and in-memory queries.

**Resolve the stale documentation explicitly.**

- Amend `docs/research/ITEM-SPEC.md` before implementation: new IDs are `dk-<8hex>`; existing the first adopter `bl-<8hex>` IDs remain valid, immutable identities—not aliases requiring another lookup.
- Rename operational paths to `.docket/index.json` and `<git-common-dir>/docket-claims.json`.
- Preserve the final field order: `id, type, created, status, since, area, priority, rank, parent, fixes, blocked_by, relates`.
- Earlier research recommending one shared backlog, another field order, extensible fields, or Backlog.md’s serializer is superseded. Borrow its file-per-item idea, not its sequential IDs or incompatible schema.

**Docket file map.** Brace lists below name individual files, not proposed catch-all modules.

| Paths | Responsibility and reason |
|---|---|
| `package.json`, `package-lock.json` | Package exports, both executable names, pinned dependencies, milestone verification scripts. |
| `.gitignore`, `.gitattributes` | Ignore `.docket/`, `dist/`, dependencies and test artifacts; enforce LF for item Markdown. No merge driver. |
| `README.md`, `CLAUDE.md`, `AGENTS.md` | Installation/commands and short contributor instructions. |
| `STRUCTURE.md`, `docs/{ARCHITECTURE,DECISIONS,FEATURES,ROADMAP,GOTCHAS,BACKLOG}.md` | Living architecture and capability maps. BACKLOG points to items; it does not duplicate their statuses or ranks. |
| `docs/items/<id>.md` | Docket’s own work, beginning in the bootstrap milestone. Flat, permanent paths. |
| `src/bootstrap/{prototype-check,check}.mjs` | Recovered merge-test validator and a bootstrap adapter. Quarantined historical code; never imported by the production core. |
| `src/core/format/{schema,parse,serialize}.mjs` | Schema constants, strict grammar, canonical frontmatter writing with unchanged valid body bytes. |
| `src/core/validation/{items,relations,warnings,check}.mjs` | Local validation, graph integrity, advisory diagnostics, and validation orchestration respectively. |
| `src/core/identity/{id,rank,date}.mjs` | Random identity allocation, fractional ordering, and local-date rules. |
| `src/core/items/{add,set,link,query}.mjs` | Application operations shared by CLI and viewer. No terminal or HTTP dependencies. |
| `src/storage/{revision,atomic-write,lock,item-store}.mjs` | Content revisions, durable replacement, cooperating-process exclusion, and repository item I/O. |
| `src/repository/{context,config,snapshot}.mjs` | Worktree/common-dir discovery, `docket.json`, and reading either working files or an explicit Git tree. |
| `src/index/{build,query}.mjs` | Rebuildable per-worktree cache and reverse relation queries. |
| `src/claims/store.mjs` | Common-dir claims, atomic read-modify-write, expiration and ownership checks. |
| `src/registry/store.mjs` | Per-machine registration of repository paths and document-location overrides. |
| `src/documents/{catalog,render}.mjs` | Discover living docs and render ordinary Markdown read-only. No document-specific semantic parsers. |
| `src/cli/{main,args,output}.mjs` | Dispatch, argument handling and stable human/JSON output contracts. |
| `src/cli/commands/{items,validation,coordination,registry,viewer,migration,gate,conflicts}.mjs` | Thin adapters for the corresponding command families; business rules remain elsewhere. |
| `src/importers/common/{source-map,manifest,apply}.mjs` | Shared byte accounting, persisted migration plans, and resumable installation. Extract only the mechanics actually shared by both importers. |
| `src/importers/first-adopter/{register,shards,status,convert}.mjs` | Legacy register/shard interpretation, lead-status recognition and conversion. |
| `src/importers/priority-checkbox/{parse,convert}.mjs` | The second supported legacy shape. Separate from the first adopter conventions. |
| `src/integration/agent-snippet.md` | Short reusable instructions copied into each repo’s CLAUDE.md and AGENTS.md. |
| `src/integration/gate/{install,launcher,pre-push}.mjs` | Gate configuration/promotion, last-good resolution, and pushed-ref validation. |
| `src/observability/conflicts.mjs` | Local recording and reporting of real merge conflicts. |
| `src/viewer/server/{main,boundary,item-routes,document-routes,repo-routes,worktrees}.mjs` | Server lifecycle, request safety, scoped API endpoints, and advisory worktree overlays. |
| `src/viewer/ui/{index.html,app.mjs,api.mjs,repo-picker.mjs,board.mjs,item-editor.mjs,relations.mjs,documents.mjs,styles.css}` | Browser shell and separate UI responsibilities. |
| `src/tooling/{build,layout-check}.mjs` | Assemble the distributable and verify declared placement/file-size limits. |
| `tests/{format,core,storage,cli,index,claims,registry,importers,integration,viewer,merge,packaging}/` | Responsibility-matched test files specified below. |
| `tests/helpers/{repository,clock}.mjs`, `tests/fixtures/{items,first-adopter,priority-checkbox}/` | Shared disposable-repo/clock support and bounded fixtures. |
| `docs/records/{migrations,conflicts}/` | Migration evidence and the two-week conflict review; historical records stay out of living summaries. |

`STRUCTURE.md` must contain hook-compatible `## Layout` bullets covering these homes. Keep code files below approximately 800 lines; extract by responsibility before crossing that limit.

**State locations.**

| Location | Contents |
|---|---|
| `<repo>/docket.json` | Store version and explicit migration state; no configurable schema vocabulary. |
| `<repo>/.docket/index.json` | Disposable index for that checkout only. |
| `<repo>/.docket/import/<run>/` | Dry-run staging, source hashes, mapping decisions and recovery journal. |
| `<git-common-dir>/docket-claims.json` | Advisory claims shared across linked worktrees. |
| `<git-common-dir>/docket-conflicts.jsonl` | Local conflict observations, never committed automatically. |
| `%LOCALAPPDATA%/Docket/registry.json` | Repo aliases, canonical paths and relative document overrides—no items. |
| `%LOCALAPPDATA%/Docket/gate/versions/<version>/`, `gate/active.json` | Immutable tested checker installations and the selected last-good version. |

**Portal reuse and extractions.** The approximately 200–300-line estimate is an upper bound for adapted code and integration, not a ready-made core. Inspection found an 83-line storage module, a 494-line patcher, and a 78-line status module. Roughly 125–210 production lines are plausible candidates: storage primitives, small span helpers, and importer-only status detection.

Extract revision/atomic-write techniques into Docket storage; use span accounting only in migration. Do not transplant the portal’s register reconciliation, general patcher, title truncation or status heuristics into the item core. Preserve attribution. No live dependency on the first adopter checkout.

**Necessary external changes, shipped with the first adopter rollout.**

| Paths, relative to the first adopter unless absolute | Change and placement |
|---|---|
| `tools/portal/src/backlog/legacy-write-policy.mjs` | New explicit cutover guard, shared by legacy writers. |
| `tools/portal/src/backlog/service.mjs`, `scripts/migrate-backlog.mjs` under `tools/portal/` | Guard queued mutations and the direct migration writer. `import-gap.mjs` already writes through the service. |
| `tools/portal/src/server/{main,http}.mjs` | Retire startup after cutover and return a clear 410 from an already-running server’s mutation path. |
| `tools/portal/tests/{http,legacy-write-policy}.test.mjs`, `tools/portal/README.md` | Verify and document legacy retirement. |
| `tools/documentation/lib/docket-backlog.mjs` | Extract item-check/reference integration from the checker into a read-only Docket CLI adapter. |
| `tools/documentation/lib/{backlog-ids,document-collections}.mjs` | Recognize both prefixes and select the declared authoritative collection. |
| `tools/documentation/{check,baseline-snapshot}.mjs` | Call the adapter; remove the current-tree snapshot’s dependency on the portal parser. Preserve legacy historical-snapshot support. |
| `tools/documentation/{policy.json,README.md,check.test.mjs,baseline-snapshot.test.mjs}`, `tools/documentation/tests/document-policy.test.mjs` | Update collection policy, historical treatment and regression coverage. |
| `docs/BACKLOG.md`, `docs/work/backlog/README.md`, `STRUCTURE.md`, `CLAUDE.md`, `AGENTS.md` | Point callers to Docket; identify retained shards as historical. |
| `docs/items/<id>.md`, `docket.json`, `.gitignore`, `.gitattributes`, `docs/records/migrations/docket.json` | Migrated store, configuration and committed provenance. |
| `~/.claude/hooks/structure/pre-push.template.sh` | Add the supported, opt-in Docket callback; do not append to generated hooks. |
| `~/.claude/hooks/{STRUCTURE,GOTCHAS}.md` | Document callback installation, ordering and independent failure semantics. |

The portal service already mixes several responsibilities. Add only a call to the extracted guard, not another policy implementation inside it.

## 3. Sequence

1. **M0 — Architecture and self-hosting bootstrap.**
   - Write the three architecture documents first, including the Layout contract and dependency direction: CLI/viewer → core → storage; importers → core.
   - Amend ITEM-SPEC for naming and compatibility before producing any item files.
   - Recover the merge-test prototype. Its referenced scratchpad files were not found during inspection; recovery is an explicit milestone prerequisite.
   - Hand-write a small set of Docket milestone items with random-format IDs and distinct valid ranks. Record this as the single bootstrap exception to tool-assigned identity/rank.
   - Validate them with the recovered prototype, minimally adapted for the final field order and prefix policy. Document its missing warnings.
   - Install an independent bootstrap checker copy for Docket’s pre-push gate. No production CLI exists yet.
   - **Callers:** only bootstrap instructions and Docket’s new hook configuration.

2. **M1a — Strict core and first CLI check.**
   - Implement parser, serializer and all nine groups of ITEM-SPEC checks. Reject malformed files visibly; never omit them from a successful listing.
   - Make the CLI’s first acceptance action `docket check` against Docket itself.
   - Snapshot errors fail; warnings print without failing: dropped targets, duplicate ranks within a priority, unclaimed `wip`, and future `since`.
   - Enforce real dates, exact field order, filename/ID equality, unique list members, same-repo references, no self-reference and separate parent/blocking cycle checks.
   - **Callers:** bootstrap validation remains independent until the production checker passes its conformance suite.

3. **M1b — Usable CLI, safe writes and last-good gate.**
   - Add `add`, `set`, `link`, `list`, `show`, `index`, `claim` and `release`. Every command supports `--repo`; agent-facing results support `--json`.
   - `add` generates four random bytes, retries collisions and assigns the end-of-priority rank. Creation must not overwrite an existing destination.
   - `set` preserves immutable identity/creation date. A real status change updates `since`; other edits and no-op status assignments do not. Priority changes allocate a rank in the destination band.
   - Reordering exposes relative placement, never an agent-supplied rank. Sort by priority, bytewise rank, then ID for deterministic duplicate-rank display.
   - `link` handles scalar parent and list additions/removals. `relates` is symmetric in queries but stored once; adding an already-existing reverse relation is a no-op.
   - Serialize cooperating mutations per worktree, validate the candidate graph, reparse output, check the expected revision, then temp-write/fsync/rename. Stale browser edits return 409; CLI edits return a structured conflict error.
   - Build the per-worktree JSON index from source hashes. Missing, stale or corrupt caches rebuild; `check` always reads authoritative files.
   - Claims use a separate common-dir lock to prevent lost updates. Reject conflicting claims unless explicitly taken over; expire missing worktree paths. `release` and completion remove the matching claim. Report incomplete claim cleanup without pretending the durable item write failed.
   - Package and install a tested tarball. Promote a checker into the separate gate installation only after its smoke tests pass; retain the previous version. Never execute a build or working-tree imports during pre-push.
   - **Callers:** CLI adapters use core operations; Docket’s gate switches from the prototype to the installed checker.

4. **M1c — Compose the real push gate.**
   - Add per-repo opt-in configuration for the stable launcher to the managed structure template.
   - Buffer push stdin once and replay it independently to Git LFS and Docket. Preserve arguments, exit failures and temporary-file cleanup.
   - Keep LFS first. Run Docket before the template’s structure pause/opt-out early returns: those controls govern structure review, not item validity.
   - Validate each pushed local tip through `check --ref`; a clean working tree must not conceal invalid committed items. Skip deleted refs. Claims remain advisory local warnings.
   - Refresh managed hooks explicitly. Preserve foreign hooks and existing `core.hooksPath`.
   - the first adopter’s existing chain stays icon guard → physical managed hook → LFS/Docket/structure checks. Its wrapper already replays stdin; do not replace it.
   - **Callers:** the managed template’s installer and hook-sync consume its new version; Claude’s separate `PreToolUse` structure gate remains unchanged.

5. **M2a — the first adopter importer and byte-verified dry run.** _(Historical: done for one repo; the importer was removed 2026-10-05, see ADR-19. New work uses `docket init` and `docs/MOVE-IN.md`.)_
   - Inventory the actual source tree. Inspection found 391 unique `bl-` markers and 271 register rows; these are a baseline, not hard-coded expected totals.
   - Freeze source hashes and persist the import plan. Keep existing `bl-` IDs verbatim; allocate missing identities through core allocation and retain them across retries.
   - Register priority and ordering win. Missing rows fall back to explicit shard priority and stable source order, with reported decisions. Wishlist becomes `idea/P3`.
   - Done shards become `done`. Open-shard completion markers inform status; ambiguous or contradictory entries require manifest overrides.
   - Default unclassified entries to `task`. Do not infer `fixes`, parents or blockers from prose. Preserve research/ask notes as prose; there are no new schema fields.
   - Preserve nested content and account for wrapper removal, title extraction, line-ending conversion, historical metadata removal and relative-link rebasing.
   - Byte verification must reconstruct every original input from its recorded spans and compare hashes. Separately verify that every item/content span reaches an output or an explicit reviewed transformation. New item bytes cannot equal the old register/shard bytes.
   - Reject unexplained omissions, duplicates and unresolved ambiguities before apply.
   - **Callers:** importer only reads legacy files; production CLI/core supplies output validation and allocation.

6. **M2b — the first adopter cutover: first external usable slice.**
   - Install the staged items using a resumable journal and source-hash preconditions. Refuse source drift or conflicting pre-existing output.
   - Stop the old portal during cutover. Publish the explicit migration marker only after the item set passes validation; failure leaves the source intact and cutover incomplete.
   - Retain old shards as historical evidence; replace the register with a short navigation page after recording its source commit/hash.
   - Activate legacy-write guards, documentation-checker adapters, agent instructions and the composed gate together.
   - Test historical documentation snapshots and preserved `bl-` references, not merely the new item directory.
   - Start the two-week conflict observation period here.
   - **Callers:** portal startup/mutations, legacy migration script, documentation checker, baseline snapshot, ContentChecks’ existing checker invocation, and repo agent instructions.

7. **M3 — Registry and common-shape importer.** _(Superseded 2026-10-05: M3 is the registry, `docket init` and the move-in playbook; no importer.)_
   - Add `docket repo add/list/remove` and the per-machine registry. Registration canonicalizes paths, identifies linked worktrees and reports unavailable repositories without deleting registrations.
   - Resolve living docs from root/`docs/`, with explicit overrides for `website/docs/`, `_platform/docs/` and `hooks/`.
   - Implement priority-H2/checklist importing using the proven manifest/apply mechanics. Preserve nested checklists as parent content unless explicitly identified as separate items.
   - Handle repeated priority headings and configured aliases; unknown sections and `[~]` semantics produce review entries rather than silent guesses.
   - Pilot a small repo, then a larger backlog. The approximately 18-repo coverage claim needs inventory verification: the survey also describes the harness as plain unprioritized bullets.
   - **Callers:** new registry/import command adapters; converted repos receive the same snippet and gate.

8. **M4 — Local viewer/editor.**
   - Add `docket serve`, bound to loopback. Build the repo selector, status board, item editor, feature/bug view and relation navigation.
   - All edits call the same core operations as the CLI. Return revisions on reads; preserve unsaved input when a save conflicts.
   - Show blocked as a derived badge, not another persisted status. Keep dropped items discoverable.
   - Read registered worktrees and overlay claims/branch-local work as labeled hints. Never silently write a worktree observation into the main checkout; editing requires an explicit selected checkout.
   - Render the seven living documents read-only with ordinary Markdown rendering and a source view. Show missing/invalid docs explicitly.
   - Restrict HTTP paths to registered, contained locations; reject traversal, foreign origins and unsafe HTML. No document-write endpoint.
   - **Callers:** HTTP routes call core/query services; UI modules call only the scoped API.

9. **M5 — Evidence review, not automatic expansion.**
   - Provide `docket conflicts record/list` for real unresolved merges, recording paths, fields, branches and resolution effort in clone-local storage.
   - Distinguish Git conflicts from revision conflicts, duplicate-rank warnings and semantic duplicates.
   - After two weeks, summarize evidence in Docket’s records and decide whether a merge driver warrants a separate item.
   - Defer the other backlog shapes, cross-machine claims, status event history and MCP.

The per-repo CLAUDE.md/AGENTS.md snippet should say:

> Track work in `docs/items/` through `dk`. Use filtered `dk list --json` and `dk show`; use `add`, `set`, and `link` for changes. Never invent IDs or ranks. Claim work in the current worktree, release it when finished, and run `dk check` before pushing. Drop items instead of deleting them. Living docs remain ordinary Markdown.

## 4. Tests

| Milestone | New tests and required coverage |
|---|---|
| M0–M1a | `tests/format/{grammar,roundtrip}.test.mjs`: every forbidden grammar form, UTF-8/BOM/CRLF, field ordering, real dates, H1 and unchanged body bytes. `tests/core/check.test.mjs`: every error/warning distinction, both prefixes and graph cycles. |
| M1b | `tests/core/{mutations,rank}.test.mjs`: immutable fields, local-date rollover, status no-ops, priority moves, collision retries, one-file reorder, relation symmetry and generated-rank properties. |
| M1b | `tests/storage/atomic-write.test.mjs`: stale revisions, cooperating concurrent writers, rename failures, Windows retry behavior and temp cleanup. |
| M1b | `tests/{claims,index}/store.test.mjs`: parallel claim updates, ownership, worktree expiration, completion cleanup, cache rebuild and branch/worktree isolation. |
| M1b | `tests/cli/commands.test.mjs`: exact JSON envelope, bounded list output, stderr separation, exit codes, Unicode and paths with spaces. |
| M1c | `tests/integration/pre-push.test.mjs`: invalid pushed tip despite clean working files, several refs, deletions, LFS stdin replay, structure pause/opt-out, pending review, foreign hooks and first-adopter-style delegation. |
| M1c | `tests/packaging/last-good.test.mjs`: deliberately broken working tree cannot break the installed gate; failed promotion preserves the previous installation; both Windows command aliases work. |
| M2 | `tests/importers/first-adopter.test.mjs`: register/shard priority mismatch, missing rows, done-row drift, duplicate IDs, nested prose, flags, relative links and uncertain dates. |
| M2 | `tests/importers/manifest.test.mjs`: first reproduce dropped-byte and changed-source failures, then verify byte reconstruction, complete content accounting, repeatability and interrupted-apply recovery. |
| M2 | the first adopter tests listed in Placement: retired writers cannot change files/events; documentation references recognize both prefixes; old and migrated snapshots retain identity coverage. |
| M3 | `tests/importers/priority-checkbox.test.mjs`, `tests/registry/store.test.mjs`: duplicate headings, nested checklists, ambiguous statuses, unsupported shapes, doc overrides and unavailable paths. |
| M4 | `tests/viewer/{routes,worktrees}.test.mjs`, `tests/viewer/editor.e2e.test.mjs`: CLI/UI parity, stale-save recovery, correct checkout targeting, reverse relations, read-only docs, traversal and origin rejection. |
| M5 | `tests/merge/scenarios.test.mjs`: reconstruct the documented Git scenarios with the final field order, including known conflicts and clean merges requiring warnings. `tests/integration/conflicts.test.mjs`: capture and classify real-conflict records. |

Do not claim the missing prototype already covers these tests. The research explicitly says its duplicate-rank warning was absent.

## 5. Verification

**Nothing was built or tested for this plan.** Docket has no existing build/test commands. Implement and document the following milestone scripts in `package.json` and `README.md`; the implementer must run them on Windows 11.

| Milestone | Commands and acceptance |
|---|---|
| M0 | `node src/bootstrap/check.mjs --repo .`; verify all handwritten seed items and the independent bootstrap gate. Record the recovered validator’s provenance and limitations. |
| M1a | `npm ci`, `npm run test:format`, `npm run test:core`, `node src/cli/main.mjs check --repo .`; Docket validates itself before ordinary CLI-created items are accepted. |
| M1b | `npm run test:storage`, `npm run test:cli`, `npm run test:coordination`, `npm run build`, `npm run test:layout`, `npm pack`; install the resulting tarball with `npm install --global <tarball>`. Confirm `docket --version`, `dk --version` and `docket check --repo .` from outside the checkout. |
| M1c | `npm run test:integration`, `npm run test:packaging`; promote with `docket gate promote <tarball>`, install with `docket gate install --repo .`. Use disposable bare remotes to prove rejection/pass behavior without a real push. Break working-tree code and confirm the last-good gate still runs. |
| M2 | `npm run test:importers`; run `docket import first-adopter --repo <game-repo> --dry-run --json`, review the persisted manifest, then `docket import apply --repo <game-repo> --manifest <path>`. Require zero unexplained content losses and a passing `docket check --repo <game-repo>`. |
| M3 | Repeat importer verification for `docket import priority-checkbox --repo <repo> --source <backlog> --dry-run --json`; run `npm run test:registry`. Verify a small and a large real-source dry run before fleet rollout. |
| M4 | `npm run test:viewer`, `npm run test:e2e`, `npm run build`; launch `docket serve`. Confirm repo switching, status moves, ordering, feature bugs, reverse links, worktree labels, stale-save recovery and seven read-only doc views. |
| M5 | `npm run test:merge`; review two weeks of actual conflict records separately from synthetic results. Record the merge-driver decision and supporting counts. |

During M2, also run the first adopter’s documented commands from its root:

- `npm --prefix tools/portal run check`
- `npm --prefix tools/portal test`
- `node tools/documentation/check.mjs --repo . --strict-size`
- `node --test "tools/documentation/*.test.mjs"`
- `node --test "tools/documentation/tests/*.test.mjs"`
- `node --test tools/build/content/icon-guard/tests/hooks.test.mjs`

Capture before/after evidence through `tools/documentation/baseline-snapshot.mjs` and its documented `--diff` command. Its existing ContentChecks integration must continue to work; the migration must not require bypassing that tier.

## 6. Docs

- **`STRUCTURE.md`:** bootstrap enforceable `## Layout` bullets before scaffolding; update them alongside each new responsibility.
- **`docs/ARCHITECTURE.md`:** authoritative files, dependency direction, write/locking model, per-worktree caches, common-dir claims and viewer checkout targeting.
- **`docs/DECISIONS.md`:** `.mjs`/Node, CLI over MCP, JSON cache, dual-prefix compatibility, fixed schema, last-good gate and deferred merge driver.
- **`docs/FEATURES.md`:** implemented capability summary with item links; no second backlog or per-item status table.
- **`docs/ROADMAP.md`, `docs/BACKLOG.md`:** milestone navigation and links into Docket’s own store.
- **`docs/GOTCHAS.md`:** external-editor race, nontransactional item/claim updates, Windows file locking, rank edge cases, claim visibility and gate recovery.
- **`docs/research/ITEM-SPEC.md`:** authoritative naming/path amendment and resolution of the `fixes` target inconsistency. Keep other research as historical evidence.
- **`docs/records/migrations/`:** exact source inventories, hashes, transformations, overrides and acceptance results.
- **`docs/records/conflicts/`:** two-week observations and the explicit merge-driver decision.
- **the first adopter and harness docs named in Placement:** new item authority, retired legacy writers, documentation-checker integration and preserved hook composition.

## 7. Open questions / assumptions

| Owner decision | Assumption used in this plan |
|---|---|
| Preserve or rewrite the first adopter IDs? | Preserve existing `bl-` identities indefinitely; mint only `dk-`. This avoids rewriting historical references, at the cost of permanent dual-prefix support. |
| Missing merge-test prototype? | Recover the original before M0 acceptance. If unavailable, the owner must choose whether an explicitly labeled reconstruction satisfies the bootstrap requirement; it must not be presented as the original tested artifact. |
| `fixes` legality? | Follow the field table: only bugs may have `fixes`, targeting features/tasks. Amend rule 8, whose “not idea” wording currently also admits bugs. |
| Dates absent from legacy entries? | Preserve reliable dates only when internally consistent; otherwise use the recorded import date for `created`/`since` and disclose the uncertainty. Do not invent historical precision. |
| Partial/reopened legacy status? | Map reopened to `todo`; treat partial as `todo` unless active work is explicitly established. Preserve the historical note and require overrides for ambiguity. |
| Fractional rank edge cases? | Generated keys use a dense subset of `[a-z]+`. Arbitrary legal hand-written keys can leave no representable gap; return a clear error rather than silently rewriting a whole band. Duplicate ranks remain warnings. |
| Is whole-file writing acceptable? | Yes for small canonical items, while preserving untouched body bytes. Cooperating Docket writers lock; an external editor can still race between revision check and rename. |
| Last-good installation and schema upgrades? | Keep the gate separate from the development checkout and ordinary global CLI upgrades. Promote support for a new schema before committing items requiring it. |
| Structure-gate integration scope? | A small supported change to the managed harness template is part of rollout. Structure pause/opt-out does not disable Docket validation. |
| Retire the first adopter’s portal before the viewer exists? | Yes. The CLI is the deliberate early usable slice; the legacy portal is not maintained as a second writable frontend. |
| Common-importer fleet coverage? | Approximately 18 repos is an estimate. Verify actual shapes and defer exceptions instead of adding permissive parsing branches. |
| Global viewer semantics? | Registry and transient aggregation are global; persisted item indexes are per checkout. Claims cover linked worktrees on one machine, not independent clones or cloud agents. |
| Documentation migration? | Keep living prose docs intact and read-only in the viewer. Seed feature items when needed for references; defer wholesale FEATURES conversion and unrelated doc cleanup. |