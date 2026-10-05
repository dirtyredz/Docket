// The save controller the item editor's three panels share (scalar fields, facts body, notes): one
// busy flag, the panel's own API call, draft discard on success, a 409 turned into a recorded conflict
// plus a reload, any other failure shown inline, and the conflict panel frame with its "Use current as
// base" action. A panel supplies only its API call, its fields and its conflict detail. Nothing is
// ever retried automatically.
import { api } from "../../api.mjs";
import { h } from "../../dom.mjs";
import { discardDraft, getDraft, isDirty, markConflict, rebaseOnServer } from "../../drafts.mjs";

/**
 * env: {ctx, route, item, key, syncAll, message} (message: the panel's status <p>).
 * Returns {busy, save(send, {done}), act(send, on409), rebaseAction(testid), discardAction(testid, label)}.
 */
export function createSaver({ ctx, route, item, key, syncAll, message }) {
  let busy = false;

  const fail = (err) => {
    message.textContent = err.message;
    message.className = "error";
    syncAll();
  };

  async function run(action, on409) {
    busy = true;
    syncAll();
    try {
      await action();
      busy = false;
    } catch (err) {
      busy = false;
      if (err.status === 409) return on409();
      fail(err);
    }
  }

  const conflictOf = async () => {
    markConflict(key, await api.item(route.repo, route.checkout, item.id));
    return ctx.reload();
  };

  return {
    get busy() {
      return busy;
    },
    /**
     * Save the panel's draft: send(draft) makes the API call (based on draft.base.revision); on success
     * the draft is discarded, done() runs, and every panel re-fetches (ctx.onSaved gets the response's
     * warnings). A 409 records the server's current item as the draft's conflict and reloads.
     */
    async save(send, { done } = {}) {
      const d = getDraft(key);
      if (busy || !isDirty(d) || d.conflict) return;
      await run(async () => {
        const res = await send(d);
        discardDraft(key);
        done?.();
        busy = false;
        await ctx.onSaved(res?.warnings ?? []);
      }, conflictOf);
    },
    /** A one-shot action that is not a draft save (Resolve): on a 409, on409() decides what to show. */
    async act(send, on409) {
      if (busy) return;
      await run(async () => {
        await send();
        busy = false;
        await ctx.onSaved([]);
      }, on409);
    },
    /** The "Use current as base" action: rebase the draft on the server's version, then reload. */
    rebaseAction: (testid, label = "Use current as base") => ({
      label,
      testid,
      onclick: () => {
        rebaseOnServer(key);
        ctx.reload();
      },
    }),
    discardAction: (testid, label) => ({
      label,
      testid,
      onclick: () => {
        discardDraft(key);
        ctx.reload();
      },
    }),
  };
}

/** The conflict panel frame: headline, panel-specific detail nodes, action buttons, optional footer. */
export function conflictPanel({ testid, headline, detail = [], actions, footer = null }) {
  return h(
    "div",
    { class: "conflict", role: "alert", "data-testid": testid },
    h("strong", {}, headline),
    ...detail,
    h(
      "div",
      { class: "actions" },
      actions.map((a) =>
        h("button", { type: "button", onclick: a.onclick, "data-testid": a.testid }, a.label),
      ),
    ),
    footer,
  );
}
