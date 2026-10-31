import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDelay, freshCard, previewDelays, schedule } from '../src/lib/srs.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test('new cards use learning steps before they graduate', () => {
  const card = freshCard('ren:read', 'ren', 'read');
  const again = schedule(card, 'again', 0);
  assert.equal(again.status, 'learning');
  assert.equal(again.step, 0);
  assert.equal(again.due, MIN);

  const hard = schedule(card, 'hard', 0);
  assert.equal(hard.due, 6 * MIN);
  assert.equal(hard.status, 'learning');

  const good = schedule(card, 'good', 0);
  assert.equal(good.status, 'review');
  assert.equal(good.interval, 1);
  assert.equal(good.due, DAY);

  const easy = schedule(card, 'easy', 0);
  assert.equal(easy.status, 'review');
  assert.equal(easy.interval, 4);
  assert.equal(easy.due, 4 * DAY);
  assert.equal(easy.ease, 2.65);
});

test('good and easy do not come back the same day', () => {
  const start = Date.parse('2026-10-31T15:00:00Z');
  const good = schedule(freshCard('kou:read', 'kou', 'read'), 'good', start);
  const easy = schedule(freshCard('ren:read', 'ren', 'read'), 'easy', start);
  assert.ok(good.due >= start + DAY);
  assert.ok(easy.due >= start + 4 * DAY);
  const hard = schedule(freshCard('ri:read', 'ri', 'read'), 'hard', start);
  const again = schedule(freshCard('yue:read', 'yue', 'read'), 'again', start);
  assert.equal(hard.status, 'learning');
  assert.equal(hard.due, start + 6 * MIN);
  assert.equal(again.due, start + MIN);
});

test('review intervals follow ease, and lapses keep 20 percent', () => {
  const card = {
    ...freshCard('shui:read', 'shui', 'read'),
    status: 'review',
    interval: 1,
    ease: 2.5,
    repetitions: 1,
  };
  const good = schedule(card, 'good', 0);
  assert.equal(good.interval, 3);
  assert.equal(good.ease, 2.5);
  assert.equal(good.due, 3 * DAY);

  const hard = schedule(card, 'hard', 0);
  assert.equal(hard.interval, 2);
  assert.equal(hard.ease, 2.35);

  const lapsed = schedule({ ...card, interval: 10, repetitions: 4 }, 'again', 0);
  assert.equal(lapsed.status, 'relearning');
  assert.equal(lapsed.interval, 2);
  assert.equal(lapsed.ease, 2.3);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, 10 * MIN);

  const relearned = schedule(lapsed, 'good', lapsed.due);
  assert.equal(relearned.status, 'review');
  assert.equal(relearned.interval, 2);
});

test('ease never drops below 1.3 and scheduling does not mutate the card', () => {
  const card = {
    ...freshCard('a:read', 'a', 'read'),
    status: 'review',
    interval: 4,
    ease: 1.3,
    repetitions: 2,
  };
  const snapshot = JSON.stringify(card);
  let current = card;
  for (let i = 0; i < 6; i += 1) {
    current = schedule(current, 'again', i * DAY);
    assert.ok(current.ease >= 1.3);
    if (current.status === 'relearning') current = schedule(current, 'good', current.due);
  }
  assert.equal(JSON.stringify(card), snapshot);
});

test('button previews match the delay that will be saved', () => {
  const card = freshCard('yue:write', 'yue', 'write');
  const now = 1_700_000_000_000;
  const delays = previewDelays(card, now);
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    assert.equal(schedule(card, rating, now).due - now, delays[rating]);
  }
  assert.equal(formatDelay(delays.again), '1m');
  assert.equal(formatDelay(delays.hard), '6m');
  assert.equal(formatDelay(delays.good), '1d');
  assert.equal(formatDelay(delays.easy), '4d');
});
