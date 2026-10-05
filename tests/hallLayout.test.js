import assert from 'node:assert/strict';
import test from 'node:test';
import { canWalkTo } from '../src/roomLayout.js';
import { findHallArrival, findRoomEntry, validateHall } from '../src/hallLayout.js';

const hall = {
  halfLength: 11.4, bedroomWidth: 6.4, bedroomDepth: 7, corridorWidth: 3.2,
  walkAreas: [
    { minX: -4.9, maxX: 4.9, minZ: -4.9, maxZ: 4.9 },
    { minX: -11.4, maxX: 11.4, minZ: -1.5, maxZ: 1.5 },
  ],
  doors: [
    { roomId: 2, name: 'Jose’s bedroom', wing: 'West', bay: 1, position: [-8.2, 0, -1.5], arrival: [-8.2, 0, -0.6], rotation: 0 },
    { roomId: 3, name: 'Ana’s bedroom', wing: 'East', bay: 1, position: [8.2, 0, -1.5], arrival: [8.2, 0, -0.6], rotation: 0 },
  ],
};

test('the lobby and corridor form a continuous walkable floor with bounded sides', () => {
  for (let x = -11; x <= 11; x += 0.1) assert.equal(canWalkTo(x, 0, [], hall.walkAreas), true);
  assert.equal(canWalkTo(0, 4, [], hall.walkAreas), true);
  assert.equal(canWalkTo(10, 1.1, [], hall.walkAreas), true);
  assert.equal(canWalkTo(10, 1.2, [], hall.walkAreas), false);
  assert.equal(canWalkTo(16, 0, [], hall.walkAreas), false);
  assert.equal(canWalkTo(10, 5, [], hall.walkAreas), false);
  assert.equal(canWalkTo(10, 0, []), false); // Personal rooms retain their original limits.
  const table = { id: 'test', type: 'table', position: [10, 0, 0], rotation: 0 };
  assert.equal(canWalkTo(10, 0, [table], hall.walkAreas), false);
});

test('leaving a personal room arrives at that room’s hall door with a fresh position', () => {
  const arrival = findHallArrival(hall, 3);
  assert.deepEqual(arrival, [8.2, 0, -0.6]);
  assert.equal(canWalkTo(arrival[0], arrival[2], [], hall.walkAreas), true);
  arrival[0] = 0;
  assert.equal(hall.doors[1].arrival[0], 8.2);
  assert.deepEqual(findHallArrival(hall, 999), [0, 0, 1]);
});

test('entering a furnished room prefers the doorway and avoids blocked arrival space', () => {
  assert.deepEqual(findRoomEntry([]), [0, 0, 3.5]);
  const sofa = { id: 'sofa', type: 'sofa', position: [0, 0, 3.5], rotation: 0 };
  const entry = findRoomEntry([sofa]);
  assert.notDeepEqual(entry, [0, 0, 3.5]);
  assert.equal(canWalkTo(entry[0], entry[2], [sofa]), true);
});

test('hall response validation rejects invalid geometry, duplicate doors, and unsafe arrivals', () => {
  assert.equal(validateHall(hall), hall);
  for (const invalid of [null, { ...hall, halfLength: Infinity },
    { ...hall, walkAreas: [{ minX: 0, maxX: -1, minZ: 0, maxZ: 1 }] },
    { ...hall, doors: [hall.doors[0], hall.doors[0]] },
    { ...hall, doors: [{ ...hall.doors[0], arrival: [100, 0, 0] }] },
    { ...hall, doors: [{ ...hall.doors[0], roomId: 1 }] }]) assert.throws(() => validateHall(invalid));
});
