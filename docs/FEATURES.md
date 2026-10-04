# FEATURES

Capability inventory. Status vocabulary: planned, in progress, shipped. Items and their statuses live
in `docs/items/`; this page does not duplicate them. Milestones are in `ROADMAP.md`.

| Capability                                                             | Milestone | Status  |
| ---------------------------------------------------------------------- | --------- | ------- |
| Strict item parser and canonical serializer (unchanged body bytes)     | M1a       | planned |
| `docket check`: all nine ITEM-SPEC check groups, `--ref` for Git trees | M1a       | planned |
| `add` (assigns `dk-` ID and rank), `set`, `link`, `list`, `show`       | M1b       | planned |
| Per-worktree JSON index, rebuilt from hashes                           | M1b       | planned |
| Advisory claims across linked worktrees (`claim`, `release`)           | M1b       | planned |
| Safe writes: lock, revision check, atomic rename                       | M1b       | planned |
| `--repo` on every command, `--json` for agents                         | M1b       | planned |
| Tarball install, `docket` and `dk` aliases                             | M1b       | planned |
| Last-good pre-push gate composed with LFS and structure checks         | M1c       | planned |
| EvilEye importer with byte-verified dry run and resumable apply        | M2a       | planned |
| EvilEye cutover; legacy portal retired                                 | M2b       | planned |
| Repo registry (`docket repo add/list/remove`)                          | M3        | planned |
| Priority-checkbox importer for other repos                             | M3        | planned |
| Local viewer/editor (`docket serve`): board, editor, relations         | M4        | planned |
| Read-only rendering of the seven living docs                           | M4        | planned |
| Derived "blocked" badge; worktree overlays                             | M4        | planned |
| Conflict recording and report (`docket conflicts`)                     | M5        | planned |

Not planned in this scope: MCP server, cross-machine claims, status event history, merge driver,
central database.
