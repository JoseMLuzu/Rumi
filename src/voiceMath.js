export const VOICE_FULL_DISTANCE = 2;
export const VOICE_DISTANCE = 8;
export const VOICE_DISCONNECT_DISTANCE = 10;

export function playerDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function voiceVolume(distance) {
  if (!Number.isFinite(distance) || distance >= VOICE_DISTANCE) return 0;
  if (distance <= VOICE_FULL_DISTANCE) return 1;
  const remaining = (VOICE_DISTANCE - distance) / (VOICE_DISTANCE - VOICE_FULL_DISTANCE);
  return remaining ** 2;
}
