# FEATURES

Capability inventory. Status vocabulary: planned, in progress, built (in the checkout, not yet in an installed tarball),
shipped. Shipped in 0.1.0 (2026-10-04): M0 to M1c. 0.2.0 (2026-10-05): the one-off legacy import and cutover for
the first adopter. 0.3.0 (2026-10-05): importers removed, `docket init` and the move-in playbook added. 0.4.0 (2026-10-05): move-in ergonomics. 0.4.1 (2026-10-05): move-in fixes from the first real batch. 0.4.2 (2026-10-05): batch dates and playbook gaps. 0.4.3 (2026-10-05): `set --title`. 0.4.4 (2026-10-05): `init` keeps Prettier off `docs/items/`. 0.4.5 (2026-10-05): `init --no-agent-snippet`. 0.5.0 (built, unpushed): repo registry (its viewer was removed in 0.7.0). 0.6.0 (built, unpushed): facts and notes, content editing, managed agent snippet, `docket guide`. 0.7.0 (built): viewer removed, Command Deck is the UI. 0.8.0 (built): headless library contract. Items and their statuses live
in `docs/items/`; this page does not duplicate them. Milestones are in `ROADMAP.md`.

| Capability                                                                                   | Milestone | Status  |
| -------------------------------------------------------------------------------------------- | --------- | ------- |
| Strict item parser and canonical serializer (unchanged body bytes)                           | M1a       | shipped |
| `docket check`: all nine ITEM-SPEC check groups, `--ref` for Git trees                       | M1a       | shipped |
| `add` (assigns `dk-` ID and rank), `set`, `link`, `list`, `show`                             | M1b       | shipped |
| `set --title`: rewrites the H1 only (body and frontmatter bytes kept)                        | M1b       | shipped |
| Per-worktree JSON index, rebuilt from hashes                                                 | M1b       | shipped |
| Advisory claims across linked worktrees (`claim`, `release`)                                 | M1b       | shipped |
| Safe writes: lock, revision check, atomic rename                                             | M1b       | shipped |
| `--repo` on every command, `--json` for agents                                               | M1b       | shipped |
| Tarball install, `docket` and `dk` aliases                                                   | M1b       | shipped |
| Last-good pre-push gate composed with LFS and structure checks                               | M1c       | shipped |
| Agent snippet for CLAUDE.md / AGENTS.md (`src/integration/`)                                 | M2a       | shipped |
| `docket init [--gate]`: idempotent repo setup, agent snippet                                 | M3        | shipped |
| Move-in playbook for existing backlogs (`docs/MOVE-IN.md`)                                   | M3        | shipped |
| 0.4.0: `add --batch` (all-or-nothing JSON array)                                             | M3        | shipped |
| 0.4.0: `--body-file -` (stdin body) and `add --json` (full item)                             | M3        | shipped |
| 0.4.0: `list --count-by FIELD` and `--rank`                                                  | M3        | shipped |
| 0.4.0: per-command `--help` with enum values from the schema                                 | M3        | shipped |
| 0.4.0: `init` / `gate install` report created/updated/unchanged, `--dry-run`                 | M3        | shipped |
| 0.4.1: dry-run reports git config keys as "would be created"; MOVE-IN rules                  | M3        | shipped |
| 0.4.2: `add --batch` entries take `created`/`since` historical dates (ADR-21)                | M3        | shipped |
| 0.4.4: `init` lists `docs/items/` in `.prettierignore` when the repo uses Prettier           | M3        | shipped |
| 0.4.5: `init --no-agent-snippet` skips CLAUDE.md / AGENTS.md (never creates one)             | M3        | shipped |
| 0.5.0: `docket repo add/list/remove` (aliases, worktree groups, `--doc` metadata)            | M3a       | built   |
| 0.5.0: `docket repo scan <dir> [--dry-run]` (one-shot, additive)                             | M3b       | built   |
| 0.5.0: `set`/`link --expect` also guard no-ops (scalar `--expect`)                           | M4c       | built   |
| 0.6.0: item body is facts; optional final `## Notes` (untrusted discussion, check group 10)  | M6        | built   |
| 0.6.0: `note <id> "text"` (or `--file`, `--author`), `note resolve <id> <ref>`               | M6        | built   |
| 0.6.0: `set --body-file` replaces the body (`--expect` required; Notes kept)                 | M6        | built   |
| 0.6.0: `list --notes open`, `show` facts/notes sections, JSON body, notes, openNoteCount     | M6        | built   |
| 0.6.0: index v2 (open-note count only); `--all --notes open` covers closed items             | M6        | built   |
| 0.6.0: managed, versioned agent snippet in CLAUDE.md and AGENTS.md; in-place upgrade         | M6        | built   |
| 0.6.0: `docket guide` prints the tool-neutral agent guide (`docs/AGENT-GUIDE.md`)            | M6        | built   |
| 0.7.0: viewer and `docket serve` removed (exits 2 with a removal message; ADR-29)            | M7        | built   |
| 0.8.0: headless library: narrow subpath exports, `docs/LIBRARY.md` contract (ADR-30)         | M8        | built   |
| 0.8.0: `relationsView` and `linkItem` revision maps (selected item + reverse-stored holders) | M8        | built   |
| 0.8.0: exact-root and registered checkout opening, containment guard, last-good registry     | M8        | built   |
| CI on hosted Windows (full gate, tarball artifact); `v*` tag -> draft release + SHA-256      | -         | built   |
| Owner scripts: `scripts/release/cut.ps1` (bump, tag, confirmed push), `install.ps1`          | -         | built   |
| Conflict recording and report (`docket conflicts`)                                           | M5        | planned |

Not planned in this scope: MCP server, cross-machine claims, status event history, merge driver,
central database.
