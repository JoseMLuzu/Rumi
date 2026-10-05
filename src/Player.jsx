import useReducedMotion from './objects/useReducedMotion.js';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import PlayerAvatar, { AVATAR_HIP_HEIGHT } from './PlayerAvatar.jsx';
import PlayerNameTag from './PlayerNameTag.jsx';
import { Vector3 } from 'three';
import { canWalkTo, PLAYER_RADIUS } from './roomLayout.js';

const MOVE_SPEED = 3;
const UP = new Vector3(0, 1, 0);

export default function Player({
  playerRef,
  touchInput,
  enabled,
  items,
  spawnPosition,
  onPose,
  walkAreas,
  name,
  voiceEnabled,
  voiceMuted,
  posture,
}) {
  const keys = useRef({ KeyW: false, KeyA: false, KeyS: false, KeyD: false });
  const body = useRef(null);
  const walkTime = useRef(0);
  // Reuse vectors rather than allocating new objects on every animation frame.
  const vectors = useMemo(
    () => ({
      forward: new Vector3(),
      right: new Vector3(),
      direction: new Vector3(),
    }),
    [],
  );
  const reduced = useReducedMotion();
  const seated = !!posture?.seated;

  useEffect(() => {
    if (!posture || !playerRef.current || !body.current) return;
    // Seats and safe standing positions come from the server, independent of walking input.
    playerRef.current.position.set(...posture.position);
    body.current.rotation.y = posture.rotation;
  }, [posture, playerRef]);

  useEffect(() => {
    function resetKeys() {
      if (touchInput) touchInput.current = {};
      for (const code of Object.keys(keys.current)) keys.current[code] = false;
    }
    function handleKeyDown(event) {
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches('input, textarea, select') || event.target.isContentEditable)
      )
        return;
      if (event.code in keys.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        keys.current[event.code] = true;
      }
    }
    function handleKeyUp(event) {
      if (event.code in keys.current) keys.current[event.code] = false;
    }
    resetKeys();
    if (!enabled || seated) return;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', resetKeys);
    document.addEventListener('visibilitychange', resetKeys);
    return () => {
      resetKeys();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', resetKeys);
      document.removeEventListener('visibilitychange', resetKeys);
    };
  }, [enabled, seated]);

  useFrame(({ camera }, delta) => {
    if (!playerRef.current || !body.current) return;
    const forwardInput =
      Number(keys.current.KeyW || !!touchInput?.current.KeyW) -
      Number(keys.current.KeyS || !!touchInput?.current.KeyS);
    const rightInput =
      Number(keys.current.KeyD || !!touchInput?.current.KeyD) -
      Number(keys.current.KeyA || !!touchInput?.current.KeyA);
    if (!enabled || seated || (!forwardInput && !rightInput)) {
      body.current.position.y = 0;
      onPose(playerRef.current.position, body.current.rotation.y);
      return;
    }

    // Project the camera's forward direction onto the floor so W feels forward on screen.
    camera.getWorldDirection(vectors.forward);
    vectors.forward.y = 0;
    vectors.forward.normalize();
    vectors.right.crossVectors(vectors.forward, UP).normalize();
    vectors.direction
      .copy(vectors.forward)
      .multiplyScalar(forwardInput)
      .addScaledVector(vectors.right, rightInput)
      .normalize();

    // Delta makes speed independent of FPS; a cap avoids jumps after a paused tab.
    const distance = MOVE_SPEED * Math.min(delta, 0.1);
    const position = playerRef.current.position;
    // Small substeps prevent crossing a thin obstacle during a slow frame.
    const steps = Math.ceil(distance / (PLAYER_RADIUS / 2));
    const stepX = (vectors.direction.x * distance) / steps;
    const stepZ = (vectors.direction.z * distance) / steps;
    let moved = false;
    for (let step = 0; step < steps; step++) {
      // Check axes separately so the player slides along walls instead of sticking.
      if (canWalkTo(position.x + stepX, position.z, items, walkAreas)) {
        position.x += stepX;
        moved = moved || Math.abs(stepX) > 0.0001;
      }
      if (canWalkTo(position.x, position.z + stepZ, items, walkAreas)) {
        position.z += stepZ;
        moved = moved || Math.abs(stepZ) > 0.0001;
      }
    }
    body.current.rotation.y = Math.atan2(vectors.direction.x, vectors.direction.z);
    walkTime.current += Math.min(delta, 0.1);
    body.current.position.y = moved && !reduced ? Math.sin(walkTime.current * 12) * 0.025 : 0;
    onPose(position, body.current.rotation.y);
  }, -1); // Move before the camera's frame callback reads the player position.

  return (
    <group ref={playerRef} position={spawnPosition}>
      <group ref={body}>
        <PlayerAvatar
          seated={seated}
          seatHeight={posture?.seatHeight}
          seatPose={posture?.seatPose}
          crown={posture?.crown}
          cosmetic={posture?.cosmetic}
          cosmeticExpires={posture?.cosmeticExpires}
          snack={posture?.snack}
          reaction={posture?.reaction}
          snackExpires={posture?.snackExpires}
        />
      </group>
      <PlayerNameTag
        name={name}
        voiceEnabled={voiceEnabled}
        voiceMuted={voiceMuted}
        heightOffset={seated ? posture.seatHeight - AVATAR_HIP_HEIGHT : 0}
      />
    </group>
  );
}
