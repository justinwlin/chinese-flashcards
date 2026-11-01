import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { freshCard } from '../src/lib/srs.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { decodeBase64, encodeBase64 } from '../src/lib/github.js';
import {
  alignWords,
  applyTombstones,
  buildQueue,
  mergeCards,
  mergeWords,
  parseWords,
  reconcileRemote,
  serializeWords,
  summarize,
} from '../src/lib/merge.js';

const settings = { ...DEFAULT_SETTINGS, newPerDay: 10, directions: 'both' };

test('newer word edits win and file order is kept', () => {
  const local = [{ id: 'ren', hanzi: '人', pinyin: 'rén', meaning: 'person', added: '2026-10-31', updated: '2026-11-02T00:00:00.000Z', dirty: true }];
  const remote = [{ id: 'ren', hanzi: '人', pinyin: 'rén', meaning: 'human', added: '2026-10-31', updated: '2026-11-01T00:00:00.000Z' }];
  const merged = mergeWords(local, remote);
  assert.equal(merged[0].meaning, 'person');
  const ordered = alignWords(
    [{ id: 'hao', hanzi: '好', pinyin: 'hǎo', meaning: 'good', added: '2026-10-31', updated: '2026-11-03T00:00:00.000Z', dirty: true }],
    remote,
  );
  assert.deepEqual(ordered.map((word) => word.id), ['ren', 'hao']);
});

test('tombstones hide a word unless it was edited after deletion', () => {
  const words = [{ id: 'ri', hanzi: '日', pinyin: 'rì', meaning: 'sun', added: '2026-10-31', updated: '2026-10-31T00:00:00.000Z' }];
  assert.equal(applyTombstones(words, { ri: '2026-10-31T00:00:00.000Z' }).length, 0);
  const restored = [{ ...words[0], updated: '2026-11-01T00:00:00.000Z' }];
  assert.equal(applyTombstones(restored, { ri: '2026-10-31T00:00:00.000Z' })[0].id, 'ri');
});

test('a remote snapshot drops clean local words that were deleted in the repo', () => {
  const local = [
    { id: 'ren', hanzi: '人', pinyin: 'rén', meaning: 'person', added: '2026-10-31', updated: '2026-10-31T00:00:00.000Z' },
    { id: 'extra', hanzi: '火', pinyin: 'huǒ', meaning: 'fire', added: '2026-11-01', updated: '2026-11-01T00:00:00.000Z', dirty: true },
  ];
  const remote = [{ id: 'kou', hanzi: '口', pinyin: 'kǒu', meaning: 'mouth', added: '2026-10-31', updated: '2026-10-31T00:00:00.000Z' }];
  const { words, tombstones } = reconcileRemote({
    localWords: local,
    remoteWords: remote,
    localTombs: {},
    remoteTombs: {},
  });
  assert.deepEqual(words.map((word) => word.id), ['kou', 'extra']);
  assert.ok(tombstones.ren);
});

test('the later review wins when progress is merged', () => {
  const local = { 'ren:read': { id: 'ren:read', lastReview: 20, ease: 2.2 } };
  const remote = { 'ren:read': { id: 'ren:read', lastReview: 10, ease: 2.8 }, 'ren:write': { id: 'ren:write', lastReview: 5 } };
  const merged = mergeCards(local, remote);
  assert.equal(merged['ren:read'].ease, 2.2);
  assert.equal(merged['ren:write'].lastReview, 5);
});

test('the daily queue teaches reading faces before writing faces', () => {
  const words = [
    { id: 'ren', hanzi: '人', pinyin: 'rén', meaning: 'person' },
    { id: 'kou', hanzi: '口', pinyin: 'kǒu', meaning: 'mouth' },
    { id: 'ri', hanzi: '日', pinyin: 'rì', meaning: 'sun' },
  ];
  const now = Date.parse('2026-10-31T15:00:00Z');
  const today = '2026-10-31';
  const queue = buildQueue(words, {}, { ...settings, newPerDay: 2 }, now, today);
  assert.deepEqual(queue.map((item) => item.card.id), []);

  const cards = {
    'ren:read': { ...freshCard('ren:read', 'ren', 'read'), status: 'learning', due: now - 1000 },
    'kou:read': { ...freshCard('kou:read', 'kou', 'read'), status: 'review', due: now - 500, interval: 3 },
    'ri:read': { ...freshCard('ri:read', 'ri', 'read'), status: 'review', due: now + 60_000, interval: 2 },
    'ren:write': { ...freshCard('ren:write', 'ren', 'write'), introducedOn: today, status: 'learning', due: now + 60_000 },
  };
  const summary = summarize(words, cards, { ...settings, newPerDay: 1 }, now, today);
  assert.equal(summary.learningDue, 1);
  assert.equal(summary.reviewDue, 1);
  assert.equal(summary.due, 2);
  const due = buildQueue(words, cards, { ...settings, newPerDay: 1 }, now, today);
  assert.deepEqual(due.map((item) => item.card.id), ['ren:read', 'kou:read']);

  const reading = buildQueue(words, {}, { ...settings, directions: 'read', newPerDay: 10 }, now, today);
  assert.ok(reading.every((item) => item.card.direction === 'read'));
});

test('the committed deck matches the serializer and the study list', () => {
  const raw = fs.readFileSync(new URL('../words.json', import.meta.url), 'utf8');
  const words = parseWords(raw);
  assert.equal(serializeWords(words), raw);
  assert.ok(words.length >= 20 && words.length <= 200);
  const hanzi = new Set(words.map((word) => word.hanzi));
  for (const character of ['人', '口', '日', '月', '明', '水', '女', '好', '日落', '你好', '谢谢', '中国', '飞机', '朋友']) {
    assert.ok(hanzi.has(character), character);
  }
  const day1 = words.filter((word) => word.tags?.includes('day1')).map((word) => word.hanzi);
  assert.deepEqual(day1, ['人', '口', '日', '月', '明', '水', '女', '好']);
  const riluo = words.find((word) => word.hanzi === '日落');
  assert.equal(riluo.pinyin, 'rì luò');
  assert.equal(riluo.meaning, 'sunset');
  const ids = words.map((word) => word.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const word of words) {
    assert.ok(word.id && word.hanzi && word.pinyin && word.meaning && word.added);
  }
});

test('github file bodies round-trip through base64', () => {
  const text = '日落 rì luò\n';
  assert.equal(decodeBase64(encodeBase64(text)), text);
});
