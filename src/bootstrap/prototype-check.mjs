// RECOVERED PROTOTYPE (quarantined; production code never imports this file).
// Source: docs/research/merge-test/bl-check.mjs, commit 553ae79, sha256 b3ca27ce7c644aadef81580c4333d0bfef264a5307c6b0b47ef306e2a5637044.
// Minimal M0 adaptation, nothing else changed: the ID and filename patterns accept `dk-` as well as `bl-`
// (ITEM-SPEC amendment 2026-10-04). KEYS already holds the final field order.
// Known gaps (see docs/GOTCHAS.md): no rule 9 warnings at all (duplicate rank, dropped targets, unclaimed
// wip, future since); no explicit BOM or UTF-8 check (a BOM only fails by accident, at the fence match); `fixes` target types not checked; lenient value grammar for
// scalar tokens; Date.parse accepts impossible dates such as 2026-02-30.
// Prototype of `bl check` for ITEM-SPEC v1. Usage: node bl-check.mjs <repo-or-worktree-root>
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const KEYS = (process.env.BL_KEYS ?? 'id,type,created,status,since,area,priority,rank,parent,fixes,blocked_by,relates').split(',');
const ENUM = { status:['todo','wip','done','dropped'], type:['feature','bug','task','idea'], priority:['P0','P1','P2','P3'] };
const ID = /^(dk|bl)-[0-9a-f]{8}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TOK = /^[A-Za-z0-9._-]+$/;
export function parse(text) { // lenient structural parse; returns {fm:{k:v}, order:[k], title, body, errs:[]}
  const errs = [], lines = text.split('\n'), fm = {}, order = [];
  if (lines[0] !== '---') return { errs: ['no frontmatter fence at line 1'], fm, order };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { errs: ['frontmatter not closed'], fm, order };
  for (const [i, l] of lines.slice(1, end).entries()) {
    const m = /^([a-z_]+):(?: (.*))?$/.exec(l);
    if (!m) { errs.push(`line ${i+2}: not "key: value": ${JSON.stringify(l)}`); continue; }
    if (m[1] in fm) errs.push(`duplicate key ${m[1]}`);
    fm[m[1]] = m[2] ?? ''; order.push(m[1]);
  }
  const rest = lines.slice(end + 1), t = rest.findIndex(l => l.trim() !== '');
  const title = t >= 0 && /^# \S/.test(rest[t]) ? rest[t].slice(2) : null;
  if (title === null) errs.push('first non-blank line after frontmatter is not an H1');
  return { fm, order, title, body: rest.slice(t + 1).join('\n'), errs };
}
const list = v => { const m = /^\[(.*)\]$/.exec(v); return m ? (m[1] === '' ? [] : m[1].split(', ')) : null; };
export function checkDir(root) {
  const dir = path.join(root, 'docs', 'items'), errs = [], items = {};
  for (const f of fs.readdirSync(dir)) {
    const e = m => errs.push(`${f}: ${m}`), txt = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/^(dk|bl)-[0-9a-f]{8}\.md$/.test(f)) { e('bad filename'); continue; }
    if (/\r|\t| \n/.test(txt)) e('CR, tab or trailing space');
    const p = parse(txt); p.errs.forEach(e);
    if (p.order.join() !== KEYS.join()) e(`keys/order wrong: [${p.order}]`);
    for (const [k, v] of Object.entries(p.fm)) {
      if (['fixes','blocked_by','relates'].includes(k)) { const l = list(v); if (!l) e(`${k} not a flow list: ${v}`); else if (l.some(x => !ID.test(x)) || new Set(l).size !== l.length) e(`${k} bad/dup ids`); }
      else if (k in ENUM) { if (!ENUM[k].includes(v)) e(`${k} bad enum "${v}"`); }
      else if (k === 'since' || k === 'created') { if (!DATE.test(v) || isNaN(Date.parse(v))) e(`${k} bad date "${v}"`); }
      else if (k === 'id') { if (v !== f.slice(0, -3)) e('id != filename'); }
      else if (k === 'parent') { if (v !== '' && !ID.test(v)) e(`parent bad "${v}"`); }
      else if (k === 'rank') { if (!/^[a-z]+$/.test(v)) e(`rank bad "${v}"`); }
      else if (k === 'area') { if (v !== '' && !TOK.test(v)) e(`area bad "${v}"`); }
    }
    if (DATE.test(p.fm.since) && DATE.test(p.fm.created) && p.fm.since < p.fm.created) e('since < created');
    items[f.slice(0, -3)] = p;
  }
  for (const [id, p] of Object.entries(items)) {
    const refs = [p.fm.parent, ...['fixes','blocked_by','relates'].flatMap(k => list(p.fm[k] ?? '') ?? [])].filter(Boolean);
    for (const r of refs) { if (r === id) errs.push(`${id}: self reference`); else if (!items[r]) errs.push(`${id}: dangling ref ${r}`); }
    if (p.fm.fixes && p.fm.fixes !== '[]' && p.fm.type !== 'bug') errs.push(`${id}: fixes on non-bug`);
    for (const k of ['parent', 'blocked_by']) { // cycle walk
      const next = x => k === 'parent' ? [items[x]?.fm.parent].filter(Boolean) : list(items[x]?.fm.blocked_by ?? '') ?? [];
      const seen = new Set(), st = [id]; while (st.length) for (const n of next(st.pop())) { if (n === id) { errs.push(`${id}: ${k} cycle`); st.length = 0; break; } if (!seen.has(n)) { seen.add(n); st.push(n); } }
    }
  }
  return errs;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const e = checkDir(process.argv[2] ?? '.'); console.log(e.length ? e.join('\n') : 'ok'); process.exit(e.length ? 1 : 0); }
