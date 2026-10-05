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

- `link` that edits two files (own list plus a reverse-stored `relates`) is two atomic writes, not one
  transaction; a crash between them leaves half the change. Rare; revisit if it bites.
- Move to Node 24 when it is installed here; no code change expected (ADR-13).
- Harness: `/gate install` (skills/gate) does not know about `docket gate install`; a repo opting into
  Docket runs both. Consider teaching the skill.

## Deferred from M2a (2026-10-05), resolved at M2b

- Apply, its journal and the interrupted-apply tests shipped in M2b (ADR-18). The owner ruled the three
  struck-lead overrides, kept the bold lead in bodies, and placed the register prose (EvilEye
  `docs/records/migrations/README.md` says where); `STRUCTURAL-DEBT.md` stays unconverted.

## Deferred from M2b (2026-10-05)

- An unbounded export (`docket list --all` without the 500 cap, or `docket export --json`) would let EvilEye's
  adapter drop its priority/status paging.
- EvilEye's `baseline-snapshot.mjs --at <commit>` refuses migrated commits (Docket has no `list --ref`); add
  one if historical snapshots of the new store are needed.
- `docket conflicts record/list` is M5; until then the observation window is logged by hand
  (`records/conflicts/README.md`).
- EvilEye's avatar branch adds `bl-5f2b9e47` to a legacy shard; after merging, recreate it with `dk add`.
- Docket's `package-lock.json` still says version 0.0.0 (pre-existing).
