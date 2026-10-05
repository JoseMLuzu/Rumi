import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import modelUrl from './assets/models/chaise-longue-burgundy.glb?url';

export default function ChaiseLongue() {
  const { scene } = useGLTF(modelUrl);
  const model = useMemo(() => {
    // Instances move independently while sharing the cached geometry and materials.
    const copy = scene.clone(true);
    const bounds = new Box3().setFromObject(copy);
    const center = bounds.getCenter(new Vector3());
    // The editor places furniture by its floor centre, rather than the asset's origin.
    copy.position.set(-center.x, -bounds.min.y, -center.z);
    copy.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return copy;
  }, [scene]);

  return <primitive object={model} dispose={null} />;
}
