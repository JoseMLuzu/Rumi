import { Suspense } from 'react';
import { RoundedBox } from '@react-three/drei';
import PoolDoll from './PoolDoll.jsx';
import ChaiseLongue from './ChaiseLongue.jsx';
import BookTable from './BookTable.jsx';

const WOOD = '#b88765';
const CREAM = '#f2e8d8';

// One small drawing helper keeps the models readable and their edges consistent.
export function BoxPart({ size, position, color, rotation }) {
  return (
    <RoundedBox
      args={size}
      position={position}
      rotation={rotation}
      radius={Math.min(0.06, ...size.map((value) => value / 3))}
      smoothness={2}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.85} />
    </RoundedBox>
  );
}

function Legs({ x, z, height }) {
  return [-1, 1].flatMap((sideX) =>
    [-1, 1].map((sideZ) => (
      <BoxPart
        key={`${sideX}-${sideZ}`}
        size={[0.12, height, 0.12]}
        position={[sideX * x, height / 2, sideZ * z]}
        color={WOOD}
      />
    )),
  );
}

export default function FurnitureModel({ type, cozy, lights = true }) {
  switch (type) {
    case 'chaiseLongue':
      return (
        <Suspense fallback={null}>
          <ChaiseLongue />
        </Suspense>
      );
    case 'poolDoll':
      // Only this item waits for its model; the room and placement outline remain visible.
      return (
        <Suspense fallback={null}>
          <PoolDoll />
        </Suspense>
      );
    case 'bed':
      return (
        <>
          <BoxPart size={[2.12, 0.35, 3.1]} position={[0, 0.225, 0]} color={WOOD} />
          <BoxPart size={[2.15, 0.25, 3.02]} position={[0, 0.5, 0]} color={CREAM} />
          <BoxPart size={[2.2, 1.1, 0.12]} position={[0, 0.55, -1.52]} color={WOOD} />
          <BoxPart size={[2.05, 0.12, 1.95]} position={[0, 0.64, 0.45]} color="#9fae95" />
          {[-0.5, 0.5].map((x) => (
            <BoxPart key={x} size={[0.85, 0.16, 0.62]} position={[x, 0.68, -1]} color="#fff5e5" />
          ))}
        </>
      );
    case 'chair':
      return (
        <>
          <Legs x={0.29} z={0.29} height={0.48} />
          <BoxPart size={[0.85, 0.16, 0.85]} position={[0, 0.53, 0]} color={WOOD} />
          <BoxPart size={[0.82, 0.7, 0.13]} position={[0, 0.91, -0.43]} color={WOOD} />
          <BoxPart
            size={[0.7, 0.08, 0.7]}
            position={[0, 0.65, 0.04]}
            color={cozy ? '#a7b393' : '#e5cba8'}
          />
        </>
      );
    case 'bookTable':
    case 'table':
      return (
        <>
          <Legs x={0.7} z={0.5} height={0.76} />
          <BoxPart size={[1.8, 0.16, 1.4]} position={[0, 0.84, 0]} color="#c89e78" />
          {type === 'bookTable' && <BookTable />}
        </>
      );
    case 'sofa':
      return (
        <>
          <Legs x={1.07} z={0.39} height={0.2} />
          <BoxPart size={[2.6, 0.35, 1.1]} position={[0, 0.34, 0]} color="#cb8d81" />
          <BoxPart size={[2.6, 0.85, 0.23]} position={[0, 0.88, -0.46]} color="#d9a092" />
          {[-1.25, 1.25].map((x) => (
            <BoxPart key={x} size={[0.2, 0.7, 1.15]} position={[x, 0.65, 0]} color="#d9a092" />
          ))}
          {[-0.55, 0.55].map((x) => (
            <BoxPart key={x} size={[1.06, 0.22, 0.82]} position={[x, 0.61, 0.12]} color="#edbaaa" />
          ))}
          {cozy && (
            <>
              {[-1, 1].map((side) => (
                <BoxPart
                  key={side}
                  size={[0.34, 0.36, 0.18]}
                  position={[side * 0.94, 0.92, -0.15]}
                  rotation={[0.12, 0, side * 0.12]}
                  color={side < 0 ? '#a8b294' : '#ebd9b3'}
                />
              ))}
              <BoxPart size={[0.5, 0.045, 0.65]} position={[-0.57, 0.745, 0.16]} color="#b4bba0" />
              <BoxPart size={[0.5, 0.28, 0.035]} position={[-0.57, 0.59, 0.5]} color="#b4bba0" />
            </>
          )}
        </>
      );
    case 'plant':
      return (
        <>
          <mesh position={[0, 0.23, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.26, 0.19, 0.46, 8]} />
            <meshStandardMaterial color="#c48d70" roughness={1} />
          </mesh>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.6, 6]} />
            <meshStandardMaterial color="#687353" />
          </mesh>
          {[
            [0, 1, 0],
            [-0.17, 0.81, 0],
            [0.17, 0.86, 0.05],
            [0, 0.79, -0.17],
          ].map((position, index) => (
            <mesh key={index} position={position} scale={[0.75, 1.15, 0.75]} castShadow>
              <sphereGeometry args={[0.25, 7, 5]} />
              <meshStandardMaterial color={index % 2 ? '#7c946f' : '#617e60'} roughness={1} />
            </mesh>
          ))}
        </>
      );
    case 'lamp':
      return (
        <>
          <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.29, 0.29, 0.08, 12]} />
            <meshStandardMaterial color={WOOD} />
          </mesh>
          <mesh position={[0, 0.69, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 1.3, 8]} />
            <meshStandardMaterial color="#a48055" />
          </mesh>
          <mesh position={[0, 1.42, 0]} castShadow>
            <cylinderGeometry args={[0.23, 0.31, 0.4, 12]} />
            <meshStandardMaterial color="#f1dab0" emissive="#f3c97e" emissiveIntensity={0.25} />
          </mesh>
          {lights && (
            <pointLight position={[0, 1.3, 0]} color="#ffd397" intensity={0.45} distance={3} />
          )}
        </>
      );
    default:
      return null;
  }
}
