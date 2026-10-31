---
id: dk-7c8ddfb5
type: task
created: 2026-10-31
status: done
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

## Notes

### 2026-10-31T21:02:34.024Z · open · agent

Sign-off (2026-10-31) suggests: memoize the resolved path once per module, and warn on stderr when pushGit() falls back to plain git (unwrapped mingw64\bin\git.exe missing).
