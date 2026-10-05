import { useRef, useState } from 'react';
export default function DartsPanel({ action }) {
  const [aim, setAim] = useState([0, 0]),
    [hits, setHits] = useState([]),
    [result, setResult] = useState(null);
  const pending = useRef(false);
  function locate(event) {
    const r = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - r.left) / r.width) * 2 - 1,
      ((event.clientY - r.top) / r.height) * 2 - 1,
    ];
  }
  async function shoot(event) {
    if (hits.length >= 3 || pending.current) return;
    const hit = locate(event);
    setAim(hit);
    const next = [...hits, hit];
    setHits(next);
    if (next.length === 3) {
      pending.current = true;
      const response = await action('darts', { hits: next });
      setResult(response);
      pending.current = false;
    }
  }
  return (
    <section className="object-section">
      <p>
        Apunta y haz clic o toca la diana. Tienes tres dardos. Centro: 50; anillos: 25, 20, 10, 5 y
        1 punto.
      </p>
      <button
        className="dart-target"
        aria-label="Apuntar y lanzar dardo"
        onPointerMove={(e) => setAim(locate(e))}
        onClick={shoot}
        disabled={hits.length >= 3}
      >
        {hits.map(([x, y], i) => (
          <span
            className="dart-hit"
            key={i}
            style={{ left: `${(x + 1) * 50}%`, top: `${(y + 1) * 50}%` }}
          >
            ×
          </span>
        ))}
        <span
          className="dart-aim"
          style={{
            left: `${(aim[0] + 1) * 50}%`,
            top: `${(aim[1] + 1) * 50}%`,
          }}
        >
          +
        </span>
      </button>
      <p>
        {hits.length} / 3 dardos{' '}
        {result && `· ${result.total} puntos (${result.scores.join(' + ')})`}
      </p>
      {hits.length === 3 && (
        <button
          className="button secondary"
          onClick={() => {
            setHits([]);
            setResult(null);
          }}
        >
          Jugar otra vez
        </button>
      )}
    </section>
  );
}
