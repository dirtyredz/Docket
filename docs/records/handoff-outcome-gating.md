# Handoff: outcome gating (2026-11-22)

Shipped in v0.11.0 (e402f01), installed on Valhalla (`dk --version` 0.11.0, gate promoted 0.11.0-3f511554).
Owner ruling 2026-11-22 "Outcome work closes on the installed result".

- Mechanism: `src/core/items/closing/outcome.mjs` (`assertCloseable`), called from `planSet` (`src/core/items/set.mjs`) and `planAddOne` (`src/core/items/add.mjs`, covers add and batch add).
- Markers are body lines (frontmatter keys are fixed): `Outcome: yes`, `Installed-measurement:`, `Safety-switch-off: <dk-id>`, `Owner:`.
- Evidence: tests/unit/core/outcome.test.mjs (15 tests); independent validator compare cases 1-8 (`docs/plans/outcome-gating.md`); installed dk refuses `done` on a scratch `Outcome: yes` item.
- Gaps: hand-edited files and `dk check` do not enforce; the integration test "pending structure review still blocks after Docket passes" fails on baseline (harness marker behaviour, unrelated).
