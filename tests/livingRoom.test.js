import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlacementError, canWalkTo } from '../src/roomLayout.js';
import { saveRoom } from '../src/api.js';

const chair = { id: 'chair', type: 'chair', position: [4.3, 0, 0], rotation: 0 };

test('only the living-room editor reserves both hallway entrances', () => {
  for (const x of [-4.3, 4.3]) {
    const candidate = { ...chair, position: [x, 0, 0] };
    assert.equal(getPlacementError(candidate, []), null);
    assert.match(getPlacementError(candidate, [], undefined, true), /hallway entrances/);
    assert.equal(
      getPlacementError({ ...candidate, position: [x, 0, 3] }, [], undefined, true),
      null,
    );
  }
});

test('deleting the saved book table opens its former walking space', () => {
  const book = { id: 'book', type: 'bookTable', position: [0, 0, 3.25], rotation: 0 };
  assert.equal(canWalkTo(0, 3.25, [book]), false);
  assert.equal(canWalkTo(0, 3.25, []), true);
});

test('a shared save sends the version that the host actually reviewed', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { items: [], layoutVersion: 'saved-version' });
    return Response.json({ error: 'The living room changed in another session.' }, { status: 409 });
  });
  await assert.rejects(saveRoom(1, [], 'saved-version'), /changed in another session/);
});
