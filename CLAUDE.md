# Docket

Windows 11 CLI (`docket` / `dk`) and local viewer over per-repo Markdown work items. Status: pre-code;
the design is in `docs/PLAN.md`.

## Working here

- Read `STRUCTURE.md` (code map and `## Layout`), then `docs/GOTCHAS.md`. `docs/ARCHITECTURE.md` for
  flows, `docs/DECISIONS.md` for why.
- Stack: Node >= 24, plain ESM (`.mjs`), npm, `node:test`. No TypeScript, no framework.
- Planned commands (not wired yet): `npm test` and `npm run test:<area>` (format, core, storage, cli,
  coordination, integration, packaging, importers, registry, viewer, merge), `npm run test:layout`,
  `npm run build`. Verification per milestone is in `docs/PLAN.md` section 5.
- Today: `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- Dependency direction: CLI/viewer -> core -> storage; importers -> core. Keep code files under about
  800 lines and update STRUCTURE.md's Layout when adding a responsibility.
- Tests ship with the change; a bug fix reproduces the bug in a test first.

## Items

- Docket's own work lives in `docs/items/` (from M0). Item files follow `docs/research/ITEM-SPEC.md`
  exactly: 12 keys in fixed order, `dk-<8hex>` IDs (`bl-` stays valid).
- Never hand-write IDs or ranks once the CLI exists; use `dk add`. The M0 seed items are the one
  exception. Drop items, never delete them.

## Docs

- Living docs (STRUCTURE, ARCHITECTURE, DECISIONS, FEATURES, ROADMAP, BACKLOG, GOTCHAS) are maps: a
  screen or two each, 12 KB hard cap. History goes in `docs/records/`.
- `docs/research/` and `docs/PLAN.md` are historical evidence. Do not reformat or rewrite them; only
  ITEM-SPEC.md is amended in place (note at the top).

## Git

Sole developer, no PRs: merge to `main` and push. The pre-push gate blocks pushes while a structure
review is pending.
