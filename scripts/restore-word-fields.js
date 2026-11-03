import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  droppedWordFields,
  fillMissingWordFields,
  parseWords,
  serializeWords,
} from '../src/lib/merge.js';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const parent = git(['rev-parse', 'HEAD^']);
let parentRaw = '';
try {
  parentRaw = execFileSync('git', ['show', `${parent}:words.json`], { encoding: 'utf8' });
} catch {
  process.exit(0);
}
const currentRaw = fs.readFileSync('words.json', 'utf8');
const previous = parseWords(parentRaw);
const current = parseWords(currentRaw);
if (!droppedWordFields(previous, current).length) process.exit(0);

const restored = serializeWords(fillMissingWordFields(previous, current));
if (restored === currentRaw) process.exit(0);
fs.writeFileSync('words.json', restored);
execFileSync('git', ['add', 'words.json']);
execFileSync('git', [
  '-c', 'user.name=github-actions[bot]',
  '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  'commit',
  '-m',
  'Restore word fields removed by an older app copy',
]);
execFileSync('git', ['push', 'origin', 'HEAD:main'], { stdio: 'inherit' });
