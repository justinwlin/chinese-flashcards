import { DIRECTIONS, cardId } from './day.js';
import { freshCard } from './srs.js';

const KNOWN_WORD_KEYS = new Set(['id', 'hanzi', 'pinyin', 'meaning', 'example', 'tip', 'tags', 'added', 'updated', 'dirty']);

function copyUnknown(source, target, reserved) {
  for (const key of Object.keys(source).sort()) {
    if (reserved.has(key)) continue;
    const value = source[key];
    if (value == null || typeof value === 'function') continue;
    target[key] = value;
  }
}

export function publicWord(word) {
  const entry = {
    id: word.id,
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    meaning: word.meaning,
  };
  const example = word.example;
  if (example && typeof example === 'object') {
    const built = {
      hanzi: example.hanzi || '',
      pinyin: example.pinyin || '',
      english: example.english || '',
    };
    copyUnknown(example, built, new Set(['hanzi', 'pinyin', 'english']));
    if (built.hanzi || built.pinyin || built.english || Object.keys(built).length > 3) entry.example = built;
  }
  const tip = typeof word.tip === 'string' ? word.tip.trim() : '';
  if (tip) entry.tip = tip;
  if (Array.isArray(word.tags) && word.tags.length) entry.tags = [...word.tags];
  entry.added = word.added;
  if (word.updated) entry.updated = word.updated;
  copyUnknown(word, entry, KNOWN_WORD_KEYS);
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

function isPlain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Start from `base`, then overlay values `extra` actually has. A missing key is not a deletion. */
function overlayFields(base, extra) {
  const out = { ...base };
  if (isPlain(base.example)) out.example = { ...base.example };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || key === 'dirty') continue;
    if (key === 'example' && isPlain(value)) {
      const example = { ...(out.example || {}) };
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue != null) example[subKey] = subValue;
      }
      out.example = example;
      continue;
    }
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

/**
 * Newer `updated` (then `added`) wins keys that both copies have.
 * `primary` wins a tie. The other copy is the base, so a field that exists
 * only there (a tip the device has not seen, or any unknown field) is kept.
 * `secondary` is merged first; call mergeWords(local, remote) so remote is that base.
 */
export function mergeWords(primary, secondary) {
  const map = new Map();
  const consider = (word, preferred) => {
    const prev = map.get(word.id);
    if (!prev) {
      map.set(word.id, { ...word });
      return;
    }
    const incomingWins = stamp(word) > stamp(prev) || (stamp(word) === stamp(prev) && preferred);
    const merged = overlayFields(incomingWins ? prev : word, incomingWins ? word : prev);
    if (word.dirty || prev.dirty) merged.dirty = true;
    map.set(word.id, merged);
  };
  for (const word of secondary) consider(word, false);
  for (const word of primary) consider(word, true);
  return [...map.values()];
}

function isBlank(value) {
  return value == null || value === '';
}

/** Field paths on `remoteWords` that `outgoingWords` would erase. A missing word is a deletion, not a dropped field. */
export function droppedWordFields(remoteWords, outgoingWords) {
  const byId = new Map(outgoingWords.map((word) => [word.id, word]));
  const drops = [];
  for (const remote of remoteWords || []) {
    const next = byId.get(remote.id);
    if (!next) continue;
    for (const [key, value] of Object.entries(remote)) {
      if (key === 'dirty' || key === 'example' || isBlank(value)) continue;
      if (isBlank(next[key])) drops.push(`${remote.id}.${key}`);
    }
    if (!isPlain(remote.example)) continue;
    for (const [key, value] of Object.entries(remote.example)) {
      if (isBlank(value)) continue;
      if (!isPlain(next.example) || isBlank(next.example[key])) drops.push(`${remote.id}.example.${key}`);
    }
  }
  return drops;
}

export function assertWordsKeepFields(remoteWords, outgoingWords) {
  const drops = droppedWordFields(remoteWords, outgoingWords);
  if (drops.length) {
    throw new Error(`Refusing to update words.json because it would remove ${drops.join(', ')}.`);
  }
}

/** Keep a newer edit, but put back any field the incoming copy simply does not have. */
export function fillMissingWordFields(previousWords, nextWords) {
  const previousById = new Map((previousWords || []).map((word) => [word.id, word]));
  return nextWords.map((word) => {
    const previous = previousById.get(word.id);
    if (!previous) return { ...word };
    return overlayFields(previous, word);
  });
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
  const entry = {
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
  if (card.queued) entry.queued = true;
  return entry;
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
      const stored = cards[id];
      // A missing write card is not an unseen card. It is added only after the read side is known.
      if (!stored && direction === 'write') continue;
      const card = stored ? { ...stored } : freshCard(id, word.id, direction);
      items.push({ word, card });
    }
  }
  return items;
}

export function summarize(words, cards, settings, now) {
  const items = enumerateCards(words, cards, settings);
  let learningDue = 0;
  let reviewDue = 0;
  let unseen = 0;
  let queued = 0;
  let nextDue = null;
  for (const { card } of items) {
    if (card.status === 'new') {
      if (card.queued) queued += 1;
      else unseen += 1;
      continue;
    }
    if (card.due <= now) {
      if (card.status === 'review') reviewDue += 1;
      else learningDue += 1;
    } else if (nextDue === null || card.due < nextDue) nextDue = card.due;
  }
  return {
    learningDue,
    reviewDue,
    due: learningDue + reviewDue,
    unseen,
    queued,
    nextDue,
    remaining: learningDue + reviewDue + queued,
  };
}

function byDirectionThenDeck(a, b) {
  if (a.card.direction === b.card.direction) return 0;
  return a.card.direction === 'read' ? -1 : 1;
}

/** New faces he has not asked to study. Reads come before writes. */
export function unseenCards(words, cards, settings) {
  return enumerateCards(words, cards, settings)
    .filter(({ card }) => card.status === 'new' && !card.queued)
    .sort(byDirectionThenDeck);
}

export function queueUnseen(cards, items) {
  const next = { ...cards };
  for (const item of items) {
    next[item.card.id] = { ...item.card, queued: true };
  }
  return next;
}

export function buildQueue(words, cards, settings, now) {
  const items = enumerateCards(words, cards, settings);
  const learning = items
    .filter(({ card }) => (card.status === 'learning' || card.status === 'relearning') && card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
  const reviews = items
    .filter(({ card }) => card.status === 'review' && card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
  const chosen = items.filter(({ card }) => card.status === 'new' && card.queued);
  return [...learning, ...reviews, ...chosen];
}
