import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3 } from 'three';
import bookUrl from './assets/models/kamasutra-lowpoly.glb?url';

const TABLE_TOP = 0.92;
const BOOK_SCALE = 7.5;
const TILT = Math.PI / 4;
const STAND_BASE_HEIGHT = 0.06;

function Book() {
  const { scene } = useGLTF(bookUrl);
  const model = useMemo(() => {
    // The loader caches its scene; clone it before changing this instance's placement.
    const copy = scene.clone(true);
    copy.scale.setScalar(BOOK_SCALE);
    // YXZ tilts the flat cover first, then turns it toward the diagonal room camera.
    copy.rotation.set(TILT, Math.PI / 4, 0, 'YXZ');
    const bounds = new Box3().setFromObject(copy);
    // The lowest point changes after tilting. Lift it so it rests on the stand.
    copy.position.y = -bounds.min.y;
    copy.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return copy;
  }, [scene]);

  // The clone shares cached geometry/materials, which must survive room travel.
  return <primitive object={model} dispose={null} />;
}

export default function BookTable() {
  // The supplied book is 0.17 units long before scaling; its lower edge is half that.
  const rise = 0.085 * BOOK_SCALE * Math.sin(TILT);
  return (
    <group>
      {/* The furniture wrapper supplies the table, placement, rotation, and scale. */}
      <group position={[0, TABLE_TOP, 0]}>
        <group rotation={[0, Math.PI / 4, 0]}>
          <mesh position={[0, STAND_BASE_HEIGHT / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.02, STAND_BASE_HEIGHT, 1.04]} />
            <meshStandardMaterial color="#896447" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.29, -0.13]} castShadow>
            <boxGeometry args={[0.18, 0.58, 0.14]} />
            <meshStandardMaterial color="#896447" roughness={0.9} />
          </mesh>
          <group position={[0, STAND_BASE_HEIGHT + rise, 0]} rotation={[TILT, 0, 0]}>
            <mesh position={[0, -0.025, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.96, 0.04, 1.3]} />
              <meshStandardMaterial color="#896447" roughness={0.9} />
            </mesh>
          </group>
        </group>
        {/* Only the book waits for the asset; the rest of the room stays visible. */}
        <Suspense fallback={null}>
          <group position={[0, STAND_BASE_HEIGHT, 0]}>
            <Book />
          </group>
        </Suspense>
      </group>
    </group>
  );
}
