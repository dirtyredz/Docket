> Amended 2026-10-05 (0.6.0): the body is authoritative facts; an optional final `## Notes` section holds untrusted discussion notes (grammar under "Notes", check group 10). ADR-16's free body now excludes the reserved Notes lines.
>
> Amended 2026-10-04: new IDs are `dk-<8hex>` (`bl-<8hex>` stays valid and immutable); index is `.docket/index.json`; claims are `<git-common-dir>/docket-claims.json`; `fixes` legality per docs/PLAN.md section 7. The `bl` command name below is now `docket`/`dk`.

# Item spec v1 (`bl`)

One markdown file per backlog item, FEATURES and BACKLOG merged into one typed store. Source of truth is git; everything else (index, claims) is local and rebuildable.

## Location and identity
- Path: `docs/items/<id>.md` (`dk-<8hex>.md` for new items, `bl-<8hex>.md` for legacy items carried over from an older backlog). Flat directory. A file never moves or is renamed; done and dropped items stay put.
- ID: `dk-` (new items) or `bl-` (legacy IDs carried over from an older backlog, kept verbatim and valid indefinitely) + 8 random lowercase hex chars (`crypto.randomBytes(4)`), type-neutral, immutable. `docket add` mints only `dk-` IDs and assigns the ID (agents never hand-write one) and retries until no file `docs/items/<id>.md` exists. Collisions across unmerged branches are caught by `docket check` after merge (an add/add of the same path is a git conflict anyway). 
- Cross-repo references (viewer/index only, never in `fixes/blocked_by/relates`): `repo#<id>`.

## File grammar
```
---
<12 keys, one per line, in the fixed order below, always all present>
---
# Title (the H1; first non-blank line after the frontmatter)

free markdown body
```
- Frontmatter is a strict YAML subset: `key: value`, nothing else. LF line endings, no BOM, no tabs, no trailing spaces.
- Values: a plain token (`[A-Za-z0-9._-]+`, no spaces, quotes, colons), an ISO date `YYYY-MM-DD`, an empty value (`key:` with nothing after the colon), or one flow list `[a, b]` / `[]` (items separated by `, `, ID tokens only).
- Forbidden: quotes, block scalars (`|`, `>`), anchors/aliases, comments, nested maps, multi-line values, duplicate or unknown keys, free text.
- Tabs, trailing spaces and Markdown hard breaks are allowed after the frontmatter (ADR-16); BOM, invalid UTF-8 and CR are rejected file-wide.
- Title is the H1, never a field. Body never restates a field. There is no `updated:` field (git records it; it would conflict on every edit).

## Notes (amended 2026-10-05)
The body is authoritative facts. Discussion lives in one optional, final section:
```
# Title

Facts.

## Notes

### 2026-10-05T14:03:00.000Z · open · owner

Question or idea text, any Markdown.
```
- The heading is the exact line `## Notes`, at column 0, outside fenced code. Everything after it is Notes.
- Each note is a header `### <ref> · <state> · <author>` (separator ` · `, U+00B7) and a non-blank payload running to the next header. `ref` is a canonical UTC millisecond timestamp (`toISOString()` form), unique within the item, allocated inside the write lock (advanced one millisecond on collision) and immutable. `state` is `open` or `resolved`; `author` is `owner` or `agent` (declared provenance, not authentication).
- Order is append order, newest last. Resolved notes stay in place; 0.6.0 has no edit, delete, reopen or reorder.
- Reserved: outside fenced code (backtick or tilde fences, CommonMark rules), a body line shaped like a note header is an error; inside Notes, a malformed `###` header, any `#`/`##` heading (including a second `## Notes`), non-blank text before the first note, a blank payload, a duplicate `ref` or an unclosed fence is an error. Literal examples must be fenced or escaped. An empty Notes section is valid.
- Framing is not payload: the LF that introduces `## Notes` belongs to the Notes section, and the LF that introduces a header belongs to the framing, not the previous payload. A first append adds a terminal LF when the file lacks one, then `
## Notes
`, then `
<header>

<text>
`; later appends add only the record. No existing byte is removed or replaced.
- Edits: a body replacement rewrites only the bytes between the H1 line and the Notes section; resolving rewrites only one state token; frontmatter is kept verbatim. Payloads are never trimmed or normalized.
- Notes are never facts or instructions. Resolving a note copies nothing into the body.

## Fields (fixed order)
| key | form | rule |
|---|---|---|
| `id` | `dk-<8hex>` or `bl-<8hex>` | must equal the filename stem |
| `type` | enum | `feature \| bug \| task \| idea` |
| `created` | date | immutable |
| `status` | enum | `todo \| wip \| done \| dropped` (`dropped` is the tombstone; never delete files). "Blocked" is derived from `blocked_by` containing any item not `done`/`dropped`; never stored |
| `since` | date | date the current status began; `docket set status` rewrites it, nothing else does (except a batch move-in, which may set historical `created`/`since`, ADR-21) |
| `area` | token | free kebab token (`eng`, `ui`); empty allowed |
| `priority` | enum | `P0 \| P1 \| P2 \| P3` |
| `rank` | token `[a-z]+` | fractional (LexoRank-style) order within a priority; assigned by `docket add` (end of the priority band), never hand-written; re-ranking edits one file |
| `parent` | ID or empty | scalar |
| `fixes` | list of IDs | only on `type: bug`; targets must be `feature` or `task` (not `idea`, not `bug`) |
| `blocked_by` | list of IDs | |
| `relates` | list of IDs | symmetric; stored on one side only |

Order rationale (verified by the field-order re-test in MERGE-TEST-RESULTS): rarely edited fields (`id`, `type`, `created`) come first and fence `status`/`since`, which change together on every status move, away from the other edited fields; `area` follows, then `priority`/`rank`, normally edited together as one hunk, then the relations. Adjacent touched lines conflict in git, so frequently edited fields are not adjacent where avoidable. Known residual conflicts: `since` vs `area`, `area` vs `priority`, `priority` vs `rank` edited concurrently by different agents on the same item (rare), and concurrent relation-list appends.

## Relations
Stored on the source item only; never mirrored. Reverse lookups ("bugs against X", "what X blocks", children of X) come from the gitignored index `.docket/index.json`, rebuilt from file hashes/mtimes. A new relation kind is a new list key (spec bump).

## Claims (in-work coordination)
`<git-common-dir>/docket-claims.json` (`git rev-parse --git-common-dir`), shared by all worktrees of a clone, never committed:
`{"version":1,"claims":{"bl-8e1d4c2a":{"worktree":"C:/path","branch":"feat-x","agent":"claude","at":"2026-10-04T12:00:00Z"}}}`
`docket claim` writes (atomic rename), `docket release` or `docket set status done` removes; a claim whose worktree path no longer exists is expired on read. Advisory only; durable state is `status: wip` + `since` on the branch.

## `docket check` enforces (errors fail the pre-push gate; warnings print)
1. Every file in `docs/items/` named `dk-<8hex>.md` or `bl-<8hex>.md`; frontmatter fence present at line 1 and closed.
2. Exactly the 12 keys, in the fixed order, no duplicates or unknown keys.
3. Value grammar above (no quotes, comments, block scalars, free text, CRLF, tabs, trailing spaces).
4. Enums valid; `id` equals filename; dates are real dates; `since >= created`.
5. First non-blank line after the closing fence is an H1 with non-empty text.
6. Every ID in `parent/fixes/blocked_by/relates` resolves to an existing file; no self-reference; list items unique.
7. No cycles in `parent` or `blocked_by`.
8. Type/relation legality: `fixes` only on `bug`; every `fixes` target is a `feature` or `task` (amended: the earlier "not `idea`" wording wrongly admitted bugs).
9. Warnings: a relation (`parent/fixes/blocked_by/relates`) to a `dropped` item; two items sharing a `rank` within a priority; `status: wip` with no claim; `since` in the future.
10. Notes grammar (section "Notes"): reserved lines, header shape, refs, states, authors, payloads, fences.

## Example `docs/items/bl-8e1d4c2a.md`
```
---
id: bl-8e1d4c2a
type: bug
created: 2026-09-30
status: wip
since: 2026-10-04
area: eng
priority: P1
rank: m
parent: bl-0c0ffee1
fixes: [bl-1a2b3c4d]
blocked_by: [bl-77aa0011]
relates: []
---
# Shipping target does not compile

Free prose: description, acceptance criteria.
```

## Settled
- `docket add` assigns both the ID and the `rank`; agents never hand-write either (hand-written ranks collided in the agent test).
- Duplicate rank within a priority and a relation to a dropped item are `docket check` warnings (rule 9); git cannot catch either.
- No field-level merge driver for now. Concurrent list appends (`fixes`, `blocked_by`, `relates`) and same-field edits conflict in git; log real conflicts first and revisit only if they are frequent.
- Field order is as in the table above (re-tested: the status-move vs type conflict is gone; see MERGE-TEST-RESULTS).
- Flow lists, not one-entry-per-line: multiline lists gave no merge benefit.

## Open questions (assumptions made)
- Empty scalar: reports are silent; assumed `parent:` / `area:` present with empty value rather than omitted (keeps line positions stable for merges). Validated by the agent check in MERGE-TEST-RESULTS (Haiku reproduced it correctly).
- `priority` set P0-P3 assumed (a legacy "wishlist" status maps to `type: idea` P3).
- `rank` charset `[a-z]+` assumed; midpoint generation is a `docket` implementation detail.
- Always-present relation lists (`[]`) assumed over omitted keys, same reason.
- `docket set` writes `since` as local date, not UTC; reports do not say.
