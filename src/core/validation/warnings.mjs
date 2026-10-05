// Advisory diagnostics (ITEM-SPEC group 9). Warnings print; they never fail a gate.
import { relationPairs } from "./relations.mjs";

const warn = (code, message) => ({ rule: 9, code, message });

/**
 * items: Map<id, {fields, file}>. claimedIds: Set of claimed IDs, or null when claims are unknown
 * (then the unclaimed-wip warning is skipped). today: local YYYY-MM-DD.
 */
export function collectWarnings(items, { claimedIds = null, today }) {
  const out = [];
  const add = (file, w) => out.push({ file, ...w });
  const bands = new Map();
  for (const [id, { fields, file }] of items) {
    for (const [key, target] of relationPairs(fields)) {
      if (items.get(target)?.fields.status === "dropped") {
        add(file, warn("dropped-target", `${key} refers to dropped item ${target}`));
      }
    }
    if (fields.status === "wip" && claimedIds && !claimedIds.has(id)) {
      add(file, warn("unclaimed-wip", "status wip but no claim in this clone"));
    }
    if (today && fields.since && fields.since > today) {
      add(file, warn("future-since", `since ${fields.since} is in the future`));
    }
    if (fields.priority && fields.rank) {
      const key = `${fields.priority} ${fields.rank}`;
      bands.set(key, [...(bands.get(key) ?? []), id]);
    }
  }
  for (const [key, ids] of bands) {
    if (ids.length < 2) continue;
    const [priority, rank] = key.split(" ");
    for (const id of ids) {
      const others = ids.filter((x) => x !== id).join(", ");
      add(
        items.get(id).file,
        warn("duplicate-rank", `rank ${rank} in ${priority} also used by ${others}`),
      );
    }
  }
  return out;
}
