import { FURNITURE_CATALOG, OBJECTS } from './data/furniture.js';
// Local seat offsets match the chair/sofa cushions in Furniture.jsx and backend/seating.py.
export function getSeats(items) {
  return items.flatMap((item) => {
    const offsets =
      item.type === 'chaiseLongue'
        ? // Sit near the front edge so the existing avatar's legs clear the cushion.
          [[0, 0.16]]
        : ['chair', 'handChair', 'plasticThrone'].includes(item.type)
          ? [[0, 0.04]]
          : item.type === 'sofa'
            ? [
                [-0.55, 0.1],
                [0.55, 0.1],
              ]
            : [];
    return offsets.map(([x, z], slot) => ({
      id: `${item.id}:${slot}`,
      itemId: item.id,
      slot,
      label: FURNITURE_CATALOG[item.type]?.label ?? item.type,
      position: [
        item.position[0] +
          (item.scale ?? 1) * x * Math.cos(item.rotation) +
          (item.scale ?? 1) * z * Math.sin(item.rotation),
        0,
        item.position[2] -
          (item.scale ?? 1) * x * Math.sin(item.rotation) +
          (item.scale ?? 1) * z * Math.cos(item.rotation),
      ],
      rotation: Math.atan2(Math.sin(item.rotation), Math.cos(item.rotation)),
      seatHeight:
        (item.type === 'chair'
          ? 0.69
          : item.type === 'sofa'
            ? 0.72
            : item.type === 'chaiseLongue'
              ? 0.42
              : OBJECTS[item.type].seatHeight) * (item.scale ?? 1),
    }));
  });
}

export function nearestSeat(seats, position, occupied) {
  let nearest = null;
  let distance = 1.8;
  for (const seat of seats) {
    if (occupied.has(seat.id)) continue;
    const next = Math.hypot(seat.position[0] - position.x, seat.position[2] - position.z);
    if (next <= distance) {
      nearest = seat;
      distance = next;
    }
  }
  return nearest;
}
