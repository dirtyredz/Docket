---
id: dk-0cd243cf
type: task
created: 2026-10-12
status: done
since: 2026-10-31
area: repository
priority: P2
rank: zzzzzy
parent:
fixes: []
blocked_by: []
relates: []
---
# Share checkout canonicalisation between contextAtRoot and inspectCheckout

Found in the 0.8.0 push review (abstraction lens).

`src/repository/registered-checkout.mjs:34` `inspectCheckout` repeats the canonicalise-or-throw-NOT_A_REPO and `resolveRepo` canonicalisation that `src/repository/context.mjs:85-100` (`contextAtRoot`) already does. A change to the canonical form or the error details has to be made twice.

Direction: one helper in `context.mjs` returning canonical `{root, commonDir, gitDir}`, used by both. Pairs with dk-d041ec4b.
