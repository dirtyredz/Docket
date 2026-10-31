---
id: dk-ecef6190
type: task
created: 2026-10-12
status: done
since: 2026-10-31
area: repository
priority: P3
rank: z
parent:
fixes: []
blocked_by: []
relates: []
---
# Un-export containment.mjs internals (lexicallyWithin, assertRealWithin, isLink)

Found in the 0.8.0 push review (abstraction lens).

Only `relativeInside` (used by `src/state/registry/schema.mjs:32`) and `assertSafeCheckout` have callers outside `src/repository/containment.mjs`. The other three are exported anyway, which widens the repository seam.

Direction: un-export them unless docs/LIBRARY.md names them; tests reach them through the public guards.
