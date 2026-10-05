import { useEffect, useRef, useState } from 'react';
import ScreenSharing from './ScreenSharing.js';

export default function useScreenSharing(socketRef, isCentral) {
  const engine = useRef(null);
  const [state, setState] = useState({ share: null, preview: null, sharing: false, busy: false, viewing: false, stream: null, error: '' });
  useEffect(() => {
    let active = true;
    const screen = new ScreenSharing(socketRef.current, isCentral, next => { if (active) setState(next); });
    engine.current = screen;
    return () => {
      active = false;
      screen.dispose();
      engine.current = null;
    };
  }, [socketRef, isCentral]);
  return { ...state, start: () => engine.current?.start(), stop: () => engine.current?.stop(),
    view: () => engine.current?.view(), closeView: () => engine.current?.closeView() };
}
