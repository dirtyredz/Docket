---
id: dk-c8a1b81d
type: task
created: 2026-10-11
status: todo
since: 2026-10-11
area: core
priority: P3
rank: y
parent:
fixes: []
blocked_by: []
relates: []
---
# Deduplicate count-by field and doc-name validation

From the 0.7.0 push review (2026-10-11).

- `COUNT_FIELDS` is validated in src/cli/commands/items/list.mjs:51 and again in core/items/query.mjs `countBy` (different error types: usage vs INVALID). Let core own it and map the error in the CLI.
- src/state/registry/registration.mjs:96 repeats the unknown-document-name check that `checkDocPath` in registry/schema.mjs already does. Export one `assertDocName` and use it in both.
