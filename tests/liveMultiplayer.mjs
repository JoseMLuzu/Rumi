import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { authenticate } from './authClient.mjs';

// This opt-in check needs a running app. Ordinary `npm test` stays offline.
const url = process.env.TEST_SERVER_URL || 'http://127.0.0.1:5173';
const firstAccount = await authenticate(url, process.env.TEST_USERNAME, process.env.TEST_PASSWORD);
const secondAccount = await authenticate(url, process.env.TEST_USERNAME, process.env.TEST_PASSWORD);
const { spaces } = await firstAccount.request('/api/spaces');
const space = process.env.TEST_SPACE_ID
  ? spaces.find((entry) => entry.id === Number(process.env.TEST_SPACE_ID))
  : spaces[0];
assert.ok(
  space,
  'The test account must belong to a space. Create one or accept an invitation first.',
);
const roomId = space.centralRoomId;
const makeClient = (position, account = firstAccount) =>
  io(url, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    // Match a browser's Origin header, including HTTPS when testing a public tunnel.
    extraHeaders: { Origin: new URL(url).origin, Cookie: account.cookie },
    auth: { roomId, csrfToken: account.csrfToken, position, rotation: 0 },
  });

function waitFor(socket, event, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5000);
    function handler(data) {
      if (!matches(data)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

async function readRoom() {
  return firstAccount.request(`/api/rooms/${roomId}`);
}

let first = makeClient([0, 0, 0]);
const second = makeClient([1, 0, 1], secondAccount);
try {
  const before = await readRoom();
  const firstSnapshot = waitFor(first, 'room_state');
  first.connect();
  assert.ok((await firstSnapshot).players.some((player) => player.id === first.id));
  const firstId = first.id;
  const joined = waitFor(first, 'player_joined');
  const secondSnapshot = waitFor(second, 'room_state');
  second.connect();
  const players = (await secondSnapshot).players;
  assert.ok(players.some((player) => player.id === first.id));
  assert.ok(players.some((player) => player.id === second.id));
  assert.equal((await joined).id, second.id);
  assert.equal(first.io.engine.transport.name, 'websocket');
  assert.equal(second.io.engine.transport.name, 'websocket');
  console.log(`PASS: two players join over WebSockets at ${url}`);

  const received = waitFor(second, 'player_moved', (player) => player.id === first.id);
  first.emit('player_move', { position: [0.5, 0, 0], rotation: 0.5 });
  assert.deepEqual(await received, {
    id: firstId,
    name: firstAccount.user.displayName,
    voiceEnabled: false,
    voiceMuted: false,
    position: [0.5, 0, 0],
    rotation: 0.5,
  });
  const reverse = waitFor(first, 'player_moved', (player) => player.id === second.id);
  second.emit('player_move', { position: [1.5, 0, 1], rotation: -0.5 });
  assert.deepEqual((await reverse).position, [1.5, 0, 1]);
  console.log('PASS: movement reaches the other player in both directions');

  const left = waitFor(second, 'player_left', (player) => player.id === firstId);
  first.disconnect();
  assert.equal((await left).id, firstId);
  first = makeClient([2, 0, 2]);
  const fresh = waitFor(first, 'room_state');
  first.connect();
  const snapshot = (await fresh).players;
  assert.notEqual(first.id, firstId);
  assert.ok(!snapshot.some((player) => player.id === firstId));
  assert.ok(snapshot.some((player) => player.id === second.id && player.position[0] === 1.5));
  console.log('PASS: leaving removes the player; reconnecting loads a fresh snapshot');

  assert.deepEqual(await readRoom(), before);
  console.log('PASS: live movement leaves the PostgreSQL layout unchanged');
} finally {
  first.disconnect();
  second.disconnect();
  await firstAccount.request('/api/auth/logout', { method: 'POST' });
  await secondAccount.request('/api/auth/logout', { method: 'POST' });
}
