import { useEffect, useRef, useState } from 'react';
import ProximityVoice from './ProximityVoice.js';

export default function useProximityVoice(socketRef, latestPose) {
  const engine = useRef(null);
  const [state, setState] = useState({ enabled: false, muted: false, busy: false, connections: 0, nearby: 0, error: '' });
  useEffect(() => {
    let active = true;
    const voice = new ProximityVoice(socketRef.current, () => latestPose.current.position,
      next => { if (active) setState(next); });
    engine.current = voice;
    return () => {
      active = false;
      voice.dispose();
      engine.current = null;
    };
  }, [socketRef, latestPose]);

  return { ...state, join: () => engine.current?.join(), leave: () => engine.current?.leave(),
    toggleMute: () => engine.current?.toggleMute() };
}
