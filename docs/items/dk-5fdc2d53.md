---
id: dk-5fdc2d53
type: task
created: 2026-10-11
status: todo
since: 2026-10-11
area: core
priority: P3
rank: w
parent:
fixes: []
blocked_by: []
relates: []
---
# Tidy single-caller seams left after the viewer removal

From the 0.7.0 push review (2026-10-11).

- src/repository/containment.mjs `relativeInside`: one caller (state/registry/schema.mjs). Its percent-decode branch guarded viewer URL paths; registry stores filesystem paths. Consider folding into the registry schema as a private check and dropping the decode branch; update STRUCTURE.md Layout/component rows.
- src/core/items/link.mjs `planLink`: exported only for tests; production goes through `linkItem`. Leave exported as the pure-plan seam or un-export.
- src/core/items/revisions.mjs: a one-export file beside storage/revision.mjs; either state in STRUCTURE.md that it is the core-level guard over storage/revision or fold it.
- Registry per-repo document overrides (state/registry DOC_NAMES) have no in-repo reader now. Document in ARCHITECTURE.md that Command Deck (dk-ac2f3fea in command-deck) is the consumer via CLI JSON, or drop the surface later.

Consequences of 0.8.0 (headless library, ADR-30; Command Deck dk-ac2f3fea slice 1):

- `src/repository/containment.mjs` is no longer a single-caller file: `assertSafeCheckout`, `assertRealWithin`, `lexicallyWithin` and `isLink` returned and `docket/repository/containment` is a public export (used by `repository/registered-checkout.mjs`). `relativeInside` keeps its behaviour, decode branch included; folding it into the registry schema would now only move that one function.
- `src/core/items/revisions.mjs` now holds `assertRevision`, `selectedExpectation` and `assertRevisions` (link revision maps), and its header names it the core-level guard over `storage/revision.mjs`: that bullet is settled.
- `planLink` is unchanged (still the pure-plan seam the tests use; `linkItem` is the exported operation).
- Registry document overrides: Command Deck reads the registry through the library (`docket/registry/source`), not CLI JSON.
