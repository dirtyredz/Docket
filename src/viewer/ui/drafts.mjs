// Unsaved scalar edits for the open application session, keyed by registry repo, checkout and item.
// A draft keeps the revision and values it was based on, the user's values, and after a 409 the
// server's current values beside them. Nothing persists past the page: leaving with drafts prompts.

export const SCALARS = ["title", "status", "priority"];
const drafts = new Map();

export const draftKey = (repo, checkout, id) => `${repo}/${checkout}/${id}`;

/** Base snapshot of an item: its revision and scalar values. */
export const baseOf = (item) => ({
  revision: item.revision,
  values: Object.fromEntries(SCALARS.map((k) => [k, item[k] ?? ""])),
});

export const getDraft = (key) => drafts.get(key) ?? null;

/** Record a value; creates the draft from `item` on first edit. Drops it when nothing differs. */
export function editDraft(key, item, field, value) {
  const draft = drafts.get(key) ?? { base: baseOf(item), values: { ...baseOf(item).values } };
  draft.values[field] = value;
  drafts.set(key, draft);
  if (!isDirty(draft) && !draft.conflict) drafts.delete(key);
  return drafts.get(key) ?? null;
}

export const isDirty = (draft) =>
  Boolean(draft) && SCALARS.some((k) => draft.values[k] !== draft.base.values[k]);

/** Fields the draft changes, for the save body. */
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
  if (draft) draft.conflict = baseOf(current);
}

/**
 * Explicit reconciliation: base the user's values on the server's current revision (the next save is
 * checked against it). Never automatic.
 */
export function rebaseOnServer(key) {
  const draft = drafts.get(key);
  if (!draft?.conflict) return;
  // Fields the user never touched follow the server; only the user's own edits are kept.
  for (const k of SCALARS) {
    if (draft.values[k] === draft.base.values[k]) draft.values[k] = draft.conflict.values[k];
  }
  draft.base = draft.conflict;
  delete draft.conflict;
  if (!isDirty(draft)) drafts.delete(key);
}

export const discardDraft = (key) => drafts.delete(key);
export const anyDirty = () => [...drafts.values()].some((d) => isDirty(d) || d.conflict);
