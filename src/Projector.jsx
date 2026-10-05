import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { ProjectorActions } from './ScreenShareControls.jsx';

export const PROJECTOR_VIEW_DISTANCE = 2.5;

export default function Projector({
  screen,
  connected,
  table,
  playerRef,
  nearby,
  onNearChange,
  seated = false,
  isEditing = false,
  onSelect,
}) {
  const tableTop = 0.84 + 0.16 / 2; // Matches the table model in Furniture.jsx.
  const projectorCenterY = tableTop + 0.04 + 0.32 / 2;
  const nearRef = useRef(false);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 135;
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    return map;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => onNearChange(false), [onNearChange]);
  useEffect(() => {
    let active = true;
    const context = texture.image.getContext('2d');
    if (!screen.preview) {
      context.fillStyle = '#223b33';
      context.fillRect(0, 0, 240, 135);
      context.textAlign = 'center';
      context.fillStyle = '#f6edda';
      context.font = '600 16px system-ui';
      context.fillText(screen.share ? 'Loading preview…' : 'Living room cinema', 120, 62);
      context.font = '10px system-ui';
      context.fillStyle = '#c4d4b9';
      context.fillText(
        screen.share ? 'Snapshots every 5 seconds' : 'Walk up to the projector',
        120,
        84,
      );
      texture.needsUpdate = true;
    } else {
      const image = new Image();
      image.onload = () => {
        if (!active) return;
        // Keep the previous snapshot visible while decoding; upload only the new image.
        context.drawImage(image, 0, 0, 240, 135);
        texture.needsUpdate = true;
      };
      image.src = screen.preview;
    }
    return () => {
      active = false;
    };
  }, [texture, screen.preview, screen.share?.sessionId]);

  useFrame(() => {
    const player = playerRef.current?.position;
    const near =
      !isEditing &&
      !!player &&
      !!table &&
      Math.hypot(player.x - table.position[0], player.z - table.position[2]) <=
        PROJECTOR_VIEW_DISTANCE;
    // Proximity is sampled each frame, but React updates only when crossing the boundary.
    if (near !== nearRef.current) {
      nearRef.current = near;
      onNearChange(near);
    }
  });

  return (
    <group
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
    >
      <group position={[0, 1.4, -4.7]}>
        <mesh castShadow>
          <boxGeometry args={[3.95, 2.32, 0.18]} />
          <meshStandardMaterial
            color={nearby && screen.share ? '#bca064' : '#a17d5c'}
            roughness={0.8}
          />
        </mesh>
        <mesh
          position={[0, 0, 0.1]}
          onClick={(event) => {
            event.stopPropagation();
            if (isEditing) onSelect?.();
            else if (nearby && screen.share) screen.view();
          }}
        >
          <planeGeometry args={[3.7, 2.08125]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.22, 0]} castShadow>
          <boxGeometry args={[4.05, 0.12, 0.24]} />
          <meshStandardMaterial color="#efe4d0" />
        </mesh>
        <mesh position={[0, -1.21, 0]} castShadow>
          <boxGeometry args={[4.05, 0.12, 0.24]} />
          <meshStandardMaterial color="#efe4d0" />
        </mesh>
      </group>
      {/* Table top = 0.84 + 0.16 / 2 = 0.92. Feet touch it; the body sits 0.04 above it. */}
      {table && (
        <group
          position={[table.position[0], projectorCenterY * (table.scale ?? 1), table.position[2]]}
          rotation={[0, table.rotation, 0]}
          scale={table.scale ?? 1}
        >
          {[-1, 1].flatMap((x) =>
            [-1, 1].map((z) => (
              <mesh key={`${x}-${z}`} position={[x * 0.38, -0.18, z * 0.23]}>
                <boxGeometry args={[0.09, 0.04, 0.09]} />
                <meshStandardMaterial color="#626958" />
              </mesh>
            )),
          )}
          <mesh castShadow>
            <boxGeometry args={[1.05, 0.32, 0.72]} />
            <meshStandardMaterial color={nearby ? '#eee1c6' : '#dfd6c4'} roughness={0.8} />
          </mesh>
          <mesh position={[-0.26, 0, -0.39]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.09, 16]} />
            <meshStandardMaterial color="#3a4c45" />
          </mesh>
          <mesh position={[-0.26, 0, -0.44]} rotation={[0, Math.PI, 0]}>
            <circleGeometry args={[0.1, 16]} />
            <meshStandardMaterial
              color="#b8d8cc"
              emissive="#b8d8cc"
              emissiveIntensity={screen.share ? 1 : 0.1}
            />
          </mesh>
          {[-0.25, -0.12, 0.01, 0.14, 0.27].map((x) => (
            <mesh key={x} position={[x, 0, 0.365]}>
              <boxGeometry args={[0.045, 0.13, 0.01]} />
              <meshStandardMaterial color="#8b9386" />
            </mesh>
          ))}
          <mesh position={[0.35, 0.17, 0.12]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color={screen.share ? '#a3d888' : '#b7ad90'} />
          </mesh>
          {/* Keep seated faces visible: use a screen corner while sitting, and the device anchor while walking. */}
          {nearby && !screen.viewing && (
            <Html
              center
              position={[-2.4, 1.7, 0]}
              zIndexRange={[20, 10]}
              calculatePosition={
                seated ? (_object, _camera, size) => [size.width - 160, 190] : undefined
              }
            >
              <ProjectorActions screen={screen} connected={connected} />
            </Html>
          )}
        </group>
      )}
    </group>
  );
}
