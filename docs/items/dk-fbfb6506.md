---
id: dk-fbfb6506
type: task
created: 2026-10-05
status: todo
since: 2026-10-05
area: structure
priority: P2
rank: zt
parent:
fixes: []
blocked_by: []
relates: []
---
# Enum validation in core for planSet (assertEnum)

planSet trusts the CLI to check type/status/priority enums while planAdd validates them itself. Add an assertEnum in core so every caller (viewer too) is protected. From the 2026-10-05 structure review.
