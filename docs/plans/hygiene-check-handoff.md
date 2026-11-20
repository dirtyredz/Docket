# Hygiene check: handoff (2026-11-20, docket lead -> release session)

Plan and approved scope: `docs/plans/hygiene-check.md` (`## Chosen scope`). Owner: Skippy.

## State
- **Docket slice (3): done, pushed.** `origin/main` = `464bead`. Delivered: wip entry records branch + worktree in the common-dir claims store (envelope v2, retained after claim expiry; 12-key item format unchanged); `dk activity [ids] --json`; idempotent `dk worktree release --path <p> [--json]`. Validator PASS (5/5 scenarios, `.tmp/validation.md`), sign-off PASS, fast gate green.
- **Not done:** version bump/release (package.json still 0.9.0; FEATURES.md rows say "0.10.0 (unreleased)"), full `npm test`, build, installed smoke, global install.
- Not started: harness H1/H2 (Skippy dispatches), Knowledge slice.
- Library contract change: headless callers now pass the opaque `workClaims` (from `docket/claims`) as `claims`, not the module namespace (docs/LIBRARY.md). Public name `mutateWorkStore` is gone. Minor-version bump covers it.

## Release steps for 0.10.0 (tonight, one release per day)
1. In a clean `main` checkout at/after `464bead`: run the async long suites first, once: `npm test` (integration/packaging do real pushes to temp bare remotes; needs `~/.claude/hooks/structure/pre-push.template.sh`). A failure is filed/fixed, not skipped.
2. Dry run: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\dirty\projects\docket\scripts\release\cut.ps1 -Version 0.10.0 -DryRun`
3. Real cut: same with `-Push` (type `v0.10.0` when asked, or `-ConfirmPush v0.10.0`). Pushes main + tag atomically.
4. `release.yml` re-runs the gate and drafts the GitHub Release (tgz + sha256). Review the draft and publish it (owner step).
5. Edit FEATURES.md "0.10.0 (unreleased)" labels only if the version changes. Never push a tag unasked.

## Global install
`powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\dirty\projects\docket\scripts\release\install.ps1 -Tag v0.10.0 -DryRun`, then without `-DryRun`. It verifies the SHA-256, runs `npm install --global` on the ABSOLUTE tgz path, `docket gate promote`, `docket gate install`. Expect `dk activity --help` and `dk worktree release --help` to work afterwards.

## What H2 needs (harness prune/sweep)
- After a successful worktree removal, call `dk worktree release --path <removed worktree path> --json` from the main checkout (or `--repo`); failure must not block removal; log only. Exit 0 with no matches is normal.
- Until the global install is done, call `node C:\Users\dirty\projects\docket\src\cli\main.mjs worktree release ...` (or wait for tonight's install).
- Known gap: an unrecorded wip item (claimed before this change, or claimed on master and never touched from the worktree) has no binding, so release will not reset it; the hygiene scan flags it via the commit-message fallback instead. Provisional transfer is deferred.
- Release of a physically removed path was not tested by the validator; test it in H2 (path is canonicalized even when removed, per the slice's tests).

## What Knowledge needs
- Call `dk activity --json [--id <id>]...` once per repo per request (`--repo <root>`); output `{ok,data:{items:[{id,branch,worktree,lastCommitAt,quietDays,...}]}}`; `quietDays`/`lastCommitAt` are null with a reason when unknown: show no suffix then, never "0d".
- Render `quiet Nd` on wip headers only; soft-fail to the existing header on missing exe, old Docket without `activity`, timeout or bad JSON. Needs 0.10.0 installed (or the repo main.mjs path).
- Gate: `uv run pytest tests/test_items.py tests/test_item_activity.py tests/test_search_service.py`.

## Open
- Branchless-wip census (how many current wip items in command-deck lack a branch) is unmeasured; after install run `dk activity --json` in command-deck. Decides whether provisional-claim transfer gets built.
