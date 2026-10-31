const DB_NAME = 'chinese-flashcards';
const DB_VERSION = 1;

const memory = {
  ready: false,
  useMemory: false,
  warning: '',
  words: new Map(),
  cards: new Map(),
  kv: new Map(),
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('words')) db.createObjectStore('words', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the database'));
  });
  return dbPromise;
}

async function ensure() {
  if (memory.ready) return;
  try {
    await openDb();
    memory.useMemory = false;
  } catch {
    memory.useMemory = true;
    memory.warning = 'This browser will not keep data after you close the tab. Reviews still work for this session, and export can save a backup.';
    dbPromise = null;
  }
  memory.ready = true;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Storage write failed'));
    tx.onabort = () => reject(tx.error || new Error('Storage write was aborted'));
  });
}

export function storageWarning() {
  return memory.warning;
}

export async function loadSnapshot() {
  await ensure();
  if (memory.useMemory) {
    return {
      words: [...memory.words.values()],
      cards: [...memory.cards.values()],
      kv: Object.fromEntries([...memory.kv.entries()]),
    };
  }
  const db = await openDb();
  const words = await new Promise((resolve, reject) => {
    const request = db.transaction('words', 'readonly').objectStore('words').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const cards = await new Promise((resolve, reject) => {
    const request = db.transaction('cards', 'readonly').objectStore('cards').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction('kv', 'readonly').objectStore('kv').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const kv = {};
  for (const row of rows) kv[row.key] = row.value;
  return { words, cards, kv };
}

export async function replaceWords(words) {
  await ensure();
  if (memory.useMemory) {
    memory.words = new Map(words.map((word) => [word.id, word]));
    memory.kv.set('wordOrder', words.map((word) => word.id));
    return;
  }
  const db = await openDb();
  const tx = db.transaction(['words', 'kv'], 'readwrite');
  const store = tx.objectStore('words');
  store.clear();
  for (const word of words) store.put(word);
  tx.objectStore('kv').put({ key: 'wordOrder', value: words.map((word) => word.id) });
  await txDone(tx);
}

export async function putWord(word) {
  await ensure();
  if (memory.useMemory) {
    memory.words.set(word.id, word);
    return;
  }
  const db = await openDb();
  const tx = db.transaction('words', 'readwrite');
  tx.objectStore('words').put(word);
  await txDone(tx);
}

export async function replaceCards(cards) {
  await ensure();
  const list = Array.isArray(cards) ? cards : Object.values(cards);
  if (memory.useMemory) {
    memory.cards = new Map(list.map((card) => [card.id, card]));
    return;
  }
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  const store = tx.objectStore('cards');
  store.clear();
  for (const card of list) store.put(card);
  await txDone(tx);
}

export async function putCard(card) {
  await ensure();
  if (memory.useMemory) {
    memory.cards.set(card.id, card);
    return;
  }
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').put(card);
  await txDone(tx);
}

export async function deleteCard(id) {
  await ensure();
  if (memory.useMemory) {
    memory.cards.delete(id);
    return;
  }
  const db = await openDb();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').delete(id);
  await txDone(tx);
}

export async function setKv(key, value) {
  await ensure();
  if (memory.useMemory) {
    memory.kv.set(key, value);
    return;
  }
  const db = await openDb();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({ key, value });
  await txDone(tx);
}

export async function orderFromSnapshot(words, wordOrder) {
  const byId = new Map(words.map((word) => [word.id, word]));
  const ordered = [];
  for (const id of wordOrder || []) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const word of byId.values()) ordered.push(word);
  return ordered;
}
