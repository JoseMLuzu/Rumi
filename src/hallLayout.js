import { canWalkTo, findPlayerSpawn } from './roomLayout.js';

export function validateHall(hall) {
  const finitePosition = (position) => Array.isArray(position) && position.length === 3
    && position.every(Number.isFinite) && position[1] === 0;
  const ids = new Set();
  if (!hall || !Number.isFinite(hall.halfLength) || hall.halfLength < 5
    || !['bedroomWidth', 'bedroomDepth', 'corridorWidth'].every((key) => Number.isFinite(hall[key]) && hall[key] > 0)
    || !Array.isArray(hall.walkAreas) || hall.walkAreas.length !== 2
    || hall.walkAreas.some((area) => !area ||
      !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(area[key]))
      || area.minX >= area.maxX || area.minZ >= area.maxZ)
    || !Array.isArray(hall.doors)) throw new Error('The server returned an invalid hall layout.');
  for (const door of hall.doors) {
    if (!Number.isSafeInteger(door?.roomId) || door.roomId < 2 || ids.has(door.roomId)
      || typeof door.name !== 'string' || !finitePosition(door.position) || !finitePosition(door.arrival)
      || !['West', 'East'].includes(door.wing) || !Number.isSafeInteger(door.bay) || door.bay < 1
      || ![0, Math.PI].includes(door.rotation)
      || !canWalkTo(door.arrival[0], door.arrival[2], [], hall.walkAreas)) {
      throw new Error('The server returned an invalid hall doorway.');
    }
    ids.add(door.roomId);
  }
  return hall;
}

export function findHallArrival(hall, fromRoomId) {
  const door = hall.doors.find((entry) => entry.roomId === fromRoomId);
  return door ? [...door.arrival] : [0, 0, 1];
}

export function findRoomEntry(items) {
  // Prefer the doorway, then search inward in case the owner decorated that area.
  for (let z = 3.5; z >= -4; z -= 0.5) {
    for (let offset = 0; offset <= 4; offset += 0.5) {
      for (const x of [offset, -offset]) {
        if (canWalkTo(x, z, items)) return [x, 0, z];
      }
    }
  }
  return findPlayerSpawn(items);
}
