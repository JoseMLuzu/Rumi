import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, validateAppearance } from '../src/roomAppearance.js';
import { saveRoomAppearance, validateRoomResponse } from '../src/api.js';

test('room style requests send only settings and revision to the separate PATCH endpoint', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/rooms/2/appearance');
      assert.equal(options.method, 'PATCH');
      assert.equal(options.credentials, 'same-origin');
      assert.deepEqual(JSON.parse(options.body), { appearance: DEFAULT_APPEARANCE, revision: 3 });
      return {
        ok: true,
        json: async () => ({ roomId: 2, appearance: DEFAULT_APPEARANCE, revision: 4 }),
      };
    };
    assert.equal((await saveRoomAppearance(2, DEFAULT_APPEARANCE, 3)).revision, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('saved styles accept storage references and reject blob/base64 and malformed transforms', () => {
  const appearance = structuredClone(DEFAULT_APPEARANCE);
  appearance.floor.image = '/api/media/' + 'a'.repeat(32);
  appearance.floor.fit = 'tile';
  appearance.floor.repeat = 4;
  assert.equal(validateAppearance(appearance), appearance);
  for (const invalid of [
    'blob:preview',
    'data:image/png;base64,abc',
    'https://example.com/image.png',
  ]) {
    appearance.floor.image = invalid;
    assert.throws(() => validateAppearance(appearance), /room style/);
  }
  const invalid = structuredClone(DEFAULT_APPEARANCE);
  invalid.walls.crop = [NaN, 1];
  assert.throws(() => validateAppearance(invalid));
  const room = {
    id: 2,
    name: 'Bedroom',
    readOnly: false,
    items: [],
    appearance: DEFAULT_APPEARANCE,
    appearanceRevision: -1,
  };
  assert.throws(() => validateRoomResponse(room, 2), /revision/);
});
