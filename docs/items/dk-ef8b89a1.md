---
id: dk-ef8b89a1
type: feature
created: 2026-10-04
status: done
since: 2026-10-04
area: gate
priority: P0
rank: l
parent:
fixes: []
blocked_by: [dk-3f9499c1]
relates: []
---
# M1c: Compose the real push gate

Opt-in Docket callback in the managed pre-push template: stdin buffered and replayed to LFS and Docket,
Docket before the structure early returns, `check --ref` on every pushed tip, promoted last-good install.

Acceptance: integration and packaging tests pass; a broken working tree cannot break the gate (proven with a
disposable bare remote).
