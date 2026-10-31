import { useState } from 'preact/hooks';
import { dayKey } from '../lib/day.js';
import { slugifyPinyin } from '../lib/pinyin.js';

function uniqueId(pinyin, hanzi, words) {
  const base = slugifyPinyin(pinyin) || `w${[...hanzi].map((char) => char.codePointAt(0).toString(16)).join('')}`;
  const taken = new Set(words.map((word) => word.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function parseTags(value) {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

export function WordForm({ words, existing, syncing, onSave, onDelete }) {
  const [hanzi, setHanzi] = useState(existing?.hanzi || '');
  const [pinyin, setPinyin] = useState(existing?.pinyin || '');
  const [meaning, setMeaning] = useState(existing?.meaning || '');
  const [exampleHanzi, setExampleHanzi] = useState(existing?.example?.hanzi || '');
  const [examplePinyin, setExamplePinyin] = useState(existing?.example?.pinyin || '');
  const [exampleEnglish, setExampleEnglish] = useState(existing?.example?.english || '');
  const [tags, setTags] = useState((existing?.tags || []).join(', '));
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const nextHanzi = hanzi.trim();
    const nextPinyin = pinyin.trim();
    const nextMeaning = meaning.trim();
    if (!nextHanzi || !nextPinyin || !nextMeaning) {
      setError('Hanzi, pinyin, and English are required.');
      return;
    }
    const example = {
      hanzi: exampleHanzi.trim(),
      pinyin: examplePinyin.trim(),
      english: exampleEnglish.trim(),
    };
    const hasExample = example.hanzi || example.pinyin || example.english;
    const now = new Date();
    const word = {
      id: existing?.id || uniqueId(nextPinyin, nextHanzi, words),
      hanzi: nextHanzi,
      pinyin: nextPinyin,
      meaning: nextMeaning,
      ...(hasExample ? { example } : {}),
      tags: parseTags(tags),
      added: existing?.added || dayKey(now.getTime()),
      updated: now.toISOString(),
      dirty: true,
    };
    setError('');
    onSave(word);
  };

  return (
    <form class="screen form" onSubmit={submit}>
      <label>
        Hanzi
        <input value={hanzi} onInput={(event) => setHanzi(event.currentTarget.value)} lang="zh-CN" autoComplete="off" required />
      </label>
      <label>
        Pinyin
        <input value={pinyin} onInput={(event) => setPinyin(event.currentTarget.value)} autoCapitalize="none" autoCorrect="off" placeholder="nǐ hǎo" required />
      </label>
      <label>
        English
        <input value={meaning} onInput={(event) => setMeaning(event.currentTarget.value)} autoComplete="off" required />
      </label>
      <label>
        Example
        <input value={exampleHanzi} onInput={(event) => setExampleHanzi(event.currentTarget.value)} lang="zh-CN" autoComplete="off" placeholder="你好吗？" />
      </label>
      <label>
        Example pinyin
        <input value={examplePinyin} onInput={(event) => setExamplePinyin(event.currentTarget.value)} autoCapitalize="none" autoCorrect="off" placeholder="Nǐ hǎo ma?" />
      </label>
      <label>
        Example English
        <input value={exampleEnglish} onInput={(event) => setExampleEnglish(event.currentTarget.value)} autoComplete="off" placeholder="How are you?" />
      </label>
      <label>
        Tags
        <input value={tags} onInput={(event) => setTags(event.currentTarget.value)} autoCapitalize="none" autoCorrect="off" placeholder="hsk1, day1" />
      </label>
      {error && <p class="form-error" role="alert">{error}</p>}
      <button type="submit" class="primary" disabled={syncing}>{existing ? 'Save changes' : 'Add word'}</button>
      {existing && (
        <button
          type="button"
          class="danger"
          disabled={syncing}
          onClick={() => {
            if (confirm(`Delete ${existing.hanzi}? It leaves this device and the next sync removes it from words.json.`)) onDelete(existing);
          }}
        >
          Delete word
        </button>
      )}
    </form>
  );
}
