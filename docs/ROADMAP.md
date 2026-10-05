# ROADMAP

Milestones from `plans/PLAN.md` section 3, in order. Concrete work is tracked as items in `docs/items/`.

**M0 - Architecture and self-hosting bootstrap.** (done 2026-10-04) Write the architecture docs and Layout contract, amend
ITEM-SPEC (done 2026-10-04), recover the merge-test prototype, hand-write a few milestone items with
valid IDs and distinct ranks (the one exception to tool-assigned identity), validate them with the
adapted prototype and install it as an independent bootstrap pre-push checker.

**M1a - Strict core and first CLI check.** (done 2026-10-04) Parser, serializer and every ITEM-SPEC check; `docket check`
run against Docket itself. Errors fail, warnings print. Bootstrap validation stays independent until the
production checker passes conformance.

**M1b - Usable CLI, safe writes, last-good gate.** (done 2026-10-04) `add`, `set`, `link`, `list`, `show`, `index`,
`claim`, `release`; locking and atomic writes; JSON index; claims; tested tarball install and the
promoted last-good checker.

**M1c - Real push gate.** (done 2026-10-04) Opt-in launcher in the managed hook template; stdin buffered and replayed to
LFS and Docket; Docket runs before structure early returns; `check --ref` on each pushed tip.

**M2a - First-adopter importer and dry run (historical; the importer was removed in 0.3.0, ADR-19).** (done 2026-10-05; manifest approved by the owner) Inventory, frozen source hashes, persisted plan, ID
preservation, priority and status mapping, byte-verified reconstruction; no unexplained omissions.

**M2b - First-adopter cutover.** (done 2026-10-05) Resumable install, old portal stopped and retired (owner ruling 2026-10-04),
legacy-write guards, documentation-checker adapter, composed gate. The two-week conflict observation
runs 2026-10-05 to 2026-10-19 (`records/conflicts/`).

**M3 - Init and move-in.** (done 2026-10-05) `docket init` and `docs/MOVE-IN.md`, no importer; small then large pilot by
agent move-in.

**M3a - Registry.** (done 2026-10-05) `docket repo add/list/remove`: canonical identity, worktree groups, aliases,
preferred checkout, document overrides.

**M3b - Scan.** (done 2026-10-05) `docket repo scan <dir> [--dry-run]`: one-shot, additive discovery.

**M4a - Read-only overview.** (done 2026-10-05) `docket serve`: loopback boundary, scoped catalog, overview counts, title search.

**M4b - Browsing.** (done 2026-10-05) Per-checkout board, item detail, relations, worktree hints, read-only living docs.

**M4c - Editing.** (done 2026-10-05) Title, status, priority and relation edits with revision checks, conflict drafts.

**M4d - Hardening.** (done 2026-10-05) Browser end-to-end tests, security and accessibility pass, docs, 0.5.0 (built, unpushed).

**M5 - Evidence review.** `docket conflicts record/list`; after two weeks decide whether a merge driver
earns its own item. Everything else (other backlog shapes, cross-machine claims, MCP) stays deferred.

**M6 - Facts and notes.** (built 2026-10-05, 0.6.0, unpushed) Body as facts plus untrusted Notes, `dk note`, `set --body-file`, viewer facts and notes panels, managed agent snippet, `docket guide`. Release steps are in the README.
