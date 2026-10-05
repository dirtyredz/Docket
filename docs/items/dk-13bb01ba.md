---
id: dk-13bb01ba
type: task
created: 2026-10-04
status: done
since: 2026-10-04
area: bootstrap
priority: P0
rank: c
parent:
fixes: []
blocked_by: []
relates: []
---
# M0: Architecture and self-hosting bootstrap

Write the architecture docs and Layout contract, amend ITEM-SPEC, recover the merge-test prototype into
`src/bootstrap/`, hand-write these milestone items (the single bootstrap exception to tool-assigned IDs and
ranks) and gate Docket's pushes with an independent copy of the bootstrap checker.

Acceptance: `node src/bootstrap/check.mjs --repo .` passes; the bootstrap gate is installed.
