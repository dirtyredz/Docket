---
id: dk-7c8ddfb5
type: task
created: 2026-10-31
status: todo
since: 2026-10-31
area:
priority: P3
rank: zzn
parent:
fixes: []
blocked_by: []
relates: []
---
# gate test helper: one gitExecPath() for gitSh and pushGit

From the 2026-10-31 structure review of b5fe244. `tests/helpers/gate.mjs` `gitSh()` (around line 44) and `pushGit()` (around line 104) both run `git --exec-path` and work out the Git for Windows layout on their own.

Acceptance: one memoized `gitExecPath()` (or Git-for-Windows root) helper used by both; `npm run test:integration` passes.
