import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

// Opt-in integration check: two saved names reuse the same test bedrooms on every run.
const url = process.env.TEST_SERVER_URL || 'http://127.0.0.1:5173';
const sockets = [];

function waitFor(socket, event, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5000);
    function handler(data) {
      if (!matches(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

async function request(path, visitor, method = 'GET', body) {
  return fetch(url + path, {
    method,
    headers: { ...(visitor ? { Cookie: visitor.cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function newVisitor(name) {
  const response = await request('/api/visitor', null, 'POST', { name });
  assert.ok([200, 201].includes(response.status));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { cookie, ...await response.json() };
}

function makeSocket(visitor, roomId) {
  const socket = io(url, {
    autoConnect: false, transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: new URL(url).origin, Cookie: visitor.cookie },
    auth: { roomId, position: [0, 0, 0], rotation: 0 },
  });
  sockets.push(socket);
  return socket;
}

async function join(visitor, roomId) {
  const socket = makeSocket(visitor, roomId);
  const initial = waitFor(socket, 'room_state');
  socket.connect();
  const snapshot = await initial;
  assert.equal(snapshot.roomId, roomId);
  return { socket, snapshot };
}

try {
  const centralBefore = await (await request('/api/rooms/1')).json();
  const first = await newVisitor('MVP Test A');
  const second = await newVisitor('MVP Test B');
  assert.notEqual(first.personalRoomId, second.personalRoomId);
  const returning = await (await request('/api/visitor', null, 'POST', { name: '  MVP   TEST A ' })).json();
  assert.equal(returning.personalRoomId, first.personalRoomId);
  const firstPath = `/api/rooms/${first.personalRoomId}`;
  const secondPath = `/api/rooms/${second.personalRoomId}`;
  const original = await (await request(firstPath, first)).json();
  const otherOriginal = await (await request(secondPath, second)).json();
  assert.equal(original.readOnly, false);
  assert.equal((await request(firstPath, second)).status, 200);
  assert.equal((await (await request(firstPath, second)).json()).readOnly, true);
  const directory = await (await request('/api/rooms', second)).json();
  assert.ok(directory.rooms.some((room) => room.id === first.personalRoomId));
  assert.ok(directory.rooms.some((room) => room.id === second.personalRoomId));
  assert.ok(directory.rooms.every((room) => Object.keys(room).sort().join(',') === 'id,name'));
  assert.equal((await request(firstPath, second, 'PUT', { items: [] })).status, 403);
  assert.equal((await request('/api/rooms/1', first, 'PUT', { items: [] })).status, 403);
  const changed = original.items.map((item) => item.type === 'chair'
    ? { ...item, rotation: (item.rotation + Math.PI / 2) % (2 * Math.PI) } : item);
  assert.equal((await request(firstPath, first, 'PUT', { items: changed })).status, 200);
  assert.deepEqual((await (await request(firstPath, first)).json()).items, changed);
  assert.deepEqual(await (await request(secondPath, second)).json(), otherOriginal);
  assert.equal((await request(firstPath, first, 'PUT', { items: original.items })).status, 200);
  console.log('PASS: saved names recover distinct persistent bedrooms from a new browser, owner-only saves, and isolated furniture');

  const a = await join(first, first.personalRoomId);
  const b = await join(second, second.personalRoomId);
  assert.equal(a.snapshot.players.length, 1);
  assert.equal(b.snapshot.players.length, 1);
  let leaked = 0;
  b.socket.on('player_moved', () => leaked++);
  await a.socket.timeout(5000).emitWithAck('player_move', { position: [0.5, 0, 0], rotation: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(leaked, 0);
  b.socket.disconnect();
  const guestJoined = waitFor(a.socket, 'player_joined');
  const guest = await join(second, first.personalRoomId);
  assert.equal((await guestJoined).id, guest.socket.id);
  assert.equal(guest.snapshot.players.length, 2);
  const guestMove = waitFor(guest.socket, 'player_moved');
  await a.socket.timeout(5000).emitWithAck('player_move', { position: [1, 0, 0], rotation: 0 });
  assert.deepEqual((await guestMove).position, [1, 0, 0]);
  try {
    const layoutChanged = waitFor(guest.socket, 'room_layout_changed');
    assert.equal((await request(firstPath, first, 'PUT', { items: changed })).status, 200);
    assert.equal((await layoutChanged).roomId, first.personalRoomId);
    assert.deepEqual((await (await request(firstPath, second)).json()).items, changed);
    assert.equal((await request(firstPath, second, 'PUT', { items: [] })).status, 403);
  } finally {
    assert.equal((await request(firstPath, first, 'PUT', { items: original.items })).status, 200);
  }
  const guestId = guest.socket.id;
  const guestLeft = waitFor(a.socket, 'player_left', (player) => player.id === guestId);
  guest.socket.disconnect();
  await guestLeft;
  a.socket.disconnect();
  console.log('PASS: room directory, visiting, shared personal-room movement, owner-only edits and live furniture notifications');

  const sharedA = await join(first, first.centralRoomId);
  const joined = waitFor(sharedA.socket, 'player_joined');
  const sharedB = await join(second, second.centralRoomId);
  assert.equal((await joined).id, sharedB.socket.id);
  assert.ok(sharedB.snapshot.players.some((player) => player.id === sharedA.socket.id));
  const moved = waitFor(sharedB.socket, 'player_moved', (player) => player.id === sharedA.socket.id);
  sharedA.socket.emit('player_move', { position: [0.5, 0, 0], rotation: 0 });
  assert.deepEqual((await moved).position, [0.5, 0, 0]);
  const oldId = sharedA.socket.id;
  const left = waitFor(sharedB.socket, 'player_left', (player) => player.id === oldId);
  sharedA.socket.disconnect();
  await left;
  const home = await join(first, first.personalRoomId);
  assert.equal(home.snapshot.players.length, 1);
  const centralAfter = await (await request('/api/rooms/1')).json();
  assert.deepEqual(centralAfter.items, centralBefore.items);
  const hallDoor = centralAfter.hall.doors.find((door) => door.roomId === first.personalRoomId);
  assert.ok(hallDoor);
  // Personal rooms still reject hall coordinates even if the packet claims room 1.
  assert.equal((await home.socket.timeout(5000).emitWithAck('player_move', {
    roomId: 1, position: hallDoor.arrival, rotation: 0,
  })).ok, false);
  // The remaining central player can move beyond the old 10×10 scene.
  const walker = await join(first, 1);
  const corridorMoved = waitFor(sharedB.socket, 'player_moved', (player) => player.id === walker.socket.id);
  assert.equal((await walker.socket.timeout(5000).emitWithAck('player_move', {
    position: hallDoor.arrival, rotation: 0,
  })).ok, true);
  assert.deepEqual((await corridorMoved).position, hallDoor.arrival);
  console.log('PASS: visitors meet in the central room and return home without ghost players');
  console.log('PASS: central furniture preserved; temporary personal test rooms retain starter layouts');
} finally {
  for (const socket of sockets) socket.disconnect();
}
