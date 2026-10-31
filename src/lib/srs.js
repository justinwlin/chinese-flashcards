/**
 * SM-2-style scheduler with Anki-like learning steps.
 *
 * Ratings: again, hard, good, easy.
 * New cards pass through 1-minute and 10-minute steps, then graduate
 * to day-scale intervals. Review intervals grow by the ease factor.
 * Lapses drop back to a 10-minute relearning step and keep 20% of the
 * previous interval instead of wiping the card.
 */

export const RATINGS = ['again', 'hard', 'good', 'easy'];

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const MAX_EASE = 3;
const LEARNING_STEPS_MIN = [1, 10];
const RELEARN_STEPS_MIN = [10];
const GRADUATE_DAYS = 1;
const EASY_DAYS = 4;
const EASY_BONUS = 1.3;
const HARD_FACTOR = 1.2;
const LAPSE_FACTOR = 0.2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export function freshCard(id, wordId, direction) {
  return {
    id,
    wordId,
    direction,
    status: 'new',
    step: 0,
    ease: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    lapses: 0,
    due: 0,
    lastReview: 0,
    introducedOn: null,
  };
}

function roundEase(value) {
  return Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, value)) * 100) / 100;
}

/** Slight deterministic jitter so cards with the same interval don't clump. */
export function fuzzDays(cardId, days) {
  if (days < 3) return days;
  let hash = 2166136261;
  const text = `${cardId}:${days}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (hash >>> 0) % 1001;
  const factor = 0.95 + (unit / 1000) * 0.1;
  const fuzzed = Math.round(days * factor);
  const low = Math.round(days * 0.95);
  const high = Math.round(days * 1.05);
  return Math.min(high, Math.max(low, fuzzed));
}

function graduate(card, now, days) {
  const next = card;
  next.status = 'review';
  next.step = 0;
  next.interval = fuzzDays(next.id, days);
  next.repetitions = (next.repetitions || 0) + 1;
  next.due = now + next.interval * DAY_MS;
  return next;
}

function scheduleLearning(card, rating, now, steps, relearn) {
  const entering = card.status === 'new';
  const current = entering ? -1 : card.step;

  if (rating === 'easy') {
    card.ease = roundEase(card.ease + 0.15);
    const days = relearn ? Math.max(EASY_DAYS, card.interval || EASY_DAYS) : EASY_DAYS;
    return graduate(card, now, days);
  }

  if (rating === 'again') {
    card.status = relearn ? 'relearning' : 'learning';
    card.step = 0;
    card.due = now + steps[0] * MIN_MS;
    return card;
  }

  if (rating === 'hard') {
    card.status = relearn ? 'relearning' : 'learning';
    const index = Math.max(0, current);
    const here = steps[Math.min(index, steps.length - 1)];
    let minutes;
    if (current < 0) {
      minutes = steps.length > 1 ? Math.round((steps[0] + steps[1]) / 2) : Math.round(steps[0] * 1.5);
      card.step = 0;
    } else if (index < steps.length - 1) {
      const upcoming = steps[index + 1];
      minutes = Math.round((here + upcoming) / 2);
      card.step = index;
    } else {
      minutes = Math.round(here * 1.5);
      card.step = index;
    }
    card.due = now + minutes * MIN_MS;
    return card;
  }

  const target = entering ? Math.min(1, steps.length - 1) : current + 1;
  if (target < steps.length) {
    card.status = relearn ? 'relearning' : 'learning';
    card.step = target;
    card.due = now + steps[target] * MIN_MS;
    return card;
  }
  const days = relearn ? Math.max(GRADUATE_DAYS, card.interval || GRADUATE_DAYS) : GRADUATE_DAYS;
  return graduate(card, now, days);
}

function scheduleReview(card, rating, now) {
  const ease = card.ease || DEFAULT_EASE;
  const interval = card.interval || GRADUATE_DAYS;

  if (rating === 'again') {
    card.lapses = (card.lapses || 0) + 1;
    card.status = 'relearning';
    card.step = 0;
    card.ease = roundEase(ease - 0.2);
    card.interval = Math.max(1, Math.round(interval * LAPSE_FACTOR));
    card.due = now + RELEARN_STEPS_MIN[0] * MIN_MS;
    return card;
  }

  let nextEase = ease;
  let days;
  if (rating === 'hard') {
    nextEase = ease - 0.15;
    days = Math.max(interval + 1, Math.round(interval * HARD_FACTOR));
  } else if (rating === 'good') {
    days = Math.max(interval + 1, Math.round(interval * ease));
  } else {
    nextEase = ease + 0.15;
    days = Math.max(interval + 1, Math.round(interval * ease * EASY_BONUS));
  }
  card.ease = roundEase(nextEase);
  return graduate(card, now, days);
}

/** Return the next card state. Does not mutate `card`. */
export function schedule(card, rating, now) {
  const next = {
    ...card,
    ease: card.ease || DEFAULT_EASE,
    lastReview: now,
  };
  if (next.status === 'new' || next.status === 'learning') {
    return scheduleLearning(next, rating, now, LEARNING_STEPS_MIN, false);
  }
  if (next.status === 'relearning') {
    return scheduleLearning(next, rating, now, RELEARN_STEPS_MIN, true);
  }
  return scheduleReview(next, rating, now);
}

export function previewDelays(card, now) {
  const delays = {};
  for (const rating of RATINGS) {
    delays[rating] = schedule(card, rating, now).due - now;
  }
  return delays;
}

/** Schedule the card and append one review-log entry. Does not mutate `card`. */
export function withReview(card, rating, reviewedAt, hanzi = '') {
  const next = schedule(card, rating, reviewedAt);
  next.hanzi = hanzi || card.hanzi || '';
  next.reviews = [
    ...(Array.isArray(card.reviews) ? card.reviews : []),
    {
      at: new Date(reviewedAt).toISOString(),
      grade: rating,
      direction: card.direction,
    },
  ];
  return next;
}

export function formatDelay(ms) {
  const minutes = Math.round(ms / MIN_MS);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY_MS);
  if (days < 30) return `${Math.max(1, days)}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.max(1, Math.round(days / 365))}y`;
}
