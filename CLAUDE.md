# Docket

Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown work items. Status: the CLI, core, pre-push
gate, `docket init`, the move-in playbook, the repo registry and the local viewer (`docket serve`) are shipped in 0.5.0 (importers removed, ADR-19; viewer plan `docs/PLAN-VIEWER.md`).

## Working here

- Read `STRUCTURE.md` (code map and `## Layout`), then `docs/GOTCHAS.md`. `docs/ARCHITECTURE.md` for
  flows, `docs/DECISIONS.md` for why.
- Stack: Node >= 22 (24 planned, ADR-13), plain ESM (`.mjs`), npm, `node:test`. No TypeScript.
- Tests: `npm test` (everything), or `npm run test:<area>` for bootstrap, format, core, storage, cli,
  coordination (tests/state), registry, viewer, e2e (Playwright; Edge/Chrome fallback), integration, packaging, layout (bootstrap and layout are scripts, not test folders). Integration and packaging do real pushes to temp bare
  remotes and need the harness template (`~/.claude/hooks/structure/pre-push.template.sh`).
- `npm run build` packs `dist/docket-<v>.tgz`. Ship it: `npm install --global <tgz>`, (ABSOLUTE tarball path: a relative one is misread as a GitHub spec), then
  `docket gate promote <tgz>` (last-good gate) and `docket gate install --repo .`.
- `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- Dependency direction: CLI/viewer -> core -> storage; state, integration -> core. Keep code files under about
  800 lines and update STRUCTURE.md's Layout when adding a responsibility.
- Tests ship with the change; a bug fix reproduces the bug in a test first.

## Items

- Docket's own work lives in `docs/items/` (from M0). Item files follow `docs/research/ITEM-SPEC.md`
  exactly: 12 keys in fixed order, `dk-<8hex>` IDs (`bl-` stays valid).
- Moving another repo's backlog in: `docket init`, then follow `docs/MOVE-IN.md` (no importer).
- Never hand-write IDs or ranks; use `dk add` (the M0 seed items were the one exception). Update
  status with `dk set <id> --status ...`, claim with `dk claim`. Drop items, never delete them.
  Run `dk check` before pushing; the pre-push gate runs it on every pushed tip.

## Docs

- Living docs (STRUCTURE, ARCHITECTURE, DECISIONS, FEATURES, ROADMAP, BACKLOG, GOTCHAS) are maps: a
  screen or two each, 12 KB hard cap. History goes in `docs/records/`.
- `docs/research/` and `docs/PLAN.md` are historical evidence. Do not reformat or rewrite them; only
  ITEM-SPEC.md is amended in place (note at the top).

## Git

Sole developer, no PRs: merge to `main` and push. The pre-push gate blocks pushes while a structure
review is pending.
