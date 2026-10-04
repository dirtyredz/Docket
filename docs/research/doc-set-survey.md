# Doc-set survey, 2026-10-04

**Scope.** 31 repos, 1,297 md files, 17.46 MB. That is 14 Moonlight Peaks mod and root repos, 2 factorio mods, 13 other project repos, evil-eye-pack and the ~/.claude harness. EvilEye (7.7 MB) and VelvetEmberX (4.2 MB) are 68% of the bytes. Scoping used `git ls-files --cached --others --exclude-standard`, so worktrees are excluded. Sizes are in KB. A dash means the doc is missing. "(d)" means it lives in docs/, otherwise it is at the root. The raw inventory per file is in `inv.txt` in this folder.

## Summary table

| Repo | STRUCT | CLAUDE | README | ARCH(d) | DECIS(d) | FEAT(d) | ROAD(d) | BACKLOG(d) | GOTCHAS(d) |
|---|---|---|---|---|---|---|---|---|---|
| dirtyredz.com | 8.1 | — | 2.7 | 7.1 | 8.3 | 3.0 | 1.9 | 7.9 | 4.3 |
| evil-eye-pack | — | — | 2.0 | — | — | — | — | — | — |
| **EvilEye** | 5.9 | 2.5 | **25.3** | 7.5 | 1.9 (map) | 2.3 (map) | 5.6 | 24.2 (register) + 10 open and 10 done shards | 1.6 (map) |
| exit-exam | 5.3 | 1.2 | 0.7 | 4.5 | 2.9 | 3.8 | 0.6 | 2.7 | 2.3 |
| factorio-bp | 6.3 | **33.6** | 14.6 | — | — | — | — | 5.4 (root) | — |
| map-tag-layers | 6.2 | **20.6** | 4.4 | — | — | — | — | 5.5 (root) | — |
| trains-via-interrupt | 5.1 | 4.0 | 3.1 | — | — | — | — | 1.7 (root) | — |
| **family-command-center** | **175.4** | 4.7 | 3.8 | 44.9 | **221.7** | 42.3 | 4.2 | **86.2** | **62.2** |
| golem | 32.0 | 2.0 | 4.1 | 37.0 | 61.9 | 21.4 | 11.6 | 29.1 | 25.8 |
| **grotti** | **128.7** | 2.8 | 2.1 | 24.1 | **230.8** | 51.5 | 6.6 | **96.1** | **121.1** |
| maoin | 72.4 | 3.6 | 0.7 | 10.1 | 63.0 | 39.6 | 3.9 | 25.9 | 18.4 |
| messages-mcp | 20.8 | 5.8 | 11.1 | 20.9 | 34.1 | 11.2 | 2.4 | 14.0 | 25.1 |
| mia-sync | 14.3 | 1.5 | 2.7 | 7.0 | 22.9 | 3.5 | 2.4 | 7.1 | 20.8 |
| Moonlight Peaks (root) | 6.2 | 3.8 | 9.3 | 3.3 | 4.8 | 3.1 | 2.1 | 3.0 | 3.1 |
| mod BiggerUI | 3.3 | — | 22.1 | — | — | — | — | — | — |
| mod ChestLabels | 12.3 | 2.4 | 11.3 | 6.1 | 4.8 | 3.0 | 1.4 | 2.9 | 3.5 |
| mod CoffinBreak | 14.1 | 2.6 | 9.3 | 4.7 | 3.1 | 2.1 | 1.4 | 4.4 | 2.9 |
| mod DeadReckoning | 13.9 | 3.8 | 2.6 | 10.9 | 5.8 | 5.1 | 2.0 | 6.6 | 7.3 |
| mod FangtasticPalette | 19.5 | 3.4 | 8.8 | 5.2 | 6.5 | 2.4 | 1.3 | 7.3 | 4.2 |
| mod FormLock | 6.2 | 2.8 | 4.8 | 3.7 | 3.1 | 1.9 | 0.9 | 2.4 | 2.4 |
| mod LastSwing | 8.2 | 2.8 | 17.2 | 3.1 | 3.0 | 2.1 | 1.2 | 2.2 | 3.9 |
| mod ModNook | 18.9 | 3.2 | 5.4 | 5.7 | 11.4 | 3.3 | 2.3 | 9.0 | 5.8 |
| mod MoonlightTogether | 6.5 | 1.8 | 1.5 | 2.3 | 7.9 | 2.9 | 2.1 | 9.0 | 11.7 |
| mod PlantPeek | 17.0 | 2.9 | 14.4 | 5.3 | 8.0 | 2.4 | 1.5 | 7.1 | 4.2 |
| mod PurrtasticPalette | 19.5 | 2.7 | 8.6 | 3.6 | 5.4 | 2.3 | 1.1 | 6.2 | 3.7 |
| mod Transplant | 9.8 | 2.7 | 7.0 | 4.5 | 4.6 | 2.3 | 1.2 | 3.8 | 3.6 |
| mod Vampscape | 9.0 | 3.0 | 6.5 | 4.8 | 4.4 | 2.2 | 1.1 | 2.5 | 4.1 |
| resumes | 13.0 | 11.9 | — | 30.4 (`_platform/`) | 45.0 | 9.5 | 4.2 | 33.4 | 18.7 |
| sanas | 10.4 | 1.4 | 2.3 | 8.8 | 13.9 | 7.4 | 2.0 | 5.9 | 18.3 |
| **VelvetEmberX** | 19.2 (root), 29.3 (website/docs) | 17.7 (root), 1.2 (website) | docs 1.1, website 6.6 | — | 45.3 (website/docs) | 60.4 (website/docs) | — | 73.8 (website/docs) | 23.5 (website/docs) |
| ~/.claude (harness) | — | **30.4** | — | — | hooks/ 28.1 | hooks/ 4.6 | — | hooks/ 1.9 | hooks/ 8.4 |

Per-repo notes:
- Harness: `hooks/STRUCTURE.md` is 21.9 KB. The doc set describes only the hooks subsystem, not the repo.
- resumes: `HANDOFF.md` (5.7) and `REGISTRY.md` (1.8) are extra root docs. The `_platform` docs sit under `_platform/docs/`.
- VelvetEmberX: ADRs are in the root `docs/decisions/` (24 files, 220 KB), plus 3 big design docs.

**Read-at-start cost.** The nine canonical docs total 645 KB in family-command-center (about 160k tokens) and 664 KB in grotti. That is far beyond the "a screen or two" in ~/.claude/CLAUDE.md. EvilEye's nine canonical docs total 77 KB.

## Per-repo sections

### EvilEye (7.74 MB, 422 files)

- **Layout.** Only EvilEye has the fully restructured set.
  - Maps: root STRUCTURE.md (5.9 KB, `## Layout` present), CLAUDE.md 2.5 KB, AGENTS.md 5.9 KB.
  - Detail: `docs/handbook/` (55 files, 984 KB, CODE-MAP/ARCHITECTURE/GOTCHAS/FEATURES per area).
  - Records: `docs/records/` (45 files, 615 KB, dated ADR collections).
  - Working files: `docs/work/` (59 files, 721 KB), including history/ and documentation/.
  - Research: `research/` holds 219 files and 4.86 MB. Of that, `archive/` is 340 KB and `catalogs/` is 718 KB.
- **Bloat outside the living docs.** `research/` has six files over 100 KB. The largest are BOP-BIOME-CATALOG (287 KB), ITEMS-DETAILED (281 KB) and PIECES-SYSTEM-BUILD-PLAN (263 KB). 120 files are over 20 KB. README.md (25 KB) is the only over-limit living doc.
- **BACKLOG shape.** Register plus shards.
  - `docs/BACKLOG.md` holds a `## Ranking index` table `| ID | Priority | Flags | Entry |` (271 rows), a shard table and Known limitations.
  - Entries live in `docs/work/backlog/open/<area>.md` (288 entries) and `done/<area>.md` (103 entries). Done entries move to the done shard.
  - Entries are `- **Title.** <!-- bl-1a2b3c4d -->` bullets under `## P0/P1/P2/wishlist` and `### area` headings, with nested sub-bullets.
  - Typical open entry is 316 B median, 440 B mean, 2.2 KB maximum.
  - Example: `- **Shipping target does not compile (found 2026-09-29, P2).** <!-- bl-8e1d4c2a -->`
- **Duplicated fields.**
  - Priority sits in the index row, the shard section heading, and sometimes the entry prose. The title is copied into the index row, truncated.
  - 34 of 301 matched entries have a section priority different from the row priority.
  - 20 open entries have no index row. 3 index rows point at entries in the done shard.
- **Append-only logs.** `docs/records/**` holds newest-first ADR files split per period. `docs/work/history/**` and the dated plans, handoffs and results files hold the narrative logs.
- **Conventions.** `Last full review: 2026-09-24`, `policy.json` size classes, a CLAIMS.md owner-review queue of 24 suspected stale claims, and single-home-per-claim rules in MAINTENANCE.md.
- **Drift (from its own CLAIMS.md).**
  - Wire protocol: ARCHITECTURE says 21, REMOTE-SERVER says 23, the code says 26.
  - Store format: FEATURES says 5, the code says 7.
  - The FEATURES and ROADMAP stamps are about ten days stale.
- **Checker.** Passes with 0 findings; 205 ADR headings, 205 index links.
- **Memory.** MEMORY.md is 9.7 KB, 48 files, 114 KB total.

### VelvetEmberX (4.18 MB, 238 files)

- **Layout.**
  - The monorepo root has STRUCTURE and CLAUDE only. `website/docs/` has BACKLOG, DECISIONS, FEATURES, GOTCHAS, STRUCTURE and README, with no ARCHITECTURE or ROADMAP.
  - 24 numbered ADRs sit in the root `docs/decisions/`.
  - Separate numbered series: `docs/plans` (17 files, 412 KB) and `docs/design` (8 files, 658 KB), plus `website/docs/plans` and `website/docs/design`. About 86 numbered handoff files.
- **Bloat.** Three files exceed 100 KB: design/006 (162 KB), design/007b (160 KB) and website plans/050 (108 KB). 64 files are over 20 KB. BACKLOG (74 KB) and FEATURES (60 KB) are the biggest living docs.
- **BACKLOG shape.**
  - A table `| Item | Status | Blocker | Parked plan |` with 75 rows (453 B mean, 1.75 KB max), plus dated review sections.
  - 37 rows are struck-through or "✅ BUILT" yet still sit in the Open table.
  - Priority is per section. No IDs; items are cited as "Plan 044" or "Hand-off 089".
- **Conventions.** 97 files have front-matter. `Last full review: 2026-09-07` appears in 3 files.
- **Drift.** The backlog claims to be the single list of not-started work, but its Open table is mostly built items. FEATURES also keeps a "Not built" list.
- **Memory.** MEMORY.md is 12.8 KB with 55 files (141 KB), the largest of any project.

### family-command-center (655 KB, 13 files)

- **Bloat.** STRUCTURE is 175 KB and DECISIONS is 222 KB. BACKLOG (86), GOTCHAS (62), ARCHITECTURE (45) and FEATURES (42) are also large: 6 of 9 canonical docs are over 40 KB.
- **BACKLOG shape.** 801 lines, 267 bullets: 127 open and 140 done, all kept in place.
  - Checkbox items carry an inline `**P0**` tag, grouped under feature/ADR H2 sections plus appended dated review sections.
  - Median item 264 B.
- **Drift.**
  - ADR-080 appears 17 times in STRUCTURE.
  - Review stamps lag behind the content.
  - BACKLOG and ROADMAP disagree on Phase 0.
  - One section exists purely to capture deferred facts that were spread across ADRs, FEATURES, GOTCHAS and CLAUDE.md.
- **ADR format.** `### ADR-080 — Title`, 80 ADRs, newest first.
- **Memory.** 1.9 KB, 11 files.

### grotti (1.31 MB, 41 files)

- **Bloat.** STRUCTURE is 129 KB (1,485 lines), DECISIONS is 231 KB (3,134 lines) and GOTCHAS is 121 KB.
  - About 640 KB of research and plan files sit loose in `docs/`, not in a research folder.
  - Examples: PLAN-MAP-OVERVIEW (85 KB), RESEARCH-FACTORIO (64 KB), RESEARCH-STACK (59 KB), LORE (55 KB).
- **BACKLOG shape.** 1,083 lines, 154 bullets: 89 open and 80 done.
  - `## P0/P1/P2/Known issues` sections with `[x]`/`[ ]`/`[~]` checkboxes and italic dated completion notes.
  - The P0 section is entirely done.
  - Median item 391 B, max 6.1 KB.
- **Append-only logs inside living docs.** STRUCTURE "Current state" has 157 dated lines. GOTCHAS has 59 dated headings. DECISIONS has 96 dated ADR headings.
- **Conventions.** The stamp (09-04) lags the content (09-12). It is the only repo with a "Size discipline" section.
- **Memory.** 2.4 KB, 12 files.

### golem (266 KB)

- **BACKLOG.** 56 bullets like `- **[P0] \`src/skills/loader.ts:46\`** — …`, each with **Why:** and **Direction:** subfields.
  - Inline `[P0]` tag, no checkboxes, no done items.
  - Sections are dated structural-review blocks plus Open questions, Deferred and Known issues.
- **ADRs.** 32 of them, in `## ADR-030 —` form with Context and Decision fields.
- **Other.** STRUCTURE is 32 KB. FEATURES is a status table.

### maoin (355 KB)

- **Bloat.** STRUCTURE is 72 KB, DECISIONS 63 KB, FEATURES 40 KB.
- **BACKLOG.** 41 open and 25 done checkboxes, plus 22 struck-through lines.
  - `## P0` appears twice and "Known issues" appears twice.
  - Dated review sections are appended.
- **Conventions.** The review stamp is a month stale.

### messages-mcp (232 KB)

- **BACKLOG.** `## P0/P1/v2/P2/Closed` sections with checkbox items. The closing story gets edited into each item.
- **ADRs.** Dated headings with a qualifier.
- **Other.** Extra SPEC.md (27 KB) and docs/specs (59 KB). The memory dir is empty.

### mia-sync, sanas, dirtyredz.com, exit-exam

- **mia-sync.** The BACKLOG is mostly done items kept in place (24 done vs 8 open), so it reads like a changelog. Two P1 sections. ADRs are `## ADR-0010 —`.
- **sanas.** Phase sections that are mostly done, and no priority at all. GOTCHAS is 18 KB.
- **dirtyredz.com.** The cleanest: `### B1 — title` per item under `## P0/P1/P2`, plus a "Watch list — deliberately NOT doing" section.
- **exit-exam.** Complete and tiny. Bold-lead bullets under P1/P2/Done.

### factorio-bp, map-tag-layers, trains-via-interrupt (flat)

- **Layout.** STRUCTURE, CLAUDE, README and BACKLOG only.
- **Oversized CLAUDE.md.** factorio-bp's is 33.6 KB and stands in for ARCHITECTURE and GOTCHAS. map-tag-layers' is 20.6 KB.
- **trains-via-interrupt.** Has a "Considered and rejected (do not re-raise)" list, which is worth preserving.

### Moonlight Peaks root and 12 mods

- **Template uniformity.** All nine docs in every mod, all small; no living doc is over 20 KB. Each mod also has CHANGELOG.md (~5 KB) and NEXUS.md (~13 KB). The root has numbered guides 01–17, with `08-mod-ideas.md` at 45 KB.
- **BACKLOG.** `## P0/P1/P2` with checkboxes and ✅ date tags. Done items are kept.
- **Stamps.** Almost all are 2026-08-22, written in 7 different markup styles.
- **Drift.**
  - The README mod count ("twelve") contradicts the 13 repos; MoonlightTogether is unaccounted for.
  - ChestLabels NEXUS says 1.0.0 while everything else says 1.0.1.
- **Memory.** The root has 2.5 KB. Four mods have tiny memories, seven have empty dirs.

### resumes (279 KB)

- **Layout.** The doc set lives under `_platform/`.
- **BACKLOG.** `- [done] **P0** — text`: status as a bracketed word, priority as a bold tag. Grouped into milestone sections M1–M7.
- **DECISIONS.** `### D1 · date · accepted · title`, the only repo with a status field.
- **Big files.** RESUME-EVIDENCE.md is 42.6 KB.

### ~/.claude (harness, 803 KB, 250 md files)

- **CLAUDE.md.** 30.4 KB, and it carries the convention itself.
- **Doc set.** Covers only `hooks/`.
- **Memory.** 209 files (469 KB) of per-project memory under projects/.
- **BACKLOG.** Plain bullets with no priority.

### evil-eye-pack

Out of scope: it is a packwiz pack with only a README.

## Cross-repo findings

### BACKLOG shapes (7)

1. Priority H2 sections plus checkboxes: grotti, maoin, messages-mcp, mia-sync, the MP mods, the harness.
2. Feature/phase H2 groups with an inline `**P0**` tag: family-command-center.
3. A `### Bn — title` heading per item: dirtyredz.com.
4. A table plus entries: EvilEye (register plus shards, the only `bl-` IDs) and VelvetEmberX (table rows as items).
5. Bracket status words or inline `[P0]`: resumes, golem.
6. Plain bold-lead bullets under P1/P2: exit-exam, the factorio repos.
7. Phase sections with no priority: sanas.

Patterns across all shapes:
- Dated "Structure review — date" sections get appended in five repos.
- Done items mostly stay in place. Only EvilEye archives them.
- Items are small: median 86–450 B, with outliers up to 6 KB.
- Items without IDs get cited by ADR, plan or hand-off numbers.

### Worst bloat

1. family-command-center: STRUCTURE 175 KB, DECISIONS 222 KB.
2. grotti: STRUCTURE 129 KB, DECISIONS 231 KB, GOTCHAS 121 KB, BACKLOG 96 KB.
3. EvilEye research/: 4.86 MB, though it is separated by folder.
4. VelvetEmberX design and plan docs: three over 100 KB.
5. Against EvilEye's own caps, about 11 repos have a STRUCTURE over 16 KiB, and 5 have a CLAUDE.md over 6 KiB.

### Worst drift

- Review stamps lag the content in grotti, family-command-center and maoin.
- EvilEye's CLAIMS list documents 24 wrong figures, and its mirrored index and entry fields disagree in about 11% of matched entries.
- ChestLabels has a version mismatch.
- Moonlight Peaks states its mod count three different ways.
- family-command-center's BACKLOG and ROADMAP disagree on phase status.
- VelvetEmberX's Open table is mostly built items.

### Closest to and furthest from the convention

- **Closest.** EvilEye is the only repo with tool-enforced size caps, a Layout contract, IDs and one home per claim. dirtyredz.com, exit-exam and the MP mods are closest in shape and size.
- **Furthest.** family-command-center and grotti, then VelvetEmberX, then the factorio repos.

### What a format spec must accommodate

- **Doc homes.** Root, `docs/`, `website/docs/`, `_platform/docs/` or `hooks/`. The ADR series can live in a separate folder.
- **Item forms.** Checkbox bullets, bold-lead bullets, `### Bn` headings or table rows.
- **Priority.** As a section, an inline `**P0**`, `[P0]`, or `[status] P0 —`.
- **Status markers.** `[x]`, `[~]`, `~~strike~~`, `✅`, `[done]`, `**FIXED (date).**`.
- **IDs.** `bl-` markers, `Bn`, plan or hand-off numbers, or none.
- **Item bodies.** Nested Why/Direction blocks, plus optional shards and an optional register.
- **Duplicated fields.** The spec must pick one authority for priority, flags and title.
- **ADR headings.** Five variants. Status and superseded markers are optional.
- **Review stamps.** Seven markup variants. Also the `## Layout` bullet syntax and front-matter.
- **Size and archive policy.** Caps per doc class, archive and research folders, and a rule for where append-only history goes. CHANGELOG.md is a legitimate user-facing log.

## Per-project Claude memory

| Repo | MEMORY.md | Files |
|---|---|---|
| EvilEye | 9.7 KB | 48 (114 KB) |
| VelvetEmberX | 12.8 KB | 55 (141 KB) |
| Moonlight Peaks | 2.5 KB | 14 (35 KB) |
| grotti | 2.4 KB | 12 |
| family-command-center | 1.9 KB | 11 |
| maoin | 0.95 KB | 7 |
| resumes, factorio-bp, 4 mods, golem | <0.5 KB | 2–4 |
| 11 repos | empty dir | 0 |
| 6 repos/paths | no dir | n/a |

## EvilEye portal (`tools\portal`)

- **Parsing.**
  - Only the backlog is parsed (`src/backlog/parse.mjs`, `status.mjs`, `shards.mjs`). It works losslessly by character offsets, never re-serializes, and recognizes priority sections, top-level list items or `###` entries, `bl-` IDs and the ranking index (where the row is authoritative).
  - `status.mjs` detects done, reopened and partial items.
  - Everything else, including FEATURES and DECISIONS, is rendered read-only, covering root docs plus `docs/**` and `research/**`. There is no document write endpoint.
- **Writing.**
  - `patch.mjs` makes narrow span replacements (edit, set-priority, set-flags, move, index, complete, reopen, add) and preserves the BOM and line endings.
  - `storage/documents.mjs` checks a sha256 revision and returns 409 on conflict. It writes a temp file, fsyncs it, renames it over the original, and retries on a lock.
  - Each change appends to an event log, `events.jsonl`, under %LOCALAPPDATA%.
- **Migration.** `migrate.mjs` is a one-time ID/index migration that checks it can reproduce the original bytes. `diff.mjs` is the dry-run diff.
