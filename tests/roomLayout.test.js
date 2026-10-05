import assert from 'node:assert/strict';
import test from 'node:test';
import { FURNITURE_CATALOG, STARTER_LAYOUT } from '../src/data/furniture.js';
import {
  STORAGE_KEY, ROOM_EDGE, PLAYER_RADIUS, canWalkTo, clampPlacement,
  findPlayerSpawn, getBounds, getFootprint, getPlacementError,
  loadRoomLayout, normalizeRotation, saveRoomLayout,
} from '../src/roomLayout.js';

const piece = (type = 'table', position = [0, 0, 0], rotation = 0) => ({ id: 'test-piece', type, position, rotation });
const fakeStorage = (raw = null) => ({
  raw,
  getItem(key) { assert.equal(key, STORAGE_KEY); return this.raw; },
  setItem(key, value) { assert.equal(key, STORAGE_KEY); this.raw = value; },
});

test('starter furniture fits, does not overlap, and leaves a clear spawn', () => {
  for (const item of STARTER_LAYOUT) assert.equal(getPlacementError(item, STARTER_LAYOUT), null);
  const spawn = findPlayerSpawn(STARTER_LAYOUT);
  assert(spawn);
  assert(canWalkTo(spawn[0], spawn[2], STARTER_LAYOUT));
});

test('quarter turns swap footprints and wrap after a full turn', () => {
  assert.deepEqual(getFootprint(piece('bed', [0, 0, 0], Math.PI / 2)), { width: 3.2, depth: 2.2 });
  assert.equal(normalizeRotation(2 * Math.PI), 0);
  assert.equal(normalizeRotation(-Math.PI / 2), 3 * Math.PI / 2);
});

test('every type stays inside all edges in all four orientations', () => {
  for (const type of Object.keys(FURNITURE_CATALOG)) {
    for (let turn = 0; turn < 4; turn++) {
      for (const x of [-100, 100]) for (const z of [-100, 100]) {
        const item = piece(type, [0, 0, 0], turn * Math.PI / 2);
        item.position = clampPlacement(item, [x, 0, z]);
        const bounds = getBounds(item);
        assert(bounds.minX >= -ROOM_EDGE - 1e-9 && bounds.maxX <= ROOM_EDGE + 1e-9);
        assert(bounds.minZ >= -ROOM_EDGE - 1e-9 && bounds.maxZ <= ROOM_EDGE + 1e-9);
      }
    }
  }
});

test('placement snaps to half units away from walls', () => {
  assert.deepEqual(clampPlacement(piece(), [0.72, 10, -1.27]), [0.5, 0, -1.5]);
});

test('placement rejects overlap, wall overhang, and occupying the player', () => {
  const existing = { ...piece(), id: 'existing' };
  assert.match(getPlacementError(piece('chair'), [existing]), /between furniture/);
  assert.match(getPlacementError(piece('bed', [4, 0, 0]), []), /inside the room/);
  assert.match(getPlacementError(piece('chair'), [], { x: 0, z: 0 }), /character/);
});

test('moving a piece excludes its old footprint', () => {
  const item = piece('chair', [2, 0, 2]);
  assert.equal(getPlacementError({ ...item, position: [2.5, 0, 2] }, [item]), null);
});

test('walking checks the player radius at walls and furniture edges', () => {
  const limit = ROOM_EDGE - PLAYER_RADIUS;
  assert(canWalkTo(limit - 0.001, 0, []));
  assert(!canWalkTo(limit + 0.001, 0, []));
  const table = piece();
  assert(!canWalkTo(0, 0, [table]));
  assert(!canWalkTo(1.2, 0, [table]));
  assert(canWalkTo(1.3, 0, [table]));
});

test('a piece at the origin produces another clear player spawn', () => {
  const items = [piece()];
  const spawn = findPlayerSpawn(items);
  assert(spawn);
  assert(canWalkTo(spawn[0], spawn[2], items));
  assert(Math.hypot(spawn[0], spawn[2]) > 0);
});

test('added, moved, rotated, and deleted pieces survive save/load', () => {
  const storage = fakeStorage();
  let items = [piece('chair', [2, 0, 2])];
  assert(saveRoomLayout(items, storage));
  assert.deepEqual(loadRoomLayout(storage).items, items);
  items = [{ ...items[0], position: [-2, 0, 2], rotation: Math.PI / 2 }];
  assert(saveRoomLayout(items, storage));
  assert.deepEqual(loadRoomLayout(storage).items, items);
  assert(saveRoomLayout([], storage));
  assert.deepEqual(loadRoomLayout(storage).items, []);
});

test('malformed JSON, unknown versions, and blocked storage recover visibly', () => {
  for (const raw of ['broken json', 'null', JSON.stringify({ version: 50, items: [] })]) {
    const room = loadRoomLayout(fakeStorage(raw));
    assert(room.warning);
    assert.equal(room.items.length, STARTER_LAYOUT.length);
  }
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  assert(loadRoomLayout(unavailable).warning);
  assert.equal(saveRoomLayout([], unavailable), false);
});

test('invalid records and duplicate IDs are skipped without losing valid pieces', () => {
  const valid = piece('plant', [2, 0, 2]);
  const bad = [null, { ...valid }, { ...valid, id: 'unknown', type: 'spaceship' },
    { ...valid, id: 'nan', position: [null, 0, 0] },
    { ...valid, id: 'outside', position: [200, 0, 0] },
    { ...valid, id: 'overlap' }, { ...valid, id: 'height', position: [0, 2, 0] }];
  const room = loadRoomLayout(fakeStorage(JSON.stringify({ version: 1, items: [valid, ...bad] })));
  assert.deepEqual(room.items, [valid]);
  assert(room.warning);
});

test('fresh rooms do not share mutable starter arrays', () => {
  const first = loadRoomLayout(fakeStorage());
  const second = loadRoomLayout(fakeStorage());
  assert.equal(first.warning, '');
  first.items[0].position[0] = 100;
  assert.equal(second.items[0].position[0], STARTER_LAYOUT[0].position[0]);
});
