import { useEffect, useRef, useState } from 'react';
import { OBJECTS, FURNITURE_CATALOG } from '../data/furniture.js';
import { getSeats } from '../seating.js';
import ImageEditor from './ImageEditor.jsx';
import ConfigEditor from './ConfigEditor.jsx';
import DartsPanel from './DartsPanel.jsx';
import { GuestBookPanel, DrawingPanel } from './GuestPanels.jsx';
import PlayerAvatar from '../PlayerAvatar.jsx';
import { initialImageURL } from './assets.js';
import { Canvas } from '@react-three/fiber';

const BUTTONS = {
  feed: 'Dar comida',
  toggle: 'Encender / apagar',
  greet: 'Llamar a la puerta',
  surprise: 'Pulsar (¡bajo tu responsabilidad!)',
  open: 'Abrir caja',
  squeak: '¡Cuac!',
  wave: 'Saludar',
  water: 'Regar',
  toast: 'Hacer tostada',
  straighten: 'Enderezar',
  step: 'Saludar al monstruo',
};

export default function ObjectPanel({
  item,
  roomId,
  owner,
  mode,
  saved,
  interactions,
  live,
  onClose,
  onTravel,
  audioEnabled,
  onAudioEnabled,
  volume,
  onVolume,
  ambientVolume,
  onAmbientVolume,
  motionPaused,
  onMotionPaused,
}) {
  const info = OBJECTS[item.type],
    config = { ...info.defaults, ...item.config };
  const [tab, setTab] = useState(mode === 'configure' ? 'configure' : 'use'),
    [error, setError] = useState(''),
    [result, setResult] = useState(null),
    [enlarged, setEnlarged] = useState(false),
    [trackIndex, setTrackIndex] = useState(item.state?.radio?.index ?? 0),
    [photoIndex, setPhotoIndex] = useState(item.state?.photoIndex ?? 0),
    [destination, setDestination] = useState(null);
  const actions = info.actions;
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const enlargedRef = useRef(enlarged);
  enlargedRef.current = enlarged;
  const [, refreshPhoto] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector('button')?.focus();
    function keyboard(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (enlargedRef.current) setEnlarged(false);
        else closeRef.current();
      }
      if (event.key === 'Tab') {
        const focusable = [
          ...panelRef.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary',
          ),
        ];
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    setPhotoIndex(item.state?.photoIndex ?? 0);
  }, [item.state?.photoIndex]);
  useEffect(() => {
    if (item.type !== 'photoFrame' || !config.slideshow) return;
    const timer = setInterval(() => refreshPhoto((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [item.type, config.slideshow]);
  async function action(name, data = {}) {
    setError('');
    try {
      const response = await interactions.action(item, name, data);
      setResult(response);
      return response;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }
  async function save(next) {
    setError('');
    await interactions.configure(item, next);
  }
  const shownIndex =
    item.type === 'photoFrame' && config.slideshow
      ? (item.state?.photoIndex ?? 0) +
        Math.floor((Date.now() / 1000 - (item.state?.photoAt ?? 0)) / config.interval)
      : photoIndex;
  const selectedImage =
    config.images?.[shownIndex % Math.max(1, config.images?.length ?? 0)] ??
    initialImageURL(item.type);
  return (
    <div className="object-modal-backdrop" onClick={onClose}>
      <section
        className="object-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={info.label}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">SOCIAL ROOMS · {owner ? 'TU OBJETO' : 'VISITANDO'}</p>
            <h2>{info.label}</h2>
          </div>
          <button className="button quiet" onClick={onClose} aria-label="Cerrar panel">
            ×
          </button>
        </header>
        <nav className="object-tabs">
          <button
            className={`button ${tab === 'use' ? 'primary' : 'secondary'}`}
            onClick={() => setTab('use')}
          >
            Interactuar
          </button>
          {owner && Object.keys(info.defaults).length > 0 && (
            <button
              className={`button ${tab === 'configure' ? 'primary' : 'secondary'}`}
              onClick={() => setTab('configure')}
            >
              Configurar
            </button>
          )}
        </nav>
        {!saved && (
          <p role="status">
            Guarda primero el diseño con «Save Room» para usar o configurar este objeto.
          </p>
        )}
        {tab === 'configure' && owner ? (
          <>
            {['poster', 'photoFrame', 'crookedPicture'].includes(item.type) ? (
              <ImageEditor
                roomId={roomId}
                item={item}
                config={config}
                onSave={save}
                disabled={!saved}
              />
            ) : (
              <ConfigEditor
                item={item}
                roomId={roomId}
                config={config}
                onSave={save}
                disabled={!saved}
              />
            )}
          </>
        ) : (
          <fieldset disabled={!saved || interactions.pending} className="object-use">
            {item.type === 'dartRack' && (
              <>
                <DartsPanel action={action} />
                <p>Los accesorios colgados se eligen en «Configurar».</p>
              </>
            )}
            {item.type === 'retroRadio' && (
              <section className="object-section">
                <p>
                  {config.tracks[item.state?.radio?.index ?? 0]?.title ??
                    'Todavía no hay audio configurado.'}{' '}
                  · {item.state?.radio?.playing ? 'Reproduciendo' : 'En pausa'}
                </p>
                <label>
                  Pista
                  <select value={trackIndex} onChange={(e) => setTrackIndex(+e.target.value)}>
                    {config.tracks.map((track, i) => (
                      <option key={track.url} value={i}>
                        {track.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="object-actions">
                  <button
                    className="button primary"
                    onClick={() =>
                      action('play', {
                        index: trackIndex,
                        position:
                          trackIndex === (item.state?.radio?.index ?? 0) &&
                          !(
                            item.state?.radio?.duration &&
                            item.state.radio.position >= item.state.radio.duration
                          )
                            ? undefined
                            : 0,
                      })
                    }
                  >
                    Reproducir
                  </button>
                  <button className="button secondary" onClick={() => action('pause')}>
                    Pausar
                  </button>
                </div>
                <p>
                  La pista y su posición son compartidas. Tu volumen y permiso de sonido son
                  personales.
                </p>
              </section>
            )}
            {['poster', 'photoFrame', 'crookedPicture'].includes(item.type) && (
              <section className="object-section">
                {selectedImage ? (
                  <button className="photo-view" onClick={() => setEnlarged(true)}>
                    <img src={selectedImage} alt="Imagen del objeto · tocar para ampliar" />
                  </button>
                ) : (
                  <p>
                    El objeto muestra su imagen inicial. El propietario puede subir una foto propia.
                  </p>
                )}
                {item.type === 'photoFrame' && (
                  <div className="object-actions">
                    <button
                      className="button secondary"
                      onClick={async () => {
                        const r = await action('next', { direction: -1 });
                        if (r) setPhotoIndex(r.item.state.photoIndex);
                      }}
                    >
                      ← Foto
                    </button>
                    <button
                      className="button secondary"
                      onClick={async () => {
                        const r = await action('next', { direction: 1 });
                        if (r) setPhotoIndex(r.item.state.photoIndex);
                      }}
                    >
                      Foto →
                    </button>
                  </div>
                )}
              </section>
            )}
            {item.type === 'visitorBoard' && (
              <DrawingPanel item={item} roomId={roomId} owner={owner} action={action} />
            )}
            {item.type === 'guestBook' && (
              <GuestBookPanel item={item} owner={owner} action={action} />
            )}
            {item.type === 'snackMachine' && (
              <section className="object-section">
                <div className="object-actions">
                  {[
                    ['chips', 'Patatas'],
                    ['juice', 'Zumo'],
                    ['cookie', 'Galleta'],
                  ].map(([snack, label]) => (
                    <button
                      key={snack}
                      className="button secondary"
                      onClick={() => action('snack', { snack })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p>Tu snack aparece en la mano durante 30 segundos.</p>
                <button className="button primary" onClick={() => action('consume')}>
                  Consumir
                </button>
              </section>
            )}
            {item.type === 'aquarium' && (
              <p>
                {config.fishNames.join(' · ')} · Toca un pez en el acuario para ver su nombre. La
                comida tiene una espera de 8 segundos.
              </p>
            )}
            {['handChair', 'plasticThrone'].includes(item.type) && (
              <section className="object-section">
                <p>Una persona por asiento. Pose: {config.pose}.</p>
                <button
                  className="button primary"
                  disabled={live.seatPending}
                  onClick={() => {
                    if (live.posture?.seated) live.stand();
                    else live.sit(getSeats([item])[0]);
                  }}
                >
                  {live.posture?.seated ? 'Levantarse' : 'Sentarse'}
                </button>
                {live.seatError && <p role="alert">{live.seatError}</p>}
              </section>
            )}
            {item.type === 'magicMirror' && (
              <section className="object-section">
                <div className="avatar-preview">
                  <Canvas camera={{ position: [0, 0.9, 3], fov: 40 }} dpr={1}>
                    <ambientLight intensity={1.4} />
                    <directionalLight position={[2, 4, 2]} intensity={1} />
                    <group position={[0, -0.7, 0]}>
                      <PlayerAvatar
                        cosmetic={live.posture?.cosmetic}
                        cosmeticExpires={live.posture?.cosmeticExpires}
                      />
                    </group>
                  </Canvas>
                </div>
                <p>Espejo ligero: representa tu avatar sin renderizar otra habitación.</p>
                <div className="object-actions">
                  {[
                    ['hat', 'Sombrero'],
                    ['glasses', 'Gafas'],
                    ['color', 'Otro color'],
                  ].map(([effect, label]) => (
                    <button
                      key={effect}
                      className="button secondary"
                      onClick={() => action('mirror', { effect })}
                    >
                      {label}
                    </button>
                  ))}
                  <button className="button quiet" onClick={() => action('removeEffect')}>
                    Quitar efecto
                  </button>
                </div>
                <small>Desaparece al salir de la habitación o después de dos minutos.</small>
              </section>
            )}
            {item.type === 'sceneWindow' && (
              <p>
                Paisaje:{' '}
                {
                  {
                    space: 'Espacio',
                    rain: 'Ciudad lluviosa',
                    beach: 'Playa',
                    sea: 'Fondo del mar',
                  }[config.scene]
                }
                .
              </p>
            )}
            {item.type === 'friendPortal' && (
              <section className="object-section">
                <button
                  className="button primary"
                  onClick={async () => {
                    const r = await action('visit');
                    if (r) setDestination(r.destination);
                  }}
                >
                  Comprobar destino
                </button>
                {destination && (
                  <>
                    <p>{destination.name}</p>
                    <button className="button primary" onClick={() => onTravel(destination.id)}>
                      Visitar {destination.name}
                    </button>
                  </>
                )}
              </section>
            )}
            {item.type === 'memoryCabinet' && (
              <section className="object-section">
                {config.slots.length ? (
                  config.slots.filter(Boolean).map((type, i) => (
                    <details key={`${type}-${i}`}>
                      <summary>{FURNITURE_CATALOG[type].label}</summary>
                      <p>{FURNITURE_CATALOG[type].description}</p>
                      <small>Procedencia: colección gratuita de Social Rooms</small>
                    </details>
                  ))
                ) : (
                  <p>El propietario puede elegir hasta tres recuerdos de su colección.</p>
                )}
              </section>
            )}
            <div className="object-actions">
              {actions
                .filter((name) => name in BUTTONS)
                .map((name) => (
                  <button key={name} className="button primary" onClick={() => action(name)}>
                    {name === 'toggle'
                      ? item.state?.active
                        ? 'Desactivar'
                        : 'Activar'
                      : BUTTONS[name]}
                  </button>
                ))}
            </div>
            {item.type === 'tinyDoor' && result && (
              <p>
                {
                  ['¡Hola, vecino!', '¿Trajiste galletas?', 'Shhh… estoy de siesta.'][
                    result.item.state.effect?.variant % 3
                  ]
                }
              </p>
            )}
            {item.type === 'mysteryBox' && (
              <p>Una sorpresa temporal; no concede objetos ni recompensas.</p>
            )}
          </fieldset>
        )}
        {['retroRadio', 'sceneWindow', 'giantDuck'].includes(item.type) && (
          <section className="object-section">
            <button className="button secondary" onClick={() => onAudioEnabled(!audioEnabled)}>
              {audioEnabled ? 'Desactivar sonido' : 'Activar sonido'}
            </button>
            <label>
              Tu volumen
              <input
                type="range"
                min="0"
                max="1"
                step=".01"
                value={volume}
                onChange={(e) => onVolume(+e.target.value)}
              />
            </label>
            {item.type === 'sceneWindow' && (
              <label>
                Volumen ambiental
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={ambientVolume}
                  onChange={(e) => onAmbientVolume(+e.target.value)}
                />
              </label>
            )}
          </section>
        )}
        <button className="button quiet" onClick={() => onMotionPaused(!motionPaused)}>
          {motionPaused ? 'Reanudar reacciones visuales' : 'Pausar reacciones visuales'}
        </button>
        {error && (
          <p className="object-error" role="alert">
            {error}
          </p>
        )}
        {enlarged && selectedImage && (
          <div className="enlarged-photo" role="dialog" aria-label="Imagen ampliada">
            <button className="button secondary" onClick={() => setEnlarged(false)}>
              Cerrar imagen
            </button>
            <img src={selectedImage} alt="Imagen ampliada" />
          </div>
        )}
      </section>
    </div>
  );
}
