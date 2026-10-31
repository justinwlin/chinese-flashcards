import { putContent, readContent } from './github.js';
import {
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
