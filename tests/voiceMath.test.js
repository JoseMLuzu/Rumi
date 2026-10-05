import assert from 'node:assert/strict';
import test from 'node:test';
import { playerDistance, voiceVolume } from '../src/voiceMath.js';

test('voice is full nearby, fades with distance, and is silent outside hearing range', () => {
  assert.equal(voiceVolume(0), 1);
  assert.equal(voiceVolume(2), 1);
  assert.equal(voiceVolume(5), 0.25);
  assert.equal(voiceVolume(8), 0);
  assert.equal(voiceVolume(100), 0);
  assert.equal(voiceVolume(NaN), 0);
  let previous = 1;
  for (let distance = 0; distance <= 10; distance += 0.1) {
    const volume = voiceVolume(distance);
    assert.ok(volume >= 0 && volume <= previous);
    previous = volume;
  }
});

test('proximity uses the walking plane, not avatar height or camera position', () => {
  assert.equal(playerDistance([0, 0, 0], [3, 50, 4]), 5);
  assert.equal(playerDistance([-4, 0, 2], [-4, 0, 2]), 0);
});
