---
id: dk-8e5a6a5c
type: task
created: 2026-10-05
status: todo
since: 2026-10-05
area: structure
priority: P2
rank: zzz
parent:
fixes: []
blocked_by: []
relates: []
---
# Move cleanTitle next to withTitle in core/format

Codex 0.4.3 sign-off: src/core/items/add.mjs:12 hosts the shared title normalizer, so set depends on the add module for a format-level rule. Move it to core/format/serialize.mjs (or a title module) and import from both.
