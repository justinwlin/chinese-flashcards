export function dayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function cardId(wordId, direction) {
  return `${wordId}:${direction}`;
}

export const DIRECTIONS = ['read', 'write'];
