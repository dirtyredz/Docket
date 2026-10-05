# Conflict observation

ADR-09: no merge driver until real conflicts justify one. The observation window opened at the first adopter
cutover (M2b) and covers the two repos that track work with Docket.

- **Window:** 2026-10-05 to 2026-10-19.
- **Repos:** Docket (`docs/items/`), the first adopter (`docs/items/`, 415 items imported 2026-10-05).
- **Record:** every real Git merge conflict inside an item file. Until `docket conflicts record` ships (M5),
  add a row below by hand at resolution time. Revision conflicts (stale `--expect`), duplicate-rank warnings
  and semantic duplicates are not Git conflicts; note them separately if they occur.
- **Decide (M5, item `dk-7f473623`):** after the window, summarise the counts here and record whether a merge
  driver earns its own item.

| Date | Repo | Item file | Fields in conflict | Branches | Resolution effort |
| ---- | ---- | --------- | ------------------ | -------- | ----------------- |
