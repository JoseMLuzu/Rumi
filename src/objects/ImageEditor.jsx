import { useEffect, useState } from 'react';
import { prepareImage, uploadMedia } from './images.js';

export default function ImageEditor({ roomId, item, config, onSave, disabled }) {
  const [draft, setDraft] = useState(config);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewURLs, setPreviewURLs] = useState([]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewURLs(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  async function choose(list) {
    setError('');
    setBusy(true);
    try {
      const maximum = item.type === 'photoFrame' ? 20 : 1;
      if (list.length > maximum) throw new Error(`Selecciona como máximo ${maximum} imágenes.`);
      const blobs = [];
      for (const file of list) blobs.push(await prepareImage(file));
      setFiles(blobs);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const images = [];
      for (const file of files) images.push((await uploadMedia(roomId, file)).url);
      const saved = { ...draft, images: files.length ? images : draft.images };
      await onSave(saved);
      setDraft(saved);
      setFiles([]);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const urls = previewURLs.length ? previewURLs : draft.images;
  return (
    <section className="object-section">
      <div
        className="image-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          choose([...event.dataTransfer.files]);
        }}
      >
        <label>
          Subir imagen {item.type === 'photoFrame' && '(hasta 20)'}
          <input
            type="file"
            accept="image/*,.heic,.avif,.bmp,.tiff"
            multiple={item.type === 'photoFrame'}
            disabled={busy || disabled}
            onChange={(event) => choose([...event.target.files])}
          />
        </label>
        <small>También puedes arrastrarla aquí. Máximo 10 MB por archivo.</small>
        {!!urls.length && (
          <div
            className="image-preview"
            style={{ aspectRatio: item.type === 'poster' ? '63 / 93' : '1' }}
          >
            <img
              alt="Vista previa antes de guardar"
              src={urls[0]}
              style={{
                objectFit: draft.fit,
                objectPosition: `${draft.crop[0] * 100}% ${draft.crop[1] * 100}%`,
                borderColor: draft.frameColor,
              }}
            />
          </div>
        )}
        {urls.length > 1 && <p>{urls.length} fotos seleccionadas</p>}
      </div>
      <label>
        Ajuste
        <select value={draft.fit} onChange={(e) => setDraft({ ...draft, fit: e.target.value })}>
          <option value="contain">Mostrar completa</option>
          <option value="cover">Rellenar</option>
        </select>
      </label>
      {draft.fit === 'cover' &&
        ['Horizontal', 'Vertical'].map((label, index) => (
          <label key={label}>
            {label}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={draft.crop[index]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  crop: draft.crop.map((n, i) => (i === index ? +e.target.value : n)),
                })
              }
            />
          </label>
        ))}
      <label>
        Color del marco
        <input
          type="color"
          value={draft.frameColor}
          onChange={(e) => setDraft({ ...draft, frameColor: e.target.value })}
        />
      </label>
      {item.type === 'photoFrame' && (
        <>
          <label>
            <input
              type="checkbox"
              checked={draft.slideshow}
              onChange={(e) => setDraft({ ...draft, slideshow: e.target.checked })}
            />{' '}
            Presentación automática
          </label>
          <label>
            Intervalo (segundos)
            <input
              type="number"
              min="2"
              max="60"
              value={draft.interval}
              onChange={(e) => setDraft({ ...draft, interval: +e.target.value })}
            />
          </label>
        </>
      )}
      <div className="object-actions">
        <button className="button primary" disabled={busy || disabled} onClick={save}>
          {busy ? 'Procesando…' : 'Guardar imagen y ajustes'}
        </button>
        <button
          className="button quiet"
          disabled={busy || disabled}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ ...draft, images: [] });
              setDraft({ ...draft, images: [] });
              setFiles([]);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Restaurar imagen inicial
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
