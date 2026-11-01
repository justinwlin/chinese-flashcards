import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBase64, decodeBase64 } from '../src/lib/github.js';
import { freshCard, withReview } from '../src/lib/srs.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { formatSyncLine, planSyncAfterGrade, shouldSyncSetNow, syncDeck } from '../src/lib/sync.js';
import { buildQueue, mergeCards, queueUnseen, serializeWords, unseenCards } from '../src/lib/merge.js';

const settings = { ...DEFAULT_SETTINGS };
const words = [{
  id: 'ren',
  hanzi: '人',
  pinyin: 'rén',
  meaning: 'person',
  added: '2026-10-31',
  updated: '2026-10-31T00:00:00.000Z',
}];
const wordsText = serializeWords(words);
const COMMIT = 'a'.repeat(40);

function response(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(handler) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = previous;
    },
  };
}

test('a review creates progress.json and success requires the commit sha', async () => {
  const card = withReview(freshCard('ren:read', 'ren', 'read'), 'good', Date.parse('2026-10-31T15:00:00Z'), '人');
  card.introducedOn = '2026-10-31';
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT') {
      const saved = JSON.parse(decodeBase64(call.body.content));
      assert.equal(saved.cards['ren:read'].hanzi, '人');
      assert.equal(saved.cards['ren:read'].direction, 'read');
      assert.equal(saved.cards['ren:read'].reviews[0].grade, 'good');
      assert.equal(saved.cards['ren:read'].reviews[0].direction, 'read');
      assert.equal(call.body.branch, 'main');
      assert.equal(call.body.sha, undefined);
      return response(201, { content: { sha: 'blob' }, commit: { sha: COMMIT } });
    }
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    if (String(call.url).includes('/contents/words.json')) {
      return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
    }
    throw new Error(`unexpected ${call.url}`);
  });
  try {
    const result = await syncDeck({
      token: 'github_pat_test',
      settings,
      words,
      cards: { 'ren:read': card },
      tombstones: {},
    });
    assert.equal(result.committed, true);
    assert.equal(result.commitSha, COMMIT);
    assert.match(result.message, /progress\.json/);
    const puts = fetchMock.calls.filter((call) => call.options.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.match(puts[0].url, /\/contents\/progress\.json$/);
  } finally {
    fetchMock.restore();
  }
});

test('an empty deck does not claim a sync and does not write', async () => {
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT') throw new Error('should not write');
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
  });
  try {
    const result = await syncDeck({
      token: 'github_pat_test',
      settings,
      words,
      cards: {},
      tombstones: {},
    });
    assert.equal(result.committed, false);
    assert.equal(result.commitSha, null);
    assert.equal(result.message, 'No reviews to send yet.');
  } finally {
    fetchMock.restore();
  }
});

test('GitHub errors keep the HTTP status and are not reported as success', async () => {
  const card = withReview(freshCard('ren:read', 'ren', 'read'), 'again', Date.parse('2026-10-31T16:00:00Z'), '人');
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT') {
      return response(403, { message: 'Resource not accessible by personal access token' });
    }
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
  });
  try {
    await assert.rejects(
      () => syncDeck({ token: 'github_pat_test', settings, words, cards: { 'ren:read': card }, tombstones: {} }),
      /GitHub 403: Resource not accessible by personal access token/,
    );
  } finally {
    fetchMock.restore();
  }
});

test('a 422 that is not a sha conflict is shown and is not treated as success', async () => {
  const card = withReview(freshCard('ren:read', 'ren', 'read'), 'hard', Date.parse('2026-10-31T17:00:00Z'), '人');
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT') return response(422, { message: 'Invalid request. No committer name.' });
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
  });
  try {
    await assert.rejects(
      () => syncDeck({ token: 'github_pat_test', settings, words, cards: { 'ren:read': card }, tombstones: {} }),
      /GitHub 422: Invalid request\. No committer name\./,
    );
  } finally {
    fetchMock.restore();
  }
});

test('a 200 without a commit sha is not success', async () => {
  const card = withReview(freshCard('ren:read', 'ren', 'read'), 'easy', Date.parse('2026-10-31T18:00:00Z'), '人');
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT') return response(200, { content: { sha: 'blob-only' } });
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
  });
  try {
    await assert.rejects(
      () => syncDeck({ token: 'github_pat_test', settings, words, cards: { 'ren:read': card }, tombstones: {} }),
      /GitHub 200: response had no commit sha/,
    );
  } finally {
    fetchMock.restore();
  }
});

test('an edited word is committed to words.json', async () => {
  const edited = [{ ...words[0], meaning: 'human', updated: '2026-11-01T00:00:00.000Z', dirty: true }];
  const fetchMock = installFetch((call) => {
    if (call.options.method === 'PUT' && call.url.endsWith('/contents/words.json')) {
      const saved = JSON.parse(decodeBase64(call.body.content));
      assert.equal(saved[0].meaning, 'human');
      assert.equal(saved[0].dirty, undefined);
      return response(200, { content: { sha: 'blob' }, commit: { sha: COMMIT } });
    }
    if (String(call.url).includes('/contents/progress.json')) return response(404, { message: 'Not Found' });
    return response(200, { sha: 'wordsha', content: encodeBase64(wordsText) });
  });
  try {
    const result = await syncDeck({
      token: 'github_pat_test',
      settings,
      words: edited,
      cards: {},
      tombstones: {},
    });
    assert.equal(result.commitSha, COMMIT);
    assert.match(result.message, /words\.json/);
  } finally {
    fetchMock.restore();
  }
});

test('words.json 404 is an error, not an empty deck', async () => {
  const fetchMock = installFetch(() => response(404, { message: 'Not Found' }));
  try {
    await assert.rejects(
      () => syncDeck({ token: 'github_pat_test', settings, words, cards: {}, tombstones: {} }),
      /GitHub 404: words\.json was not readable/,
    );
  } finally {
    fetchMock.restore();
  }
});

test('review logs from both devices are kept with the newer schedule', () => {
  const merged = mergeCards(
    {
      'ren:read': {
        id: 'ren:read',
        lastReview: 20,
        ease: 2.2,
        reviews: [{ at: '2026-10-31T00:00:02.000Z', grade: 'good', direction: 'read' }],
      },
    },
    {
      'ren:read': {
        id: 'ren:read',
        lastReview: 10,
        ease: 2.8,
        reviews: [{ at: '2026-10-31T00:00:01.000Z', grade: 'again', direction: 'read' }],
      },
    },
  );
  assert.equal(merged['ren:read'].ease, 2.2);
  assert.deepEqual(merged['ren:read'].reviews.map((entry) => entry.grade), ['again', 'good']);
});

test('a finished set syncs immediately and a card in the middle does not', () => {
  assert.equal(shouldSyncSetNow({ queueEmpty: true, learningPending: false, batchPending: false }), true);
  assert.equal(shouldSyncSetNow({ queueEmpty: false, learningPending: false, batchPending: false }), false);
  assert.equal(shouldSyncSetNow({ queueEmpty: true, learningPending: true, batchPending: false }), false);
  assert.equal(shouldSyncSetNow({ queueEmpty: false, learningPending: false, batchPending: true }), false);
});

const readSettings = { ...DEFAULT_SETTINGS, directions: 'read' };

function gradeQueue(words, cards, now, rating) {
  let nextCards = cards;
  let at = now;
  for (const item of buildQueue(words, nextCards, readSettings, at)) {
    const next = withReview(item.card, rating, at, item.word.hanzi);
    nextCards = { ...nextCards, [next.id]: next };
    at += 4000;
  }
  return { cards: nextCards, at: at - 4000 };
}

test('a 1-minute learning step is not the end of the set', () => {
  const words = [
    { id: 'xiexie', hanzi: '谢谢', pinyin: 'xièxie', meaning: 'thanks', added: '2026-10-31' },
    { id: 'feiji', hanzi: '飞机', pinyin: 'fēijī', meaning: 'airplane', added: '2026-10-31' },
  ];
  const start = Date.parse('2026-10-31T22:02:20.321Z');
  const firstPass = gradeQueue(words, queueUnseen({}, unseenCards(words, {}, readSettings)), start, 'again');
  const waiting = planSyncAfterGrade({
    words,
    cards: firstPass.cards,
    settings: readSettings,
    now: firstPass.at,
  });
  assert.equal(buildQueue(words, firstPass.cards, readSettings, firstPass.at).length, 0);
  assert.equal(waiting.when, 'later');
  assert.equal(waiting.delayMs, 60_000 - 4_000 + 15_000);

  const back = start + 64_000;
  const due = buildQueue(words, firstPass.cards, readSettings, back);
  assert.equal(due.length, 2);
  const hard = withReview(due[0].card, 'hard', back, due[0].word.hanzi);
  const midCards = { ...firstPass.cards, [hard.id]: hard };
  const mid = planSyncAfterGrade({ words, cards: midCards, settings: readSettings, now: back });
  assert.equal(mid.when, 'later');
  assert.equal(mid.delayMs, 15_000);

  const rest = buildQueue(words, midCards, readSettings, back);
  const graduated = withReview(rest[0].card, 'good', back, rest[0].word.hanzi);
  const stillLearning = { ...midCards, [graduated.id]: graduated };
  const gap = planSyncAfterGrade({ words, cards: stillLearning, settings: readSettings, now: back });
  assert.equal(buildQueue(words, stillLearning, readSettings, back).length, 0);
  assert.equal(Boolean(hard.queued), true);
  assert.equal(gap.when, 'later');
  assert.equal(gap.delayMs, hard.due - back + 15_000);

  const finishAt = hard.due;
  const last = buildQueue(words, stillLearning, readSettings, finishAt)[0];
  const doneCard = withReview(last.card, 'good', finishAt, last.word.hanzi);
  const done = planSyncAfterGrade({
    words,
    cards: { ...stillLearning, [doneCard.id]: doneCard },
    settings: readSettings,
    now: finishAt,
  });
  assert.equal(done.when, 'now');
});

test('a lapsed card due in 10 minutes does not finish the set', () => {
  const now = Date.parse('2026-10-31T22:02:05.315Z');
  const words = [{ id: 'nv', hanzi: '女', pinyin: 'nǚ', meaning: 'woman', added: '2026-10-31' }];
  const card = {
    ...freshCard('nv:read', 'nv', 'read'),
    status: 'review',
    step: 0,
    interval: 1,
    due: now - 1000,
    repetitions: 1,
  };
  const lapsed = withReview(card, 'again', now, '女');
  assert.equal(lapsed.status, 'relearning');
  const plan = planSyncAfterGrade({
    words,
    cards: { 'nv:read': lapsed },
    settings: readSettings,
    now,
  });
  assert.equal(plan.when, 'later');
  assert.equal(plan.delayMs, 10 * 60_000 + 15_000);
});

test('the last new card syncs only when it will not come back today', () => {
  const words = [
    { id: 'wo', hanzi: '我', pinyin: 'wǒ', meaning: 'I', added: '2026-10-31' },
    { id: 'ni', hanzi: '你', pinyin: 'nǐ', meaning: 'you', added: '2026-10-31' },
  ];
  const now = Date.parse('2026-10-31T22:02:36.051Z');
  let cards = queueUnseen({}, unseenCards(words, {}, readSettings));
  const first = buildQueue(words, cards, readSettings, now)[0];
  cards = { ...cards, [first.card.id]: withReview(first.card, 'easy', now, first.word.hanzi) };
  const middle = planSyncAfterGrade({ words, cards, settings: readSettings, now });
  assert.equal(middle.when, 'later');

  const second = buildQueue(words, cards, readSettings, now)[0];
  cards = { ...cards, [second.card.id]: withReview(second.card, 'easy', now, second.word.hanzi) };
  const finished = planSyncAfterGrade({ words, cards, settings: readSettings, now });
  assert.equal(finished.when, 'now');
});

test('the status line names the commit and does not invent one', () => {
  assert.equal(formatSyncLine(null), 'Not synced to GitHub yet.');
  assert.match(formatSyncLine({ at: '2026-10-31T15:04:00.000Z', commit: COMMIT }), /Last synced at .+ commit aaaaaaa/);
});
