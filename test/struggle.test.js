import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQueue } from '../src/lib/merge.js';
import { freshCard, isStruggling, nextPracticeQueue, schedule, sessionQueue, strugglingWords, withReview } from '../src/lib/srs.js';

function reviews(grades) {
  return {
    reviews: grades.map((grade, index) => ({
      at: new Date(index * 60_000).toISOString(),
      grade,
      direction: 'read',
    })),
  };
}

test('four Agains in a row mark a card struggling', () => {
  assert.equal(isStruggling(reviews(['again', 'again', 'again'])), false);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again'])), true);
  assert.equal(isStruggling(reviews(['again', 'again', 'hard', 'again', 'again', 'again'])), false);
  assert.equal(isStruggling(null), false);
});

test('two Goods or Easies in a row clear the flag and Hard does not', () => {
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'good'])), true);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'good', 'good'])), false);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'easy', 'easy'])), false);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'hard'])), true);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'good', 'again'])), true);
  assert.equal(isStruggling(reviews(['again', 'again', 'again', 'again', 'good', 'easy'])), false);
});

test('a struggling Again comes back once, after the other cards, without rescheduling them', () => {
  const struggling = { ...freshCard('ri:read', 'ri', 'read'), ...reviews(['again', 'again', 'again', 'again']) };
  const other = freshCard('kou:read', 'kou', 'read');
  const scheduled = schedule(other, 'good', 5_000);
  const due = scheduled.due;
  const queue = [{ word: { id: 'kou', hanzi: '口' }, card: { ...scheduled, id: 'kou:read' } }];
  const cards = {
    'kou:read': scheduled,
    'ri:read': struggling,
  };
  const words = [{ id: 'kou', hanzi: '口' }, { id: 'ri', hanzi: '日' }];
  const practice = nextPracticeQueue([], 'ri:read', 'again', struggling);
  assert.deepEqual(practice, ['ri:read']);
  const session = sessionQueue(queue, words, cards, practice);
  assert.deepEqual(session.map((item) => item.card.id), ['kou:read', 'ri:read']);
  assert.equal(scheduled.due, due);
  assert.equal(other.due, 0);
  assert.deepEqual(nextPracticeQueue(practice, 'ri:read', 'good', struggling), []);
  assert.deepEqual(buildQueue(words, cards, { directions: 'both', newPerDay: 10 }, 0).map((item) => item.card.id), []);
});

test('a word is struggling when either face has the streak', () => {
  const words = [{ id: 'ri', hanzi: '日' }, { id: 'kou', hanzi: '口' }];
  const cards = {
    'ri:write': { ...reviews(['again', 'again', 'again', 'again']) },
    'kou:read': { ...reviews(['again', 'again', 'good', 'good']) },
  };
  assert.deepEqual(strugglingWords(words, cards).map((word) => word.hanzi), ['日']);
});

test('the extra pass uses the same SM-2 step as a normal Again', () => {
  let card = freshCard('ri:read', 'ri', 'read');
  for (let i = 0; i < 3; i += 1) card = withReview(card, 'again', i * 60_000, '日');
  const before = card.due;
  const fourth = withReview(card, 'again', 3 * 60_000, '日');
  assert.equal(isStruggling(fourth), true);
  assert.equal(fourth.due, schedule(card, 'again', 3 * 60_000).due);
  assert.notEqual(fourth.due, before);
  const sibling = freshCard('kou:read', 'kou', 'read');
  const siblingDue = schedule(sibling, 'good', 3 * 60_000).due;
  nextPracticeQueue(['ri:read'], 'ri:read', 'again', fourth);
  assert.equal(schedule(sibling, 'good', 3 * 60_000).due, siblingDue);
});
