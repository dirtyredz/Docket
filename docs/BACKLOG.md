# BACKLOG

Docket's own work lives in `docs/items/` (created in M0), tracked with Docket itself. This page holds no
item list, statuses or ranks; see `ROADMAP.md` for milestones.

## Open questions from `plans/PLAN.md`, with the assumption in force

| Question                           | Assumption used                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Legacy ID prefix?                  | `bl-` stays valid indefinitely as a generic legacy prefix; mint only `dk-`.                                     |
| Missing merge-test prototype?      | Recovered into `docs/research/merge-test/` (`bl-check.mjs`); M0 adapts it. Label any reconstruction as such.    |
| `fixes` legality?                  | Only bugs may have `fixes`, targeting features or tasks (ITEM-SPEC amended).                                    |
| Legacy entries without dates?      | Move-in agents use the move-in date and say so in the item body.                                                |
| Partial or reopened legacy status? | Both map to `todo` unless active work is explicit; the owner reviews the list.                                  |
| Fractional rank edge cases?        | Dense generated subset of `[a-z]+`; no gap means a clear error, never a band rewrite.                           |
| Whole-file writing acceptable?     | Yes; body bytes preserved; external-editor race remains.                                                        |
| Last-good and schema upgrades?     | Gate separate from dev checkout; promote schema support before committing items that need it.                   |
| Structure-gate integration scope?  | Small opt-in Docket callback in the managed template; structure pause/opt-out never disables Docket validation. |
| Importers?                         | None. `docket init` plus an agent move-in playbook (ADR-19, owner ruling 2026-10-05).                           |
| Global viewer semantics?           | Registry and aggregation global; indexes per checkout; claims per clone.                                        |
| Documentation migration?           | Living prose docs stay intact and read-only in the viewer.                                                      |

## Deferred from M0 to M1c (2026-10-04)

- `link` that edits two files (own list plus a reverse-stored `relates`) is two atomic writes, not one
  transaction; a crash between them leaves half the change. Rare; revisit if it bites.
- Move to Node 24 when it is installed here; no code change expected (ADR-13).
- Harness: `/gate install` (skills/gate) does not know about `docket gate install`; a repo opting into
  Docket runs both. Consider teaching the skill.

## Deferred from M2b (2026-10-05)

- An unbounded export (`docket list --all` without the 500 cap, or `docket export --json`) would let
  adapters drop their priority/status paging.
- `list --ref` (historical snapshots of the store) does not exist; add one if a consumer needs it.
- `docket conflicts record/list` is M5; until then the observation window is logged by hand
  (`records/conflicts/README.md`).
- Docket's `package-lock.json` still says version 0.0.0 (pre-existing).
