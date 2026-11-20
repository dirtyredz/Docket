## Chosen scope (APPROVED by Skippy 2026-11-20 with amendments; trimmer-informed)

The sections below are Astra's maximal draft. Build only this scope. Where it differs, this wins.

**Order and slices**
1. **Harness H1 (ships first, own lead/harness).** Detector script `hooks/overview/hygiene/`: quiet-wip (>=5d, commit-message `dk-`/`bl-` fallback; no match = unknown, never zero), unregistered pool dirs, quiet unmerged branches. Errors become error findings (no merging prior state). Findings JSON (kind, repo, item/path/ref, quietDays, source) written atomically to `~/.local-state/harness/hygiene/`; silent when clean. Extract `discoverRepos` and worktree inventory only where reuse is real. Machine schedule via `schedule_job` (task-scheduler, below-normal, UTC, activationAt, daily 09:00 UTC). Delivery: Skippy-only SessionStart backup (roleOf==skippy). Keep: reproducing fixture test, clean-scan-silent test. Gate: `node --test "hooks/overview/hygiene/*.test.js"`.
2. **Delivery push (APPROVED, harness).** skippy-wake schedule with cadence {kind:"manual"} (a fired one-shot does not rearm). The script calls run-now on it only on a clean->flagged change; persist operationId before submit, reuse on retry. At build time verify the script can trigger run-now WITHOUT MCP (schedule_job is top-level-only); if no non-MCP path exists, fall back to a daily skippy-wake that reads the findings file. No Command Deck event machinery.
3. **Docket (docket lead builds now).** H1/H2 are global harness files: Skippy dispatches them himself. Knowledge goes after this lands. Store branch + worktree path in the existing common-dir claims store when an item enters wip (add/set/claim), item format untouched. `dk activity --json [--id]` (branch-tip committer time, quietDays, unknown reason). One idempotent `dk worktree release --path <p>`: still-wip items bound to that path -> todo + one "work stopped" note. Measure first how many current wip items lack a branch. Gate: new unit tests + `npm run lint` + `dk check`.
4. **Harness H2.** prune.js/sweep.js call `dk worktree release` after a successful removal via a thin adapter; failure never blocks removal; log only.
5. **Knowledge (knowledge lead, last).** `quiet Nd` suffix on wip headers via one `dk activity --json` call per request, soft-fail to existing header. Gate: `uv run pytest tests/test_items.py tests/test_item_activity.py tests/test_search_service.py`.

**Cut:** Command Deck emit-event/guard/admission/reconcile; event subscription; episode/digest/delivery.json; binding generations; prepare-stop/finish-stop receipts; lifecycle/ refactor of complete.mjs and claims persistence extraction (extract only if file >800 lines); `--all-worktrees`; packaged-profile and restart validation scenarios.
**Deferred (to Docket):** provisional-claim transfer from primary on first worktree touch (revisit after measuring branchless wip items); `--all-worktrees`; episode dedupe if 3b is enabled and re-wakes become noisy; prepare-commit-msg stamping; stale doc-summary corrections.
**Docs:** Layout entries + one GOTCHAS line per repo only.
**Validation:** reduced: disposable-repo fixture (11 wip items aged 4-16d, 28 pool dirs/13 registered, 2 quiet unmerged) run by the validator against pre/post SHAs: expect 10 quiet-wip, 15 orphan, 2 quiet-unmerged, zero model launches, silent when clean. Docket release: one wip item pruned twice -> one todo, one note.
**Known risk accepted:** prune crash between removal and release leaves item wip on missing path; next scan flags it (self-heals).

---

## Goal

Surface abandoned work through deterministic tooling: quiet WIP items, orphan worktree directories, and quiet branches holding unmerged work. Skippy receives findings and delegates settlement to each project lead; the scanner performs no cleanup and invokes no model.

Ship order: **Harness detector → Command Deck event ingress → Docket tracking → Harness prune integration → Knowledge headers**. These are four project slices, with the harness slice delivered in two stages.

## Placement

Paths are relative to the named repository; harness paths are relative to `C:/Users/dirty/.claude`. New responsibilities require matching `STRUCTURE.md` Layout entries; keep code files below approximately 800 lines.

| Project | Files | Responsibility and placement |
|---|---|---|
| Harness | New `hooks/overview/hygiene/{cli,scan,findings,delivery,sessionstart}.js` | Scheduled entry, evidence collection, atomic findings state, event submission, and Skippy-only backup delivery. Nest under overview because `hooks/` is already at its breadth cap. |
| Harness | New `hooks/shared/repo-discovery.js`; change `hooks/worktrees/sweep.js` | Extract `discoverRepos` and its skip policy from sweep for reuse. Scanner must not import a cleanup CLI. |
| Harness | New `hooks/worktrees/inventory.js`; change `hooks/worktrees/stale.js` | Extract checked Git worktree enumeration. Preserve existing callers’ interface while exposing failures explicitly to hygiene. |
| Harness | New `hooks/worktrees/lifecycle/docket-stop.js`; change `hooks/worktrees/{prune,sweep}.js` | Shared Docket prepare/remove/finalize adapter. Keep `remove.js` responsible only for safe filesystem removal. |
| Harness | `settings.json`; new colocated tests for the modules above; existing `worktrees/{prune,sweep}.test.js` | Register bounded backup delivery and verify scanner/removal integration. Schedule definitions and receipts belong in local state, not settings or agent files. |
| Command Deck | New `src/server/cli/schedule/event.js`; change `src/server/cli/schedule/command.js` | Parse targeted event submissions through the existing authenticated schedule transport. |
| Command Deck | `src/api/contracts/commands/schedules.js`, `src/api/contracts/schedules/kinds/wake.js` | Admit event wakes and an optional event guard on existing `run-now` requests; extend wake payload trigger vocabulary. |
| Command Deck | New `src/agent/services/schedules/engines/wake/events.js`; change `admission/validation.js`, `engines/reconcile.js`, `engines/wake/engine.js` under `src/agent/services/schedules/` | Validate event eligibility during serialized admission, carry the guard through recovery, and reuse durable mailbox delivery. |
| Command Deck | Existing contract, CLI, wake delivery and host lifecycle tests; new `test/agent/services/schedules/engines/wake/events.test.js`; relevant `src/testing/runner/manifest/{agent,server,host}.js` entries | Cover the complete submission path and register every new test. |
| Docket | New `src/repository/work-activity.mjs` | Verified checkout/default-branch facts and branch-tip commit activity. Git knowledge stays below CLI/state. |
| Docket | Extract `src/state/claims/persistence.mjs` from `store.mjs`; new `src/state/claims/{work,stops}.mjs` | Shared locked persistence, retained per-item work associations, and durable stop receipts. Preserve live-claim expiration separately. |
| Docket | Move `src/core/items/complete.mjs` to `src/core/items/lifecycle/set.mjs`; new `src/core/items/lifecycle/stopped.mjs` | Status lifecycle and one revision-checked status-plus-note write. Group rather than add another responsibility to the crowded `core/items/` directory. |
| Docket | New `src/cli/commands/{activity,worktree}.mjs` and `src/cli/commands/items/work.mjs`; change `main.mjs`, `help.mjs`, `commands/coordination.mjs`, and item adapters `add`, `set`, `show`, `notes`, `link` | Thin CLI adapters and shared targeted-touch integration. `activity` is strictly read-only. |
| Docket | `src/library/claims.mjs`, `src/library/items/set.mjs`, `package.json` | Preserve facade-only exports and expose lifecycle dependencies through the supported claims contract. Update release metadata through the normal release process. |
| Docket | New `tests/unit/{repository/work-activity,state/work,state/work-stops,core/work-stopped,cli/activity,cli/worktree}.test.mjs`; existing claims, revisions, refactor-seams and packaging tests | Exercise repository evidence, shared state, atomic item edits, CLI contracts and installed exports. Update moved imports in `revisions.test.mjs` and `refactor-seams.test.mjs`. |
| Knowledge | New `src/knowledge/service/item_activity.py`; change `service/items.py`, `service/tools.py` | Keep Docket subprocess transport separate from live Markdown parsing; enrich selected search/list results. |
| Knowledge | New `tests/test_item_activity.py`; change `tests/test_{items,search_service,restricted}.py` | Verify rendering, batching, query budgets and admitted nested-repository boundaries. |

## Sequence

### 1. Harness — essential: ship detection and the machine schedule first

**H1 ships independently of all other slices.**

- Extract discovery and checked worktree inventory. Discover real clones beneath `~/projects`, including nested repositories, plus the harness; deduplicate canonical Git common directories. Use `worktrees/home.js::repoHome` for pool names, including `harness`.
- Read WIP through Docket JSON. Handle the existing 500-item limit by priority slices and explicitly report any remaining truncation.
- Initially derive activity from the newest reachable commit whose message contains an exact `dk-<8hex>` or `bl-<8hex>` token. Scan history once per repository, with bounded execution/output. No matching commit means **unknown**, not zero days or an invented `since`-based activity date.
- Detect `quiet-wip` at **five completed 24-hour periods**. Detect pool directories absent from checked Git worktree inventory, accounting for nested branch directories and registered descendants.
- Detect quiet linked branches with positively established unmerged work. Reuse ancestry and patch-equivalence semantics from `stale.js`, but distinguish command failures from negative answers. Record the local comparison ref and SHA.
- Never fetch, remove directories, delete branches, change items, call usage dispatch, or invoke a model. Errors and missing evidence become explicit coverage findings requiring inspection.
- Persist findings atomically under `~/.local-state/harness/hygiene/`. `hooks/structure/internals/local-state.js` already permits this home; no exemption is needed.
- Register `sessionstart.js` with a short timeout. Emit bounded, data-only findings exclusively when `shared/agent-role.js::roleOf(input) === "skippy"` and unresolved findings exist. Other agents and subagents receive nothing.
- Create the scanner through Command Deck `schedule_job`, then resume it: `engine:"task-scheduler"`, native absolute `node.exe`, structured script arguments, `priority:"below-normal"`, timezone `"UTC"`, explicit future numeric `activationAt`, `overlap:"skip"`, and existing provisioned principal/profile references.
- Default cadence: daily at 09:00 UTC. Use the Command Deck project as schedule owner and its checkout as `workingDirectory`; its admission boundary permits an external harness script argument. Save actual schedule IDs/revisions in local state.
- Before the event slice lands, delivery is the Skippy SessionStart backup. Implement event submission as a capability-gated adapter, never as an ordinary timed model wake.

**Acceptance:** a clean complete scan produces no stdout and no notification; flagged projects produce a durable grouped list; unavailable repositories remain visibly incomplete; no repository contents change.

**Fast gate, target <120 seconds:** `node --test "hooks/overview/hygiene/*.test.js" hooks/shared/repo-discovery.test.js hooks/worktrees/inventory.test.js`.

**Out of scope:** automatic settlement, orphan deletion, changes to existing cleanup policy, general agent warnings, agent/brief text, and direct Task Scheduler ownership outside Command Deck.

### 2. Command Deck — essential: enable targeted event wakes

**Finding:** generic schedule admission accepts event cadence, but `kinds/wake.js` currently rejects it. No application-event producer exists; `health/cadence.js` creates no event slots. Windows `event-log` triggers are unrelated.

- Add `schedule emit-event <schedule-id> --event hygiene-flagged --revision N --operation <stable-id> --local --installed`.
- Represent submission as existing `run-now` plus an event guard. During serialized admission require the named `skippy-wake` event definition, matching revision, active desired/applied state, and reached `activationAt`.
- Preserve the guard through the operation journal and reconciliation. Deliver with `trigger:"event"` through existing `runSourceId(operationId)` and mailbox uncertainty/recovery handling.
- Retain current behavior for ordinary `run-now` and timed wakes. Event definitions receive no timed occurrences.
- Create and resume one `skippy-wake` subscription with cadence `{kind:"event",event:"hygiene-flagged"}`, UTC and explicit activation time, using owner or Skippy-tier authority.
- Its immutable message contains the findings-file reference and event identity as data. The script cannot inject arbitrary message text or manufacture a Skippy identity.
- Enable harness event delivery. Persist an episode ID and operation ID before submission; retry uncertain submission unchanged. A confirmed refusal requires reconciliation and a new operation ID after its cause changes.
- Notify once per newly flagged or materially changed episode. Exclude scan timestamps and growing day counters from the digest. A later recurrence after a clean scan gets a new episode.
- Keep the SessionStart backup after primary delivery is enabled. Mailbox acceptance does not mean settlement; preserve current findings until a later scan resolves them.

**Acceptance:** one matching event produces one durable mailbox item across retries/restart; wrong event, paused definition, future activation, stale revision and machine-engine targets are rejected. A clean scan submits no event.

**Fast gate, target <120 seconds:** `node scripts/test.js unit test/api/commands/schedules.test.js test/server/cli/schedule.test.js test/agent/services/schedules/engines/wake/events.test.js test/agent/services/schedules/engines/wake/delivery.test.js test/agent-host/lifecycle/schedules/skippy-wake.test.js`.

**Out of scope:** broadcast event buses, public HTTP endpoints, new authority channels, UI redesign, `SCHEDULE_PROMPT` changes and new model instructions.

**Tradeoff:** targeted events reuse the existing run-now operation journal. Durable harness acknowledgement prevents reliance on Command Deck’s bounded settled-operation retention.

### 3. Docket — essential: record work and retire stopped work safely

- Preserve the strict 12-key item format. Version the common-directory claims envelope to retain a separate per-item work-association map alongside live advisory claims.
- Extract persistence so every claim writer preserves association and receipt fields. Import usable v1 claims lazily; do not infer bindings for unrelated old WIP items. Association evidence survives claim expiration and explicit claim release.
- Record canonical worktree, full branch ref or detached state, and an opaque binding generation when entering WIP, including `add --status wip` and batch additions.
- A claim made on the primary/default branch is provisional. The first successful targeted `dk claim/show/set/note/link` from a verified linked worktree transfers that provisional association. Bulk `list`, `activity`, Knowledge reads and headless detail reads never transfer it.
- Explicit takeover remains necessary for an established association owned by another live worktree. Concurrent first touches must yield one winner. A new WIP episode gets a new generation.
- Keep state dependencies injected into core. Route status mutation and binding coordination through a consistent common-directory-before-item lock order; avoid re-entering the same lock. Report partial item/state persistence accurately and retain recoverable state.
- Add bulk `dk activity --json --repo <root>`, with optional repeated `--id` filters. Return per-ID branch/worktree/binding identity, `lastCommitAt`, `quietDays`, source and unknown reason.
- Activity is the recorded branch’s tip commit **committer timestamp**; compute `floor(elapsedMilliseconds / 86400000)`, clamped at zero. Reading an item, refreshing a claim and editing Notes do not refresh activity.
- Add `--all-worktrees` for hygiene: include bound worktree-only WIP items, preserving their checkout identity and exposing conflicting views. Normal Knowledge requests remain scoped to the admitted item checkout.
- Missing/deleted refs, detached bindings and corrupt association state return explicit unknown evidence. Harness retains commit-message fallback for unsupported versions and unmapped legacy items, labelled by source.
- Add `dk worktree prepare-stop --path <path> --json` and `dk worktree finish-stop --receipt <token> --json`. Preparation persists binding generations, branch/SHA evidence, and revisions from the designated surviving main checkout before removal.
- Finalization requires confirmed disappearance of that registered worktree and the same binding generation. For each still-WIP matching item, write `todo` and one machine-generated “work stopped” note together through the item transaction.
- Preserve facts and relations. Skip already-settled/reassigned items; retain unresolved receipts for missing items, changed revisions or unavailable destination checkouts. Never recreate items, switch branches, merge files, or auto-commit.
- Completion and successful retirement clear the active association appropriately. Duplicate finalization cannot duplicate the note.

**H2, harness follow-through after Docket is available:** both `prune.js` and `sweep.js` use the shared adapter to prepare, run existing safe removal, then finalize. Preparation failure for a tracked item defers removal; physical failure never resets status. Preserve retry receipts across crashes, including removal success before finalization. Prune may delete the branch only after evidence is captured. Keep failures in local findings/logs; add no warning hook output.

**Acceptance:** WIP automatically records its checkout; provisional primary claims attach once; branch commits change activity; successful prune/sweep resets matching WIP exactly once; failed removal, reassignment and concurrent edits cannot reset unrelated work.

**Fast gates, each target <120 seconds:** Docket `node --test tests/unit/repository/work-activity.test.mjs tests/unit/state/work.test.mjs tests/unit/state/work-stops.test.mjs tests/unit/core/work-stopped.test.mjs tests/unit/cli/activity.test.mjs tests/unit/cli/worktree.test.mjs`; harness `node --test hooks/worktrees/lifecycle/docket-stop.test.js hooks/worktrees/prune.test.js hooks/worktrees/sweep.test.js`.

**Out of scope:** item-schema migration, cross-machine ownership, tracking arbitrary filesystem edits, automatic commits, branch recreation and retrospective guessed bindings.

### 4. Knowledge — essential: render live quiet age

- Add an optional quiet-days field to `Item`; append `quiet Nd` only to WIP headers. Compact `line()` inherits the same rendering.
- In `tools.py`, enrich search results after filtering/top-k and list results after sorting/capping. Group selected admitted physical item paths by owning checkout, including nested repositories.
- Invoke public Docket activity JSON once per selected repository/request using `node <resolved Docket main.mjs>`, structured arguments, existing `windowless_kwargs()`, and bounded timeout/output. Do not spawn `.cmd` through a shell.
- Missing executable, unsupported API, malformed output, timeout or unknown activity preserves the existing status header without a quiet suffix. Keep total header cost inside search’s response budget.

**Acceptance:** known five-day activity displays `quiet 5d`; a fresh commit changes the next request without reindexing; non-WIP and unknown activity have no suffix; repository ID collisions remain isolated.

**Fast gate, target <120 seconds:** `uv run pytest tests/test_items.py tests/test_item_activity.py tests/test_search_service.py tests/test_restricted.py`.

**Out of scope:** indexing changes, ranking changes, `knowledge_fetch` headers, new hooks, status mutations and MCP instructional text.

### Later — optional

A silent `prepare-commit-msg` integration may add `Docket: dk-…` when association is unambiguous. Exclude it from this delivery; branch-based activity must not depend on trailers.

## Tests

Write the detector reproduction before implementation: stale WIP plus unmatched pool directories must produce findings where the baseline has no detector.

- **Harness:** 4d23h versus 5d boundary; exact/legacy ID matching; no matching commit; Git failure; malformed/truncated Docket output; nested pool directories; junctions; positive unmerged versus unknown; clean clearing; failed-project preservation; concurrent scans; quiet stdout; duplicate notification; offline retry; Skippy-only backup.
- **Docket:** primary-to-worktree first touch, concurrent transfers, real association conflicts, same-branch activity shared by multiple items, unrelated-primary-branch commits, missing/deleted refs, no-op status assignments, add/batch WIP, old claims migration, and unchanged item frontmatter schema.
- **Retirement:** successful prune and sweep; failed/partial removal; crash at each prepare/remove/finalize boundary; branch deletion; done/dropped/reassigned items; missing destination item; stale destination revision; duplicate receipt; one atomic status-plus-note write.
- **Command Deck:** guarded event contract/admission, immutable request retry, uncertain mailbox enqueue, host restart, Skippy generation replacement, unchanged ordinary run-now, and absence of timed event occurrences.
- **Knowledge:** exact header suffixes, next-request freshness, one process per admitted checkout, nested-source restrictions, timeout degradation and full response-budget accounting.

## Verification

Inspection only was performed for this plan; no build or test results are claimed. Measure every fast gate on Windows; if it exceeds 120 seconds, split fixture-heavy regression coverage from the focused gate without dropping it from required verification.

- **Docket:** `npm run lint`, `npm run format:check`, `npm test`, `dk check`, `npm run build`. Exercise the installed tarball contract. Follow release scripts with `-DryRun` first; no unrequested tag push.
- **Knowledge:** `uv run pytest` from its repository.
- **Harness:** focused gates above plus affected discovery, stale/removal and SessionStart regressions.
- **Command Deck:** `npm run check`, `npm run lint`, `npm run format:check`, `npm run check:unused`, `npm test`, `npm run test:integration`; `npm run build:host` and `npm run pack:win` for packaged verification.
- Confirm scanner schedule creation followed by resume, actual activation time, below-normal native priority, UTC cadence and structured execution arguments. Inspect schedule results for partial scans.
- In an isolated profile, confirm event mailbox delivery and backup role filtering. On operational activation, confirm Skippy forwards each project’s current list to its lead; only leads reconcile against code and decide settlement/removal.

## Validation

Performed independently by `C:/Users/dirty/.claude/agents/validator.md`. The orchestrator records baseline reports before developer dispatch. Use one fixed external validation driver under `~/.local-state/harness/hygiene/validation/`, prepared before implementation and unchanged between baseline and comparison.

- **Claim:** abandoned work becomes a durable project-grouped finding, reaches Skippy without a clean-scan wake, and acquires correct Docket retirement and Knowledge age behavior.
- **Metric:** deterministic pass/fail for detection, delivery, retirement and header cases; counts of findings, mailbox items, item transitions and model launches by the scanner.
- **Method:** on Valhalla/Windows, use disposable repositories and an isolated packaged Command Deck profile. Run the following fixed scripted scenarios against the recorded pre-change SHA tuple and candidate SHA tuple; never use the owner’s items, worktrees or schedules.
- Create 11 WIP items through `dk add`, with committed activity ages of 4, 5, 6, 7, 8, 9, 10, 12, 14, 15 and 16 days. Create 28 pool leaf directories, 13 registered linked worktrees and 15 unregistered leaves; two registered branches contain quiet unmerged changes. Freeze the observation clock.
- Run the scanner against that fixture root: expect 10 quiet-WIP findings, 15 orphan-directory findings and two quiet-unmerged-worktree findings. Repeat unchanged, restart the isolated host, and retry delivery: expect one accepted mailbox notification for the episode.
- Resolve fixture findings and rescan: expect cleared current findings and no new event. Capture child-process launches throughout: expect no scanner-launched model/usage-dispatch process.
- Create a provisional primary claim, touch it from a linked worktree, commit there, and query activity. Exercise successful removal/finalization twice: expect one `todo` transition and one “work stopped” note. Repeat with failed removal and reassignment: expect no reset.
- Query Knowledge search/list for a bound five-day WIP item, then commit and query again: expect `quiet 5d`, then `quiet 0d`, without reindexing; non-WIP and unknown cases retain their existing headers.
- Feed the same findings to SessionStart with Skippy, project-lead and subagent identities: only Skippy receives findings. Verify per-project delegation separately on activation; mailbox acceptance alone is not proof of delegation.
- The driver records absent pre-change commands/contracts as the expected missing-capability symptom, not as a successful result. Unexpected fixture/build failures are INCONCLUSIVE.
- **Runs:** one per SHA tuple for these deterministic scenarios.
- **Target:** every specified count and transition matches; duplicate notifications/notes, unintended resets, clean-scan wakes and scanner model launches are all zero.
- **Baseline:** pending.

## Docs

- **Docket:** update `STRUCTURE.md` Layout and lifecycle placement; `ARCHITECTURE.md` retained associations/receipts; `DECISIONS.md` separation of advisory ownership from activity evidence; `FEATURES.md`, `GOTCHAS.md`, `LIBRARY.md` and CLI help for activity, provisional transfer and stopped-work behavior.
- **Knowledge:** update `STRUCTURE.md`, `docs/FEATURES.md` and `docs/GOTCHAS.md` for live quiet headers, batching and unknown activity.
- **Harness:** update `hooks/{STRUCTURE,ARCHITECTURE,DECISIONS,GOTCHAS}.md` for detector placement, state, delivery, retry and lead-owned settlement.
- **Command Deck:** update `STRUCTURE.md`, `docs/{ARCHITECTURE,DECISIONS,GOTCHAS}.md` and `docs/schedules/operations.md` for targeted event submission and recovery.
- Correct relevant stale status summaries: Docket’s package is 0.9.0 while orientation documents mention 0.7/0.8; Command Deck’s composed schedule runtime is newer than historical “uncomposed slice” prose. Knowledge has no `CLAUDE.md`; harness maps live under `hooks/`.
- Do not change agent files, briefs, managed snippets or frozen research/plans other than saving this requested plan.

## Open questions / assumptions

- **Findings format:** `findings.json` contains `version`, `generatedAt`, `thresholdDays`, `episodeId`, `digest`, `complete`, and `projects[]`. Each project has canonical `repo`/`commonDir`, `findings[]` and `errors[]`. Findings carry stable `key`, `kind`, optional item/path/ref/SHA, `lastCommitAt`, nullable `quietDays`, `activitySource`, comparison-base evidence and bounded reason. Keep delivery IDs/acknowledgements in adjacent locked `delivery.json`; include no item bodies, Notes or raw commit messages.
- **Unknown evidence:** use explicit coverage findings for unresolved activity, unavailable upstreams or failed scans. A partial scan preserves prior findings for failed projects with a stale marker; it cannot declare them clean.
- **Cadence assumption:** daily 09:00 UTC, five-day threshold for both WIP and unmerged branch findings. Persist provisioned schedule details rather than inventing principal/profile identities.
- **Settlement semantics:** Docket has no `blocked` status. Leads use existing `blocked_by` relations and explanatory facts; `done` requires code/test evidence. Skippy delegates and does not clean up.
- **Deletion risk:** an orphan directory is not proven disposable. Its lead must establish ownership, dirty/untracked state and recoverable/unmerged work before removal. Missing `.git`, failed probes or unknown history never authorize deletion.
- **Activity tradeoff:** branch activity is coarse: any commit on that branch refreshes every associated item. Commit-message fallback misses unstamped work; preserve its evidence source and unknown cases.
- **State risk:** associations remain local to one clone. Install the upgraded Docket writer before enabling retirement; older writers must not rewrite the extended claims envelope. Existing independent-clone limitations remain.
- **Delivery tradeoff:** unchanged unresolved findings do not wake Skippy every day. They remain available in the findings file and SessionStart backup; a clean-to-flagged recurrence creates a new episode.
- **Latency risk:** Knowledge gains bounded subprocess work. This plan makes no unchanged-latency claim; enrich only selected results and fail softly.
