# Outcome gating (owner ruling 2026-11-22)

Goal: Docket refuses `done` for an `Outcome: yes` item without `Installed-measurement:`, and for an item whose
`Safety-switch-off: <id>` follow-up is missing, has no `Owner:` line, or is not done; through `dk set`, `dk add
--status done` and `dk add --batch` with status done.

## Validation

- Metric: for each case, whether the CLI exits 0 (accepted) or non-zero with DOCKET_INVALID and leaves the item unwritten.
- Method: disposable repo (`dk init`), drive the `dk` CLI of each SHA (checkout in a temp worktree): (1) set done on an
  outcome item with no measurement; (2) same with measurement; (3) set done with open owned follow-up; (4) add --status done
  with an unmeasured outcome body; (5) batch add the same; (6) unmarked item set done.
- Target: baseline SHA 2002e6c accepts 1, 3, 4, 5; reviewed HEAD refuses 1, 3, 4, 5 and accepts 2, 6 (and 3 once follow-up done).
- Baseline: measured by the validator on 2002e6c before comparing.
