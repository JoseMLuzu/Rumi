import { useRef, useState } from 'react';
import { uploadMedia } from './images.js';

export function GuestBookPanel({ item, owner, action }) {
  const [text, setText] = useState('');
  const [page, setPage] = useState(0);
  const entries = item.state?.entries ?? [];
  const entry = entries[Math.min(page, Math.max(0, entries.length - 1))];
  return (
    <section className="object-section">
      <div className="guest-page" key={entry?.id ?? 'empty'}>
        {entry ? (
          <>
            <blockquote>{entry.text}</blockquote>
            <p>
              {entry.author} · {new Date(entry.date * 1000).toLocaleString()}
            </p>
            {owner && (
              <button
                className="button danger"
                onClick={() => action('deleteEntry', { entryId: entry.id })}
              >
                Eliminar dedicatoria
              </button>
            )}
          </>
        ) : (
          <p>Escribe la primera dedicatoria.</p>
        )}
      </div>
      <div className="object-actions">
        <button
          className="button secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          ← Anterior
        </button>
        <span>
          {entries.length ? Math.min(page + 1, entries.length) : 0} / {entries.length}
        </span>
        <button
          className="button secondary"
          disabled={page >= entries.length - 1}
          onClick={() => setPage(page + 1)}
        >
          Siguiente →
        </button>
      </div>
      <label>
        Tu dedicatoria
        <textarea maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        className="button primary"
        disabled={!text.trim()}
        onClick={async () => {
          if (await action('message', { text })) {
            setText('');
            setPage(entries.length);
          }
        }}
      >
        Dejar mensaje
      </button>
    </section>
  );
}

export function DrawingPanel({ item, roomId, owner, action }) {
  const canvas = useRef(null),
    drawing = useRef(false),
    undo = useRef([]);
  const [color, setColor] = useState('#f0e9cf'),
    [size, setSize] = useState(5),
    [erase, setErase] = useState(false),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // Remember the version at the START of the contribution. Live updates must not silently advance it.
  const [revision, setRevision] = useState(item.revision ?? 0);
  const changed = (item.revision ?? 0) !== revision;
  function point(e) {
    const r = canvas.current.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.current.width) / r.width,
      ((e.clientY - r.top) * canvas.current.height) / r.height,
    ];
  }
  function begin(e) {
    const c = canvas.current.getContext('2d');
    undo.current.push(c.getImageData(0, 0, 600, 400));
    if (undo.current.length > 20) undo.current.shift();
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    c.beginPath();
    c.moveTo(...point(e));
    stroke(e);
  }
  function stroke(e) {
    if (!drawing.current) return;
    const c = canvas.current.getContext('2d');
    c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    c.strokeStyle = color;
    c.lineWidth = size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineTo(...point(e));
    c.stroke();
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const blob = await new Promise((resolve) => canvas.current.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('No se pudo guardar el dibujo.');
      const asset = await uploadMedia(roomId, blob, 'drawing');
      const result = await action('draw', { url: asset.url, text, revision });
      if (result) {
        canvas.current.getContext('2d').clearRect(0, 0, 600, 400);
        undo.current = [];
        setText('');
        setRevision(result.item.revision);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="object-section">
      <p>
        Cada dibujo es una capa independiente: el propietario puede borrar una aportación sin borrar
        las demás.
      </p>
      <div className="drawing-tools">
        <label>
          Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          Pincel
          <input
            type="range"
            min="2"
            max="30"
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
        <label>
          <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />{' '}
          Borrador
        </label>
        <button
          className="button secondary"
          onClick={() => {
            const previous = undo.current.pop();
            if (previous) canvas.current.getContext('2d').putImageData(previous, 0, 0);
          }}
        >
          Deshacer
        </button>
      </div>
      <canvas
        ref={canvas}
        width={600}
        height={400}
        className="drawing-canvas"
        onPointerDown={begin}
        onPointerMove={stroke}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <label>
        Mensaje corto
        <textarea maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {changed && (
        <p role="alert">
          La pizarra cambió mientras dibujabas. Revisa las nuevas aportaciones y pulsa «Aceptar
          nueva versión» antes de guardar. Tu dibujo sigue aquí.
          <button className="button secondary" onClick={() => setRevision(item.revision ?? 0)}>
            Aceptar nueva versión
          </button>
        </p>
      )}
      <button className="button primary" disabled={busy || changed} onClick={save}>
        {busy ? 'Guardando…' : 'Guardar aportación'}
      </button>
      {error && <p role="alert">{error}</p>}
      <div className="drawing-posts">
        {(item.state?.drawings ?? []).map((post) => (
          <article key={post.id}>
            <img src={post.url} alt={`Dibujo de ${post.author}`} />
            <p>
              <strong>{post.author}</strong> · {post.text}
            </p>
            {owner && (
              <button
                className="button danger"
                onClick={() => action('deleteDrawing', { entryId: post.id })}
              >
                Borrar aportación
              </button>
            )}
          </article>
        ))}
      </div>
      {owner && (
        <button className="button danger" onClick={() => action('clearBoard')}>
          Limpiar pizarra
        </button>
      )}
    </section>
  );
}
