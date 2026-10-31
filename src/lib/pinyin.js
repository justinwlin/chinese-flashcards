/** Tone-mark lookup. Tone 5 is neutral (no mark). */
const TONE_OF = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
  ń: 2, ň: 3, ǹ: 4,
  ḿ: 2,
};

const FOLD = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v',
  ń: 'n', ň: 'n', ǹ: 'n',
  ḿ: 'm',
};

for (const [mark, tone] of Object.entries({ ...TONE_OF })) {
  const upper = mark.toUpperCase();
  if (upper !== mark) TONE_OF[upper] = tone;
}
for (const [mark, base] of Object.entries({ ...FOLD })) {
  const upper = mark.toUpperCase();
  if (upper !== mark && !FOLD[upper]) FOLD[upper] = base;
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const FINALS = new Set([
  'iang', 'iong', 'uang', 'ueng',
  'ang', 'eng', 'ing', 'ong', 'iao', 'ian', 'uan', 'uai',
  'ai', 'ei', 'ao', 'ou', 'ia', 'ie', 'iu', 'in', 'un', 'ui', 'ua', 'uo', 'ue', 'an', 'en', 'er',
  've', 'vn', 'van',
  'a', 'o', 'e', 'i', 'u', 'v',
]);

const LETTER = /[A-Za-z\u00C0-\u024F]/;

export function toneOf(token) {
  for (const char of token) {
    if (TONE_OF[char]) return TONE_OF[char];
  }
  const numbered = token.match(/[1-5](?!.*[a-zA-Z\u00C0-\u024F])/);
  if (numbered) return Number(numbered[0]);
  return 5;
}

function isSyllable(ascii) {
  if (!ascii) return false;
  if (FINALS.has(ascii)) return true;
  for (const initial of INITIALS) {
    if (ascii.startsWith(initial) && FINALS.has(ascii.slice(initial.length))) return true;
  }
  return false;
}

function canParse(ascii) {
  if (!ascii) return true;
  if (isSyllable(ascii)) return true;
  const max = Math.min(6, ascii.length);
  for (let len = max; len >= 1; len -= 1) {
    if (isSyllable(ascii.slice(0, len)) && canParse(ascii.slice(len))) return true;
  }
  return false;
}

/** Split an unspaced ascii pinyin string into syllables. */
export function segmentAscii(ascii) {
  if (!ascii) return [];
  if (isSyllable(ascii)) return [ascii];
  const parts = [];
  let index = 0;
  while (index < ascii.length) {
    let best = 0;
    const max = Math.min(6, ascii.length - index);
    for (let len = max; len >= 1; len -= 1) {
      if (isSyllable(ascii.slice(index, index + len))) {
        best = len;
        break;
      }
    }
    if (!best) {
      const stray = ascii[index];
      if (parts.length) parts[parts.length - 1] += stray;
      else parts.push(stray);
      index += 1;
      continue;
    }
    let len = best;
    const syllable = ascii.slice(index, index + len);
    const ending = syllable.endsWith('ng') ? 'ng' : syllable.endsWith('n') ? 'n' : '';
    if (ending) {
      const shortLen = len - ending.length;
      const short = ascii.slice(index, index + shortLen);
      const rest = ascii.slice(index + shortLen);
      if (shortLen >= 1 && isSyllable(short) && canParse(rest) && /^[b-df-hj-np-tv-z]/.test(rest)) {
        len = shortLen;
      }
    }
    parts.push(ascii.slice(index, index + len));
    index += len;
  }
  return parts;
}

function foldToken(token) {
  let ascii = '';
  const map = [];
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (FOLD[char]) {
      ascii += FOLD[char];
      map.push(i);
    } else if (/[A-Za-z]/.test(char)) {
      ascii += char.toLowerCase();
      map.push(i);
    }
  }
  return { ascii, map };
}

function sliceOriginal(token, map, segments) {
  if (!segments.length) return [];
  const pieces = [];
  let asciiIndex = 0;
  for (let s = 0; s < segments.length; s += 1) {
    const start = map[asciiIndex] ?? token.length;
    asciiIndex += segments[s].length;
    const end = s === segments.length - 1 ? token.length : (map[asciiIndex] ?? token.length);
    pieces.push(token.slice(start, end));
  }
  return pieces;
}

/**
 * Split display pinyin into syllables and other characters.
 * Spaces in the source are preserved. Unspaced words such as "xièxie"
 * are segmented so each syllable can be colored.
 */
export function tokenize(text) {
  const tokens = [];
  const source = String(text ?? '');
  let buffer = '';
  const flushWord = () => {
    if (!buffer) return;
    const { ascii, map } = foldToken(buffer);
    const segments = segmentAscii(ascii);
    const pieces = sliceOriginal(buffer, map, segments.length ? segments : [ascii]);
    const rendered = pieces.length ? pieces : [buffer];
    for (const piece of rendered) {
      if (piece) tokens.push({ type: 'syl', text: piece, tone: toneOf(piece) });
    }
    buffer = '';
  };
  const flushOther = (chunk) => {
    if (!chunk) return;
    tokens.push({ type: 'text', text: chunk });
  };

  let other = '';
  for (const char of source) {
    if (LETTER.test(char) || TONE_OF[char] || FOLD[char]) {
      flushOther(other);
      other = '';
      buffer += char;
    } else if (/[1-5]/.test(char) && buffer) {
      buffer += char;
    } else {
      flushWord();
      other += char;
    }
  }
  flushWord();
  flushOther(other);
  return tokens;
}

/** Lowercase, tone-less key for search. ü and v both become u. */
export function searchable(text) {
  let out = '';
  for (const char of String(text ?? '').toLowerCase()) {
    if (FOLD[char]) out += FOLD[char] === 'v' ? 'u' : FOLD[char];
    else if (char === 'v') out += 'u';
    else if (/\s/.test(char)) continue;
    else out += char;
  }
  return out;
}

export function slugifyPinyin(pinyin) {
  const ascii = searchable(pinyin).replace(/[^a-z0-9]+/g, '');
  return ascii.slice(0, 32);
}
