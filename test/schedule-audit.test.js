import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dayKey } from '../src/lib/day.js';
import {
  buildQueue,
  mergeCards,
  parseProgress,
  queueUnseen,
  summarize,
  unseenCards,
} from '../src/lib/merge.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { freshCard, schedule } from '../src/lib/srs.js';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const settings = { ...DEFAULT_SETTINGS, directions: 'both' };
const words = [
  { id: 'ren', hanzi: '人', pinyin: 'rén', meaning: 'person' },
  { id: 'kou', hanzi: '口', pinyin: 'kǒu', meaning: 'mouth' },
  { id: 'ri', hanzi: '日', pinyin: 'rì', meaning: 'sun' },
];

function sameLocalDay(a, b) {
  return dayKey(a) === dayKey(b);
}

test('dayKey follows the device timezone rather than UTC', () => {
  const stamp = Date.parse('2026-10-31T03:30:00Z');
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(stamp));
  assert.equal(dayKey(stamp), local);
});

test('good and easy stay out of today, while again and hard use minute steps', () => {
  const now = Date.parse('2026-10-31T16:00:00Z');
  const cards = {};
  for (const [id, rating] of [['ren', 'good'], ['kou', 'easy'], ['ri', 'again'], ['yue', 'hard']]) {
    const wordId = id;
    cards[`${wordId}:read`] = schedule(freshCard(`${wordId}:read`, wordId, 'read'), rating, now);
  }
  const deck = [
    ...words,
    { id: 'yue', hanzi: '月', pinyin: 'yuè', meaning: 'moon' },
  ];
  const immediate = buildQueue(deck, cards, settings, now + 30 * 1000);
  assert.deepEqual(immediate.map((item) => item.card.id), []);

  const afterMinutes = buildQueue(deck, cards, settings, now + 6 * MIN);
  assert.deepEqual(afterMinutes.map((item) => item.card.id).sort(), ['ri:read', 'yue:read']);

  const tomorrow = buildQueue(deck, cards, settings, now + DAY);
  assert.ok(tomorrow.some((item) => item.card.id === 'ren:read'));
  assert.equal(sameLocalDay(cards['ren:read'].due, now), false);
  assert.equal(sameLocalDay(cards['kou:read'].due, now), false);
});

test('intervals grow from the review time across later days', () => {
  const day0 = Date.parse('2026-10-31T15:00:00Z');
  let card = schedule(freshCard('ren:read', 'ren', 'read'), 'easy', day0);
  assert.equal(card.due - card.lastReview, 4 * DAY);

  assert.equal(buildQueue(words, { 'ren:read': card }, settings, day0 + DAY).length, 0);
  assert.equal(buildQueue(words, { 'ren:read': card }, settings, day0 + 3 * DAY).length, 0);
  assert.equal(buildQueue(words, { 'ren:read': card }, settings, card.due)[0].card.id, 'ren:read');

  const reviewed = schedule(card, 'good', card.due);
  assert.equal(reviewed.lastReview, card.due);
  assert.ok(reviewed.due - reviewed.lastReview >= DAY);
  assert.ok(reviewed.interval > card.interval);
  assert.equal(buildQueue(words, { 'ren:read': reviewed }, settings, reviewed.lastReview + 60 * 1000).length, 0);

  const opened = { ...reviewed };
  assert.equal(buildQueue(words, { 'ren:read': opened }, settings, reviewed.lastReview + 2 * DAY).length, 0);
  assert.equal(opened.due, reviewed.due);
  assert.equal(opened.interval, reviewed.interval);
});

test('read and write are scheduled separately, and sync does not reschedule', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const read = schedule(freshCard('ren:read', 'ren', 'read'), 'good', now);
  const write = freshCard('ren:write', 'ren', 'write');
  const cards = { 'ren:read': read, 'ren:write': write };
  const merged = mergeCards(cards, JSON.parse(JSON.stringify(cards)));
  assert.equal(merged['ren:read'].due, read.due);
  assert.equal(merged['ren:read'].interval, read.interval);
  assert.equal(merged['ren:write'].status, 'new');
  assert.equal(merged['ren:write'].due, 0);
  assert.notEqual(merged['ren:read'].direction, merged['ren:write'].direction);

  const older = { ...read, lastReview: read.lastReview - DAY, due: 1, interval: 1 };
  const kept = mergeCards({ 'ren:read': read }, { 'ren:read': older });
  assert.equal(kept['ren:read'].due, read.due);
});

test('new cards stay out of Today until he queues them', () => {
  const now = Date.parse('2026-10-31T15:00:00Z');
  assert.equal(buildQueue(words, {}, settings, now).length, 0);
  assert.equal(summarize(words, {}, settings, now).unseen, 6);
  const picked = unseenCards(words, {}, settings).slice(0, 2);
  assert.deepEqual(picked.map((item) => item.card.id), ['ren:read', 'kou:read']);
  const queued = queueUnseen({}, picked);
  assert.deepEqual(buildQueue(words, queued, settings, now).map((item) => item.card.id), ['ren:read', 'kou:read']);
});

test('Justin’s saved progress is due by its timestamps, not by opening the app', () => {
  const progress = parseProgress(fs.readFileSync(new URL('../progress.json', import.meta.url), 'utf8'));
  const savedWords = JSON.parse(fs.readFileSync(new URL('../words.json', import.meta.url), 'utf8'));
  const atSync = Date.parse(progress.updated);
  const queue = buildQueue(savedWords, progress.cards, settings, atSync);
  for (const item of queue) assert.ok(item.card.due <= atSync, item.card.id);
  const dueIds = Object.values(progress.cards)
    .filter((card) => card.status !== 'new' && card.due <= atSync)
    .map((card) => card.id);
  for (const id of dueIds) assert.ok(queue.some((item) => item.card.id === id), id);
  for (const card of Object.values(progress.cards)) {
    const graded = card.reviews?.at(-1)?.grade;
    if (graded === 'good' || graded === 'easy') {
      assert.equal(sameLocalDay(card.due, card.lastReview), false, card.id);
      assert.ok(card.due - card.lastReview >= DAY, card.id);
    }
    if (graded === 'again' || graded === 'hard') {
      assert.ok(card.due - card.lastReview <= 15 * MIN, card.id);
      assert.equal(card.status === 'learning' || card.status === 'relearning', true);
    }
  }
  const moon = progress.cards['yue:read'];
  const whenMoonIsDue = buildQueue(savedWords, progress.cards, settings, moon.due);
  assert.ok(whenMoonIsDue.some((item) => item.card.id === 'yue:read'));
  assert.equal(whenMoonIsDue.some((item) => item.card.id === 'ren:read'), false);

  const fourDaysLater = buildQueue(savedWords, progress.cards, settings, progress.cards['ren:read'].due);
  assert.ok(fourDaysLater.some((item) => item.card.id === 'ren:read'));
  const reread = parseProgress(JSON.stringify(progress));
  assert.equal(reread.cards['ren:read'].due, progress.cards['ren:read'].due);
  assert.equal(mergeCards(progress.cards, reread.cards)['hao:read'].interval, progress.cards['hao:read'].interval);
});
