import { useEffect, useRef, useState } from 'react';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE } from './roomAppearance.js';
import { prepareImage, uploadMedia } from './objects/images.js';

const LABELS = { floor: 'Floor', walls: 'Walls', background: 'Background' };

export default function RoomAppearancePanel({
  roomId,
  appearance,
  revision,
  onPreview,
  onSave,
  onReload,
}) {
  const [surface, setSurface] = useState('floor');
  const [draft, setDraft] = useState(() => structuredClone(appearance));
  const [base, setBase] = useState(appearance);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const files = useRef(new Map());
  const urls = useRef(new Set());
  const mounted = useRef(true);
  const dirty = files.current.size > 0 || JSON.stringify(draft) !== JSON.stringify(base);
  const config = draft[surface];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      urls.current.forEach(URL.revokeObjectURL);
      onPreview(null);
    };
  }, [onPreview]);
  useEffect(() => {
    onPreview(dirty ? draft : null);
  }, [draft, dirty, onPreview]);
  useEffect(() => {
    // Keep an unfinished preview if another session saves; its revision will be checked on Apply.
    if (!dirty && !busy) {
      setDraft(structuredClone(appearance));
      setBase(appearance);
      setBaseRevision(revision);
    }
  }, [appearance, revision]);

  function update(changes) {
    setDraft((current) => ({ ...current, [surface]: { ...current[surface], ...changes } }));
    setError('');
    setNotice('');
  }
  function reset(value = appearance, nextRevision = revision) {
    files.current.clear();
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    setDraft(structuredClone(value));
    setBase(value);
    setBaseRevision(nextRevision);
    setError('');
  }
  async function choose(list) {
    if (busy) return;
    if (list.length !== 1) {
      setError('Choose one image for this surface.');
      return;
    }
    setBusy(true);
    setError('');
    const target = surface;
    try {
      const blob = await prepareImage(list[0]);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      files.current.set(target, blob);
      setDraft((current) => ({ ...current, [target]: { ...current[target], image: url } }));
      setNotice('Preview only. Apply style to save this image.');
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function apply() {
    if (!dirty || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = structuredClone(draft);
      // Temporary blob URLs are only previews. Save storage references after real multipart uploads.
      for (const [key, blob] of files.current) {
        saved[key].image = (await uploadMedia(roomId, blob)).url;
      }
      if (!mounted.current) return;
      const result = await onSave(saved, baseRevision);
      if (!mounted.current) return;
      reset(result.appearance, result.revision);
      setNotice('Room style saved. Visitors can see it now.');
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="appearance-panel" aria-label="Room style editor" aria-busy={busy}>
      <div className="panel-heading">
        <h2>Make it yours.</h2>
        <p>Preview here, then apply. Furniture saves separately.</p>
      </div>
      <div className="surface-tabs" role="group" aria-label="Choose a room surface">
        {Object.entries(LABELS).map(([key, label]) => (
          <button
            key={key}
            className={`button quiet ${surface === key ? 'active' : ''}`}
            disabled={busy}
            aria-pressed={surface === key}
            onClick={() => setSurface(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <fieldset disabled={busy}>
        <legend>{LABELS[surface]}</legend>
        <label>
          Style
          <select
            aria-label={`${LABELS[surface]} style`}
            value={config.image ? 'image' : config.preset}
            onChange={(e) => {
              const preset = e.target.value;
              files.current.delete(surface);
              update({
                preset,
                color: APPEARANCE_OPTIONS[surface].presets[preset].color,
                image: null,
              });
            }}
          >
            {Object.entries(APPEARANCE_OPTIONS[surface].presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
            {config.image && (
              <option value="image" disabled>
                My image
              </option>
            )}
          </select>
        </label>
        <label className="appearance-color">
          Color
          <input
            type="color"
            aria-label={`${LABELS[surface]} color`}
            value={config.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
        <div
          className="image-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose([...e.dataTransfer.files]);
          }}
        >
          <label>
            Use your own image
            <input
              key={surface}
              type="file"
              aria-label={`${LABELS[surface]} image`}
              accept="image/*,.heic,.avif,.bmp,.tiff"
              onChange={(e) => {
                choose([...e.target.files]);
                e.target.value = '';
              }}
            />
          </label>
          <small>Choose a file or drop it here. Up to 10 MB; optimized to 2048 px.</small>
          {config.image && (
            <div
              className="appearance-image-preview"
              role="img"
              aria-label={`${LABELS[surface]} image preview`}
              style={{
                backgroundColor: config.color,
                backgroundImage: `url("${config.image}")`,
                backgroundSize: config.fit === 'tile' ? `${100 / config.repeat}% auto` : config.fit,
                backgroundRepeat: config.fit === 'tile' ? 'repeat' : 'no-repeat',
                backgroundPosition: `${config.crop[0] * 100}% ${config.crop[1] * 100}%`,
              }}
            />
          )}
        </div>
        {config.image && (
          <>
            <label>
              Image fit
              <select
                aria-label={`${LABELS[surface]} image fit`}
                value={config.fit}
                onChange={(e) => update({ fit: e.target.value })}
              >
                <option value="cover">Fill surface</option>
                <option value="contain">Show entire image</option>
                {surface !== 'background' && <option value="tile">Repeat as a pattern</option>}
              </select>
            </label>
            {config.fit === 'cover' &&
              ['Horizontal', 'Vertical'].map((axis, index) => (
                <label key={axis}>
                  {axis} crop
                  <input
                    type="range"
                    aria-label={`${LABELS[surface]} ${axis.toLowerCase()} crop`}
                    min="0"
                    max="1"
                    step="0.01"
                    value={config.crop[index]}
                    onChange={(e) =>
                      update({
                        crop: config.crop.map((n, i) => (i === index ? +e.target.value : n)),
                      })
                    }
                  />
                </label>
              ))}
            {config.fit === 'tile' && (
              <label>
                Repeat: {config.repeat}×
                <input
                  type="range"
                  aria-label={`${LABELS[surface]} repeat`}
                  min="1"
                  max="8"
                  step="1"
                  value={config.repeat}
                  onChange={(e) => update({ repeat: +e.target.value })}
                />
              </label>
            )}
            <button
              className="button quiet"
              onClick={() => {
                files.current.delete(surface);
                update({ image: null });
              }}
            >
              Remove image
            </button>
          </>
        )}
      </fieldset>
      {baseRevision !== revision && dirty && (
        <p role="status">Another session saved a newer style. Reload it before applying.</p>
      )}
      <div className="appearance-actions">
        <button
          className="button quiet"
          disabled={busy}
          onClick={() => {
            files.current.clear();
            setDraft(structuredClone(DEFAULT_APPEARANCE));
            setError('');
            setNotice('Original room style previewed. Apply to keep it.');
          }}
        >
          Reset to original style
        </button>
        <button
          className="button primary"
          disabled={!dirty || busy || baseRevision !== revision}
          onClick={apply}
        >
          {busy ? 'Processing…' : 'Apply style'}
        </button>
        <button
          className="button secondary"
          disabled={!dirty || busy}
          onClick={() => {
            reset();
            setNotice('Preview discarded.');
          }}
        >
          Discard preview
        </button>
        {dirty && (error || baseRevision !== revision) && (
          <button
            className="button quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await onReload();
                if (mounted.current) {
                  reset(saved.appearance, saved.revision);
                  setNotice('Latest style loaded.');
                }
              } catch (e) {
                if (mounted.current) setError(e.message);
              } finally {
                if (mounted.current) setBusy(false);
              }
            }}
          >
            Reload saved style
          </button>
        )}
      </div>
      {error && (
        <p className="appearance-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
