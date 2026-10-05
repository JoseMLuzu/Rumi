import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeats, nearestSeat } from '../src/seating.js';

test('chairs offer one seat, sofas offer two, and other furniture offers none', () => {
  const seats = getSeats(
    ['chair', 'sofa', 'table', 'poolDoll'].map((type) => ({
      id: type,
      type,
      position: [0, 0, 0],
      rotation: 0,
    })),
  );
  assert.deepEqual(
    seats.map((seat) => seat.id),
    ['chair:0', 'sofa:0', 'sofa:1'],
  );
  assert.equal(seats[0].seatHeight, 0.69);
  assert.equal(seats[1].seatHeight, 0.72);
});

test('seat offsets rotate with a sofa and keep the movement plane at zero', () => {
  const seats = getSeats([
    { id: 'sofa', type: 'sofa', position: [3, 0, 2], rotation: Math.PI / 2 },
  ]);
  for (const [index, z] of [
    [0, 2.55],
    [1, 1.45],
  ]) {
    assert(Math.abs(seats[index].position[0] - 3.1) < 1e-10);
    assert(Math.abs(seats[index].position[2] - z) < 1e-10);
    assert.equal(seats[index].position[1], 0);
    assert.equal(seats[index].rotation, Math.PI / 2);
  }
});

test('proximity chooses the closest available seat and hides distant/occupied seats', () => {
  const seats = getSeats([{ id: 'sofa', type: 'sofa', position: [0, 0, 0], rotation: 0 }]);
  const position = { x: -0.8, z: 1 };
  assert.equal(nearestSeat(seats, position, new Set()).id, 'sofa:0');
  assert.equal(nearestSeat(seats, position, new Set(['sofa:0'])).id, 'sofa:1');
  assert.equal(nearestSeat(seats, position, new Set(['sofa:0', 'sofa:1'])), null);
  assert.equal(nearestSeat(seats, { x: 4, z: 4 }, new Set()), null);
});

test('the chaise seat follows scaling and rotation and has a readable label', () => {
  const [seat] = getSeats([
    {
      id: 'chaise',
      type: 'chaiseLongue',
      position: [1, 0, 2],
      rotation: Math.PI / 2,
      scale: 1.5,
    },
  ]);
  assert.equal(seat.id, 'chaise:0');
  assert.equal(seat.label, 'Burgundy chaise longue');
  assert.ok(Math.abs(seat.position[0] - 1.24) < 1e-10);
  assert.ok(Math.abs(seat.position[2] - 2) < 1e-10);
  assert.equal(seat.seatHeight, 0.63);
  assert.equal(nearestSeat([seat], { x: 2, z: 2 }, new Set(['chaise:0'])), null);
});
