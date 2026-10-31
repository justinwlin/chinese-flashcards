import assert from 'node:assert/strict';
import test from 'node:test';
import { searchable, slugifyPinyin, tokenize } from '../src/lib/pinyin.js';

function syllables(text) {
  return tokenize(text).filter((token) => token.type === 'syl');
}

test('spaced pinyin keeps each syllable and its tone', () => {
  const tokens = syllables('nǐ hǎo');
  assert.deepEqual(tokens.map((token) => [token.text, token.tone]), [
    ['nǐ', 3],
    ['hǎo', 3],
  ]);
  assert.deepEqual(syllables('rì luò').map((token) => token.tone), [4, 4]);
  assert.deepEqual(syllables('Zhōng guó').map((token) => token.tone), [1, 2]);
  assert.deepEqual(syllables('xiè xie').map((token) => token.tone), [4, 5]);
  assert.deepEqual(syllables('fēi jī').map((token) => token.tone), [1, 1]);
  assert.deepEqual(syllables('péng you').map((token) => token.tone), [2, 5]);
  assert.equal(syllables('nǚ')[0].tone, 3);
});

test('unspaced pinyin is split before it is colored', () => {
  assert.deepEqual(syllables('xièxie').map((token) => token.tone), [4, 5]);
  assert.deepEqual(syllables('Zhōngguó').map((token) => [token.text, token.tone]), [
    ['Zhōng', 1],
    ['guó', 2],
  ]);
  assert.deepEqual(syllables('nihao').map((token) => token.text), ['ni', 'hao']);
  assert.deepEqual(syllables('shénme').map((token) => token.tone), [2, 5]);
  assert.deepEqual(syllables('fēijī').map((token) => token.tone), [1, 1]);
});

test('punctuation stays outside the colored syllables', () => {
  const tokens = tokenize('Nǐ hǎo ma?');
  assert.equal(tokens.at(-1).text, '?');
  assert.equal(tokens.at(-1).type, 'text');
  assert.equal(syllables('Nǐ hǎo ma?').length, 3);
});

test('search ignores tone marks and treats ü like u', () => {
  assert.equal(searchable('Nǚ'), 'nu');
  assert.equal(searchable('nv'), 'nu');
  assert.equal(searchable('Zhōngguó'), 'zhongguo');
  assert.equal(searchable('zhong guo'), 'zhongguo');
  assert.equal(slugifyPinyin('Zhōng guó'), 'zhongguo');
});
