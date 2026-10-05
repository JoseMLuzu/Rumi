import test from 'node:test';
import assert from 'node:assert/strict';
import OBJECTS from '../src/data/objects.json' with { type: 'json' };
import { imageCrop } from '../src/objects/images.js';
import { getSeats } from '../src/seating.js';
import { canWalkTo, getFootprint, getPlacementError } from '../src/roomLayout.js';

test('all 24 objects have footprints, actions and original model references', () => {
  assert.equal(Object.keys(OBJECTS).length, 24);
  for (const object of Object.values(OBJECTS)) {
    assert.ok(object.width > 0 && object.depth > 0);
    assert.ok(object.file.endsWith('.glb'));
    assert.ok(object.actions.length);
  }
});
test('image contain preserves aspect and cover clamps UVs inside the source image', () => {
  assert.deepEqual(imageCrop(2, 1, 'contain'), {
    repeat: [1, 1],
    offset: [0, 0],
    size: [1, 0.5],
  });
  assert.deepEqual(imageCrop(2, 1, 'cover', [1, 0.5]), {
    repeat: [0.5, 1],
    offset: [0.5, 0],
    size: [1, 1],
  });
  assert.deepEqual(imageCrop(0.5, 1, 'cover', [0.5, 0]), {
    repeat: [1, 0.5],
    offset: [0, 0.5],
    size: [1, 1],
  });
});
test('scale updates collisions and both new seats without making the rug an obstacle', () => {
  const chair = {
    id: 'hand',
    type: 'handChair',
    position: [0, 0, 0],
    rotation: Math.PI / 2,
    scale: 1.5,
  };
  const seats = getSeats([chair]);
  assert.equal(seats.length, 1);
  assert.equal(seats[0].seatHeight, 0.585);
  assert.equal(seats[0].position[0], 0.06);
  const footprint = getFootprint(chair);
  assert.equal(footprint.width, OBJECTS.handChair.depth * 1.5);
  assert.equal(canWalkTo(0, 0, [chair]), false);
  assert.equal(canWalkTo(0, 0, [{ ...chair, type: 'monsterRug' }]), true);
  assert.ok(getPlacementError({ ...chair, position: [4.8, 0, 4.8] }, []));
});
