// Unsaved edits for the open application session, keyed by registry repo, checkout, item AND editor
// kind (scalar | body | note). A draft keeps the revision it was based on, the user's input, and after
// a 409 the server's current state beside it. Nothing persists past the page: leaving with drafts
// prompts. Three real callers (scalar-editor, body-editor, notes); deliberately not a form framework.

export const SCALARS = ["title", "status", "priority"];
export const KINDS = ["scalar", "body", "note"];
const drafts = new Map();

export const draftKey = (repo, checkout, id, kind = "scalar") =>
  `${repo}/${checkout}/${id}/${kind}`;

/** Base snapshot of an item for scalar drafts: its revision and scalar values. */
export const baseOf = (item) => ({
  revision: item.revision,
  values: Object.fromEntries(SCALARS.map((k) => [k, item[k] ?? ""])),
});

/** Base snapshot for body/note drafts: the revision and the exact editable body source. */
const textBaseOf = (item) => ({ revision: item.revision, source: item.bodySource ?? "" });

export const getDraft = (key) => drafts.get(key) ?? null;

export function isDirty(draft) {
  if (!draft) return false;
  if (draft.kind === "body") return draft.text !== draft.base.source;
  if (draft.kind === "note") return draft.text.trim() !== "";
  return SCALARS.some((k) => draft.values[k] !== draft.base.values[k]);
}

function keep(key, draft) {
  drafts.set(key, draft);
  if (!isDirty(draft) && !draft.conflict) drafts.delete(key);
  return drafts.get(key) ?? null;
}

/** Scalar: record a value; creates the draft from `item` on first edit. Drops it when nothing differs. */
export function editDraft(key, item, field, value) {
  const draft = drafts.get(key) ?? {
    kind: "scalar",
    base: baseOf(item),
    values: { ...baseOf(item).values },
  };
  draft.values[field] = value;
  return keep(key, draft);
}

/** Body or note: record the user's text; the draft remembers the revision it started from. */
export function editText(key, kind, item, text) {
  const draft = drafts.get(key) ?? { kind, base: textBaseOf(item), text };
  draft.text = text;
  return keep(key, draft);
}

/** Fields the scalar draft changes, for the save body. */
export const changedFields = (draft) =>
  Object.fromEntries(
    SCALARS.filter((k) => draft.values[k] !== draft.base.values[k]).map((k) => [
      k,
      draft.values[k],
    ]),
  );

/** A save hit 409: keep every input and remember the server's current state beside it. */
export function markConflict(key, current) {
  const draft = drafts.get(key);
  if (draft) draft.conflict = draft.kind === "scalar" ? baseOf(current) : textBaseOf(current);
}

/**
 * Explicit reconciliation: base the user's input on the server's current revision (the next save is
 * checked against it). Never automatic.
 */
export function rebaseOnServer(key) {
  const draft = drafts.get(key);
  if (!draft?.conflict) return;
  if (draft.kind === "scalar") {
    // Fields the user never touched follow the server; only the user's own edits are kept.
    for (const k of SCALARS) {
      if (draft.values[k] === draft.base.values[k]) draft.values[k] = draft.conflict.values[k];
    }
  }
  draft.base = draft.conflict;
  delete draft.conflict;
  if (!isDirty(draft)) drafts.delete(key);
}

export const discardDraft = (key) => drafts.delete(key);
export const anyDirty = () => [...drafts.values()].some((d) => isDirty(d) || d.conflict);

/** Editor kinds of one item that hold an unsaved draft or an unresolved conflict. */
export function activeKinds(repo, checkout, id) {
  return KINDS.filter((kind) => {
    const d = drafts.get(draftKey(repo, checkout, id, kind));
    return isDirty(d) || Boolean(d?.conflict);
  });
}
