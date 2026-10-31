# DECISIONS

ADRs, newest first. ADRs 01-18 are dated 2026-10-04 (inception); ADRs 19-28 are 2026-10-05; ADR-29 is 2026-10-11; ADR-30 is 2026-10-12; ADR-31 is 2026-10-31.
Evidence paths are relative to `docs/research/`.

## ADR-31: CI and draft releases on GitHub-hosted Windows; the hook template is vendored for CI

- **Context:** Shipping was a local `npm run build` plus three manual commands, and nothing ran the gate off the
  owner's machine. The integration and packaging suites need the harness hook template
  (`~/.claude/hooks/structure/pre-push.template.sh`), which a runner does not have; without it they skip.
- **Decision:** `.github/workflows/ci.yml` runs on push and pull request to `main` on GitHub-hosted
  `windows-latest` (Docket is Windows-first): `npm ci`, lint, `format:check`, the full `npm test`, `dk check`,
  `npm run build`, tarball uploaded. CI sets `DOCKET_HOOK_TEMPLATE` to a vendored snapshot,
  `tests/fixtures/hooks/pre-push.template.sh` (harness `3c682ce`), and `DOCKET_REQUIRE_HOOK_TEMPLATE=1`, so a
  missing template fails instead of skipping. `release.yml` runs on a `v*` tag: the tag must equal
  `v<package.json version>` and be on `main`, the CI workflow runs again as the gate, and its verified tarball
  goes into a DRAFT release with a `sha256sum` file. Owner steps are `scripts/release/cut.ps1` (bump, commit,
  tag; pushes only with `-Push` and a typed confirmation) and `install.ps1` (download with `gh`, verify the
  checksum, `npm install --global`, `docket gate promote`, `docket gate install`), on the owner-run template.
- **Rejected:** fetching the template from the private harness repo (a secret on a public repo, and CI would
  follow harness HEAD); an inline stub template (tests would stop exercising the real hook); the ANU
  self-hosted runner (needs owner approval; a public repo's PRs must not reach it); Linux CI like command-deck
  (Windows paths, locks and `.cmd` shims are what break); publishing from CI (the owner reviews the draft); a
  version allocated by CI (Docket's version is a library-contract decision, ADR-30).
- **Consequences:** The snapshot drifts from the harness; the pre-push suite reports drift as a diagnostic, and
  the fixture is refreshed by copying the harness file. Published releases are immutable: a re-run refreshes
  a draft's assets only.
- **Evidence:** `scripts/release/release-scripts.test.ps1` (`npm run test:scripts`: real cut and push against a
  local bare remote, sandboxed real install); `tests/integration/pre-push.test.mjs` (vendored template).

## ADR-30: Headless library contract for Command Deck (extends ADR-29)

- **Context:** Command Deck's Docket pages need complete queries, fresh detail, conflict-safe relation edits and
  verified registry/checkout scope. `dk --json` caps `list` at 500 and cannot express a relation revision map,
  and a process per request is too slow for a long-lived UI worker.
- **Decision:** 0.8.0 ships narrow subpath exports over the existing core operations (`docs/LIBRARY.md`; no root
  entry, no patterns, only listed names supported). ADR-29's removed headless pieces return as library
  capabilities, not as a viewer: `relationsView` and `linkItem`'s `expectRevisions` (the selected item plus the
  reverse-stored holders an edit actually rewrites, checked under the store lock before any write), explicit-root
  contexts (`contextAtRoot`, `openCheckoutAt`: no ancestor discovery), the containment guard, registered-checkout
  opening with an identity-keyed verification cache, and a last-good registry source with forced refresh. Docket
  still renders nothing. Exports target re-export-only facades in `src/library/`, never implementation modules.
- **Rejected:** CLI JSON only (capped, no revision maps); exports mapped at implementation modules (other names stay reachable); a catch-all export (makes every internal a contract);
  restoring a Markdown export (Command Deck sanitizes; Docket keeps no rendering dependency); worktree
  enumeration (not needed: Command Deck addresses registered checkouts only).
- **Consequences:** ADR-29 stands for the UI and its dependencies; the build still refuses viewer files and
  `marked`, `sanitize-html`, `playwright`. A breaking change to a listed export bumps the 0.x minor.
- **Evidence:** `tests/packaging/library.test.mjs` (installed-tarball imports, refused internals, end-to-end
  flow), `tests/unit/repository/`, `tests/unit/core/relations-view.test.mjs`, `revisions.test.mjs`.

## ADR-29: Viewer and HTTP API removed; Command Deck owns the UI

- **Context:** The 0.5/0.6 viewer (`docket serve`) was a second UI with its own loopback HTTP API, security
  boundary, browser tests and Markdown dependencies. Command Deck, a separate app, is now the UI.
- **Decision:** The viewer and its API are removed outright in 0.7.0 (owner decision 2026-10-11). Command Deck
  consumes Docket through CLI JSON output and core operations. `docket serve` stays only as a permanent
  removal diagnostic: exit 2, `DOCKET_USAGE`, "docket serve was removed in 0.7.0 — use Command Deck for the UI."
  Supersedes ADR-23 and ADR-25 entirely, and the viewer portions of ADR-22, ADR-24 and ADR-27 (their registry,
  content and revision decisions still apply). ADR-23 and ADR-25 moved to `records/decisions/2026-10.md`.
- **Rejected:** deprecate-then-remove (keeps a redundant UI and API alive, with its security boundary, browser
  tests and Markdown dependencies, for no user).
- **Consequences:** `marked`, `sanitize-html` and `playwright` are dropped. Viewer-only core is deleted: the
  relations read model, revision maps on `link`, worktree enumeration and real-path containment checks
  (all but worktree enumeration returned in 0.8.0 as headless library capabilities, ADR-30).
  Registry document overrides (`repo add --doc`) stay as stored, validated metadata, avoiding a CLI break and a
  registry migration. Scalar revision checks (`--expect`) stay.
- **Evidence:** owner decision 2026-10-11; `tests/packaging/cli.test.mjs` (serve error, no viewer files or deps).

## ADR-28: Managed, versioned agent snippet and a tool-neutral guide

- **Context:** The 0.5 snippet was an unmarked block detected by its heading: it could not be upgraded, and
  it carried all agent guidance inline in two instruction files.
- **Decision:** `init` writes a short block between `<!-- docket:agent-snippet begin v2 -->` and `end`
  markers into both CLAUDE.md and AGENTS.md (creating either), and re-running upgrades it in place. A managed block
  is classified by marker version and exact canonical content (blank lines and CR ignored): current-version
  canonical is unchanged; a known older version's exact canonical text, or the exact pre-0.6 unmarked text, is
  migrated; a customised block of any version, an unknown or newer version, duplicate or incomplete markers and
  a customised `## Work items (Docket)` section are reported "needs manual review", untouched, never given a
  second block. Line endings and surrounding bytes stay. The full guide ships as
  `docs/AGENT-GUIDE.md`, tool-neutral, printed by `docket guide`; the snippet points at it.
- **Rejected:** rewriting customised sections (destroys owner edits); heading-only detection (cannot tell
  versions apart); an agent-specific guide (Docket serves any agent).
- **Evidence:** `tests/integration` init and snippet cases; owner ruling 2026-10-05.

## ADR-27: Independent content mutations; body writes are allowed (viewer portions superseded by ADR-29)

- **Context:** Facts and notes change for different reasons and by different people; one whole-file save
  would let one overwrite the other.
- **Decision:** Body replacement, note append and note resolve are separate revision-checked writes. Each
  touches only its own bytes: frontmatter, title and untouched content stay verbatim, through a
  preserved-prefix transaction path. Settling a note is two writes, save the facts then resolve, so an
  interruption leaves the note open. The CLI and viewer share the operations; the viewer gains body and
  note endpoints, so documents stay read-only but item bodies are editable. This supersedes ADR-25's
  body restriction.
- **Rejected:** one combined save (hides which part conflicted); resolve copying text into the body
  (invents facts); body editing without `--expect` (silent overwrite).
- **Evidence:** `tests/unit/core`, `tests/unit/viewer` and `tests/e2e` content cases.

## ADR-26: Facts and discussion are separate: item body versus Notes

- **Context:** Agents read item text as instructions. Mixing owner discussion into the body let a stray
  comment pass as a fact.
- **Decision:** The body is authoritative facts. An optional final `## Notes` section holds notes
  (`### <UTC ms timestamp ref> · open|resolved · owner|agent`): untrusted discussion, never facts,
  instructions or authorization. Those lines are reserved and validated (check group 10, also on pushed
  tips). This refines ADR-16: the body is still free Markdown except the Notes grammar.
- **Rejected:** a sidecar notes file (splits one item across files and merges); free-form comments in the
  body (no trust boundary); editable or deletable notes (history).
- **Evidence:** `research/ITEM-SPEC.md` amendment 2026-10-05; `tests/unit/format/content.test.mjs`.

## ADR-24: Relation actions are single-edge and revision-checked inside the lock (viewer portions superseded by ADR-29)

- **Context:** A form that saved scalars and relations together could overwrite a concurrent edit, and
  `link` can write a second file (a relation stored on the other side).
- **Decision:** Scalar Save (title, status, priority) is separate from single-edge relation actions. Each
  request carries the revisions it read: the item, plus every relation holder it will touch (including
  reverse-stored `relates`). Core asserts them inside the lock, before planning, also for no-ops. A 409 is
  never retried automatically and keeps the browser draft. The CLI's `--expect` shares the same checks.
- **Rejected:** one combined save (hides which edge conflicted); asserting outside the lock (race);
  auto-retry (silently overwrites).
- **Evidence:** `core/items/revisions.mjs`; `tests/unit/core` and `tests/unit/viewer` conflict cases.

## ADR-22: One logical repo per Git common dir; the overview counts the preferred checkout (viewer portions superseded by ADR-29)

- **Context:** Linked worktrees of one clone repeat the same items. Counting each would inflate totals,
  and falling back to another branch would show wrong work.
- **Decision:** The registry groups checkouts by canonical Git common directory: linked worktrees join a
  group, independent clones stay separate. Overview and search read one preferred checkout per group,
  never failing over silently when it disappears (it reports unavailable). Editing needs an explicit
  checkout selection.
- **Rejected:** counting every worktree; automatic failover to any available checkout; one entry per path.
- **Evidence:** owner ruling 2026-10-05; `tests/unit/state/registry/` grouping cases.

## ADR-19: Importers removed; init + agent move-in

- **Context:** Docket must be project-agnostic. The first adopter import was byte-verified because it ran once
  against one real backlog; its cutover is done. Other repos have seven different legacy shapes.
- **Decision:** Importer code (`src/importers/`, `docket import`) is deleted. New projects start with
  `docket init`; an existing repo moves in once, through an agent following `docs/MOVE-IN.md` (`dk add`
  and `dk set` per old entry, count check, owner review). `bl-` stays valid as a generic legacy-ID
  prefix. The superseded import ADRs (17, 18) moved to `records/decisions/2026-10.md`.
- **Rejected:** one importer per legacy shape (code to maintain for single-use runs); keeping the
  the first adopter importer as an example (its provenance and journal machinery only served that run).
- **Evidence:** owner ruling 2026-10-05.

> Moved verbatim to `records/decisions/2026-10.md`: ADRs 20-21 (batch move-in, historical dates), 17-18
> (import, apply), 16 (frontmatter-only strictness), 15 (gate opt-in), 13-14 (Node 22, output contract), 01-12.
