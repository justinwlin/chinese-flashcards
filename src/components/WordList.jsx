import { useMemo, useState } from 'preact/hooks';
import { searchable } from '../lib/pinyin.js';
import { Pinyin } from './Pinyin.jsx';

export function WordList({ words }) {
  const [query, setQuery] = useState('');
  const needle = searchable(query.trim());
  const shown = useMemo(() => {
    if (!needle) return words;
    return words.filter((word) => {
      const blob = searchable([
        word.hanzi,
        word.pinyin,
        word.meaning,
        ...(word.tags || []),
        word.example?.hanzi,
        word.example?.pinyin,
        word.example?.english,
      ].filter(Boolean).join(' '));
      return blob.includes(needle) || word.hanzi.includes(query.trim());
    });
  }, [words, needle, query]);

  return (
    <section class="screen">
      <label class="search">
        <span class="sr-only">Search words</span>
        <input
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search hanzi, pinyin, English, tags"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>
      <p class="left">{shown.length} {shown.length === 1 ? 'word' : 'words'}</p>
      {shown.length === 0 ? (
        <article class="card empty-card">
          <h2>No matches.</h2>
          <p>Try a tone-less pinyin spelling, like hao, or a tag like day1.</p>
        </article>
      ) : (
        <ul class="word-list">
          {shown.map((word) => (
            <li key={word.id}>
              <a class="word-row" href={`#/words/${encodeURIComponent(word.id)}`}>
                <span class="hanzi hanzi-sm" lang="zh-CN">{word.hanzi}</span>
                <span class="word-copy">
                  <Pinyin text={word.pinyin} />
                  <span class="meaning">{word.meaning}</span>
                  {word.tags?.length > 0 && (
                    <span class="tags">{word.tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
