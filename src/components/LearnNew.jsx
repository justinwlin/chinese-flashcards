import { useEffect, useState } from 'preact/hooks';

export function LearnNew({ unseen, onLearn }) {
  const [count, setCount] = useState(5);
  useEffect(() => {
    setCount(Math.min(5, unseen) || 1);
  }, [unseen]);
  if (!unseen) return null;
  const chosen = Math.min(unseen, Math.max(1, Number(count) || 1));
  return (
    <form
      class="learn-new"
      onSubmit={(event) => {
        event.preventDefault();
        onLearn(chosen);
      }}
    >
      <label>
        How many
        <input
          type="number"
          min="1"
          max={unseen}
          inputMode="numeric"
          value={count}
          onInput={(event) => setCount(event.currentTarget.value)}
        />
      </label>
      <button type="submit" class="secondary">Learn new words</button>
    </form>
  );
}
