import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildQueue, parseProgress, summarize, unseenCards } from '../src/lib/merge.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { planWriteCards, readSideReadyForWrite } from '../src/lib/srs.js';

const DAY = 24 * 60 * 60 * 1000;
const UNSEEN = ['吃', '喝', '家', '一', '二', '三', '大', '小', '妈妈', '吗'];
const STRUGGLING = ['这', '那', '在'];

function loadDeck() {
  const progress = parseProgress(fs.readFileSync(new URL('../progress.json', import.meta.url), 'utf8'));
  const words = JSON.parse(fs.readFileSync(new URL('../words.json', import.meta.url), 'utf8'));
  return { progress, words };
}

test('write cards are only for read cards he is already reviewing', () => {
  assert.equal(readSideReadyForWrite(null), false);
  assert.equal(readSideReadyForWrite({ direction: 'read', status: 'new', reviews: [] }), false);
  assert.equal(readSideReadyForWrite({
    direction: 'read',
    status: 'learning',
    reviews: [{ grade: 'again' }],
  }), false);
  assert.equal(readSideReadyForWrite({
    direction: 'read',
    status: 'review',
    reviews: [{ grade: 'again' }, { grade: 'again' }, { grade: 'again' }, { grade: 'again' }],
  }), false);
  assert.equal(readSideReadyForWrite({
    direction: 'read',
    status: 'review',
    reviews: [{ grade: 'easy' }, { grade: 'easy' }],
  }), true);
});

test('known words get staggered write cards and read progress stays put', () => {
  const { progress, words } = loadDeck();
  const now = Date.parse('2026-11-05T12:00:00Z');
  const before = JSON.parse(JSON.stringify(progress.cards));
  const created = planWriteCards(words, progress.cards, now);
  for (const [id, card] of Object.entries(before)) {
    assert.deepEqual(progress.cards[id], card, id);
  }

  const byHanzi = new Map(words.map((word) => [word.hanzi, word]));
  for (const hanzi of [...UNSEEN, ...STRUGGLING]) {
    const word = byHanzi.get(hanzi);
    assert.ok(word, hanzi);
    assert.equal(created[`${word.id}:write`], undefined, hanzi);
  }

  const createdWords = Object.values(created).map((card) => words.find((word) => word.id === card.wordId).hanzi);
  assert.equal(created['ren:write'], undefined);
  assert.equal(created['hao:write'], undefined);
  assert.equal(createdWords.includes('吃'), false);
  assert.equal(createdWords.includes('这'), false);

  const dues = Object.values(created).map((card) => card.due).sort((a, b) => a - b);
  assert.ok(dues.every((due, index) => due === now + (index + 1) * DAY));
  assert.ok(dues.every((due) => due > now));
  const settings = { ...DEFAULT_SETTINGS, directions: 'both' };
  const withWrites = { ...progress.cards, ...created };
  const dueIds = buildQueue(words, withWrites, settings, now).map((item) => item.card.id);
  assert.equal(dueIds.some((id) => id.endsWith(':write')), false);
  const unseen = unseenCards(words, withWrites, settings).map((item) => item.card.id);
  assert.ok(unseen.every((id) => id.endsWith(':read')));
  assert.equal(summarize(words, withWrites, settings, now).unseen, UNSEEN.length);

  const sample = [
    { id: 'jia', hanzi: '家', pinyin: 'jiā', meaning: 'home' },
    { id: 'chi', hanzi: '吃', pinyin: 'chī', meaning: 'to eat' },
  ];
  const sampleCards = {
    'jia:read': {
      id: 'jia:read',
      wordId: 'jia',
      direction: 'read',
      status: 'review',
      interval: 8,
      repetitions: 3,
      reviews: [{ grade: 'easy', at: '2026-11-01T00:00:00.000Z', direction: 'read' }],
    },
    'chi:read': {
      id: 'chi:read',
      wordId: 'chi',
      direction: 'read',
      status: 'review',
      interval: 3,
      repetitions: 2,
      reviews: [{ grade: 'good', at: '2026-11-01T00:00:00.000Z', direction: 'read' }],
    },
  };
  const sampleCreated = planWriteCards(sample, sampleCards, now);
  assert.deepEqual(Object.keys(sampleCreated), ['jia:write', 'chi:write']);
  assert.equal(sampleCreated['jia:write'].due, now + DAY);
  assert.equal(sampleCreated['chi:write'].due, now + 2 * DAY);
  assert.equal(sampleCreated['jia:write'].status, 'learning');
  assert.equal((sampleCreated['jia:write'].reviews || []).length, 0);
  assert.equal(sampleCreated['jia:write'].lastReview || 0, 0);

  const again = planWriteCards(words, withWrites, now + DAY);
  assert.deepEqual(again, {});
  assert.equal(
    withWrites[`${byHanzi.get('人').id}:write`].due,
    progress.cards[`${byHanzi.get('人').id}:write`].due,
  );
});
