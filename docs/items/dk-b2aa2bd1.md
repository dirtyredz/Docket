---
id: dk-b2aa2bd1
type: task
created: 2026-10-05
status: todo
since: 2026-10-05
area: structure
priority: P2
rank: z
parent:
fixes: []
blocked_by: []
relates: []
---
# One store-entries shape for listItemEntries callers

Callers of listItemEntries re-map entries to {name, isFile, bytes} in several places (dry-run, verify command, workingSnapshot). Settle one entry shape. From the 2026-10-05 structure review.
