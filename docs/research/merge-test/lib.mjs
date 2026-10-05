import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process';
import { KEYS } from './bl-check.mjs';
export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const tryGit = (cwd, ...a) => { try { return { ok: true, out: git(cwd, ...a) }; } catch (e) { return { ok: false, out: String(e.stdout) + String(e.stderr) }; } };
export const I = n => 'bl-' + crypto.createHash('sha1').update('seed' + n).digest('hex').slice(0, 8);
const L = a => '[' + a.join(', ') + ']';
export function seed(n = 20) {
  const types = ['feature', 'bug', 'task', 'idea'];
  return Array.from({ length: n }, (_, i) => ({
    id: I(i), status: i % 7 === 3 ? 'wip' : 'todo', since: `2026-09-${String(1 + i).padStart(2, '0')}`, type: types[i % 4],
    priority: 'P' + (i % 3), created: '2026-09-01', rank: String.fromCharCode(97 + i), area: i % 2 ? 'eng' : 'ui',
    parent: i >= 10 && i % 4 === 2 ? I(0) : '', fixes: i % 4 === 1 ? [I(i - 1)] : [], blocked_by: i % 5 === 4 ? [I(0)] : [], relates: [],
    title: `Item ${i} title`, body: `Description of item ${i}.\n\nAcceptance: criteria ${i}.\n` }));
}
export const clone = o => structuredClone(o);
export function itemText(it, ml = false) {
  const fm = KEYS.map(k => Array.isArray(it[k]) ? (ml && it[k].length ? [`${k}:`, ...it[k].map(x => `  - ${x}`)].join('\n') : `${k}: ${L(it[k])}`) : it[k] === '' ? `${k}:` : `${k}: ${it[k]}`);
  return `---\n${fm.join('\n')}\n---\n# ${it.title}\n\n${it.body}`;
}
export const backlogLine = it => `- ${KEYS.map(k => `${k}=${Array.isArray(it[k]) ? L(it[k]) : it[k]}`).join(' ')} :: ${it.title}`;
export const backlogText = items => '# Backlog\n\n' + items.map(backlogLine).join('\n') + '\n';
export function applyOps(items, ops) {
  for (const o of ops) {
    if (o.op === 'add') { if (o.at !== undefined) items.splice(o.at, 0, clone(o.item)); else items.push(clone(o.item)); continue; }
    const it = items.find(x => x.id === o.id);
    if (o.op === 'set') it[o.field] = o.val;
    else if (o.op === 'move') { it.status = o.status; it.since = o.since; }
    else if (o.op === 'append') { if (!it[o.field].includes(o.val)) it[o.field].push(o.val); }
    else if (o.op === 'title') it.title = o.text;
    else if (o.op === 'body') it.body = it.body.replace(/^Description.*$/m, o.text);
    else if (o.op === 'body2') it.body = it.body.replace(/^Acceptance.*$/m, o.text);
  }
  return items;
}
export function writeState(root, mode, items) {
  if (mode.startsWith('items')) { const d = path.join(root, 'docs', 'items'); fs.mkdirSync(d, { recursive: true }); for (const it of items) fs.writeFileSync(path.join(d, it.id + '.md'), itemText(it, mode === 'items-ml')); }
  else fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogText(items));
}
const sortedLines = t => t.split('\n').filter(Boolean).sort().join('\n');
export function readState(root, mode) {
  if (mode === 'backlog') return { 'BACKLOG.md': sortedLines(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8')) };
  const d = path.join(root, 'docs', 'items'); return Object.fromEntries(fs.readdirSync(d).sort().map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
}
export const expectedState = (items, mode) => mode === 'backlog' ? { 'BACKLOG.md': sortedLines(backlogText(items)) } : Object.fromEntries(items.map(x => [x.id + '.md', itemText(x, mode === 'items-ml')]));
