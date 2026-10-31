import { useEffect, useState } from 'preact/hooks';
import { Review } from './components/Review.jsx';
import { Settings } from './components/Settings.jsx';
import { WordForm } from './components/WordForm.jsx';
import { WordList } from './components/WordList.jsx';
import { IconAdd, IconReview, IconSettings, IconWords } from './components/icons.jsx';
import { VersionLabel } from './components/VersionLabel.jsx';
import {
  deleteCard,
  loadSnapshot,
  orderFromSnapshot,
  putCard,
  replaceCards,
  replaceWords,
  setKv,
  storageWarning,
} from './lib/db.js';
import { cardId, dayKey } from './lib/day.js';
import { freshCard, withReview } from './lib/srs.js';
import {
  activeDirections,
  alignWords,
  deletionStamp,
  mergeCards,
  mergeTombstones,
  parseWords,
  publicWord,
  buildQueue,
  queueUnseen,
  unseenCards,
} from './lib/merge.js';
import { normalizeSettings } from './lib/settings.js';
import { warmVoices } from './lib/speech.js';
import { formatSyncLine, shouldSyncSetNow, syncDeck } from './lib/sync.js';
import { applyTheme } from './lib/theme.js';

const stateRef = {
  current: {
    words: [],
    cards: {},
    tombstones: {},
    settings: normalizeSettings(),
    token: '',
  },
};
const SYNC_IDLE_MS = 15000;
const syncingRef = { current: false };
const syncAgainRef = { current: false };
const pendingSyncRef = { current: false };
let syncTimer = 0;

function readRoute() {
  const hash = decodeURIComponent((location.hash || '#/').replace(/^#/, '') || '/');
  if (hash.startsWith('/words/')) return { name: 'edit', id: hash.slice('/words/'.length) };
  if (hash === '/words') return { name: 'words' };
  if (hash === '/new') return { name: 'new' };
  if (hash === '/settings') return { name: 'settings' };
  return { name: 'review' };
}

function remember(partial) {
  stateRef.current = { ...stateRef.current, ...partial };
}

export function App() {
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState([]);
  const [cards, setCards] = useState({});
  const [tombstones, setTombstones] = useState({});
  const [settings, setSettings] = useState(normalizeSettings());
  const [token, setToken] = useState('');
  const [route, setRoute] = useState(readRoute);
  const [now, setNow] = useState(Date.now());
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncIsError, setSyncIsError] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [warning, setWarning] = useState('');
  const [loadError, setLoadError] = useState('');
  const [undo, setUndo] = useState(null);
  const [installEvent, setInstallEvent] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);

  const publish = (partial) => {
    remember(partial);
    if (partial.words) setWords(partial.words);
    if (partial.cards) setCards(partial.cards);
    if (partial.tombstones) setTombstones(partial.tombstones);
    if (partial.settings) setSettings(partial.settings);
    if ('token' in partial) setToken(partial.token);
  };

  const applySyncResult = async (result) => {
    const latest = stateRef.current;
    const tombstones = mergeTombstones(latest.tombstones, result.tombstones);
    const words = alignWords(latest.words, result.words, tombstones);
    const cards = mergeCards(latest.cards, result.cards);
    await replaceWords(words);
    await replaceCards(cards);
    await setKv('tombstones', tombstones);
    publish({ words, cards, tombstones });
  };

  const runSync = async (tokenOverride, { manual = false, keepalive = false } = {}) => {
    if (syncingRef.current) {
      syncAgainRef.current = true;
      return;
    }
    const credential = String(tokenOverride ?? stateRef.current.token).trim();
    if (!credential) {
      if (manual) {
        setSyncIsError(true);
        setSyncMessage('Paste a GitHub token first.');
      }
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    setSyncIsError(false);
    setSyncMessage('Syncing…');
    try {
      remember({ token: credential });
      setToken(credential);
      await setKv('token', credential);
      const result = await syncDeck({
        token: credential,
        settings: stateRef.current.settings,
        words: stateRef.current.words,
        cards: stateRef.current.cards,
        tombstones: stateRef.current.tombstones,
        keepalive,
      });
      await applySyncResult(result);
      if (result.committed && result.commitSha) {
        const record = { at: new Date().toISOString(), commit: result.commitSha };
        await setKv('lastSync', record);
        setLastSync(record);
      }
      pendingSyncRef.current = false;
      setSyncIsError(false);
      setSyncMessage(result.committed ? 'Synced ✓' : result.message);
    } catch (error) {
      const message = error.message || 'Sync failed.';
      pendingSyncRef.current = /offline|network error/i.test(message);
      setSyncIsError(!pendingSyncRef.current);
      setSyncMessage(message);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      if (syncAgainRef.current) {
        syncAgainRef.current = false;
        runSync(undefined, { keepalive });
      }
    }
  };

  const scheduleSync = () => {
    if (!String(stateRef.current.token || '').trim()) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => runSync(), SYNC_IDLE_MS);
  };

  const flushSync = () => {
    window.clearTimeout(syncTimer);
    if (!String(stateRef.current.token || '').trim()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      pendingSyncRef.current = true;
      setSyncIsError(false);
      setSyncMessage('Saved on this phone. Will sync when you\'re online.');
      return;
    }
    runSync();
  };

  useEffect(() => {
    let cancel = false;
    warmVoices();
    navigator.storage?.persist?.();
    (async () => {
      const snap = await loadSnapshot();
      const nextSettings = normalizeSettings(snap.kv.settings);
      const nextToken = snap.kv.token || '';
      const nextTombs = snap.kv.tombstones || {};
      let nextWords = await orderFromSnapshot(snap.words, snap.kv.wordOrder);
      const nextCards = Object.fromEntries(snap.cards.map((card) => [card.id, card]));
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}words.json`);
        if (response.ok) {
          const bundled = parseWords(await response.json());
          nextWords = alignWords(nextWords, bundled, nextTombs);
          await replaceWords(nextWords);
        }
      } catch {
        /* Offline launches keep the copy already stored on the device. */
      }
      if (cancel) return;
      applyTheme(nextSettings.theme);
      publish({
        words: nextWords,
        cards: nextCards,
        tombstones: nextTombs,
        settings: nextSettings,
        token: nextToken,
      });
      setLastSync(snap.kv.lastSync && snap.kv.lastSync.commit ? snap.kv.lastSync : null);
      setWarning(storageWarning());
      setLoadError(nextWords.length ? '' : 'Open the app online once so it can download the word list. After that it works offline.');
      setReady(true);
      if (nextToken && nextSettings.syncOnOpen && navigator.onLine) runSync(nextToken);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 15000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      tick();
      if (pendingSyncRef.current && navigator.onLine) runSync();
    };
    const onOnline = () => {
      if (pendingSyncRef.current) flushSync();
    };
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      window.clearTimeout(syncTimer);
      runSync(undefined, { keepalive: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(stateRef.current.settings.theme);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('cf-update', onUpdate);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('cf-update', onUpdate);
    };
  }, []);

  const saveSettings = async (next) => {
    const normalized = normalizeSettings(next);
    await setKv('settings', normalized);
    publish({ settings: normalized });
    applyTheme(normalized.theme);
  };

  const saveWord = async (word) => {
    const exists = stateRef.current.words.some((item) => item.id === word.id);
    const nextWords = exists
      ? stateRef.current.words.map((item) => (item.id === word.id ? word : item))
      : [...stateRef.current.words, word];
    const cards = { ...stateRef.current.cards };
    for (const direction of activeDirections(stateRef.current.settings)) {
      const id = cardId(word.id, direction);
      const existing = cards[id];
      if (!existing || existing.status === 'new') {
        cards[id] = { ...(existing || freshCard(id, word.id, direction)), queued: true };
      }
    }
    await replaceWords(nextWords);
    await replaceCards(cards);
    publish({ words: nextWords, cards });
    location.hash = '#/';
    scheduleSync();
  };

  const learnNew = async (count) => {
    const picked = unseenCards(
      stateRef.current.words,
      stateRef.current.cards,
      stateRef.current.settings,
    ).slice(0, count);
    if (!picked.length) return;
    const cards = queueUnseen(stateRef.current.cards, picked);
    await replaceCards(cards);
    publish({ cards });
  };

  const removeWord = async (word) => {
    const nextTombs = { ...stateRef.current.tombstones, [word.id]: deletionStamp(word) };
    const nextWords = stateRef.current.words.filter((item) => item.id !== word.id);
    const nextCards = { ...stateRef.current.cards };
    delete nextCards[`${word.id}:read`];
    delete nextCards[`${word.id}:write`];
    await replaceWords(nextWords);
    await replaceCards(nextCards);
    await setKv('tombstones', nextTombs);
    publish({ words: nextWords, cards: nextCards, tombstones: nextTombs });
    setUndo(null);
    location.hash = '#/words';
    scheduleSync();
  };

  const grade = async (item, rating) => {
    const reviewedAt = Date.now();
    const previous = stateRef.current.cards[item.card.id] || null;
    const next = withReview(item.card, rating, reviewedAt, item.word.hanzi);
    if (item.card.status === 'new') next.introducedOn = dayKey(reviewedAt);
    await putCard(next);
    const nextCards = { ...stateRef.current.cards, [next.id]: next };
    publish({ cards: nextCards });
    setUndo({ previous, id: next.id });
    setNow(reviewedAt);
    const queue = buildQueue(stateRef.current.words, nextCards, stateRef.current.settings, reviewedAt);
    const queuedLeft = Object.values(nextCards).some((card) => card.status === 'new' && card.queued);
    if (shouldSyncSetNow({ queueEmpty: queue.length === 0, batchJustFinished: Boolean(item.card.queued) && !queuedLeft })) {
      flushSync();
    } else {
      scheduleSync();
    }
  };

  const undoGrade = async () => {
    if (!undo) return;
    const nextCards = { ...stateRef.current.cards };
    if (!undo.previous) {
      delete nextCards[undo.id];
      await deleteCard(undo.id);
    } else {
      nextCards[undo.id] = undo.previous;
      await putCard(undo.previous);
    }
    publish({ cards: nextCards });
    setUndo(null);
    scheduleSync();
  };

  const exportBackup = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      words: stateRef.current.words.map(publicWord),
      cards: stateRef.current.cards,
      deletedWords: stateRef.current.tombstones,
      settings: normalizeSettings(stateRef.current.settings),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `chinese-flashcards-${dayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file) => {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const incoming = data.words || (Array.isArray(data) ? data : null);
    if (!incoming) throw new Error('The backup needs a words array.');
    const imported = parseWords(incoming).map((word) => ({
      ...word,
      dirty: true,
      added: word.added || dayKey(),
      updated: word.updated || new Date().toISOString(),
    }));
    const nextTombs = mergeTombstones(data.deletedWords || {}, stateRef.current.tombstones);
    const nextWords = alignWords(imported, stateRef.current.words, nextTombs);
    const nextCards = mergeCards(data.cards || {}, stateRef.current.cards);
    await replaceWords(nextWords);
    await replaceCards(nextCards);
    await setKv('tombstones', nextTombs);
    const partial = { words: nextWords, cards: nextCards, tombstones: nextTombs };
    if (data.settings) {
      const nextSettings = normalizeSettings({ ...stateRef.current.settings, ...data.settings });
      await setKv('settings', nextSettings);
      partial.settings = nextSettings;
      applyTheme(nextSettings.theme);
    }
    publish(partial);
    setSyncMessage('Backup imported on this device.');
    location.hash = '#/';
  };

  const resetProgress = async () => {
    if (!confirm('Erase review progress on this device? The word list stays. The next sync writes the empty progress to GitHub.')) return;
    await replaceCards([]);
    publish({ cards: {} });
    setUndo(null);
  };

  const reloadForUpdate = () => window.dispatchEvent(new CustomEvent('cf-apply-update'));

  const titles = {
    review: 'Today',
    words: 'Words',
    new: 'Add a word',
    edit: 'Edit word',
    settings: 'Settings',
  };
  const editing = route.name === 'edit' ? words.find((word) => word.id === route.id) : null;

  return (
    <>
      <div class={`shell${route.name === 'review' ? ' shell-today' : ''}`}>
        <header class="top">
          <div class="brand">
            <span class="seal" aria-hidden="true">文</span>
            <div>
              <p class="eyebrow">中文卡</p>
              <h1>{titles[route.name]}</h1>
              <VersionLabel />
            </div>
          </div>
        </header>
        {ready && (
          <div class="sync-bar">
            <p class="sync-line" role="status" title={lastSync?.commit || undefined}>{formatSyncLine(lastSync)}</p>
            {syncMessage && <p class={syncIsError ? 'form-error' : 'sync-message'} role="status">{syncMessage}</p>}
            <button type="button" class="sync-now" onClick={() => runSync(undefined, { manual: true })} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
        {!ready && <article class="card empty-card"><p class="hanzi hanzi-lg" lang="zh-CN">文</p><p>Opening your deck…</p></article>}
        {ready && loadError && <p class="banner" role="status">{loadError}</p>}
        {ready && route.name === 'review' && (
          <Review
            words={words}
            cards={cards}
            settings={settings}
            now={now}
            undo={undo}
            onGrade={grade}
            onUndo={undoGrade}
            onLearn={learnNew}
            syncMessage={syncMessage}
            syncIsError={syncIsError}
          />
        )}
        {ready && route.name === 'words' && <WordList words={words} />}
        {ready && route.name === 'new' && (
          <WordForm key="new" words={words} syncing={syncing} onSave={saveWord} onDelete={removeWord} />
        )}
        {ready && route.name === 'edit' && (
          editing
            ? <WordForm key={editing.id} words={words} existing={editing} syncing={syncing} onSave={saveWord} onDelete={removeWord} />
            : (
              <article class="card empty-card">
                <h2>That word is not on this device.</h2>
                <a class="text-link" href="#/words">Back to words</a>
              </article>
            )
        )}
        {ready && route.name === 'settings' && (
          <Settings
            settings={settings}
            token={token}
            syncing={syncing}
            syncMessage={syncMessage}
            syncIsError={syncIsError}
            lastSync={lastSync}
            warning={warning}
            installEvent={installEvent}
            onSettings={saveSettings}
            onSaveToken={async (value) => {
              const next = value.trim();
              await setKv('token', next);
              publish({ token: next });
            }}
            onForgetToken={async () => {
              await setKv('token', '');
              publish({ token: '' });
              setSyncMessage('Token removed from this device.');
            }}
            onSync={runSync}
            onExport={exportBackup}
            onImport={importBackup}
            onReset={resetProgress}
          />
        )}
      </div>
      {updateReady && (
        <button type="button" class="update-banner" onClick={reloadForUpdate}>
          Update available, tap to reload
        </button>
      )}
      <nav class="tabs" aria-label="Primary">
        <div class="tabs-inner">
          <a href="#/" class={route.name === 'review' ? 'active' : ''} aria-current={route.name === 'review' ? 'page' : undefined}>
            <IconReview /> Today
          </a>
          <a href="#/words" class={route.name === 'words' || route.name === 'edit' ? 'active' : ''} aria-current={route.name === 'words' ? 'page' : undefined}>
            <IconWords /> Words
          </a>
          <a href="#/new" class={route.name === 'new' ? 'active' : ''} aria-current={route.name === 'new' ? 'page' : undefined}>
            <IconAdd /> Add
          </a>
          <a href="#/settings" class={route.name === 'settings' ? 'active' : ''} aria-current={route.name === 'settings' ? 'page' : undefined}>
            <IconSettings /> Settings
          </a>
        </div>
      </nav>
    </>
  );
}
