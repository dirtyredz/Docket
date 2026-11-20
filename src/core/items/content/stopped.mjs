// Status and discussion are one revision-checked write, so retrying cannot duplicate the note.
import { planSet } from "../set.mjs";
import { mutateStore } from "../transaction.mjs";
import { planNoteAppend } from "./notes.mjs";

export function stopWork(ctx, ids, { today, now = new Date() }) {
  const { written } = mutateStore(ctx, (store) => {
    const writes = [];
    for (const id of ids) {
      if (store.byId.get(id)?.fields?.status !== "wip") continue;
      const status = planSet(store, id, { status: "todo" }, { today });
      const note = planNoteAppend(store, id, { text: "work stopped", author: "agent" }, { now });
      writes.push({ ...status.writes[0], rest: note.writes[0].rest });
    }
    return { writes, value: null };
  });
  return { count: written.length, items: written };
}
