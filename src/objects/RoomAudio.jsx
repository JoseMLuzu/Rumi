import { useEffect, useRef } from 'react';

function SharedTrack({ item, enabled, volume, onError, onEnded }) {
  const ref = useRef(null);
  const finished = useRef(false);
  const radio = item.state?.radio;
  const track = item.config?.tracks?.[radio?.index ?? 0];
  useEffect(() => {
    if (!enabled || !track) return;
    const audio = new Audio(track.url);
    ref.current = audio;
    audio.preload = 'metadata';
    audio.onended = () => {
      if (!finished.current) {
        finished.current = true;
        onEnded(item, !!radio?.duration);
      }
    };
    audio.onerror = () => onError('No se pudo reproducir la pista. Comprueba el archivo de audio.');
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      ref.current = null;
    };
  }, [track?.url, enabled]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !radio) return;
    const sync = () => {
      const position =
        radio.position + (radio.playing ? Math.max(0, Date.now() / 1000 - radio.updatedAt) : 0);
      if (Number.isFinite(audio.duration)) {
        const target = Math.min(audio.duration, position);
        // Correct noticeable drift instead of seeking on every render/audio sample.
        if (Math.abs(audio.currentTime - target) > 0.7) audio.currentTime = target;
        if (position >= audio.duration) {
          audio.pause();
          if (!finished.current && radio.playing) {
            finished.current = true;
            onEnded(item, !!radio?.duration);
          }
          return;
        }
      }
      if (radio.playing)
        audio
          .play()
          .catch(() => onError('Pulsa «Activar sonido» de nuevo para permitir la reproducción.'));
      else audio.pause();
    };
    finished.current = false;
    sync();
    audio.addEventListener('loadedmetadata', sync);
    const timer = setInterval(sync, 2000);
    return () => {
      clearInterval(timer);
      audio.removeEventListener('loadedmetadata', sync);
    };
  }, [radio, track?.url, enabled]);
  useEffect(() => {
    if (!radio?.playing || !radio.duration) return;
    const remaining =
      (radio.duration - radio.position - Math.max(0, Date.now() / 1000 - radio.updatedAt)) * 1000;
    // End state is shared even when this listener has chosen to keep audio muted.
    const timer = setTimeout(() => onEnded(item, true), Math.max(0, remaining) + 100);
    return () => clearTimeout(timer);
  }, [radio]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume, track?.url, enabled]);
  return null;
}

function AmbientTrack({ scene, enabled, volume }) {
  useEffect(() => {
    if (!enabled) return;
    const context = new AudioContext();
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      smooth = (smooth + Math.random() * 0.04 - 0.02) * 0.985;
      samples[i] =
        scene === 'space' ? Math.sin((i / context.sampleRate) * 110 * Math.PI * 2) * 0.03 : smooth;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = scene === 'rain' ? 1800 : scene === 'beach' ? 700 : 250;
    const gain = context.createGain();
    gain.gain.value = volume * 0.5;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    context.resume();
    return () => {
      source.stop();
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      context.close();
    };
  }, [scene, enabled, volume]);
  return null;
}

export function playQuack(enabled, volume) {
  if (!enabled) return;
  const context = new AudioContext(),
    osc = context.createOscillator(),
    gain = context.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(280, context.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, context.currentTime + 0.14);
  gain.gain.setValueAtTime(volume * 0.09, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
  osc.connect(gain).connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.2);
  osc.onended = () => context.close();
  return () => {
    osc.onended = null;
    try {
      osc.stop();
    } catch {}
    if (context.state !== 'closed') context.close();
  };
}

export default function RoomAudio({ items, enabled, volumes, ambientVolume, onError, onEnded }) {
  const heard = useRef(new Set());
  const sounds = useRef([]);
  useEffect(() => {
    if (!enabled) {
      sounds.current.forEach((stop) => stop());
      sounds.current = [];
      return;
    }
    for (const item of items) {
      const effect = item.state?.effect;
      const key = `${item.id}:${effect?.at}`;
      if (
        item.type === 'giantDuck' &&
        effect?.action === 'squeak' &&
        effect.expires > Date.now() / 1000 &&
        !heard.current.has(key)
      ) {
        heard.current.add(key);
        if (heard.current.size > 256) heard.current.delete(heard.current.values().next().value);
        sounds.current.forEach((stop) => stop());
        sounds.current = [playQuack(true, volumes[item.id] ?? 0.35)];
      }
    }
  }, [items, enabled, volumes]);
  useEffect(() => () => sounds.current.forEach((stop) => stop()), []);
  const radios = items
    .filter((item) => item.type === 'retroRadio' && item.state?.radio?.playing)
    .slice(0, 4);
  const window = items.find((item) => item.type === 'sceneWindow' && item.config?.ambient);
  return (
    <>
      {radios.map((item) => (
        <SharedTrack
          key={item.id}
          item={item}
          enabled={enabled}
          volume={volumes[item.id] ?? 0.35}
          onError={onError}
          onEnded={onEnded}
        />
      ))}
      {window && (
        <AmbientTrack scene={window.config.scene} enabled={enabled} volume={ambientVolume} />
      )}
    </>
  );
}
