import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';

export function Duck({ scale = 1 }) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0.14, 0]}>
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial color="#ebc45f" />
      </mesh>
      <mesh position={[0, 0.28, 0.075]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#ebc45f" />
      </mesh>
      <mesh position={[0, 0.26, 0.17]}>
        <boxGeometry args={[0.09, 0.04, 0.07]} />
        <meshStandardMaterial color="#df944e" />
      </mesh>
    </group>
  );
}

export function ObjectEffects({ effect, type, reduced }) {
  const ref = useRef(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const remaining = (effect?.expires ?? 0) * 1000 - Date.now();
    setEnded(remaining <= 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setEnded(true), remaining);
    return () => clearTimeout(timer);
  }, [effect?.expires]);
  useFrame(() => {
    if (!ref.current) return;
    const now = Date.now() / 1000;
    const active = effect && now < effect.expires;
    ref.current.visible = !!active;
    if (!active) return;
    const progress = (now - effect.at) / (effect.expires - effect.at);
    for (let i = 0; i < ref.current.children.length; i++) {
      const child = ref.current.children[i];
      if (type === 'tinyDoor') {
        child.position.y = 0.1;
        child.position.z = reduced ? 0.16 : Math.sin(progress * Math.PI) * 0.22;
        child.rotation.z = reduced ? 0 : Math.sin(progress * 12) * 0.08;
      } else if (type === 'mysteryBox') {
        child.position.y = 0.45 + (reduced ? 0.05 : Math.sin(progress * Math.PI) * 0.22);
      } else {
        child.position.y = reduced
          ? 0.6
          : 0.7 + Math.sin(progress * Math.PI + i * 0.2) * 0.3 - progress * 0.5;
        child.rotation.z = reduced ? 0 : progress * 2;
      }
    }
  });
  if (
    ended ||
    !effect ||
    !['feed', 'surprise', 'open', 'greet', 'water', 'toast', 'snack', 'step'].includes(
      effect.action,
    )
  )
    return null;
  const ducks = (type === 'mysteryBox' && effect.variant === 0) || effect.variant === 'ducks';
  if (type === 'mysteryBox' && effect.variant === 2)
    return (
      <group ref={ref}>
        <group>
          <mesh>
            <boxGeometry args={[0.15, 0.12, 0.055]} />
            <meshStandardMaterial color="#dfb5a2" />
          </mesh>
          {[-0.06, -0.02, 0.02, 0.06].map((x) => (
            <mesh key={x} position={[x, 0.09, 0]}>
              <boxGeometry args={[0.03, 0.08, 0.045]} />
              <meshStandardMaterial color="#dfb5a2" />
            </mesh>
          ))}
          <mesh position={[-0.09, 0, 0]} rotation={[0, 0, -0.5]}>
            <boxGeometry args={[0.03, 0.07, 0.045]} />
            <meshStandardMaterial color="#dfb5a2" />
          </mesh>
        </group>
      </group>
    );
  if (type === 'tinyDoor')
    return (
      <group ref={ref}>
        <group scale={0.55}>
          <mesh position={[0, 0.16, 0]}>
            <capsuleGeometry args={[0.09, 0.12, 4, 8]} />
            <meshStandardMaterial color={['#96b49c', '#d8aa9c', '#c6bb81'][effect.variant % 3]} />
          </mesh>
          {[-0.04, 0.04].map((x) => (
            <mesh key={x} position={[x, 0.21, 0.079]}>
              <sphereGeometry args={[0.012, 6, 4]} />
              <meshBasicMaterial color="#433c37" />
            </mesh>
          ))}
        </group>
      </group>
    );
  if (effect.variant === 'lights')
    return (
      <group ref={ref}>
        <ambientLight color="#bea1ce" intensity={0.15} />
        <mesh position={[0, 0.8, 0]}>
          <sphereGeometry args={[0.24, 8, 6]} />
          <meshBasicMaterial color="#bea1ce" transparent opacity={0.3} />
        </mesh>
      </group>
    );
  return (
    <group ref={ref}>
      {Array.from({ length: ducks ? 3 : reduced ? 3 : 12 }, (_, i) => (
        <group
          key={`${effect.at}-${i}`}
          position={[Math.sin(i * 2.4 + effect.seed) * 0.35, 0.7, Math.cos(i * 2.4) * 0.25]}
        >
          {ducks ? (
            <Duck scale={0.7} />
          ) : (
            <mesh>
              <boxGeometry args={[0.018, 0.035, 0.012]} />
              <meshBasicMaterial
                color={
                  effect.action === 'water'
                    ? '#87b6cc'
                    : effect.action === 'feed'
                      ? '#b69b70'
                      : ['#a3bd99', '#e4b083', '#ab9fc5'][i % 3]
                }
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
