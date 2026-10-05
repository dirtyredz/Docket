// node agent.mjs prep   -> builds agent/repo (20 seeded items + ITEM-SPEC.md) and worktrees agent/wt-1, agent/wt-2
// node agent.mjs merge  -> commits whatever each helper left, validates each branch, merges both into main, validates result
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { git, tryGit, seed, writeState } from './lib.mjs';
import { checkDir } from './bl-check.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), A = path.join(HERE, 'agent'), repo = path.join(A, 'repo');
if (process.argv[2] === 'prep') {
  fs.rmSync(A, { recursive: true, force: true }); fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't'); git(repo, 'config', 'core.autocrlf', 'false');
  writeState(repo, 'items', seed()); fs.copyFileSync('<harness>/research/bl/ITEM-SPEC.md', path.join(repo, 'ITEM-SPEC.md'));
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'seed');
  for (const n of [1, 2]) git(repo, 'worktree', 'add', '-q', '-b', `agent-${n}`, path.join(A, `wt-${n}`), 'main');
  console.log('ready', A);
} else {
  for (const n of [1, 2]) {
    const wt = path.join(A, `wt-${n}`); git(wt, 'add', '-A'); tryGit(wt, 'commit', '-q', '-m', `agent ${n}`);
    const e = checkDir(wt); console.log(`--- agent-${n}: ${git(wt, 'diff', '--stat', 'main', 'HEAD').trim().split('\n').pop()}; validator errors: ${e.length}`); e.forEach(x => console.log('  ', x));
  }
  for (const n of [1, 2]) { const r = tryGit(repo, 'merge', '--no-edit', `agent-${n}`); console.log(`merge agent-${n}:`, r.ok ? 'clean' : 'CONFLICT\n' + r.out); if (!r.ok) { tryGit(repo, 'merge', '--abort'); } }
  const e = checkDir(repo); console.log(`--- merged main validator errors: ${e.length}`); e.forEach(x => console.log('  ', x));
}
