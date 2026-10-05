# MOVE-IN

How an agent moves an existing repo's backlog into Docket. There is no importer (ADR-19): the move is a
one-time, reviewed pass using the ordinary commands. Never edit the old backlog until the owner has
approved the new item list.

## Steps

1. **Branch.** `git switch -c move-into-docket`. All of this happens on the branch.
2. **Initialise.** Preview, then apply: `docket init --dry-run`, then `docket init` (add `--gate` for the
   pre-push check). Each file is reported created, updated or unchanged; re-running is harmless.
3. **Read the old backlog completely.** Write down the counts first: open, done and dropped entries.
   Step 7 must match them. Note where entries live and how they mark status and priority.
4. **Write one JSON file** (outside the repo or under `.docket/`), one object per entry in the old order,
   then `dk add --batch items.json`. Everything is validated before anything is written, and the created
   list comes back as JSON. Never hand-write IDs, ranks or item files.
   ```json
   [
     {
       "type": "bug",
       "priority": "P1",
       "status": "todo",
       "title": "Crash on empty file",
       "body": "From BACKLOG.md: crashes when the file is empty.\n",
       "area": "parser"
     },
     { "type": "task", "priority": "P2", "status": "done", "title": "Rename config key" }
   ]
   ```
   Keys: `type` (feature, bug, task, idea), `priority` (P0 to P3, no mark means P2), `status` (todo, wip,
   done, dropped), `title` (one line), optional `body` and `area`. Put the entry's original text,
   unchanged, in `body`, optionally led by a line saying where it came from. Order within a priority is
   array order. Relations (`dk link`) only when the old entry states them outright. Keep the mapping
   from old marks to these values as a short table for your report.
5. **Ticked but with an open remainder.** Keep one `todo` item retitled to the open part, with a note in
   the body saying what was done, unless the owner asks to split it.
6. **Validate.** `dk check`; fix every error. Unsure entries (unclear status, duplicates, prose that is
   not an entry) stay as items with a note in the body and go on the review list.
7. **Count check.** `dk list --all --count-by status` must equal the old counts, with each deliberate
   difference (merged, split, dropped) named in the report.
8. **Owner review.** Show `dk list --all`, the mapping table, the count check and the uncertain entries.
   Stop until they approve; corrections are `dk set` / `dk add`.
9. **Replace the old backlog** only after approval: a short pointer to `docs/items/` and `dk list`, or
   remove shards the owner agrees are covered. Fix documents that told readers to edit the old backlog.
10. **Commit** on the branch ("Move backlog into Docket"). Do not push without the owner's go-ahead.

## Notes

- `--gate` writes into the repo's managed pre-push hook. Pausing or opting out of the structure gate does
  NOT pause Docket: its check still runs on every push.
- Run `dk check` again before the push; the gate runs it on every pushed tip.
