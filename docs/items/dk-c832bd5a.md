---
id: dk-c832bd5a
type: task
created: 2026-10-12
status: done
since: 2026-10-12
area: packaging
priority: P1
rank: zw
parent:
fixes: []
blocked_by: []
relates: []
---
# Public facade modules for the library export map (0.8.0 boundary leak)

Found by the 0.8.0 push review sign-off (Sol/high), P1.

`package.json` `exports` (line 16 onward) points public subpaths straight at implementation modules (`./src/core/errors.mjs`, `./src/core/items/link.mjs`, `./src/state/claims/store.mjs`, `./src/repository/*.mjs`, ...). That exposes unsupported names such as `docketError`, `planLink`, `git` and `claimItem`, beyond the narrow contract that ADR-30 and docs/LIBRARY.md intend. Consumers (Command Deck) can couple to internal structure.

Direction: add responsibility-named public facade modules that re-export only the supported names, point the export map at them, and have tests/packaging/library.test.mjs assert the exact namespace keys of each subpath. Do this before Command Deck starts importing the 0.8.0 library. Related: dk-ecef6190.
