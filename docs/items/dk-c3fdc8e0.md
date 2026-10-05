---
id: dk-c3fdc8e0
type: feature
created: 2026-10-04
status: done
since: 2026-10-05
area: viewer
priority: P2
rank: l
parent:
fixes: []
blocked_by: [dk-ccfbb593]
relates: []
---
# M4: Local viewer and editor

`docket serve` on loopback: repo selector, board, item editor, relations, worktree overlays and read-only
living docs. Every edit calls the same core operations as the CLI.

Acceptance: `npm run test:viewer`, `npm run test:e2e`.
