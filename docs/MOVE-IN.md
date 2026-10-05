# MOVE-IN

How an agent moves an existing repo's backlog into Docket. There is no importer (ADR-19): the move is a
one-time, reviewed pass using the ordinary commands. Never edit the old backlog until the owner has
approved the new item list.

## Steps

1. **Branch.** `git switch -c move-into-docket` (the default branch may be `master`, not `main`). All of this happens on the branch.
2. **Initialise.** Preview, then apply: `docket init --dry-run`, then `docket init` (add `--gate` for the
   pre-push check). Each file is reported created, updated or unchanged; re-running is harmless.
3. **Read the old backlog completely.** Write down the counts first: open, done and dropped entries.
   Step 7 must match them. Note where entries live and how they mark status and priority.
4. **Write one JSON file** in a private folder outside the repo, with a unique name per repo (shared temp
   names collided between parallel agents), one object per entry in the old order, then
   `dk add --batch <file> --json`. Everything is validated before anything is written. `--json` returns the
   envelope `{ok, command, data: {count, items}}` with the created IDs (without it you get plain
   `id  title` lines). Never hand-write IDs, ranks or item files. Build the JSON with a script that reads the
   old file: never retype entry text.
   ```json
   [
     {
       "type": "bug",
       "priority": "P1",
       "status": "todo",
       "title": "Crash on empty file",
       "body": "From BACKLOG.md: crashes when the file is empty.
   ```

",
"area": "parser"
},
{ "type": "task", "priority": "P2", "status": "done", "title": "Rename config key", "since": "2026-08-22" }
]

````
Keys: `type` (feature, bug, task, idea), `priority` (P0 to P3, no mark means P2), `status` (todo, wip,
done, dropped), `title` (one line), optional `body`, `area`, `created` and `since` (YYYY-MM-DD). Dates:
when the old entry states one, e.g. "(done 2026-08-22)", carry it. Real, not future, `since >= created`;
one alone fills both; none keeps today. The `body` is the entry's original text, byte for byte, led by
a `From docs/BACKLOG.md (<section>)` line. Order within a priority is array order. Relations (`dk link`)
only when the old entry states them outright. Keep the old-mark to value mapping as a short table.
**Titles:** use the entry's bold lead; with none, write a short title and keep the full text in the body.
A bold title that wraps over several lines is one title: the parser must join continuation lines; check
the count after parsing (the count check caught exactly this).
What is NOT an entry: "None" placeholders and section intro prose; known issues, watch-list notes and
accepted limitations (they go to the repo's `docs/GOTCHAS.md`, named in step 7 as a deliberate
difference); open-question lists, unless actionable (type `task`, area `research`), else leave them in
the README. A bullet with no checkbox in a priority section is an open entry at that priority.
5. **Ticked but with an open remainder** (a note saying so, or a `[~]` partial mark): keep one `todo` item
retitled to the open part, with a note in the body saying what was done, unless the owner asks to split it.
6. **Validate.** `dk check`; fix every error. Unsure entries (unclear status, duplicates) stay as items with a note in the
body and go on the review list.
7. **Count check.** `dk list --all --count-by status` must equal the old counts, with each deliberate
difference (merged, split, dropped) named in the report.
8. **Owner review.** Show `dk list --all`, the mapping table, the count check and the uncertain entries.
Stop until they approve; corrections are `dk set` / `dk add`.
9. **Replace the old backlog** only after approval: a short pointer, or
remove shards the owner agrees are covered. Fix documents that told readers to edit the old backlog.
Pointer template:
```md
Work items now live in `docs/items/` (one Markdown file each). Use `dk list`, `dk add` and `dk set`;
do not edit them by hand.
````

10. **Commit** on the branch ("Move backlog into Docket"). Do not push without the owner's go-ahead.

## Notes

- `--gate` writes into the repo's managed pre-push hook. Pausing or opting out of the structure gate does
  NOT pause Docket: its check still runs on every push.
- Run `dk check` again before the push; the gate runs it on every pushed tip.
