import { tokenize } from '../lib/pinyin.js';

export function Pinyin({ text, className = '' }) {
  const tokens = tokenize(text);
  return (
    <span class={`pinyin ${className}`.trim()}>
      {tokens.map((token, index) => (
        token.type === 'syl'
          ? <span key={index} class={`tone tone-${token.tone}`}>{token.text}</span>
          : <span key={index}>{token.text}</span>
      ))}
    </span>
  );
}
