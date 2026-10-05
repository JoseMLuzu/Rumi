import { FURNITURE_CATALOG, STARTER_LAYOUT } from './data/furniture.js';

export const ROOM_SIZE = 10;
export const WALL_THICKNESS = 0.2;
export const ROOM_EDGE = ROOM_SIZE / 2 - WALL_THICKNESS / 2;
export const PLAYER_RADIUS = 0.35;
export const STORAGE_KEY = 'social-rooms:layout:v1';
const GRID_STEP = 0.5;
const QUARTER_TURN = Math.PI / 2;

export function normalizeRotation(rotation) {
  const turns = Math.round(rotation / QUARTER_TURN);
  return (((turns % 4) + 4) % 4) * QUARTER_TURN;
}

export function getFootprint(item) {
  const entry = FURNITURE_CATALOG[item.type];
  const width = entry.width * (item.scale ?? 1);
  const depth = entry.depth * (item.scale ?? 1);
  // Quarter turns let rectangular footprints stay axis-aligned.
  const sideways = Math.round(item.rotation / QUARTER_TURN) % 2 !== 0;
  return sideways ? { width: depth, depth: width } : { width, depth };
}

export function getBounds(item) {
  const { width, depth } = getFootprint(item);
  return {
    minX: item.position[0] - width / 2,
    maxX: item.position[0] + width / 2,
    minZ: item.position[2] - depth / 2,
    maxZ: item.position[2] + depth / 2,
  };
}

export function clampPlacement(item, position) {
  const { width, depth } = getFootprint(item);
  const limitX = ROOM_EDGE - width / 2;
  const limitZ = ROOM_EDGE - depth / 2;
  const snap = (value) => Math.round(value / GRID_STEP) * GRID_STEP;
  return [
    Math.max(-limitX, Math.min(limitX, snap(position[0]))),
    0,
    Math.max(-limitZ, Math.min(limitZ, snap(position[2]))),
  ];
}

function circleTouchesBounds(x, z, bounds) {
  const nearestX = Math.max(bounds.minX, Math.min(bounds.maxX, x));
  const nearestZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 < PLAYER_RADIUS ** 2;
}

export function canWalkTo(x, z, items, walkAreas) {
  const limit = ROOM_EDGE - PLAYER_RADIUS;
  // The hall's overlapping rectangles join the lobby to its corridor wings.
  const onFloor = walkAreas
    ? walkAreas.some(
        (area) =>
          x >= area.minX + PLAYER_RADIUS &&
          x <= area.maxX - PLAYER_RADIUS &&
          z >= area.minZ + PLAYER_RADIUS &&
          z <= area.maxZ - PLAYER_RADIUS,
      )
    : Math.abs(x) <= limit && Math.abs(z) <= limit;
  if (!onFloor) return false;
  return !items.some(
    (item) =>
      FURNITURE_CATALOG[item.type].blocking !== false && circleTouchesBounds(x, z, getBounds(item)),
  );
}

export function getPlacementError(candidate, items, playerPosition, isCentral = false) {
  const bounds = getBounds(candidate);
  if (
    bounds.minX < -ROOM_EDGE ||
    bounds.maxX > ROOM_EDGE ||
    bounds.minZ < -ROOM_EDGE ||
    bounds.maxZ > ROOM_EDGE
  ) {
    return 'Keep the whole piece inside the room.';
  }

  if (
    isCentral &&
    bounds.minZ < 1.15 &&
    bounds.maxZ > -1.15 &&
    (bounds.minX < -4.5 || bounds.maxX > 4.5)
  ) {
    return 'Keep both hallway entrances clear of furniture.';
  }

  const gap = 0.05;
  const overlaps = items.some((item) => {
    if (item.id === candidate.id) return false;
    const other = getBounds(item);
    return (
      bounds.minX < other.maxX + gap &&
      bounds.maxX > other.minX - gap &&
      bounds.minZ < other.maxZ + gap &&
      bounds.maxZ > other.minZ - gap
    );
  });
  if (overlaps) return 'Leave a little space between furniture.';
  if (playerPosition && circleTouchesBounds(playerPosition.x, playerPosition.z, bounds)) {
    return 'Leave space for your character.';
  }
  return null;
}

export function findPlayerSpawn(items) {
  // Search outward from the center in case a saved piece now occupies it.
  for (let radius = 0; radius <= 4.5; radius += 0.5) {
    for (let x = -radius; x <= radius; x += 0.5) {
      for (let z = -radius; z <= radius; z += 0.5) {
        if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
        if (canWalkTo(x, z, items)) return [x, 0, z];
      }
    }
  }
  return null;
}

function starterRoom(warning = '') {
  return {
    items: STARTER_LAYOUT.map((item) => ({ ...item, position: [...item.position] })),
    warning,
  };
}

export function loadRoomLayout(storage) {
  // Legacy browser layouts remain readable for manual migration; App now loads via api.js.
  try {
    const raw = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    if (raw === null) return starterRoom();
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error('Invalid room format');

    const items = [];
    const ids = new Set();
    for (const item of saved.items) {
      // Browser storage is input too: reject malformed records before rendering.
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        ids.has(item.id) ||
        !Object.hasOwn(FURNITURE_CATALOG, item.type) ||
        !Array.isArray(item.position) ||
        item.position.length !== 3 ||
        !item.position.every(Number.isFinite) ||
        item.position[1] !== 0 ||
        !Number.isFinite(item.rotation)
      )
        continue;
      const clean = {
        id: item.id,
        type: item.type,
        position: [...item.position],
        rotation: normalizeRotation(item.rotation),
      };
      if (getPlacementError(clean, items)) continue;
      items.push(clean);
      ids.add(clean.id);
    }
    if (!findPlayerSpawn(items))
      return starterRoom('The saved room had no walking space. A starter room was opened.');
    return {
      items,
      warning: items.length === saved.items.length ? '' : 'Some invalid saved pieces were skipped.',
    };
  } catch {
    return starterRoom('Your saved room could not be loaded. A starter room was opened.');
  }
}

export function saveRoomLayout(items, storage) {
  // Retained for the old browser-format tests; the running editor saves through Flask.
  try {
    // Save records, never meshes, materials, refs, or other Three.js objects.
    (storage ?? window.localStorage).setItem(STORAGE_KEY, JSON.stringify({ version: 1, items }));
    return true;
  } catch {
    return false;
  }
}
