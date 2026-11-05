import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { freshCard } from '../src/lib/srs.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { decodeBase64, encodeBase64 } from '../src/lib/github.js';
import {
  alignWords,
  applyTombstones,
  assertWordsKeepFields,
  buildQueue,
  droppedWordFields,
  fillMissingWordFields,
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

test('an optional tip is kept when words are saved', () => {
  const word = {
    id: 'yue',
    hanzi: '月',
    pinyin: 'yuè',
    meaning: 'moon; month',
    example: {
      hanzi: '一月有月亮。',
      pinyin: 'Yī yuè yǒu yuè liang.',
      english: 'January has a moon.',
    },
    tip: '  月 is a tall crescent moon.  ',
    tags: ['day1'],
    added: '2026-10-31',
    updated: '2026-10-31T12:10:00.000Z',
    dirty: true,
  };
  const saved = JSON.parse(serializeWords([word]))[0];
  assert.equal(saved.tip, '月 is a tall crescent moon.');
  assert.equal(saved.example.english, 'January has a moon.');
  assert.equal(saved.dirty, undefined);
  const blank = JSON.parse(serializeWords([{ ...word, tip: '   ' }]))[0];
  assert.equal(blank.tip, undefined);
});

test('a stale local word does not erase a remote tip or any other field', () => {
  const stamp = '2026-11-02T19:30:00.000Z';
  const remote = [{
    id: 'ri',
    hanzi: '日',
    pinyin: 'rì',
    meaning: 'sun; day',
    tip: 'window',
    note: 'keep me',
    added: '2026-10-31',
    updated: stamp,
  }];
  const sameClock = [{
    id: 'ri',
    hanzi: '日',
    pinyin: 'rì',
    meaning: 'sun; day',
    added: '2026-10-31',
    updated: stamp,
  }];
  const tied = mergeWords(sameClock, remote)[0];
  assert.equal(tied.tip, 'window');
  assert.equal(tied.note, 'keep me');
  const newerLocal = [{ ...sameClock[0], meaning: 'sun', updated: '2026-11-03T00:00:00.000Z', dirty: true }];
  const edited = mergeWords(newerLocal, remote)[0];
  assert.equal(edited.meaning, 'sun');
  assert.equal(edited.tip, 'window');
  assert.equal(edited.note, 'keep me');
});

test('saving a word keeps fields that are not in the fixed list', () => {
  const saved = JSON.parse(serializeWords([{
    id: 'ri',
    hanzi: '日',
    pinyin: 'rì',
    meaning: 'sun',
    example: { hanzi: '日出。', pinyin: 'Rì chū.', english: 'The sun rises.', audio: 'ri.mp3' },
    tip: 'window',
    note: 'extra',
    added: '2026-10-31',
    dirty: true,
  }]))[0];
  assert.equal(saved.note, 'extra');
  assert.equal(saved.example.audio, 'ri.mp3');
  assert.equal(saved.tip, 'window');
  assert.equal(saved.dirty, undefined);
});

test('a push that would remove a remote field is refused, and a repair puts it back', () => {
  const previous = [{ id: 'ri', hanzi: '日', pinyin: 'rì', meaning: 'sun', tip: 'window', note: 'keep', added: '2026-10-31' }];
  const stripped = [{ id: 'ri', hanzi: '日', pinyin: 'rì', meaning: 'day', added: '2026-10-31' }];
  assert.deepEqual(droppedWordFields(previous, stripped), ['ri.tip', 'ri.note']);
  assert.throws(() => assertWordsKeepFields(previous, stripped), /ri\.tip/);
  const repaired = fillMissingWordFields(previous, stripped)[0];
  assert.equal(repaired.meaning, 'day');
  assert.equal(repaired.tip, 'window');
  assert.equal(repaired.note, 'keep');
  assert.deepEqual(droppedWordFields(previous, [repaired]), []);
});

test('memory tips live on tip, not inside the example sentence', () => {
  const words = parseWords(fs.readFileSync(new URL('../words.json', import.meta.url), 'utf8'));
  const tips = {
    ri: "日 is a square window with the sun's line across it. Don't mix it up with 月 moon, which is taller with two lines and open legs.",
    yue: '月 is a tall crescent moon with two cloud lines inside; it also means month.',
    ming: '明 = 日 sun + 月 moon side by side. Sun and moon together = bright.',
    nv: "女 looks like a person kneeling with crossed arms. It's the left half of 她 she and 好 good.",
    riluo: '日 sun + 落 fall = the sun falls = sunset. 落 has 艹 grass on top and 氵 water on the left.',
    zai: "在 has 土 earth at the bottom right: you're standing on the ground AT a place. Don't mix it up with 有 yǒu, which has 月 inside.",
    zhe: "这 has 辶, the 'walking road' radical, wrapping around 文. Think: walk over HERE, this one. You already say it all the time: 这是什么? = what is this? 这 zhè = this, 那 nà = that.",
    na: '那 ends with 阝, an ear-shaped radical on the RIGHT. Point far away to THAT one. 这 zhè has 辶 road; 那 nà has 阝 ear.',
    shenme: '什 = 亻 person + 十 ten; 么 is a little twist. You say shénme all the time; spot the 亻 person on the left.',
    er: '二 two lines = two; 二月 second month.',
    da: '大 is 人 a person stretching their arms out wide = big.',
    mama: '女 woman on the left + 马 mǎ for the sound.',
    ma: '口 mouth + 马 mǎ sound = a spoken question word.',
  };
  for (const [id, tip] of Object.entries(tips)) {
    const word = words.find((entry) => entry.id === id);
    assert.equal(word.tip, tip, id);
    assert.equal(/\b(tip|memory|mnemonic)\b|💡/i.test(word.example.english), false, word.hanzi);
  }
  for (const word of words) {
    const english = word.example?.english || '';
    assert.equal(/\b(tip|memory|mnemonic)\b|💡/i.test(english), false, word.hanzi);
    if (!tips[word.id]) assert.equal(word.tip, undefined, word.hanzi);
  }
});
