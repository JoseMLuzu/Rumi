import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';

export default function CameraController({ playerRef, isEditing, isCentral, spawnPosition }) {
  const vectors = useMemo(() => ({
    target: new Vector3(), position: new Vector3(), offset: new Vector3(),
    lookAt: new Vector3(0, 0.5, 0),
  }), []);
  useEffect(() => {
    // Start near the arrival door, even when it is far along a corridor.
    vectors.lookAt.set(spawnPosition[0], 0.55, spawnPosition[2]);
  }, [spawnPosition, vectors]);

  useFrame(({ camera, size }, delta) => {
    if (!playerRef.current) return;
    // Shift the overview slightly to leave space for the inventory on the right.
    if (isEditing) vectors.target.set(1.2, 0.3, -1.2);
    else {
      vectors.target.copy(playerRef.current.position);
      vectors.target.y = 0.55;
    }

    // Pull back on narrow windows to keep more of the room in view.
    const scale = Math.max(1, 1 / Math.max(size.width / size.height, 0.65));
    if (isCentral && Math.abs(vectors.target.x) > 4.2 && Math.abs(vectors.target.z) < 1.5) {
      // Look along the hallway from its inner end, keeping opaque bedroom roofs out of the sightline.
      vectors.offset.set(-Math.sign(vectors.target.x) * 6, 8, 0);
    } else vectors.offset.set(8, isEditing ? 14 : 11, 8);
    vectors.offset.multiplyScalar(scale);
    vectors.position.copy(vectors.target).add(vectors.offset);
    // Exponential interpolation gives similar smoothing at different frame rates.
    const blend = 1 - Math.exp(-5 * Math.min(delta, 0.1));
    camera.position.lerp(vectors.position, blend);
    vectors.lookAt.lerp(vectors.target, blend);
    camera.lookAt(vectors.lookAt);
  });

  return null;
}
