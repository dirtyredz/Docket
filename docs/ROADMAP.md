# ROADMAP

Milestones from `PLAN.md` section 3, in order. Concrete work is tracked as items in `docs/items/`.

**M0 - Architecture and self-hosting bootstrap.** Write the architecture docs and Layout contract, amend
ITEM-SPEC (done 2026-10-04), recover the merge-test prototype, hand-write a few milestone items with
valid IDs and distinct ranks (the one exception to tool-assigned identity), validate them with the
adapted prototype and install it as an independent bootstrap pre-push checker.

**M1a - Strict core and first CLI check.** Parser, serializer and every ITEM-SPEC check; `docket check`
run against Docket itself. Errors fail, warnings print. Bootstrap validation stays independent until the
production checker passes conformance.

**M1b - Usable CLI, safe writes, last-good gate.** `add`, `set`, `link`, `list`, `show`, `index`,
`claim`, `release`; locking and atomic writes; JSON index; claims; tested tarball install and the
promoted last-good checker.

**M1c - Real push gate.** Opt-in launcher in the managed hook template; stdin buffered and replayed to
LFS and Docket; Docket runs before structure early returns; `check --ref` on each pushed tip.

**M2a - EvilEye importer and dry run.** Inventory, frozen source hashes, persisted plan, ID
preservation, priority and status mapping, byte-verified reconstruction; no unexplained omissions.

**M2b - EvilEye cutover.** Resumable install, old portal stopped and retired (owner ruling 2026-10-04),
legacy-write guards, documentation-checker adapter, composed gate. Starts the two-week conflict
observation.

**M3 - Registry and common-shape importer.** `docket repo` commands, document-location overrides,
priority-H2/checklist importer, small then large pilot.

**M4 - Local viewer/editor.** `docket serve` on loopback: repo selector, board, editor, relations,
worktree overlays, read-only living docs.

**M5 - Evidence review.** `docket conflicts record/list`; after two weeks decide whether a merge driver
earns its own item. Everything else (other backlog shapes, cross-machine claims, MCP) stays deferred.
