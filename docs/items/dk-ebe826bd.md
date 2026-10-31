---
id: dk-ebe826bd
type: task
created: 2026-10-31
status: todo
since: 2026-10-31
area:
priority: P3
rank: zt
parent:
fixes: []
blocked_by: []
relates: []
---
# Record a removal trigger for LEGACY_HOOK_STATE (hook.state alias)

From the 2026-10-31 structure review (abstraction lens). `src/integration/gate/install.mjs` keeps `hook.state` only as a deprecated alias of `hook.change` for external `--json` readers. No reader exists in this repo, and the alias has no removal condition.

Acceptance: the removal condition (a version, or confirming Command Deck reads `change`) is recorded on the constant or in DECISIONS.md; once it holds, the alias is deleted.
