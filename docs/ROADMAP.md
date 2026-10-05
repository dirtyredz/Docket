# ROADMAP

Milestones from `PLAN.md` section 3, in order. Concrete work is tracked as items in `docs/items/`.

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

**M3 - Registry, init and move-in.** `docket repo` commands and document-location overrides; `docket init`
and `docs/MOVE-IN.md` (done 2026-10-05, no importer); small then large pilot by agent move-in.

**M4 - Local viewer/editor.** `docket serve` on loopback: repo selector, board, editor, relations,
worktree overlays, read-only living docs.

**M5 - Evidence review.** `docket conflicts record/list`; after two weeks decide whether a merge driver
earns its own item. Everything else (other backlog shapes, cross-machine claims, MCP) stays deferred.
