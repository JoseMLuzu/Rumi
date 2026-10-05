import { useEffect } from 'react';

// Touch and keyboard feed the same movement calculation; this does not dispatch fake key events.
export default function TouchMovement({ inputRef, enabled }) {
  useEffect(() => {
    const clear = () => {
      inputRef.current = {};
    };
    clear();
    window.addEventListener('blur', clear);
    return () => {
      clear();
      window.removeEventListener('blur', clear);
    };
  }, [enabled, inputRef]);
  if (!enabled) return null;
  return (
    <nav className="touch-movement" aria-label="Mover avatar">
      {[
        ['KeyW', '↑', 'Adelante'],
        ['KeyA', '←', 'Izquierda'],
        ['KeyS', '↓', 'Atrás'],
        ['KeyD', '→', 'Derecha'],
      ].map(([code, icon, label]) => (
        <button
          key={code}
          aria-label={label}
          className={`touch-${code}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            inputRef.current[code] = true;
          }}
          onPointerUp={() => {
            inputRef.current[code] = false;
          }}
          onPointerCancel={() => {
            inputRef.current[code] = false;
          }}
          onLostPointerCapture={() => {
            inputRef.current[code] = false;
          }}
        >
          {icon}
        </button>
      ))}
    </nav>
  );
}
