import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAuthSession,
  login,
  register,
  logout,
  getCsrfToken,
  requestJSON,
  loadRoom,
  loadRoomDirectory,
  saveRoom,
  validateRoomResponse,
} from '../src/api.js';
import { STARTER_LAYOUT } from '../src/data/furniture.js';

const hall = {
  halfLength: 5,
  bedroomWidth: 6.4,
  bedroomDepth: 7,
  corridorWidth: 3.2,
  doors: [],
  walkAreas: [
    { minX: -4.9, maxX: 4.9, minZ: -4.9, maxZ: 4.9 },
    { minX: -5, maxX: 5, minZ: -1.9, maxZ: 1.9 },
  ],
};
const room = (items = STARTER_LAYOUT) => ({
  id: 1,
  name: 'Central room',
  readOnly: true,
  items,
  hall,
});

test('GET uses the room endpoint and an abort signal', async (t) => {
  const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/rooms/1');
    assert.equal(options.signal, signal);
    assert.equal(options.cache, 'no-store');
    return Response.json(room());
  });
  assert.deepEqual(await loadRoom(1, signal), room());
});

test('PUT sends plain committed records and accepts an empty room', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/rooms/1');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { items: [] });
    return Response.json(room([]));
  });
  assert.deepEqual(await saveRoom(1, []), room([]));
});

test('HTTP failures do not become successful saves', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Database unavailable.' }, { status: 503 }),
  );
  await assert.rejects(saveRoom(1, []), /Database unavailable/);
});

test('network and non-JSON responses explain the connection problem', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(loadRoom(), /Could not reach/);
  fetchMock.mock.mockImplementation(async () => new Response('Proxy error', { status: 500 }));
  await assert.rejects(loadRoom(), /did not return JSON.*500/);
});

test('cancelled loading remains an AbortError', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('Cancelled', 'AbortError');
  });
  await assert.rejects(loadRoom(), { name: 'AbortError' });
});

test('invalid server layouts are rejected rather than silently replacing saved data', () => {
  for (const invalid of [
    null,
    { ...room(), id: 2 },
    { ...room(), readOnly: 'false' },
    room([null]),
    room([{ ...STARTER_LAYOUT[0], type: 'unknown' }]),
    room([{ ...STARTER_LAYOUT[0], position: [100, 0, 0] }]),
    room([{ ...STARTER_LAYOUT[0], rotation: 0.3 }]),
    room([STARTER_LAYOUT[0], STARTER_LAYOUT[0]]),
  ]) {
    assert.throws(() => validateRoomResponse(invalid));
  }
});

test('load and save use the requested room and reject a different room response', async (t) => {
  const secondRoom = { ...room([]), id: 2, name: 'Personal room' };
  const mock = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/rooms/2');
    return Response.json(secondRoom);
  });
  assert.deepEqual(await loadRoom(2), secondRoom);
  assert.deepEqual(await saveRoom(2, []), secondRoom);
  mock.mock.mockImplementation(async () => Response.json(room([])));
  await assert.rejects(loadRoom(2), /invalid room/);
});

const account = {
  personalRoomId: 4,
  centralRoomId: 1,
  name: 'jose',
  roomName: 'Jose’s bedroom',
  displayName: 'Jose',
  isHost: false,
};
const session = (user = account) => ({ user, csrfToken: 'test-csrf-token-long-enough' });

test('session bootstrap restores the account and keeps CSRF in memory', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth/session');
    assert.equal(options.credentials, 'same-origin');
    return Response.json(session());
  });
  assert.deepEqual(await loadAuthSession(), account);
  assert.equal(getCsrfToken(), session().csrfToken);
});

test('login and signup send credentials with the CSRF token; logout clears the user', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-CSRF-Token'], session().csrfToken);
    if (url.endsWith('/logout')) return Response.json(session(null));
    const body = JSON.parse(options.body);
    assert.equal(body.username, 'Jose');
    assert.equal(body.password, 'a test password phrase');
    if (url.endsWith('/register')) assert.equal(body.activationCode, 'private-code');
    return Response.json(session());
  });
  assert.deepEqual(await login('Jose', 'a test password phrase'), account);
  assert.deepEqual(await register('Jose', 'a test password phrase', 'private-code'), account);
  assert.equal(await logout(), null);
});

test('shared requests include CSRF for FormData uploads and reject bad sessions', async (t) => {
  const data = new FormData();
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.body, data);
    assert.equal(options.headers['X-CSRF-Token'], session().csrfToken);
    assert.equal(options.headers['Content-Type'], undefined);
    return Response.json({ ok: true });
  });
  await requestJSON('/api/rooms/4/media', { method: 'POST', body: data });
  for (const invalid of [
    {},
    session({ ...account, personalRoomId: 1 }),
    session({ ...account, isHost: 'yes' }),
  ]) {
    mock.mock.mockImplementation(async () => Response.json(invalid));
    await assert.rejects(loadAuthSession(), /invalid/);
  }
});

test('incorrect login remains an error without becoming a successful session', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Incorrect username or password.' }, { status: 401 }),
  );
  await assert.rejects(login('Jose', 'wrong password'), /Incorrect/);
});

test('room directory loads same-origin room summaries and validates their IDs', async (t) => {
  const rooms = [
    { id: 1, name: 'Central room' },
    { id: 8, name: 'My room' },
  ];
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/rooms');
    assert.equal(options.credentials, 'same-origin');
    return Response.json({ rooms });
  });
  assert.deepEqual(await loadRoomDirectory(), rooms);
  for (const invalid of [{}, { rooms: [null] }, { rooms: [{ id: -1, name: 'Room' }] }]) {
    mock.mock.mockImplementation(async () => Response.json(invalid));
    await assert.rejects(loadRoomDirectory(), /invalid room directory/);
  }
});
