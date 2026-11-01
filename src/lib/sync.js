import { putContent, readContent } from './github.js';
import {
  buildQueue,
  enumerateCards,
  mergeCards,
  parseProgress,
  parseWords,
  reconcileRemote,
  serializeProgress,
  serializeWords,
} from './merge.js';

function cleanWord(word) {
  const next = { ...word };
  delete next.dirty;
  return next;
}

function progressBody(text, words) {
  const parsed = text && String(text).trim() ? parseProgress(text) : { cards: {}, deletedWords: {} };
  return serializeProgress({
    cards: parsed.cards,
    words,
    deletedWords: parsed.deletedWords,
    updated: 'same',
  });
}

/**
 * Sync immediately only when this sitting is over: nothing is due, no Learn-new
 * card is still queued, and no learning or relearning card will come back.
 * A 1- or 10-minute step is not the end of the set. The queued flag stays on a
 * card after it leaves "new", so a later grade of that card is not a new finish.
 */
export function shouldSyncSetNow({ queueEmpty, learningPending = false, batchPending = false }) {
  return Boolean(queueEmpty) && !learningPending && !batchPending;
}

/**
 * Decide whether the grade that produced `cards` should commit now.
 * While a learning step is waiting to come back, the idle wait runs until
 * that step is due, so the gap itself does not become a commit.
 */
export function planSyncAfterGrade({ words, cards, settings, now, idleMs = 15000 }) {
  let learningPending = false;
  let batchPending = false;
  let nextDue = null;
  for (const { card } of enumerateCards(words, cards, settings)) {
    if (card.status === 'learning' || card.status === 'relearning') learningPending = true;
    if (card.status === 'new' && card.queued) batchPending = true;
    if (card.status !== 'new' && card.due > now && (nextDue === null || card.due < nextDue)) {
      nextDue = card.due;
    }
  }
  const queueEmpty = buildQueue(words, cards, settings, now).length === 0;
  if (shouldSyncSetNow({ queueEmpty, learningPending, batchPending })) {
    return { when: 'now', delayMs: 0 };
  }
  if (queueEmpty && learningPending) {
    const untilStep = nextDue == null ? 0 : Math.max(0, nextDue - now);
    return { when: 'later', delayMs: untilStep + idleMs };
  }
  return { when: 'later', delayMs: idleMs };
}

export function hasReviewedCards(cards) {
  return Object.values(cards || {}).some((card) => (card.lastReview || 0) > 0 || (card.reviews || []).length > 0);
}

export function formatSyncLine(lastSync) {
  if (!lastSync?.at || !lastSync?.commit) return 'Not synced to GitHub yet.';
  const time = new Date(lastSync.at).toLocaleString();
  return `Last synced at ${time}, commit ${String(lastSync.commit).slice(0, 7)}`;
}

/**
 * Pull words and progress from the repo, merge them with this device, and
 * commit anything that changed. A result only counts as a sync when GitHub
 * returns 200 or 201 with a commit sha.
 */
export async function syncDeck({ token, settings, words, cards, tombstones, keepalive = false }) {
  const credential = String(token || '').trim();
  if (!credential) throw new Error('Paste a GitHub token first.');
  const owner = settings.owner.trim();
  const repo = settings.repo.trim();
  const branch = settings.branch.trim() || 'main';
  if (!owner || !repo) throw new Error('Set the GitHub owner and repository.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Reviews stay on this device until you sync.');
  }

  const base = { token: credential, owner, repo, branch, keepalive };
  let localWords = words;
  let localCards = cards;
  let localTombs = tombstones || {};
  let commitSha = null;
  const saved = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remoteWordsFile = await readContent({ ...base, path: 'words.json' });
    if (remoteWordsFile.missing) {
      throw new Error(`GitHub 404: words.json was not readable on ${owner}/${repo} (${branch}). The token needs Contents read and write on this repo.`);
    }
    const remoteProgressFile = await readContent({ ...base, path: 'progress.json' });
    const remoteWords = parseWords(remoteWordsFile.text);
    const remoteProgress = remoteProgressFile.text.trim()
      ? parseProgress(remoteProgressFile.text)
      : { cards: {}, deletedWords: {} };

    const mergedCards = mergeCards(localCards, remoteProgress.cards);
    const reconciled = reconcileRemote({
      localWords,
      remoteWords,
      localTombs,
      remoteTombs: remoteProgress.deletedWords,
    });
    const wordsText = serializeWords(reconciled.words);
    const progressText = serializeProgress({
      cards: mergedCards,
      words: reconciled.words,
      deletedWords: reconciled.tombstones,
      updated: new Date().toISOString(),
    });
    const wordsSame = remoteWordsFile.text === wordsText;
    const progressSame = !remoteProgressFile.missing
      && progressBody(remoteProgressFile.text, reconciled.words) === progressBody(progressText, reconciled.words);
    const reviews = hasReviewedCards(mergedCards);
    const progressNeedsWrite = !progressSame && (
      reviews || Object.keys(reconciled.tombstones).length > 0 || !remoteProgressFile.missing
    );

    localWords = reconciled.words.map(cleanWord);
    localCards = mergedCards;
    localTombs = reconciled.tombstones;

    if (wordsSame && !progressNeedsWrite) {
      return {
        words: localWords,
        cards: localCards,
        tombstones: localTombs,
        commitSha,
        committed: Boolean(commitSha),
        saved,
        message: commitSha
          ? `Synced ${saved.join(' and ')}.`
          : (reviews ? 'Already on GitHub. No new commit.' : 'No reviews to send yet.'),
      };
    }

    if (!wordsSame) {
      const wrote = await putContent({
        ...base,
        path: 'words.json',
        message: `Update words.json from Chinese flashcards (${reconciled.words.length} words)`,
        sha: remoteWordsFile.sha,
        text: wordsText,
      });
      if (wrote.conflict) continue;
      commitSha = wrote.commitSha;
      saved.push('words.json');
    }

    if (progressNeedsWrite) {
      const wrote = await putContent({
        ...base,
        path: 'progress.json',
        message: 'Update review progress from Chinese flashcards',
        sha: remoteProgressFile.sha,
        text: progressText,
      });
      if (wrote.conflict) continue;
      commitSha = wrote.commitSha;
      saved.push('progress.json');
    }

    if (!commitSha) throw new Error('GitHub did not return a commit sha.');
    return {
      words: localWords,
      cards: localCards,
      tombstones: localTombs,
      commitSha,
      committed: true,
      saved,
      message: `Synced ${saved.join(' and ')}.`,
    };
  }

  throw new Error('GitHub 409: the file changed while syncing. Try again.');
}
