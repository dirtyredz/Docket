// Re-runnable merge-scenario harness. `node run.mjs` runs every scenario in both storage modes and writes results.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { git, tryGit, I, seed, clone, applyOps, writeState, readState, expectedState } from './lib.mjs';
import { checkDir } from './bl-check.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WORK = path.join(HERE, process.env.BL_WORK ?? 'work');
const X = I(5), Y = I(6), Z = I(15), W = I(2), D = '2026-10-04';
const mk = (id, rank = 'zz') => ({ id, status: 'todo', since: D, type: 'task', priority: 'P2', created: D, rank, area: 'eng', parent: '', fixes: [], blocked_by: [], relates: [], title: 'New ' + id, body: `Description of new ${id}.\n\nAcceptance: ok.\n` });
const add = (id, rank, at) => ({ op: 'add', item: mk(id, rank), at });
const mv = (id, status = 'done') => ({ op: 'move', id, status, since: D });
const set = (id, field, val) => ({ op: 'set', id, field, val });
const app = (id, field, val) => ({ op: 'append', id, field, val });
// [id, title, [opsA, opsB, (opsC)], itemsOnly?, note]
const S = [
 ['a1', 'both ADD 1 new item', [[add('bl-aaaa0001', 'zy')], [add('bl-bbbb0001', 'zz')]]],
 ['a2', 'both ADD 3 new items', [[add('bl-aaaa0001', 'zy'), add('bl-aaaa0002', 'zx'), add('bl-aaaa0003', 'zw')], [add('bl-bbbb0001', 'zz'), add('bl-bbbb0002', 'zv'), add('bl-bbbb0003', 'zu')]]],
 ['a3', 'ADD at distant positions (index 2 vs 17)', [[add('bl-aaaa0001', 'zy', 2)], [add('bl-bbbb0001', 'zz', 17)]]],
 ['b1', 'edit DIFFERENT items, adjacent (5,6)', [[mv(X)], [mv(Y)]]],
 ['b2', 'edit DIFFERENT items, distant (5,15)', [[mv(X)], [mv(Z)]]],
 ['c1', 'same item: status move (status+since) vs priority', [[mv(X)], [set(X, 'priority', 'P0')]]],
 ['c2', 'same item: status move (status+since) vs type (adjacent to since)', [[mv(W)], [set(W, 'type', 'feature')]]],
 ['c3', 'same item: status move vs fixes append', [[mv(X)], [app(X, 'fixes', I(9))]]],
 ['c4', 'same item: area vs rank (adjacent)', [[set(X, 'area', 'qa')], [set(X, 'rank', 'zz')]]],
 ['c5', 'same item: fixes append vs blocked_by append (adjacent lists)', [[app(X, 'fixes', I(8))], [app(X, 'blocked_by', I(2))]]],
 ['c6', 'same item: priority vs rank (separated by created)', [[set(X, 'priority', 'P0')], [set(X, 'rank', 'zz')]]],
 ['c7', 'same item: status ONLY vs type (separated by since)', [[set(W, 'status', 'done')], [set(W, 'type', 'feature')]]],
 ['c8', 'same item: status ONLY vs priority', [[set(X, 'status', 'done')], [set(X, 'priority', 'P0')]]],
 ['c9', 'same item: status move (status+since) vs area', [[mv(X)], [set(X, 'area', 'qa')]]],
 ['c10', 'same item: since-neighbour test, area vs priority', [[set(X, 'area', 'qa')], [set(X, 'priority', 'P0')]]],
 ['c11', 'same item: status move vs parent set', [[mv(W)], [set(W, 'parent', I(0))]]],
 ['d1', 'SAME field, SAME value (status todo->done)', [[mv(X)], [mv(X)]]],
 ['d2', 'SAME field, DIFFERENT value (status done vs dropped)', [[mv(X, 'done')], [mv(X, 'dropped')]]],
 ['d3', 'SAME field, DIFFERENT value (priority)', [[set(X, 'priority', 'P0')], [set(X, 'priority', 'P3')]]],
 ['e1', 'body edit vs status move', [[{ op: 'body', id: X, text: 'Description rewritten by A.' }], [mv(X)]], true],
 ['e2', 'H1 title edit vs relates append (last fm line)', [[{ op: 'title', id: X, text: 'Retitled by A' }], [app(X, 'relates', I(9))]], true],
 ['e3', 'body para 1 vs body para 2', [[{ op: 'body', id: X, text: 'Description by A.' }], [{ op: 'body2', id: X, text: 'Acceptance by B.' }]], true],
 ['e4', 'both edit the same body line', [[{ op: 'body', id: X, text: 'Description by A.' }], [{ op: 'body', id: X, text: 'Description by B.' }]], true],
 ['g1', 'fixes [a] -> [a,b] vs [a,c]', [[app(X, 'fixes', I(9))], [app(X, 'fixes', I(13))]]],
 ['g2', 'relates [] -> [b] vs [c]', [[app(X, 'relates', I(9))], [app(X, 'relates', I(13))]]],
 ['h1', '3 worktrees: each adds 2 items + moves a distinct item', [[add('bl-aaaa0001', 'zy'), add('bl-aaaa0002', 'zx'), mv(I(2))], [add('bl-bbbb0001', 'zz'), add('bl-bbbb0002', 'zv'), mv(I(9))], [add('bl-cccc0001', 'zq'), add('bl-cccc0002', 'zr'), mv(I(14))]]],
 ['i1', 'semantic: A drops item 6, B links item 15 -> 6 (rule 9 would warn)', [[set(Y, 'status', 'dropped')], [app(Z, 'relates', Y)]]],
 ['i2', 'semantic: both add an item with the SAME rank (rule 9 would warn)', [[add('bl-aaaa0001', 'zz')], [add('bl-bbbb0001', 'zz')]]],
];
const rm = p => fs.rmSync(p, { recursive: true, force: true });
function runOne(mode, [sid, title, opsets]) {
  const repo = path.join(WORK, mode, 'repo'), wts = [], base = seed(), names = ['a', 'b', 'c'].slice(0, opsets.length);
  names.forEach((n, i) => {
    const wt = path.join(WORK, mode, `wt-${n}`); git(repo, 'worktree', 'add', '-q', '-b', `${sid}-${n}`, wt, 'main'); wts.push(wt);
    writeState(wt, mode, applyOps(clone(base), opsets[i])); git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', `${sid} ${n}`);
  });
  const expected = clone(base); opsets.forEach(o => applyOps(expected, o));
  let conflict = false, files = '';
  for (const n of names) { const r = tryGit(repo, 'merge', '--no-edit', `${sid}-${n}`); if (!r.ok) { conflict = true; files = r.out.split('\n').filter(l => l.startsWith('CONFLICT')).length + ' conflict(s)'; tryGit(repo, 'merge', '--abort'); break; } }
  let outcome = 'clean', detail = files;
  if (!conflict) {
    const act = readState(repo, mode), exp = expectedState(expected, mode);
    const bad = Object.keys({ ...act, ...exp }).filter(k => act[k] !== exp[k]);
    const errs = mode === 'items' ? checkDir(repo) : [];
    if (bad.length || errs.length) { outcome = 'silent-wrong'; detail = `diff:${bad.slice(0, 3)} ${errs.slice(0, 2)}`; }
  } else outcome = 'conflict';
  wts.forEach(w => git(repo, 'worktree', 'remove', '--force', w)); names.forEach(n => git(repo, 'branch', '-D', `${sid}-${n}`));
  git(repo, 'reset', '-q', '--hard', 'base');
  return { id: sid, title, mode, outcome, detail };
}
rm(WORK); const results = [];
for (const mode of ['items', 'backlog', 'items-ml']) {
  const repo = path.join(WORK, mode, 'repo'); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't'); git(repo, 'config', 'core.autocrlf', 'false');
  writeState(repo, mode, seed()); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'seed'); git(repo, 'tag', 'base');
  for (const s of S) { if (mode === 'backlog' && s[3] === true) continue; results.push(runOne(mode, s)); }
}
fs.writeFileSync(path.join(HERE, process.env.BL_OUT ?? 'results.json'), JSON.stringify(results, null, 1));
console.log('id'.padEnd(4), 'file-per-item'.padEnd(13), 'one-BACKLOG'.padEnd(12), 'multiline-lists'.padEnd(15), 'scenario');
for (const id of [...new Set(results.map(r => r.id))]) {
  const g = m => results.find(r => r.id === id && r.mode === m);
  console.log(id.padEnd(4), g('items').outcome.padEnd(13), (g('backlog')?.outcome ?? 'n/a').padEnd(12), (g('items-ml')?.outcome ?? '-').padEnd(15), g('items').title, g('items').detail);
}
