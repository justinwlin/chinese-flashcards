import { DIRECTIONS, cardId } from './day.js';
import { freshCard } from './srs.js';

export function publicWord(word) {
  const entry = {
    id: word.id,
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    meaning: word.meaning,
  };
  const example = word.example;
  if (example && (example.hanzi || example.pinyin || example.english)) {
    entry.example = {
      hanzi: example.hanzi || '',
      pinyin: example.pinyin || '',
      english: example.english || '',
    };
  }
  if (Array.isArray(word.tags) && word.tags.length) entry.tags = [...word.tags];
  entry.added = word.added;
  if (word.updated) entry.updated = word.updated;
  return entry;
}

export function serializeWords(words) {
  return `${JSON.stringify(words.map(publicWord), null, 2)}\n`;
}

export function parseWords(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(list)) throw new Error('words.json must be an array of entries.');
  return list.map((word) => ({ ...word }));
}

function stamp(word) {
  return word.updated || word.added || '';
}

/**
 * Newer `updated` (then `added`) wins. `primary` wins a tie so the device
 * that is syncing keeps its copy when clocks match.
 */
export function mergeWords(primary, secondary) {
  const map = new Map();
  const consider = (word, preferred) => {
    const prev = map.get(word.id);
    if (!prev) {
      map.set(word.id, { ...word });
      return;
    }
    const prevTime = stamp(prev);
    const nextTime = stamp(word);
    if (nextTime > prevTime || (nextTime === prevTime && preferred)) {
      map.set(word.id, { ...word, dirty: Boolean(word.dirty || prev.dirty) });
    }
  };
  for (const word of secondary) consider(word, false);
  for (const word of primary) consider(word, true);
  return [...map.values()];
}

export function mergeTombstones(local, remote) {
  const out = { ...remote };
  for (const [id, when] of Object.entries(local || {})) {
    if (!out[id] || when > out[id]) out[id] = when;
  }
  return out;
}

/** A tombstone hides a word unless the word was edited after the deletion. */
export function applyTombstones(words, tombstones) {
  return words.filter((word) => {
    const deletedAt = tombstones?.[word.id];
    if (!deletedAt) return true;
    return stamp(word) > deletedAt;
  });
}

function orderWords(lists, words) {
  const byId = new Map(words.map((word) => [word.id, word]));
  const ordered = [];
  const seen = new Set();
  for (const list of lists) {
    for (const word of list) {
      if (byId.has(word.id) && !seen.has(word.id)) {
        ordered.push(byId.get(word.id));
        seen.add(word.id);
      }
    }
  }
  for (const word of words) {
    if (!seen.has(word.id)) ordered.push(word);
  }
  return ordered;
}

/** Study order: the file order, then words that only exist on this device. */
export function alignWords(localWords, remoteWords, tombstones = {}) {
  const merged = applyTombstones(mergeWords(localWords, remoteWords), tombstones);
  return orderWords([remoteWords, localWords], merged);
}

export function deletionStamp(word) {
  return afterStamp(stamp(word));
}

function afterStamp(stampValue) {
  const now = new Date().toISOString();
  if (!stampValue || now > stampValue) return now;
  const parsed = new Date(stampValue);
  if (Number.isNaN(parsed.getTime())) return `${stampValue}~`;
  return new Date(parsed.getTime() + 1).toISOString();
}

/**
 * Merge a full remote snapshot (the GitHub file, not the cached site copy).
 * A word that is not dirty and is missing remotely was deleted, so it gets a tombstone.
 */
export function reconcileRemote({ localWords, remoteWords, localTombs, remoteTombs }) {
  let tombstones = mergeTombstones(localTombs, remoteTombs);
  const remoteIds = new Set(remoteWords.map((word) => word.id));
  for (const word of localWords) {
    if (!word.dirty && !remoteIds.has(word.id)) {
      tombstones = { ...tombstones, [word.id]: afterStamp(stamp(word)) };
    }
  }
  const words = alignWords(localWords, remoteWords, tombstones);
  return { words, tombstones };
}

export function unionReviews(left = [], right = []) {
  const byKey = new Map();
  for (const entry of [...left, ...right]) {
    if (!entry?.at || !entry.grade) continue;
    const direction = entry.direction || '';
    byKey.set(`${entry.at}|${entry.grade}|${direction}`, {
      at: entry.at,
      grade: entry.grade,
      direction,
    });
  }
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function presentCard(card, hanzi = '') {
  return {
    id: card.id,
    wordId: card.wordId,
    hanzi: hanzi || card.hanzi || '',
    direction: card.direction,
    status: card.status,
    step: card.step || 0,
    ease: card.ease,
    interval: card.interval || 0,
    repetitions: card.repetitions || 0,
    lapses: card.lapses || 0,
    due: card.due || 0,
    lastReview: card.lastReview || 0,
    introducedOn: card.introducedOn || null,
    reviews: unionReviews(card.reviews, []),
  };
}

export function mergeCards(local, remote) {
  const out = {};
  const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const id of ids) {
    const left = local?.[id];
    const right = remote?.[id];
    if (!left) out[id] = { ...right, reviews: unionReviews(right.reviews, []) };
    else if (!right) out[id] = { ...left, reviews: unionReviews(left.reviews, []) };
    else {
      const winner = (left.lastReview || 0) >= (right.lastReview || 0) ? left : right;
      out[id] = { ...winner, reviews: unionReviews(left.reviews, right.reviews) };
    }
  }
  return out;
}

export function serializeProgress({ cards, words, deletedWords, updated }) {
  const hanziById = new Map((words || []).map((word) => [word.id, word.hanzi]));
  const cardIds = Object.keys(cards || {}).sort();
  const orderedCards = {};
  for (const id of cardIds) {
    const card = cards[id];
    orderedCards[id] = presentCard(card, hanziById.get(card.wordId));
  }
  const tombIds = Object.keys(deletedWords || {}).sort();
  const orderedTombs = {};
  for (const id of tombIds) orderedTombs[id] = deletedWords[id];
  return `${JSON.stringify({
    version: 2,
    updated: updated || new Date().toISOString(),
    cards: orderedCards,
    deletedWords: orderedTombs,
  }, null, 2)}\n`;
}

export function parseProgress(raw) {
  if (!raw) return { version: 1, updated: null, cards: {}, deletedWords: {} };
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    version: 1,
    updated: data.updated || null,
    cards: data.cards || {},
    deletedWords: data.deletedWords || {},
  };
}

export function activeDirections(settings) {
  if (settings.directions === 'read') return ['read'];
  if (settings.directions === 'write') return ['write'];
  return DIRECTIONS;
}

export function enumerateCards(words, cards, settings) {
  const directions = activeDirections(settings);
  const items = [];
  for (const word of words) {
    for (const direction of directions) {
      const id = cardId(word.id, direction);
      const card = cards[id] ? { ...cards[id] } : freshCard(id, word.id, direction);
      items.push({ word, card });
    }
  }
  return items;
}

export function summarize(words, cards, settings, now, today = null) {
  const day = today;
  const items = enumerateCards(words, cards, settings);
  let learningDue = 0;
  let reviewDue = 0;
  let fresh = 0;
  let introduced = 0;
  let nextDue = null;
  for (const { card } of items) {
    if (day && card.introducedOn === day) introduced += 1;
    if (card.status === 'new') {
      fresh += 1;
      continue;
    }
    if (card.due <= now) {
      if (card.status === 'review') reviewDue += 1;
      else learningDue += 1;
    } else if (nextDue === null || card.due < nextDue) nextDue = card.due;
  }
  const limit = Math.max(0, Number(settings.newPerDay) || 0);
  const budget = Math.max(0, limit - introduced);
  return {
    learningDue,
    reviewDue,
    fresh,
    introduced,
    budget,
    nextDue,
    remaining: learningDue + reviewDue + Math.min(fresh, budget),
  };
}

export function buildQueue(words, cards, settings, now, today) {
  const { budget } = summarize(words, cards, settings, now, today);
  const items = enumerateCards(words, cards, settings);
  const learning = items
    .filter(({ card }) => (card.status === 'learning' || card.status === 'relearning') && card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
  const reviews = items
    .filter(({ card }) => card.status === 'review' && card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
  const news = items.filter(({ card }) => card.status === 'new');
  news.sort((a, b) => {
    if (a.card.direction === b.card.direction) return 0;
    return a.card.direction === 'read' ? -1 : 1;
  });
  return [...learning, ...reviews, ...news.slice(0, budget)];
}
