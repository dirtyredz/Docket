---
id: dk-fe9b090e
type: feature
created: 2026-10-04
status: done
since: 2026-10-04
area: core
priority: P0
rank: f
parent:
fixes: []
blocked_by: [dk-13bb01ba]
relates: []
---
# M1a: Strict core and first CLI check

Strict parser, canonical serializer and all nine ITEM-SPEC check groups. Errors fail; warnings print.

Acceptance: `npm run test:format`, `npm run test:core` and `node src/cli/main.mjs check --repo .` pass.
