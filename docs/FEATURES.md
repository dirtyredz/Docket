# FEATURES

Capability inventory. Status vocabulary: planned, in progress, shipped. Shipped in 0.1.0 (2026-10-04):
M0 to M1c, installed globally and gating Docket's own pushes. Items and their statuses live
in `docs/items/`; this page does not duplicate them. Milestones are in `ROADMAP.md`.

| Capability                                                             | Milestone | Status  |
| ---------------------------------------------------------------------- | --------- | ------- |
| Strict item parser and canonical serializer (unchanged body bytes)     | M1a       | shipped |
| `docket check`: all nine ITEM-SPEC check groups, `--ref` for Git trees | M1a       | shipped |
| `add` (assigns `dk-` ID and rank), `set`, `link`, `list`, `show`       | M1b       | shipped |
| Per-worktree JSON index, rebuilt from hashes                           | M1b       | shipped |
| Advisory claims across linked worktrees (`claim`, `release`)           | M1b       | shipped |
| Safe writes: lock, revision check, atomic rename                       | M1b       | shipped |
| `--repo` on every command, `--json` for agents                         | M1b       | shipped |
| Tarball install, `docket` and `dk` aliases                             | M1b       | shipped |
| Last-good pre-push gate composed with LFS and structure checks         | M1c       | shipped |
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
