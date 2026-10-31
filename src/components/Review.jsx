import { useEffect, useState } from 'preact/hooks';
import { buildQueue, summarize } from '../lib/merge.js';
import { formatDelay, previewDelays } from '../lib/srs.js';
import { dayKey } from '../lib/day.js';
import { speakChinese } from '../lib/speech.js';
import { Pinyin } from './Pinyin.jsx';
import { IconSpeaker } from './icons.jsx';

const RATING_LABELS = [
  ['again', 'Again'],
  ['hard', 'Hard'],
  ['good', 'Good'],
  ['easy', 'Easy'],
];

export function Review({ words, cards, settings, now, undo, onGrade, onUndo }) {
  const today = dayKey(now);
  const summary = summarize(words, cards, settings, now, today);
  const queue = buildQueue(words, cards, settings, now, today);
  const current = queue[0] || null;
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [current?.card.id, current?.card.due, current?.card.status]);

  const reveal = () => {
    setRevealed(true);
    if (settings.speakOnReveal && current) speakChinese(current.word.hanzi);
  };

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!current) return;
      if ((event.key === ' ' || event.key === 'Enter') && !revealed) {
        event.preventDefault();
        reveal();
        return;
      }
      if (!revealed) return;
      const ratings = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
      if (ratings[event.key]) {
        event.preventDefault();
        onGrade(current, ratings[event.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const delays = current ? previewDelays(current.card, now) : null;
  const waiting = summary.nextDue ? formatDelay(Math.max(0, summary.nextDue - now)) : null;

  return (
    <section class="screen today">
      <div class="counts" aria-label="Today's queue">
        <span><b>{summary.learningDue}</b> learning</span>
        <span><b>{summary.reviewDue}</b> due</span>
        <span><b>{Math.min(summary.fresh, summary.budget)}</b> new</span>
      </div>

      {undo && (
        <button type="button" class="undo" onClick={onUndo}>
          Saved. Undo
        </button>
      )}

      {current ? (
        <>
          <article
            class="card"
            onClick={() => { if (!revealed) reveal(); }}
          >
            <div class="card-tools">
              <span class="pill">{current.card.direction === 'read' ? 'Read' : 'Write'}</span>
              {(current.card.direction === 'read' || revealed) && (
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Speak ${current.word.hanzi}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    speakChinese(current.word.hanzi);
                  }}
                >
                  <IconSpeaker />
                </button>
              )}
            </div>

            {current.card.direction === 'read' ? (
              <p class={`hanzi ${revealed ? 'hanzi-lg' : 'hanzi-xl'}`} lang="zh-CN">{current.word.hanzi}</p>
            ) : (
              !revealed && <p class="prompt">{current.word.meaning}</p>
            )}

            {revealed && (
              <div class="answer">
                {current.card.direction === 'write' && (
                  <p class="hanzi hanzi-lg" lang="zh-CN">{current.word.hanzi}</p>
                )}
                <p class="reading"><Pinyin text={current.word.pinyin} /></p>
                {current.card.direction === 'read' && <p class="meaning">{current.word.meaning}</p>}
                {current.word.example?.hanzi && (
                  <div class="example">
                    <p lang="zh-CN">{current.word.example.hanzi}</p>
                    {current.word.example.pinyin && <p><Pinyin text={current.word.example.pinyin} /></p>}
                    {current.word.example.english && <p class="example-en">{current.word.example.english}</p>}
                  </div>
                )}
                <p class="legend" aria-hidden="true">
                  <span class="tone tone-1">1st</span>
                  <span class="tone tone-2">2nd</span>
                  <span class="tone tone-3">3rd</span>
                  <span class="tone tone-4">4th</span>
                  <span class="tone tone-5">neutral</span>
                </p>
              </div>
            )}
          </article>

          {revealed ? (
            <div class="grades">
              {RATING_LABELS.map(([rating, label]) => (
                <button
                  key={rating}
                  type="button"
                  class={`grade grade-${rating}`}
                  onClick={() => onGrade(current, rating)}
                >
                  <span>{label}</span>
                  <small>{formatDelay(delays[rating])}</small>
                </button>
              ))}
            </div>
          ) : (
            <button type="button" class="primary" onClick={reveal}>Show answer</button>
          )}
          <p class="left">{summary.remaining} left today</p>
        </>
      ) : (
        <article class="card empty-card">
          <p class="hanzi hanzi-lg" lang="zh-CN">日落</p>
          <h2>You're clear for today.</h2>
          {summary.fresh > 0 && summary.budget === 0 && (
            <p>Today's {settings.newPerDay} new cards are done. {summary.fresh} are waiting for tomorrow.</p>
          )}
          {waiting && <p>Next review in {waiting}.</p>}
          {summary.fresh === 0 && summary.learningDue === 0 && summary.reviewDue === 0 && !waiting && (
            <p>Every card in this set is scheduled ahead. Add a word when you meet a new one.</p>
          )}
        </article>
      )}
    </section>
  );
}
