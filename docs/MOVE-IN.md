# MOVE-IN

How an agent moves an existing repo's backlog into Docket. There is no importer (ADR-19): the move is a
one-time, reviewed pass using the ordinary commands. Work in a branch; never edit the old backlog until
the owner has approved the new item list.

## Steps

1. **Initialise.** From the repo root run `docket init` (add `--gate` if the owner wants the pre-push
   check). It creates `docs/items/` and `docket.json`, ignores `.docket/` and adds the agent snippet to
   `CLAUDE.md` / `AGENTS.md`. Re-running is harmless.
2. **Read the old backlog completely.** Write down the counts first: open entries and done entries (and
   dropped ones, if the old format has them). These are the numbers step 5 must match. Note where the
   entries live (one file, shards, a table plus prose) and how it marks status and priority.
3. **Create every entry as an item.** One `dk add` per entry, then `dk set` where a field cannot be given
   at creation:
   - `dk add --type <feature|bug|task|idea> --priority <P0..P3> --title "<one line>" --body-file <file>`
     with `--area` and `--status` when known. Put the entry's original text, unchanged, in the body: write
     it to a scratch file (outside the repo or under `.docket/`) and pass `--body-file`, or use `--body`
     for one-liners. Lose nothing; you may add a first line saying where the entry came from.
   - Map old marks to Docket's values and keep the mapping as a short table in your report:
     status `todo | wip | done | dropped` (a reopened or partial entry is `todo` unless work is clearly
     under way; struck-out or abandoned entries are `dropped`), priority `P0..P3` (no mark means `P2`),
     type `task` unless the entry is clearly a bug, feature or idea.
   - Keep the old order within a priority: add entries in the order they appear, because `dk add` ranks
     each new item at the end of its band. Use `dk set <id> --before|--after <id>` only to fix exceptions.
   - Relations (`dk link`) only when the old entry states them outright; never infer them.
   - Do not hand-write IDs, ranks or item files. Old IDs are not carried over; mention an old ID in the
     body if other documents refer to it.
4. **Validate.** Run `dk check`; fix every error. Unsure entries (unclear status, duplicates, prose that
   is not an entry) stay as items with a note in the body and go on the review list; do not guess silently.
5. **Count check.** Compare the old counts with `dk list --all --json` (group by `status`; `list` pages at
   50, raise `--limit` up to 500). Open must equal open and done must equal done, with any deliberate
   difference named (merged, split or dropped entries) in the report.
6. **Owner review.** Show the owner the item list (`dk list --all`), the mapping table, the count check and the
   uncertain entries. Stop here until they approve or correct it (corrections are `dk set` / `dk add`).
7. **Replace the old backlog.** Only after approval: replace the old backlog file(s) with a short pointer
   to `docs/items/` and `dk list`, or remove shards the owner agrees are covered. Fix documents that told
   readers to edit the old backlog.
8. **Commit** the items, `docket.json`, the pointer and the snippet in one commit on the branch
   ("Move backlog into Docket"). Do not push without the owner's go-ahead.

## Notes

- Large backlogs: script the `dk add` calls, one per entry, from your own parse of the old file. The
  commands, not the script, assign IDs and ranks.
- Run `dk check` again before the push; the gate runs it on every pushed tip.
