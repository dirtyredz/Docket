// Relation graph integrity (ITEM-SPEC groups 6, 7, 8): references resolve to existing files in the same
// store, no self-reference, unique list members, no parent or blocked_by cycles (checked separately),
// and `fixes` only on bugs, targeting features or tasks.
import { LIST_KEYS } from "../format/schema.mjs";

const issue = (rule, code, message) => ({ rule, code, message });

/** Relation targets of one item as [key, targetId] pairs (parent first, then lists in key order). */
export function relationPairs(fields) {
  const pairs = [];
  if (fields.parent) pairs.push(["parent", fields.parent]);
  for (const key of LIST_KEYS) for (const t of fields[key] ?? []) pairs.push([key, t]);
  return pairs;
}

/**
 * items: Map<id, {fields, file}> keyed by file stem (a reference resolves when that file exists).
 * Returns [{file, ...issue}].
 */
export function checkRelations(items) {
  const errors = [];
  const add = (file, e) => errors.push({ file, ...e });
  for (const [id, { fields, file }] of items) {
    for (const key of LIST_KEYS) {
      const list = fields[key] ?? [];
      const dupes = [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];
      if (dupes.length)
        add(file, issue(6, "duplicate-member", `${key} lists ${dupes.join(", ")} more than once`));
    }
    for (const [key, target] of relationPairs(fields)) {
      if (target === id) add(file, issue(6, "self-reference", `${key} refers to the item itself`));
      else if (!items.has(target))
        add(file, issue(6, "dangling", `${key} target ${target} does not exist`));
    }
    const fixes = fields.fixes ?? [];
    if (fixes.length && fields.type !== "bug") {
      add(
        file,
        issue(8, "fixes-on-non-bug", `fixes is only allowed on type bug (this is ${fields.type})`),
      );
    }
    for (const target of fixes) {
      const t = items.get(target)?.fields.type;
      if (t && t !== "feature" && t !== "task") {
        add(
          file,
          issue(8, "fixes-target", `fixes target ${target} is a ${t}; only feature or task`),
        );
      }
    }
  }
  for (const key of ["parent", "blocked_by"]) {
    for (const cycle of findCycles(items, key)) {
      add(
        items.get(cycle[0]).file,
        issue(7, `${key}-cycle`, `${key} cycle: ${[...cycle, cycle[0]].join(" -> ")}`),
      );
    }
  }
  return errors;
}

// Each cycle reported once, as the path of IDs starting from its smallest member.
function findCycles(items, key) {
  const next = (id) => {
    const f = items.get(id)?.fields;
    if (!f) return [];
    // A self-reference is reported once, as rule 6, not again as a one-item cycle.
    return (key === "parent" ? (f.parent ? [f.parent] : []) : (f.blocked_by ?? [])).filter(
      (t) => t !== id && items.has(t),
    );
  };
  const state = new Map(); // undefined = unvisited, 1 = on stack, 2 = done
  const stack = [];
  const cycles = new Map();
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const n of next(id)) {
      if (state.get(n) === 1) {
        const cycle = stack.slice(stack.indexOf(n));
        const min = cycle.indexOf([...cycle].sort()[0]);
        const canonical = [...cycle.slice(min), ...cycle.slice(0, min)];
        cycles.set(canonical.join(), canonical);
      } else if (!state.get(n)) visit(n);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of [...items.keys()].sort()) if (!state.get(id)) visit(id);
  return [...cycles.values()];
}
