import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadSpaces,
  createSpace,
  joinSpace,
  generateSpaceInvitation,
  previewSpaceInvitation,
  revokeSpaceInvitation,
  loadRoomDirectory,
  loadRoom,
  loadAuthSession,
} from '../src/api.js';
import { invitationToken, invitationUrl } from '../src/spaces.js';

const space = {
  id: 8,
  name: 'Friends',
  personalRoomId: 21,
  centralRoomId: 20,
  roomName: 'Ana’s bedroom',
  isHost: true,
  isOwner: true,
  memberCount: 2,
};

test('space APIs send names and tokens as JSON without exposing invitation secrets in paths', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url === '/api/spaces') return Response.json(options.method ? space : { spaces: [space] });
    if (url === '/api/spaces/join') return Response.json(space);
    if (url === '/api/spaces/invitations/preview') return Response.json({ name: space.name });
    return Response.json({ token: 'private-invitation-token', revoked: true });
  });
  assert.deepEqual(await loadSpaces(), [space]);
  assert.deepEqual(await createSpace('Friends'), space);
  assert.deepEqual(await joinSpace('private-token'), space);
  await previewSpaceInvitation('private-token');
  await generateSpaceInvitation(8);
  await revokeSpaceInvitation(8);
  assert.equal(requests[1].body.name, 'Friends');
  assert.equal(requests[2].body.token, 'private-token');
  assert.equal(requests[3].body.token, 'private-token');
  assert.equal(requests[5].method, 'DELETE');
  assert.ok(requests.every((request) => !request.url.includes('private-token')));
});

test('space list validates membership context and rejects duplicates or malformed IDs', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ spaces: [] }));
  assert.deepEqual(await loadSpaces(), []);
  for (const spaces of [
    [null],
    [{ ...space, centralRoomId: space.personalRoomId }],
    [{ ...space, isHost: 'yes' }],
    [space, space],
  ]) {
    mock.mock.mockImplementation(async () => Response.json({ spaces }));
    await assert.rejects(loadSpaces(), /invalid|Duplicate/);
  }
});

test('a new account may have no spaces, while members may use living-room IDs other than one', async (t) => {
  const user = {
    name: 'ana',
    displayName: 'Ana',
    personalRoomId: null,
    centralRoomId: null,
    roomName: null,
    isHost: false,
  };
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ user, csrfToken: 'csrf-token-long-enough-for-test' }),
  );
  assert.deepEqual(await loadAuthSession(), user);
  mock.mock.mockImplementation(async () =>
    Response.json({
      user: { ...user, personalRoomId: 21, centralRoomId: 20, roomName: 'Ana’s bedroom' },
      csrfToken: 'csrf-token-long-enough-for-test',
    }),
  );
  assert.equal((await loadAuthSession()).centralRoomId, 20);
});

test('bedroom directory requests the selected space', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/rooms?spaceId=8');
    return Response.json({ rooms: [{ id: 20, name: 'Living room' }] });
  });
  assert.equal((await loadRoomDirectory(undefined, 8))[0].id, 20);
});

test('every living room requires valid hall data regardless of its numeric ID', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ id: 20, name: 'Living room', isCentral: true, readOnly: true, items: [] }),
  );
  await assert.rejects(loadRoom(20), /hall/i);
  mock.mock.mockImplementation(async () =>
    Response.json({ id: 21, name: 'Bedroom', isCentral: false, readOnly: false, items: [] }),
  );
  assert.equal((await loadRoom(21)).id, 21);
});

test('share links retain the current origin and carry the token in a URL fragment', () => {
  const url = invitationUrl('safe-token_123', 'https://example.com');
  assert.equal(url, 'https://example.com/#invite=safe-token_123');
  assert.equal(invitationToken(url), 'safe-token_123');
  assert.equal(new URL(url).search, '');
  assert.equal(invitationToken('https://example.com/'), '');
});
