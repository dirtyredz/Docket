---
id: dk-9886cdec
type: task
created: 2026-10-12
status: done
since: 2026-10-31
area: repository
priority: P2
rank: zzzzzz
parent:
fixes: []
blocked_by: []
relates: []
---
# One context shape across openers (gitDir present only from openCheckoutAt)

Found in the 0.8.0 push review (abstraction lens).

`createCheckoutOpener` (`src/repository/registered-checkout.mjs:110`) returns a context without `gitDir`, `openCheckoutAt` returns one with it, and the doc comments at lines 65 and 78 list different keys for the same "context core operations take". No src code reads `ctx.gitDir`.

Direction: drop `gitDir` from headless contexts, or document it as optional and not read by core.
