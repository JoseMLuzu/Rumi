import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { getSeats, nearestSeat } from './seating.js';

export default function SeatControls({ items, playerRef, peers, posture, onSit, onStand, enabled, connected, pending, error }) {
  const seats = useMemo(() => getSeats(items), [items]);
  const occupied = new Set(peers.filter((peer) => peer.seated).map((peer) => peer.seatId));
  const [nearId, setNearId] = useState(null);
  const nearby = seats.find((seat) => seat.id === nearId);
  const seated = !!posture?.seated;

  useFrame(() => {
    const position = playerRef.current?.position;
    const next = enabled && !seated && position ? nearestSeat(seats, position, occupied)?.id ?? null : null;
    // React renders only when the nearest available seat changes, not every frame.
    if (next !== nearId) setNearId(next);
  });

  useEffect(() => {
    if (!enabled || !connected || pending) return;
    function interact(event) {
      if (event.code !== 'KeyF' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return;
      if (!seated && !nearby) return;
      event.preventDefault();
      if (seated) onStand(); else onSit(nearby);
    }
    window.addEventListener('keydown', interact);
    return () => window.removeEventListener('keydown', interact);
  }, [enabled, connected, pending, seated, nearby, onSit, onStand]);

  useEffect(() => {
    if (!seated || !connected || pending) return;
    const seat = seats.find((candidate) => candidate.id === posture.seatId);
    if (!seat || Math.abs(seat.seatHeight - posture.seatHeight) > 0.01 || Math.abs(Math.atan2(Math.sin(seat.rotation - posture.rotation), Math.cos(seat.rotation - posture.rotation))) > 0.01 ||
        Math.hypot(seat.position[0] - posture.position[0], seat.position[2] - posture.position[2]) > 0.01) onStand();
  }, [seats, seated, posture, connected, pending, onStand]);

  if (!enabled || (!seated && !nearby && !error)) return null;
  // Fullscreen HTML keeps the action accessible while its 3D proximity drives visibility.
  return <Html fullscreen calculatePosition={(_object, _camera, size) => [size.width / 2, size.height / 2]}
    style={{ pointerEvents: 'none' }} zIndexRange={[25, 20]}>
    <div className="seat-controls">
      {(seated || nearby) && <button className="button secondary seat-action" disabled={!connected || pending}
        onClick={() => seated ? onStand() : onSit(nearby)}>
        <kbd>F</kbd> {pending ? 'One moment…' : seated ? 'Stand up' : `Sit on ${nearby.label}`}
      </button>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Html>;
}
