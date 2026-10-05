import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import modelUrl from './assets/models/pool-doll.glb?url';

export default function PoolDoll() {
  const { scene } = useGLTF(modelUrl);
  const model = useMemo(() => {
    // Each placed doll needs its own transform; geometry and materials stay cached.
    const copy = scene.clone(true);
    const bounds = new Box3().setFromObject(copy);
    const center = bounds.getCenter(new Vector3());
    // Align the asset with the editor's floor-centered position and collision rectangle.
    copy.position.set(-center.x, -bounds.min.y, -center.z);
    copy.traverse((child) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return copy;
  }, [scene]);

  return <primitive object={model} dispose={null} />;
}
