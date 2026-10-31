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

function progressSignature(text) {
  const parsed = text && text.trim() ? parseProgress(text) : { cards: {}, deletedWords: {} };
  return serializeProgress({
    cards: parsed.cards,
    deletedWords: parsed.deletedWords,
    updated: 'same',
  });
}

async function readFile(base, path) {
  return readContent({ ...base, path });
}

/**
 * Pull words and progress from the repo, merge them with this device, and
 * commit anything that changed. Sha conflicts refetch and merge again.
 */
export async function syncDeck({ token, settings, words, cards, tombstones }) {
  const credential = String(token || '').trim();
  if (!credential) throw new Error('Paste a GitHub token first.');
  const owner = settings.owner.trim();
  const repo = settings.repo.trim();
  const branch = settings.branch.trim() || 'main';
  if (!owner || !repo) throw new Error('Set the GitHub owner and repository.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Reviews stay on this device until you sync.');
  }

  const base = { token: credential, owner, repo, branch };
  let localWords = words;
  let localCards = cards;
  let localTombs = tombstones || {};
  let wordsChanged = false;
  let progressChanged = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remoteWordsFile = await readFile(base, 'words.json');
    const remoteProgressFile = await readFile(base, 'progress.json');
    const remoteWords = remoteWordsFile.text.trim() ? parseWords(remoteWordsFile.text) : [];
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
      deletedWords: reconciled.tombstones,
      updated: new Date().toISOString(),
    });
    const wordsSame = !remoteWordsFile.missing && remoteWordsFile.text === wordsText;
    const progressSame = progressSignature(remoteProgressFile.text) === progressSignature(progressText);

    localWords = reconciled.words.map(cleanWord);
    localCards = mergedCards;
    localTombs = reconciled.tombstones;

    if (wordsSame && progressSame) {
      return { words: localWords, cards: localCards, tombstones: localTombs, wordsChanged, progressChanged };
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
      wordsChanged = true;
    }

    if (!progressSame) {
      const wrote = await putContent({
        ...base,
        path: 'progress.json',
        message: 'Update review progress from Chinese flashcards',
        sha: remoteProgressFile.sha,
        text: progressText,
      });
      if (wrote.conflict) continue;
      progressChanged = true;
    }

    return { words: localWords, cards: localCards, tombstones: localTombs, wordsChanged, progressChanged };
  }

  throw new Error('The repo changed while syncing. Try again.');
}
