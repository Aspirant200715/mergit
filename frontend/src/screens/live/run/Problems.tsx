/** Every problem a form ended with, announced to screen readers as it appears. */
export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="lr-problems small" role="alert">
      {items.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}
