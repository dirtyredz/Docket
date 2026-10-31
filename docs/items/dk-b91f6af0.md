---
id: dk-b91f6af0
type: task
created: 2026-10-31
status: todo
since: 2026-10-31
area:
priority: P3
rank: zw
parent:
fixes: []
blocked_by: []
relates: []
---
# flagNamed: derive --field instead of the identity FLAG_OF_FIELD map

From the 2026-10-31 structure review (abstraction and componentization lenses). In `src/cli/commands/items/options.mjs`, `FLAG_OF_FIELD` maps every field to the flag of the same name. No caller overrides it, and the error-to-flag mapping sits in a file otherwise about option specs.

Acceptance: the flag is derived as `--${field}` from an allow-list Set; the map comes back only when a field and its flag first differ; if a second command family needs the mapping, extract it to `flag-errors.mjs`. `npm run test:cli` passes.
