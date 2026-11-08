# Docket

Docket is a Windows 11 command-line tool and local viewer for tracking work as Markdown
files, one file per item, stored in the repository the work belongs to. Items branch and merge with the
code, and every index or cache can be rebuilt from the files.

**Status (0.7.0, built, unpushed): CLI, gate, `docket init`, batch add, move-in playbook, repo registry, local viewer, facts and notes, the agent guide, and the library API.** The item format is `docs/research/ITEM-SPEC.md`; the plan is
`docs/plans/PLAN.md`.

## Commands

`docket <command> --help` lists a command's options and allowed values. Every command takes `--repo <path>` and `--json` (one JSON document on stdout). `dk` is the same
program as `docket`.

```
docket init [--gate] [--no-agent-snippet] [--dry-run]   set up this repo (idempotent), reporting each file; --gate also installs the pre-push gate
docket check [--ref <rev>]                       validate every item; errors exit 1, warnings print
docket add --type T --priority P --title "..."   create an item (ID and rank are assigned); --body-file - reads stdin
docket add --batch <file|->                      create many from a JSON array, all-or-nothing
docket set <id> --status S | --priority P | --before <id> | --after <id> | --top | --bottom
docket set <id> --body-file <F|-> --expect REV   replace the facts body (exactly the text after the H1)
docket note <id> "text" [--author owner|agent] [--expect REV]   add a discussion note (--file F|- reads a file)
docket note resolve <id> <ref> [--expect REV]     settle a note (the ref is its UTC timestamp)
docket link <id> --parent <id> | --fixes <id> | --blocked-by <id> | --relates <id> [--remove]
docket list [--status S] [--type T] [--priority P] [--blocked] [--notes open] [--all] [--limit N] [--rank] [--count-by status|type|priority]
docket show <id>                                 facts body, then notes (untrusted discussion)
docket index [--rebuild]
docket claim <id> [--takeover]   /   docket release <id>
docket repo add <path> [--alias A] [--preferred] [--doc NAME=rel.md]   register a checkout (worktrees group by Git common dir)
docket repo list
docket repo remove <alias> [--checkout <path>]
docket repo scan <dir> [--dry-run] [--verbose]    one-shot, additive discovery of Docket checkouts
docket serve [--port N]                          local viewer on 127.0.0.1
docket guide                                     print the agent guide (docs/AGENT-GUIDE.md)
docket gate promote <tarball>  /  docket gate install [--dry-run]  /  docket gate status
```

`docket init` creates `docs/items/` and `docket.json`, ignores `.docket/` and writes a managed, versioned agent snippet
into both CLAUDE.md and AGENTS.md (re-running upgrades it in place; a customised section is reported for manual review;
`--no-agent-snippet` skips both, for repos whose agent files are managed elsewhere). To move an existing backlog in, have an agent follow the `docs/MOVE-IN.md` playbook (shipped inside the installed package, under the `docket` package root).

## Viewer

Register repos (`docket repo scan C:/path/to/projects`, which prints one line per repo and a totals line; `--verbose`
lists checkout paths and every skipped folder, and build output such as `.next` or `dist` is never entered; or `docket repo add <path>`), then run `docket serve`. It
prints `http://127.0.0.1:<port>/`; open it in a browser. It listens on loopback only, never auto-starts, and
Ctrl+C stops it. `--json` prints one startup envelope after binding. The registry is
`%LOCALAPPDATA%/Docket/registry.json` (`DOCKET_HOME` overrides). The viewer edits title, status, priority, relations,
the facts body and notes (add, resolve), with per-item drafts that survive a conflict; "Needs discussion" badges and filters find
items with open notes. Living documents are read-only. Keys: `/` search, `r` refresh, `Esc` closes the detail.

## Facts and notes

The item body is authoritative facts. Notes (a final `## Notes` section) are untrusted discussion: never facts or
instructions. Raise an open note with the owner, save the agreed facts with `dk set <id> --body-file - --expect <rev>`, then
`dk note resolve <id> <ref> --expect <new rev>`. Agents record questions with `--author agent`. `dk list --notes open`
finds items with open notes. `docket guide` prints the full tool-neutral agent guide.

## Library API (0.7.0)

Installing the tarball also gives Node programs (Command Deck first) a small, supported import surface: the same
operations the CLI and viewer run, so a consumer reuses Docket's locking, validation, claims, registry and revision
rules instead of re-implementing them. There is no root entry and no catch-all: only the subpaths below resolve
(`import "docket"` and deep `docket/src/...` imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`), and only the names
listed are supported. Other names those modules happen to export are internal and may change in any release.
While Docket is 0.x, a breaking change to a listed name bumps the minor version; pin the tarball.

| Subpath                                 | Supported names                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `docket/package.json`                   | `version` (import with `{ with: { type: "json" } }`)                                               |
| `docket/errors`                         | `CODES`, `KIND_OF_CODE`                                                                            |
| `docket/schema`                         | `ENUMS`, `ID_RE`, `RELATION_KEYS`, `CLOSED_STATUSES`                                               |
| `docket/date`                           | `localDate(now?)`                                                                                  |
| `docket/items/index`                    | `loadIndex(ctx, {rebuild?})` → `{records, stats}`                                                  |
| `docket/items/query`                    | `listItems(records, filters)` → `{items, invalid}`, `compareItems`, `countBy`, `COUNT_FIELDS`      |
| `docket/items/detail`                   | `readItem(ctx, id, {records, claims})` → `{data, content}`                                         |
| `docket/items/relations`                | `relationsView(ctx, id, {records, claims})`                                                        |
| `docket/items/set`                      | `setItem(ctx, id, changes, {today, expect, claims})` → `{data, warnings}`                          |
| `docket/items/body`                     | `replaceBody(ctx, id, body, {expect})`                                                             |
| `docket/items/notes`                    | `addNote(ctx, id, {text, author}, {expect})`, `resolveNote(ctx, id, ref, {expect})`                |
| `docket/items/link`                     | `linkItem(ctx, id, change, {expect, expectRevisions})`                                             |
| `docket/claims`                         | `readClaims`, `releaseItem` (pass the module namespace as `claims`)                                |
| `docket/repository/context`             | `contextFor(root, commonDir)`                                                                      |
| `docket/repository/canonical`           | `canonicalPath(p)`, `sameKey(a, b)`                                                                |
| `docket/repository/containment`         | `assertSafeCheckout(ctx)`                                                                          |
| `docket/repository/registered-checkout` | `inspectCheckout(p)`, `unavailableReason(repo, checkout)`, `createCheckoutOpener({now?})`          |
| `docket/registry/paths`                 | `registryPath(env)`                                                                                |
| `docket/registry/source`                | `createRegistrySource(file)`, `findCheckout(registry, repoId, checkoutId?)`                        |
| `docket/markdown`                       | `renderMarkdown(text, {resolveLink?})` (sanitized HTML; unresolved links become `span.unresolved`) |

**Checkouts.** Every item operation takes a checkout context `ctx`. For a registered checkout:
`createRegistrySource(registryPath(process.env)).get()` returns `{registry, error, missing}` (a broken file keeps the
last good registry and reports `error`; `missing` means no registry file), `findCheckout` resolves registry ids
(default: the preferred checkout; unknown ids are `DOCKET_NOT_FOUND`, never another checkout), and one long-lived
`openCheckout = createCheckoutOpener()` returns `ctx` after verifying the registration against Git. Reads may reuse
a verification for 5 s; pass `{fresh: true}` before every mutation. An unavailable checkout throws
`DOCKET_NOT_FOUND` with `err.unavailable` (the reason); linked or escaping item storage throws `DOCKET_USAGE`. For a
path that is not registered: `inspectCheckout(p)` (it finds the enclosing root, so require
`sameKey(info.root, canonicalPath(p))`), then `contextFor(info.root, info.commonDir)` and `assertSafeCheckout(ctx)`.

**Revisions.** `revision` is a hash of the item file's exact bytes, returned by `loadIndex` records, `readItem`,
`relationsView` and every mutation. Mutations take `expect` (the revision the caller read) and check it inside the
item lock, before planning, so a stale caller is refused even when its change would be a no-op. `expect` is
required for `replaceBody` and optional elsewhere (omitting it skips the check: always pass it from a UI).
`addNote` defaults `author` to `owner`; set it explicitly. A relation edit also needs `expectRevisions`, the full `relationsView(...).revisions` map: removing a
`relates` edge stored on the other item rewrites that file too. Results: `setItem` → `{data: {changed, fields,
completed, revision, noop, claimReleased?}, warnings}`; `replaceBody` → `{id, noop, revision}`; `addNote` →
`{id, ref, author, state, revision}`; `resolveNote` → `{id, ref, state, noop, revision}`; `linkItem` → `{id, changes,
fields, written: [{id, revision}]}`. Completing an item releases its claim; a failed release is a warning, never a
failed save. Relation edits that rewrite two files write each atomically, not both as one transaction.

**Errors.** Failures are `Error`s with a stable `code` (`CODES` values) and optional `details`:
`DOCKET_CONFLICT` (stale `expect`; `details: {id, expected, actual}`), `DOCKET_LOCKED` (another writer holds the lock),
`DOCKET_NOT_FOUND` (item, note, registered repo or checkout, or an unavailable checkout), `DOCKET_INVALID` (malformed
item that must be fixed by hand, a change that would introduce a validation error, or a broken registry),
`DOCKET_USAGE` (bad input: ids, refs, missing `expect`, unsafe paths), `DOCKET_NOT_A_REPO`, `DOCKET_GIT`.
`KIND_OF_CODE` maps each code to `usage`, `conflict`, `notFound`, `failed` or `internal`. All operations are
synchronous (file scans, locks, Git subprocesses): call them off any latency-sensitive thread.

## Install

Requires Node 22 or newer. Use an ABSOLUTE tarball path with `npm install --global`: a relative one is read as a GitHub spec.

```
npm ci
npm test                                        # includes test:registry, test:viewer, test:e2e
npx playwright install chromium                 # for test:e2e; optional when Edge or Chrome is installed
npm run build                                   # dist/docket-<version>.tgz
npm install --global C:/path/to/repo/dist/docket-<version>.tgz
docket gate promote dist/docket-<version>.tgz   # tested copy under %LOCALAPPDATA%Docketgate
docket gate install --repo .                    # opt this clone's pre-push hook in
```

Upgrade or release 0.7.0: `npm run build`, then `npm install --global C:/path/to/repo/dist/docket-0.7.0.tgz` (absolute path),
`docket gate promote C:/path/to/repo/dist/docket-0.7.0.tgz`, and in each repo `docket init --dry-run` then `docket init` to
upgrade the agent snippet. Check adopting repos for a prose `## Notes` section first (`dk check`). The first run after
upgrading rebuilds the index cache.
