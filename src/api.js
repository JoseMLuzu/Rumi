import { FURNITURE_CATALOG } from './data/furniture.js';
import { findPlayerSpawn, getPlacementError, normalizeRotation } from './roomLayout.js';
import { validateHall } from './hallLayout.js';
import { validateAppearance } from './roomAppearance.js';

export function validateRoomResponse(room, expectedRoomId = 1) {
  if (
    !room ||
    room.id !== expectedRoomId ||
    !Number.isSafeInteger(room.id) ||
    room.id < 1 ||
    typeof room.name !== 'string' ||
    typeof room.readOnly !== 'boolean' ||
    !Array.isArray(room.items)
  ) {
    throw new Error('The server returned an invalid room. Check the Flask terminal.');
  }
  const ids = new Set();
  const items = [];
  for (const item of room.items) {
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
      !Number.isFinite(item.rotation) ||
      (item.scale !== undefined &&
        (!Number.isFinite(item.scale) || item.scale < 0.5 || item.scale > 2)) ||
      (item.config !== undefined &&
        (!item.config || typeof item.config !== 'object' || Array.isArray(item.config))) ||
      Math.abs(item.rotation - normalizeRotation(item.rotation)) > 1e-7 ||
      getPlacementError(item, items)
    ) {
      throw new Error('The saved room contains invalid furniture. Its data was left unchanged.');
    }
    items.push(item);
    ids.add(item.id);
  }
  if (!findPlayerSpawn(items)) throw new Error('The saved room has no space for the player.');
  if (room.isCentral === true || (room.isCentral === undefined && room.id === 1))
    validateHall(room.hall);
  if (room.appearance !== undefined) {
    validateAppearance(room.appearance);
    if (!Number.isSafeInteger(room.appearanceRevision) || room.appearanceRevision < 0) {
      throw new Error('The saved room style revision is invalid.');
    }
  }
  return room;
}

export async function saveRoomAppearance(roomId, appearance, revision) {
  validateAppearance(appearance);
  const result = await requestJSON(`/api/rooms/${roomId}/appearance`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appearance, revision }),
  });
  if (result?.roomId !== roomId || !Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw new Error('The server returned an invalid room style.');
  }
  validateAppearance(result.appearance);
  return result;
}

let csrfToken = null;
export const getCsrfToken = () => csrfToken;

export async function requestJSON(url, options = {}) {
  let response;
  try {
    const headers = { ...options.headers };
    if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method)) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach the room server. Check that Flask is running.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `The room server did not return JSON (HTTP ${response.status}). Check Flask and the Vite proxy.`,
    );
  }
  // fetch rejects network failures, but HTTP 400/404/503 still need this explicit check.
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-required'));
    }
    throw new Error(body?.error || `Room request failed (HTTP ${response.status}).`);
  }
  return body;
}

function requestRoom(roomId, options) {
  return requestJSON(`/api/rooms/${roomId}`, options).then((body) =>
    validateRoomResponse(body, roomId),
  );
}

function acceptSession(body) {
  if (typeof body?.csrfToken !== 'string' || body.csrfToken.length < 20) {
    throw new Error('The server returned an invalid session.');
  }
  const user = body.user;
  if (
    user !== null &&
    (((user?.personalRoomId !== null || user?.centralRoomId !== null) &&
      (!Number.isSafeInteger(user?.personalRoomId) ||
        user.personalRoomId < 2 ||
        !Number.isSafeInteger(user.centralRoomId) ||
        user.centralRoomId < 1 ||
        user.centralRoomId === user.personalRoomId)) ||
      typeof user.name !== 'string' ||
      (user.roomName !== null && typeof user.roomName !== 'string') ||
      typeof user.displayName !== 'string' ||
      typeof user.isHost !== 'boolean')
  ) {
    throw new Error('The server returned invalid account data.');
  }
  // This token is kept in memory. The HttpOnly session cookie is managed by the browser.
  csrfToken = body.csrfToken;
  return user;
}

export async function loadAuthSession(signal) {
  return acceptSession(await requestJSON('/api/auth/session', { signal, cache: 'no-store' }));
}

async function authenticate(action, payload) {
  return acceptSession(
    await requestJSON(`/api/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

export const login = (username, password) => authenticate('login', { username, password });
export const register = (username, password, activationCode) =>
  authenticate('register', { username, password, ...(activationCode ? { activationCode } : {}) });
export const logout = () => authenticate('logout', {});

export function loadRoom(roomId = 1, signal) {
  return requestRoom(roomId, { signal, cache: 'no-store' });
}

export async function loadRoomDirectory(signal, spaceId) {
  const body = await requestJSON(`/api/rooms${spaceId ? `?spaceId=${spaceId}` : ''}`, {
    signal,
    cache: 'no-store',
  });
  if (
    !Array.isArray(body?.rooms) ||
    body.rooms.some(
      (room) => !Number.isSafeInteger(room?.id) || room.id < 1 || typeof room.name !== 'string',
    )
  ) {
    throw new Error('The server returned an invalid room directory.');
  }
  return body.rooms;
}

export function validateSpace(space) {
  if (
    !space ||
    !Number.isSafeInteger(space.id) ||
    space.id < 1 ||
    typeof space.name !== 'string' ||
    !Number.isSafeInteger(space.personalRoomId) ||
    space.personalRoomId < 2 ||
    !Number.isSafeInteger(space.centralRoomId) ||
    space.centralRoomId < 1 ||
    space.personalRoomId === space.centralRoomId ||
    typeof space.roomName !== 'string' ||
    typeof space.isHost !== 'boolean' ||
    typeof space.isOwner !== 'boolean' ||
    !Number.isSafeInteger(space.memberCount) ||
    space.memberCount < 1
  ) {
    throw new Error('The server returned invalid space data.');
  }
  return space;
}

export async function loadSpaces(signal) {
  const body = await requestJSON('/api/spaces', { signal, cache: 'no-store' });
  if (!Array.isArray(body?.spaces)) throw new Error('The server returned an invalid space list.');
  const spaces = body.spaces.map(validateSpace);
  if (new Set(spaces.map((space) => space.id)).size !== spaces.length)
    throw new Error('Duplicate spaces returned by the server.');
  return spaces;
}

function spaceRequest(path, payload, method = 'POST') {
  return requestJSON(`/api/spaces${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const createSpace = (name) => spaceRequest('', { name }).then(validateSpace);
export const joinSpace = (token) => spaceRequest('/join', { token }).then(validateSpace);
export const previewSpaceInvitation = (token) => spaceRequest('/invitations/preview', { token });
export const generateSpaceInvitation = (spaceId) => spaceRequest(`/${spaceId}/invitation`, {});
export const revokeSpaceInvitation = (spaceId) =>
  spaceRequest(`/${spaceId}/invitation`, {}, 'DELETE');

export function saveRoom(roomId, items, layoutVersion) {
  // PUT saves furniture only; live player poses use Socket.IO and are not persisted.
  return requestRoom(roomId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, ...(layoutVersion ? { layoutVersion } : {}) }),
  });
}
