import { useEffect, useState } from 'react';
import { requestJSON, loadRoomDirectory } from '../api.js';
import { FURNITURE_CATALOG } from '../data/furniture.js';
import { uploadMedia } from './images.js';

export default function ConfigEditor({ item, config, roomId, onSave, disabled }) {
  const [draft, setDraft] = useState(config),
    [rooms, setRooms] = useState([]),
    [inventory, setInventory] = useState([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (item.type === 'friendPortal')
      loadRoomDirectory(controller.signal)
        .then(setRooms)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    if (['memoryCabinet', 'dartRack'].includes(item.type))
      requestJSON('/api/inventory', { signal: controller.signal })
        .then((body) => setInventory(body.items))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    return () => controller.abort();
  }, [item.type]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function addAudio(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('El audio supera 20 MB.');
      const url = URL.createObjectURL(file);
      let duration;
      try {
        duration = await new Promise((resolve, reject) => {
          const audio = new Audio();
          const finish = () => {
            audio.removeAttribute('src');
            audio.load();
          };
          audio.onloadedmetadata = () => {
            const length = audio.duration;
            finish();
            if (!Number.isFinite(length) || length <= 0 || length > 21600)
              reject(new Error('El audio debe tener una duración válida de hasta seis horas.'));
            else resolve(length);
          };
          audio.onerror = () => {
            finish();
            reject(new Error('El navegador no puede reproducir este audio. Usa MP3, WAV u OGG.'));
          };
          audio.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      const asset = await uploadMedia(roomId, file, 'audio');
      set('tracks', [
        ...draft.tracks,
        { url: asset.url, title: file.name.slice(0, 100), duration },
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="object-section">
      {['color', 'frameColor']
        .filter((key) => key in draft)
        .map((key) => (
          <label key={key}>
            Color
            <input type="color" value={draft[key]} onChange={(e) => set(key, e.target.value)} />
          </label>
        ))}
      {'intensity' in draft && (
        <label>
          Intensidad
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={draft.intensity}
            onChange={(e) => set('intensity', +e.target.value)}
          />
        </label>
      )}
      {'fishNames' in draft &&
        draft.fishNames.map((name, i) => (
          <label key={i}>
            Pez {i + 1}
            <input
              maxLength={24}
              value={name}
              onChange={(e) =>
                set(
                  'fishNames',
                  draft.fishNames.map((n, j) => (j === i ? e.target.value : n)),
                )
              }
            />
          </label>
        ))}
      {'pose' in draft && (
        <label>
          Pose del asiento
          <select value={draft.pose} onChange={(e) => set('pose', e.target.value)}>
            <option value="normal">Normal</option>
            <option value="relaxed">Relajada</option>
            <option value="wave">Saludando</option>
          </select>
        </label>
      )}
      {'scene' in draft && (
        <>
          <label>
            Paisaje
            <select value={draft.scene} onChange={(e) => set('scene', e.target.value)}>
              <option value="space">Espacio</option>
              <option value="rain">Ciudad lluviosa</option>
              <option value="beach">Playa</option>
              <option value="sea">Fondo del mar</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.ambient}
              onChange={(e) => set('ambient', e.target.checked)}
            />{' '}
            Permitir sonido ambiental
          </label>
        </>
      )}
      {'destination' in draft && (
        <label>
          Habitación de destino
          <select
            value={draft.destination ?? ''}
            onChange={(e) => set('destination', e.target.value ? +e.target.value : null)}
          >
            <option value="">Sin destino</option>
            {rooms
              .filter((room) => room.id !== roomId)
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {['slots', 'accessories']
        .filter((key) => key in draft)
        .map((key) => (
          <div key={key}>
            <p>
              {key === 'slots' ? 'Recuerdos en la vitrina' : 'Accesorios colgados'} · colección
              gratuita
            </p>
            {[0, 1, 2].map((i) => (
              <label key={i}>
                Espacio {i + 1}
                <select
                  value={draft[key][i] ?? ''}
                  onChange={(e) => {
                    const list = [...draft[key]];
                    while (list.length < 3) list.push(null);
                    list[i] = e.target.value || null;
                    set(key, list);
                  }}
                >
                  <option value="">Vacío</option>
                  {inventory
                    .filter((entry) => !['memoryCabinet', 'dartRack'].includes(entry.type))
                    .map((entry) => (
                      <option key={entry.type} value={entry.type}>
                        {FURNITURE_CATALOG[entry.type]?.label ?? entry.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        ))}
      {'tracks' in draft && (
        <>
          <label>
            Subir audio (máximo 20 MB)
            <input
              type="file"
              accept="audio/*,.flac,.m4a"
              disabled={busy || draft.tracks.length >= 10}
              onChange={(e) => addAudio(e.target.files[0])}
            />
          </label>
          {draft.tracks.map((track, i) => (
            <div className="object-actions" key={track.url}>
              <input
                aria-label="Título de audio"
                value={track.title}
                maxLength={100}
                onChange={(e) =>
                  set(
                    'tracks',
                    draft.tracks.map((t, j) => (j === i ? { ...t, title: e.target.value } : t)),
                  )
                }
              />
              <button
                className="button danger"
                onClick={() =>
                  set(
                    'tracks',
                    draft.tracks.filter((_, j) => j !== i),
                  )
                }
              >
                Quitar
              </button>
            </div>
          ))}
        </>
      )}
      <button className="button primary" disabled={busy || disabled} onClick={save}>
        {busy ? 'Guardando…' : 'Guardar configuración'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
