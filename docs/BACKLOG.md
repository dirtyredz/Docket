# BACKLOG

Docket's own work lives in `docs/items/` (created in M0), tracked with Docket itself. This page holds no
item list, statuses or ranks; see `ROADMAP.md` for milestones.

## Open questions from PLAN, with the assumption in force

| Question                                   | Assumption used                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Preserve or rewrite EvilEye IDs?           | Preserve `bl-` indefinitely; mint only `dk-`.                                                                   |
| Missing merge-test prototype?              | Recovered into `docs/research/merge-test/` (`bl-check.mjs`); M0 adapts it. Label any reconstruction as such.    |
| `fixes` legality?                          | Only bugs may have `fixes`, targeting features or tasks (ITEM-SPEC amended).                                    |
| Legacy entries without dates?              | Keep dates only if consistent; else use import date and disclose.                                               |
| Partial or reopened legacy status?         | Both map to `todo` unless active work is explicit; ambiguity needs overrides.                                   |
| Fractional rank edge cases?                | Dense generated subset of `[a-z]+`; no gap means a clear error, never a band rewrite.                           |
| Whole-file writing acceptable?             | Yes; body bytes preserved; external-editor race remains.                                                        |
| Last-good and schema upgrades?             | Gate separate from dev checkout; promote schema support before committing items that need it.                   |
| Structure-gate integration scope?          | Small opt-in Docket callback in the managed template; structure pause/opt-out never disables Docket validation. |
| Retire EvilEye portal before the viewer?   | Yes, at M2 (owner ruling 2026-10-04).                                                                           |
| Common-importer coverage (about 18 repos)? | Estimate only; verify shapes and defer exceptions.                                                              |
| Global viewer semantics?                   | Registry and aggregation global; indexes per checkout; claims per clone.                                        |
| Documentation migration?                   | Living prose docs stay intact and read-only in the viewer.                                                      |

## Deferred from M0 to M1c (2026-10-04)

- `src/integration/agent-snippet.md` (PLAN section 3 text) is not written yet; needed at M2 rollout.
- `link` that edits two files (own list plus a reverse-stored `relates`) is two atomic writes, not one
  transaction; a crash between them leaves half the change. Rare; revisit if it bites.
- Move to Node 24 when it is installed here; no code change expected (ADR-13).
- Harness: `/gate install` (skills/gate) does not know about `docket gate install`; a repo opting into
  Docket runs both. Consider teaching the skill.
