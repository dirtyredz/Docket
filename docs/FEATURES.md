# FEATURES

Capability inventory. Status vocabulary: planned, in progress, built (in the checkout, not yet in an installed tarball),
shipped. Shipped in 0.1.0 (2026-10-04): M0 to M1c. 0.2.0 (2026-10-05): the one-off legacy import and cutover for
the first adopter. 0.3.0 (2026-10-05): importers removed, `docket init` and the move-in playbook added. 0.4.0 (2026-10-05): move-in ergonomics. Items and their statuses live
in `docs/items/`; this page does not duplicate them. Milestones are in `ROADMAP.md`.

| Capability                                                                   | Milestone | Status  |
| ---------------------------------------------------------------------------- | --------- | ------- |
| Strict item parser and canonical serializer (unchanged body bytes)           | M1a       | shipped |
| `docket check`: all nine ITEM-SPEC check groups, `--ref` for Git trees       | M1a       | shipped |
| `add` (assigns `dk-` ID and rank), `set`, `link`, `list`, `show`             | M1b       | shipped |
| Per-worktree JSON index, rebuilt from hashes                                 | M1b       | shipped |
| Advisory claims across linked worktrees (`claim`, `release`)                 | M1b       | shipped |
| Safe writes: lock, revision check, atomic rename                             | M1b       | shipped |
| `--repo` on every command, `--json` for agents                               | M1b       | shipped |
| Tarball install, `docket` and `dk` aliases                                   | M1b       | shipped |
| Last-good pre-push gate composed with LFS and structure checks               | M1c       | shipped |
| Agent snippet for CLAUDE.md / AGENTS.md (`src/integration/`)                 | M2a       | shipped |
| `docket init [--gate]`: idempotent repo setup, agent snippet                 | M3        | shipped |
| Move-in playbook for existing backlogs (`docs/MOVE-IN.md`)                   | M3        | shipped |
| 0.4.0: `add --batch` (all-or-nothing JSON array)                             | M3        | shipped |
| 0.4.0: `--body-file -` (stdin body) and `add --json` (full item)             | M3        | shipped |
| 0.4.0: `list --count-by FIELD` and `--rank`                                  | M3        | shipped |
| 0.4.0: per-command `--help` with enum values from the schema                 | M3        | shipped |
| 0.4.0: `init` / `gate install` report created/updated/unchanged, `--dry-run` | M3        | shipped |
| Repo registry (`docket repo add/list/remove`)                                | M3        | planned |
| Local viewer/editor (`docket serve`): board, editor, relations               | M4        | planned |
| Read-only rendering of the seven living docs                                 | M4        | planned |
| Derived "blocked" badge; worktree overlays                                   | M4        | planned |
| Conflict recording and report (`docket conflicts`)                           | M5        | planned |

Not planned in this scope: MCP server, cross-machine claims, status event history, merge driver,
central database.
