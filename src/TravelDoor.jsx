import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import RoomSign from './RoomSign.jsx';

export default function TravelDoor({ doors, playerRef, enabled, nearby, onNearChange, onEnter, targetRoomId }) {
  const nearRef = useRef(null);

  useFrame(() => {
    const player = playerRef.current?.position;
    let near = null;
    let closestDistance = 1.35 ** 2;
    if (enabled && player) for (const door of doors) {
      const distance = (player.x - door.position[0]) ** 2 + (player.z - door.position[2]) ** 2;
      // Choose the closest bedroom when two doors face each other in a narrow hallway.
      if (distance < closestDistance) { near = door; closestDistance = distance; }
    }
    // Update React only when proximity changes, rather than on every animation frame.
    if (near?.roomId !== nearRef.current?.roomId) {
      nearRef.current = near;
      onNearChange(near);
    }
  });

  useEffect(() => {
    function enter(event) {
      if (!nearRef.current || event.code !== 'KeyE' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return;
      event.preventDefault();
      onEnter(nearRef.current.roomId);
    }
    window.addEventListener('keydown', enter);
    return () => window.removeEventListener('keydown', enter);
  }, [onEnter]);

  return (
    <group>{doors.map((door) => <DoorArch key={door.roomId} door={door}
      nearby={nearby?.roomId === door.roomId} highlighted={targetRoomId === door.roomId} />)}</group>
  );
}

function DoorArch({ door, nearby, highlighted }) {
  const color = highlighted ? '#b78a43' : door.isHome ? '#7f9273' : '#a17b5b';
  return (
    <group position={door.position} rotation={[0, door.rotation, 0]}>
      {[-0.95, 0.95].map((x) => <mesh key={x} position={[x, 1.1, 0]} castShadow>
        <boxGeometry args={[0.18, 2.2, 0.3]} /><meshStandardMaterial color={color} />
      </mesh>)}
      <mesh position={[0, 2.15, 0]} castShadow>
        <boxGeometry args={[2.1, 0.2, 0.3]} /><meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.05, -0.06]} castShadow>
        <boxGeometry args={[1.8, 2, 0.1]} /><meshStandardMaterial color="#c69b73" roughness={0.85} />
      </mesh>
      {[0.6, 1.5].map((y) => <mesh key={y} position={[0, y, 0.005]}>
        <boxGeometry args={[1.28, 0.6, 0.035]} /><meshStandardMaterial color="#b88c67" />
      </mesh>)}
      <mesh position={[0.61, 1.05, 0.1]}>
        <sphereGeometry args={[0.07, 8, 8]} /><meshStandardMaterial color="#d6b56e" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.025, -0.25]} receiveShadow>
        <boxGeometry args={[1.7, 0.05, 0.8]} />
        <meshStandardMaterial color={nearby ? '#b7d5a5' : '#ead8b8'} />
      </mesh>
      {/* Keep the sign parallel to the wall so it cannot clip through an enclosed bedroom. */}
      <group position={[0, 2.5, 0.21]}>
        <RoomSign title={door.label}
          subtitle={nearby ? 'Press E to enter' : ''} width={2.4} height={0.6} />
      </group>
      {highlighted && <mesh position={[0, 0.04, 0.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.75, 32]} /><meshBasicMaterial color="#edc56f" />
      </mesh>}
    </group>
  );
}
