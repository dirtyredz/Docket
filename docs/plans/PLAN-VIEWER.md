## 1. Goal

Deliver a per-machine registry and loopback viewer for approximately 29 repositories and 1,500 items: one place to switch projects, inspect work and living docs, search titles, and safely edit status, priority, title, and relations.

Markdown items remain authoritative in each checkout. Every item edit uses the CLI’s core operations, targets an explicitly selected checkout, and rejects stale saves while preserving unsaved input.

## 2. Placement

Follow the current enforced Layout: **`src/state/registry/` and `src/viewer/documents/`**, not the top-level `src/registry/` and `src/documents/` from the historical plan. Use Node 22, plain ESM, `node:http`, and native browser modules; no framework or frontend compilation.

Use server-side `marked` followed by `sanitize-html`, with Node-22-compatible versions pinned in the lockfile. Markdown parsing alone does not sanitize HTML; use an explicit sanitizer policy. [Marked documentation](https://marked.js.org/), [sanitize-html documentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html)

Brace lists below name individual files, with responsibilities listed in matching order.

| New or changed paths | Responsibility and placement |
|---|---|
| **New** `src/state/registry/{paths,schema,store}.mjs` | Registry location; versioned metadata validation; locked atomic persistence. Reuse storage primitives without coupling machine state to item storage. |
| **New** `src/state/registry/{registration,scan}.mjs` | Registration, aliases and checkout grouping; bounded directory discovery. Keep filesystem traversal out of the persistence module. |
| **New** `src/repository/{canonical,containment,worktrees}.mjs` | Real-path identity; contained-path checks; Git worktree enumeration. These are repository facts shared by registration and viewer scope checks. Reuse existing `context.mjs` and `paths.mjs`. |
| **New** `src/cli/commands/{registry,viewer}.mjs` | Thin `repo` and `serve` adapters. Keep server lifetime and registry rules out of CLI dispatch. |
| **Change** `src/cli/{main,help}.mjs` | Dispatch and command-specific help. Load the viewer dynamically only when `serve` executes. |
| **Change** `src/core/items/detail.mjs` | Build editable fields, title, body, errors and revision from the same freshly read bytes; retain indexed records for surrounding relations. |
| **New** `src/core/items/revisions.mjs`; **change** `src/core/items/{set,link}.mjs` | Shared revision assertions used by both planners, including no-op operations and reverse-stored relation edits. Assertions execute inside the existing mutation lock. |
| **New** `src/viewer/server/{main,boundary,scope,static}.mjs` | HTTP lifecycle; request/response safety; registered-checkout authorization; explicit packaged asset serving. |
| **New** `src/viewer/server/{catalog,worktree-hints}.mjs` | Transient indexed summaries and refresh scheduling; advisory worktree/claim projection. Neither owns item mutation rules. |
| **New** `src/viewer/server/routes/{repos,items,relations,documents,search}.mjs` | Scoped HTTP adapters for those five resources. Scalar edits call `setItem`; relation actions call `mutateStore` with `planLink`, exactly as the CLI does. |
| **New** `src/viewer/documents/{catalog,render}.mjs` | Seven-document resolution and source reading; Markdown rendering and sanitization, also reused for read-only item bodies. |
| **New** `src/viewer/ui/{index.html,app.mjs,api.mjs,drafts.mjs,styles.css}` | Browser shell, navigation composition, HTTP client, unsaved form state, and styling. |
| **New** `src/viewer/ui/views/{repo-picker,overview,board,item-editor,relations,documents,search,worktree-hints}.mjs` | Separate view responsibilities. The relations view owns bugs-per-feature and forward/reverse navigation. |
| **Change** `package.json`, `package-lock.json`, `src/tooling/build.mjs` | Runtime dependencies, development-only Playwright, test scripts, viewer packaging and required-asset checks. |
| **Change** `.gitignore` | Ignore browser-test output only; never add machine registry contents or personal paths. |
| **New/changed tests** listed in §4 | Responsibility-matched regression, route, browser and packaging coverage. |
| **Change docs** listed in §6 | Current behavior, architecture and usage contracts. |

Add exact Layout bullets for `src/viewer/server/routes/` and `src/viewer/ui/views/`; the layout checker requires exact source-directory homes. Existing declared homes cover the other production additions.

No existing file inspected requires a size-driven extraction. Extract shared revision assertions because both planners need them; do not create a generic application-service layer. Keep every code file below 800 lines and split route handling, draft state or rendering by responsibility before approaching that cap.

## 3. Sequence

### M3a — Registry and explicit registration

1. Implement canonical identity, registry validation and atomic persistence.

   Store `%LOCALAPPDATA%/Docket/registry.json`, with an injectable location for tests. Require a usable application-data location rather than silently writing into the current repository.

   Each logical repository records a generated registry identifier, unique alias, preferred checkout, registered checkout paths, canonical Git common-directory identity, and relative document overrides. No item records, counts, claims or search index belong here.

   Canonicalize existing paths through real paths and Windows-aware comparison. Reuse `resolveRepo`; require an actual supported `docket.json`, since the existing configuration parser intentionally accepts an absent file for other callers.

2. Add `docket repo add <path>`, `list`, and `remove <alias>`.

   Registration is idempotent by canonical checkout path. Linked worktrees join the same common-directory group; independent clones remain separate. Alias collisions fail explicitly. Re-adding supports deliberate alias, preferred-checkout and document-override updates.

   `list` reports unavailable checkouts and reasons without rewriting or deleting them. `remove` removes registration metadata only; support removing one checkout separately from its whole group.

   Use repeatable `--doc NAME=relative/path.md` overrides on `repo add`. Document settings never change `docs/items/`.

   **Callers changed:** CLI dispatch/help; new registry adapter. Existing item commands and repository resolution semantics remain intact.

### M3b — One-shot discovery

3. Add `docket repo scan <dir> [--dry-run]`.

   Walk beneath the supplied directory, inspecting directories containing `docket.json`. Verify each candidate is the Git checkout root: a marker in an ordinary subdirectory must not register its parent accidentally.

   Continue descending after discovering a repository so nested repositories remain discoverable. Include `.claude/worktrees/`; group linked worktrees rather than counting them as independent projects. Skip Git internals, `.docket`, dependency directories, and directory links/junctions; report skipped links and inaccessible branches.

   Collect candidates before taking the registry lock, then merge against the latest registry. Preserve existing aliases and overrides. Generate deterministic disambiguated aliases for newly discovered basename collisions and report them.

   Discovery is additive and one-shot. It never initializes repositories, imports items, watches directories or prunes unavailable registrations.

   **Callers changed:** registry adapter and registration service; existing `init` stays independent.

### M4a — Early usable read-only overview

4. Implement `docket serve [--port N]`, the HTTP boundary, scoped repository catalog and browser shell.

   Bind explicitly to `127.0.0.1`; default to an available port and print the actual URL. Do not expose an arbitrary host option. `--json` emits one startup envelope after binding, while the server keeps the process alive; shutdown closes the server and refresh timers.

   The repo switcher includes **All repos**. Its overview counts each logical repository’s preferred checkout once, showing open totals by `P0–P3` and `todo/wip`, with zero buckets, invalid-item counts, loading state and unavailable state. Never silently substitute another branch when the preferred checkout disappears.

   **Security applies from this first HTTP milestone:**

   - Validate the exact loopback Host and actual port; reject foreign origins and `Origin: null`.
   - Require the exact origin, JSON content type and a per-process CSRF token for mutations. Disable CORS; reject cross-site fetches.
   - Address repositories/checkouts by registry identifiers, never client-supplied filesystem paths.
   - Validate item IDs using the existing schema before any filesystem lookup.
   - Check lexical and real-path containment, including Windows drive/UNC syntax, encoded traversal, symlinks and junctions.
   - Check the item directory, every entry read by the index/mutation snapshot, and `.docket` before handing the checkout to existing operations: current item storage follows symlinks.
   - Permit claims access only through the Git-derived common directory and claims API.
   - Serve only known UI assets; use bounded requests, safe error responses, CSP, `nosniff`, and no framing.

   **Callers changed:** new viewer adapter invokes server lifecycle; routes consume registry, `loadIndex`, `listItems` and `countBy`.

5. Implement progressive index loading and title search.

   Use existing per-checkout `.docket/index.json` files. The server retains only transient summaries and freshness metadata. Load preferred-checkout indexes incrementally, yielding between repositories; load alternate checkouts, details and documents on demand.

   Counts use complete core results, not the CLI’s 500-item limit. Cross-repo search uses indexed titles, returns repository-qualified results, and exposes loading/unavailable coverage rather than implying incomplete results are complete. Default search to open items with an explicit closed-item option.

   Refresh on navigation, window focus and a bounded interval while visible; provide manual refresh. Invalidate affected summaries after saves and reload registry changes without restarting. Item details always read fresh bytes.

   **Tradeoff:** retain synchronous per-repo index operations initially. Avoid eager body loading and parallel Git floods; measure responsiveness before introducing worker infrastructure.

### M4b — Complete read-only browsing

6. First reproduce and fix detail inconsistency.

   `readItem` currently combines indexed fields/title with a fresh file revision/body. Parse the fresh bytes into the authoritative selected-item record and substitute it into the relation read model. Do not require an outdated index entry to exist for a file that now exists.

   **Existing caller:** CLI `show`; preserve its `{data, content}` contract. New item routes use the same corrected operation.

7. Add the per-checkout board, item detail, relations, documents and hints.

   Use actual status columns: `todo`, `wip`, `done`, `dropped`. Closed items may be collapsed but remain discoverable. Preserve core priority/rank/ID ordering; blocked is a derived badge.

   Show bugs against features using reverse `fixes`, including navigation to each bug. Expose parent/children, blockers/blocked items and symmetric `relates`; missing or malformed targets get explicit states. Item IDs are scoped by repository and checkout. Cross-repo references are navigation only, never stored relation values.

   Resolve `STRUCTURE`, `ARCHITECTURE`, `DECISIONS`, `FEATURES`, `ROADMAP`, `BACKLOG`, and `GOTCHAS` through explicit overrides, then root, then `docs/`. Report duplicate candidates and the chosen source; do not recursively guess special layouts. Overrides cover arbitrary contained layouts such as `<docs-subdir>/ARCHITECTURE.md`.

   Render ordinary Markdown with a strict tag/attribute/URL allowlist. Remove executable HTML, embedded frames, forms and remote images. Source view uses text content. Relative links navigate only to authorized catalog documents; unsupported destinations remain visibly unresolved. There is no document-write or general file-serving endpoint.

   Enumerate worktrees through Git and display branch, checkout and claim information as **hints**, with observation time. Load branch-local item comparisons only for registered checkouts on demand. Discovered but unregistered worktrees offer registration guidance, not an edit target.

   **Callers changed:** new view modules and scoped routes; existing query/index/claims operations are reused.

### M4c — Revision-safe editing

8. Write reproducing tests, then strengthen planner revision checks.

   Assert an explicitly supplied source revision before planning either a change or a no-op. Extend relation planning with an optional expected-revision map; when supplied, require revisions for affected reverse-storage holders and check them before any writes.

   Return relevant relation-source revisions with detail reads. Missing revision preconditions are request errors; mismatches return HTTP 409.

   **Existing callers affected:** `complete.mjs` invokes `planSet`; CLI `link` invokes `planLink` inside `mutateStore`; direct planner tests exercise both. Keep existing CLI flags and optional-expect behavior, while making supplied `--expect` meaningful for no-ops.

9. Enable scalar Save and separate relation actions.

   Scalar Save accepts only status, priority and title, plus the expected revision. Call `setItem`, preserving its date/rank rules and claim-cleanup warnings. Reject body, identity, rank and unknown-field edits.

   Each relation action changes one edge through `planLink`; support parent, fixes, blocked-by and relates, including removal. Require scalar drafts to be saved or discarded before relation changes.

   **Tradeoff:** separate scalar Save and single-edge relation actions avoid presenting the existing multi-file link operation as an atomic form save. Core’s general multi-file writes remain individually atomic, as already documented.

   Drafts are keyed by registry repository, checkout and item identity. On 409, retain every input, show current server values beside the draft, and require explicit reconciliation before retrying against a new revision. Never silently retry with the latest revision. Preserve drafts during switching and refresh; warn before leaving the page.

   A successful item save followed by failed claim cleanup remains a successful save with a warning.

### M4d — Installed acceptance

10. Package and verify the complete application.

   Include `src/viewer/`, HTML, CSS and native modules in the tarball. Keep Markdown dependencies outside static imports reachable from ordinary CLI/gate startup: gate promotion extracts the tarball and runs `--version` without installing dependencies.

   Verify the installed viewer from outside the source checkout, followed by the full fleet-sized acceptance scenario. No legacy portal or importer integration is required.

## 4. Tests

All application and route tests use `node:test`. Use the development-only Playwright Chromium library for the browser test, retaining `node:test` as its runner. Playwright requires a matching browser installation. [Playwright browser documentation](https://playwright.dev/docs/browsers)

| Milestone | Files and required coverage |
|---|---|
| M3a | **New** `tests/registry/{store,registration}.test.mjs`: concurrent updates, corrupt/unknown-version registry preservation, alias collisions, idempotence, canonical paths, spaces/Unicode/case, unavailable paths, linked-worktree grouping and independent clones. |
| M3b | **New** `tests/registry/scan.test.mjs`: nested repositories, marker below a checkout root, worktrees under hidden directories, directory-link loops, inaccessible branches, repeat scan, dry run and preservation of existing metadata. |
| M3 CLI | **New** `tests/cli/registry.test.mjs`; **extend** `tests/cli/ergonomics.test.mjs`: command behavior, help, JSON envelopes, errors and override updates. |
| M4a | **New** `tests/viewer/{boundary,scope,repos,search}.test.mjs`: loopback lifecycle, Host/origin/CSRF rejection, traversal and junction escapes, unavailable repositories, no worktree double counting, complete counts beyond 500 items, progressive search coverage and cache invalidation. |
| M4b regression | **New** `tests/core/detail.test.mjs`: change a file after indexing; assert returned fields/title/body/revision describe the same bytes. Cover newly added and malformed files. |
| M4b browsing | **New** `tests/viewer/{items,relations,documents,worktrees}.test.mjs`: ordering, blocked semantics, reverse relations, fixes legality, document precedence/overrides/source, XSS payloads, explicit missing states and advisory hints. Assert document mutations are unavailable. |
| M4c regression | **New** `tests/core/revisions.test.mjs`: stale no-op set/link and changed reverse-stored relation holder fail before writes. **Extend** `tests/cli/commands.test.mjs` for `--expect` parity. |
| M4c routes | **Extend** viewer item/relation tests: required revisions, 409, field allowlists, CLI/core parity, correct checkout targeting, preserved bodies, claim-cleanup warnings and separate relation actions. |
| M4c browser | **New** `tests/e2e/editor.test.mjs`: open a draft, change the item through CLI, save and receive 409 without losing input, reconcile, save successfully, switch checkouts, and confirm only the selected checkout changed. Include a reverse-stored relation removal. |
| M4d | **New** `tests/viewer/performance.test.mjs`: generated 29-repo/1,500-item fixture, one repo above 500 items, cold/warm refresh, incomplete coverage and no eager body loading. **New** `tests/packaging/viewer.test.mjs`: installed assets, Markdown dependencies and serve outside the checkout. **Extend** `tests/packaging/last-good.test.mjs`: extracted CLI/gate still work without dependency installation. |

Add **`tests/helpers/viewer.mjs`** for disposable application-data roots, server lifecycle and HTTP requests. Reuse the existing repository helper. Tests must never read or modify the owner’s real registry.

## 5. Verification

**Nothing was built or tested for this spec.** The implementer must run these checks on Windows 11 with Node 22.

Add `test:registry`, `test:viewer`, and `test:e2e` scripts with quoted Node test globs, and include them in the documented full-suite workflow.

| Stage | Implementer commands |
|---|---|
| Dependencies | `npm ci`; `npx playwright install chromium` |
| Registry | `npm run test:registry`; `npm run test:cli`; `npm run test:layout` |
| Core/editor | `npm run test:core`; `npm run test:storage`; `npm run test:coordination`; `npm run test:viewer`; `npm run test:e2e` |
| Final checks | `npm test`; `npm run lint`; `npm run format:check`; `npm run build`; `dk check` |
| Installed acceptance | `npm install --global <absolute-tarball-path>`; confirm both `docket --version` and `dk --version`; launch `docket serve` outside the checkout. |

Integration and packaging gate proofs require `~/.claude/hooks/structure/pre-push.template.sh`. Record missing prerequisites or skipped proofs explicitly.

Confirm visibly:

- Scan discovers nested projects and groups worktrees without double-counting.
- Overview totals match complete core queries; unavailable repositories remain listed.
- Repo/checkout switching, closed items, relations, title search and document source views work.
- A CLI edit causes the expected browser conflict; the draft survives and reconciliation saves correctly.
- No document editing control or endpoint exists.
- Warm switching/search feels immediate; measure cold overview completion and warm interaction latency on the representative fixture. Initial acceptance targets: complete cold overview within five seconds and warm interactions within 300 ms on the target machine. These are targets, not measured claims.

For a release, follow the existing absolute-tarball install, gate promotion and gate-install procedure after verification.

## 6. Docs

- **`STRUCTURE.md`** — activate registry/viewer homes, add exact route/view subdirectory bullets, document dependencies and revision assertions.
- **`docs/ARCHITECTURE.md`** — registry identity, preferred-checkout aggregation, explicit edit targeting, transient catalog, request security and revision flow.
- **`docs/DECISIONS.md`** — new ADRs for worktree grouping/counting, native-module stack and sanitization, revision-safe relation actions, and read-only documents.
- **`docs/FEATURES.md`** — record capabilities as built/shipped at each slice; distinguish registry, overview, browsing and editing.
- **`docs/ROADMAP.md`** — replace remaining M3/M4 shorthand with the usable slices above; retain shipped init/move-in and deferred M5.
- **`docs/GOTCHAS.md`** — unavailable registrations, duplicate doc locations, selected-checkout writes, advisory claims, external-editor races, draft conflicts and lazy viewer dependency loading.
- **`README.md`** — usage for registration, scanning, overrides and serving; startup/JSON behavior, verification commands and absolute tarball paths.
- **`CLAUDE.md`, `AGENTS.md`** — update implementation status and verification script inventory when milestones land.

Keep living maps below 12 KB; move detailed ADR history to `docs/records/` when necessary. Use placeholders exclusively in public examples.

Leave `docs/PLAN.md` and research history unchanged. Their top-level registry/document paths, Node 24 assumption, importer work and “no existing commands” verification text are superseded. Current architecture milestone labels also differ from STRUCTURE/ROADMAP; align them during the living-doc update.

## 7. Open questions / assumptions

| Owner decision | Assumption used |
|---|---|
| UI appearance? | Compact, keyboard-accessible desktop interface with system light/dark colors, repo sidebar, overview table, board and detail panel. No branding exercise or drag-and-drop requirement. |
| May the viewer edit Markdown bodies? | No. Bodies are rendered/read-only; only title, status, priority and item relations are editable. |
| Auto-start on login? | No. `docket serve` runs explicitly in the foreground; no login task, service or automatic browser launch. |
| What counts as one project? | One Git common-directory group; independent clones stay separate. Overview/search use one preferred checkout per group. |
| Which checkout becomes preferred? | Prefer the main checkout when first registering a discovered group; otherwise the explicitly added checkout. Preserve subsequent owner selection and never fail over silently. |
| Are discovered worktrees immediately editable? | Only after registration and explicit UI selection. Discovery alone supplies hints. |
| Meaning of “links”? | ITEM-SPEC relations: parent, fixes, blocked-by and relates. No new arbitrary-URL field or cross-repo stored relations. |
| How long do drafts survive? | Navigation, refresh polling and conflicts within the open application session; browser reload/closure prompts about loss. Persistent draft storage is deferred. |
| Does “viewer writes only through core” prohibit cache updates? | Item writes go exclusively through core. Existing per-checkout index caching and core-triggered claim cleanup remain allowed through their owning modules. |
| Filesystem threat boundary? | Reject static path escapes and revalidate before operations. Do not claim protection against a hostile local process swapping filesystem paths concurrently; the existing external-writer race remains documented. |