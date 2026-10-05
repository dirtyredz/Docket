// Reverse relations, computed from the index: relations are stored on the source item only.

/**
 * For `id`: children (parent = id), fixedBy (bugs whose fixes include id), blocks (items blocked by
 * id), relates (symmetric: stored on either side).
 */
export function reverseRelations(records, id) {
  const out = { children: [], fixedBy: [], blocks: [], relates: [] };
  for (const r of records) {
    const f = r.fields;
    if (!f || r.id === id) continue;
    if (f.parent === id) out.children.push(r.id);
    if (f.fixes?.includes(id)) out.fixedBy.push(r.id);
    if (f.blocked_by?.includes(id)) out.blocks.push(r.id);
    if (f.relates?.includes(id)) out.relates.push(r.id);
  }
  const own = records.find((r) => r.id === id)?.fields?.relates ?? [];
  out.relates = [...new Set([...own, ...out.relates])].sort();
  for (const k of ["children", "fixedBy", "blocks"]) out[k].sort();
  return out;
}
