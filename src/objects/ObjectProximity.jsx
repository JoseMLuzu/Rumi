import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OBJECTS } from '../data/furniture.js';

export default function ObjectProximity({ items, playerRef, enabled, onNear, onOpen, onStep }) {
  const nearest = useRef(null);
  const stepped = useRef(new Map());
  useFrame(() => {
    const position = playerRef.current?.position;
    let next = null,
      distance = Infinity;
    if (enabled && position)
      for (const item of items) {
        const info = OBJECTS[item.type];
        if (!info) continue;
        const d = Math.hypot(position.x - item.position[0], position.z - item.position[2]);
        if (d < 1.85 + (Math.max(info.width, info.depth) * (item.scale ?? 1)) / 2 && d < distance) {
          next = item;
          distance = d;
        }
        if (item.type === 'monsterRug') {
          const inside = d < (Math.min(info.width, info.depth) * (item.scale ?? 1)) / 2;
          if (inside && !stepped.current.get(item.id)) onStep(item);
          stepped.current.set(item.id, inside);
        }
      }
    if (next?.id !== nearest.current?.id) onNear(next?.id ?? null);
    nearest.current = next;
  });
  useEffect(() => {
    function interact(event) {
      if (
        !enabled ||
        !nearest.current ||
        event.code !== 'KeyE' ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches('input,textarea,select') || event.target.isContentEditable)
      )
        return;
      event.preventDefault();
      onOpen(nearest.current.id);
    }
    window.addEventListener('keydown', interact);
    return () => window.removeEventListener('keydown', interact);
  }, [enabled, onOpen]);
  return null;
}
