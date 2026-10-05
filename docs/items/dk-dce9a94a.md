---
id: dk-dce9a94a
type: task
created: 2026-10-05
status: todo
since: 2026-10-05
area: structure
priority: P2
rank: zzzzt
parent:
fixes: []
blocked_by: []
relates: []
---
# Move createRegistrySource from viewer/server/scope.mjs to state/registry/

Registry file watching is registry state, not viewer scope. Move it beside the registry store and import it from the viewer. Source: 0.6 push-time structure review.
