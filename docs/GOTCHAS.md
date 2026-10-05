# GOTCHAS

Non-obvious traps, from `PLAN.md` sections 6 and 7, the merge test, and building M0 to M1c.

- **External-editor race.** Docket locks only cooperating Docket writers. An editor (or an agent
  writing the file directly) can save between the revision check and the rename; that write is lost or
  overwrites. Whole-file canonical rewrite is accepted because items are small and body bytes are kept.
- **Item write and claim update are not transactional.** If the item write succeeds and claim cleanup
  fails, report the incomplete cleanup; do not claim the item write failed.
- **Windows file locks.** Rename onto a file held open by an editor, antivirus or indexer can fail
  transiently. Atomic write retries with backoff; test it. Prefer temp file in the same directory.
- **Rank edge cases.** Generated ranks use a dense subset of `[a-z]+`. A hand-written legal rank can
  leave no representable gap between neighbours; `docket` returns a clear error instead of rewriting a
  whole priority band. Duplicate ranks within a priority are warnings, not errors. Order is
  priority, bytewise rank, then ID.
- **Claims are invisible across machines and cloud agents.** `docket-claims.json` lives in the git
  common dir: it covers linked worktrees of one clone only. Independent clones and remote agents do not
  see each other. Claims are advisory; durable state is `status: wip` + `since` on the branch.
- **Gate recovery.** The pre-push gate runs the last-good install under `%LOCALAPPDATA%/Docket/gate/`,
  not the working tree. If a promotion fails the previous version stays active. A broken checkout must
  not break pushes; to recover, re-promote a tested tarball (`docket gate promote`). Promote schema
  support before committing items that need a new schema.
- **Adjacent-line edits conflict in git.** Frontmatter is one key per line, so two agents touching
  neighbouring keys (`since`/`area`, `area`/`priority`, `priority`/`rank`) on the same item conflict;
  so do concurrent appends to `fixes`, `blocked_by`, `relates`. No field order removes every adjacent
  pair (see `research/MERGE-TEST-RESULTS.md`). There is no merge driver; conflicts are logged first.
- **Git cannot catch two clean-but-wrong merges:** duplicate rank and a relation to a `dropped` item.
  `docket check` warnings are the only guard.
- **Hand-written IDs and ranks collide.** Only `add` assigns them; the M0 seed items are the single
  bootstrap exception.
- **Structure pause/opt-out must not skip Docket.** In the managed hook, Docket validation runs before
  the structure early returns; LFS runs first and stdin is buffered and replayed to each consumer.
- **Dual ID prefixes forever.** `dk-` and `bl-` are both valid and immutable; code must never
  special-case one or treat `bl-` as an alias.
- **Node 22 here, not 24.** The machine runs Node 22.20; `engines` is `>=22` and code avoids
  24-only APIs (ADR-13). Keep `node --test` globs quoted in npm scripts: cmd.exe does not expand them,
  Node does.
- **Lock breaking must verify.** A check-then-delete of a "stale" lock deleted a lock re-taken in
  between (lost claims under parallel load). Break by rename-then-verify only (ADR-12).
- **Prettier must never touch `docs/items/`.** The style Stop hook formats changed files at turn end;
  `.prettierignore` excludes `docs/items/`, `tests/fixtures/` and the recovered prototype.
- **Claude's PreToolUse push guard matches any `git push` text**, even a push to a disposable bare
  remote in a temp dir, while this repo has a pending structure review. Gate proofs with real pushes
  therefore live in `tests/integration` and `tests/packaging` (spawned by node), not ad-hoc shells.
- **Template changes reach every gated repo.** The harness hook-sync rewrites each managed
  `.git/hooks/pre-push` from the template at session start. The Docket callback is inert without
  `docket.gateLauncher` in local git config, so un-opted repos are unaffected.
- **The prototype rejects a BOM only by accident** (the BOM breaks its line-1 fence match); its header
  gaps list is otherwise accurate: no warnings, no real-date or `fixes`-target checks, whole-file
  tab and trailing-space ban.
- **`git push` from GUI clients may lack `node` on PATH.** The gate records `docket.gateNode` (an
  absolute node path) at install; re-run `docket gate install` after moving Node.
- **`list` is bounded at 500.** Tools that need every item page by priority, then status, and fail loudly if
  a slice still truncates.
- **Spawn Docket as `node <main.mjs>`, not `docket.cmd`.** Node refuses to spawn `.cmd` files without a shell;
  adapters find `node_modules/docket/src/cli/main.mjs` beside the `docket` launcher on PATH, or `DOCKET_CLI`.
- **`init` leaves an empty `docs/items/`.** Git does not track empty directories; the folder appears in the
  repo with the first `dk add`. Re-running `init` is safe: the snippet is detected by its heading, so do not
  rename `## Work items (Docket)` in an agent file or it is appended again.
- **Legacy `bl-` IDs are valid, not special.** A repo moved in from an older backlog may keep `bl-<8hex>` IDs
  verbatim, but the move-in playbook mints fresh `dk-` IDs with `dk add`.
