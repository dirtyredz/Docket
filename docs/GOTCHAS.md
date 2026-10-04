# GOTCHAS

Non-obvious traps, from `PLAN.md` sections 6 and 7 and the merge test. Design-time list; extend it as
code lands.

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
