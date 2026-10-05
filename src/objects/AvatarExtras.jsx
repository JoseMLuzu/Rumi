import { useEffect, useState } from 'react';

export function useTemporaryValue(value, expires) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const remaining = (expires ?? 0) * 1000 - Date.now();
    setExpired(remaining <= 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [value, expires]);
  return expired ? null : value;
}

export default function AvatarExtras({
  crown,
  cosmetic,
  snack,
  snackExpires,
  cosmeticExpires,
  reaction,
}) {
  const effect = useTemporaryValue(cosmetic, cosmeticExpires);
  const happy = useTemporaryValue(reaction?.kind, reaction?.expires);
  const held = useTemporaryValue(snack, snackExpires);
  return (
    <>
      {happy && (
        <mesh position={[0.22, 1.65, 0]}>
          <sphereGeometry args={[0.08, 6, 4]} />
          <meshBasicMaterial color="#dca3ab" />
        </mesh>
      )}
      {(crown || effect === 'hat') && (
        <group position={[0, 1.5, 0]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.21, 0.12, 8]} />
            <meshStandardMaterial color={crown ? '#e5c06e' : '#a88ab9'} />
          </mesh>
          {crown &&
            [-0.14, 0, 0.14].map((x) => (
              <mesh key={x} position={[x, 0.08, 0]}>
                <coneGeometry args={[0.04, 0.12, 4]} />
                <meshStandardMaterial color="#e5c06e" />
              </mesh>
            ))}
        </group>
      )}
      {effect === 'glasses' && (
        <group position={[0, 1.2, 0.245]}>
          {[-0.085, 0.085].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <torusGeometry args={[0.047, 0.011, 5, 12]} />
              <meshStandardMaterial color="#5e536c" />
            </mesh>
          ))}
          <mesh>
            <boxGeometry args={[0.075, 0.013, 0.013]} />
            <meshStandardMaterial color="#5e536c" />
          </mesh>
        </group>
      )}
      {held && (
        <mesh position={[0.32, 0.53, 0.09]}>
          <boxGeometry args={held === 'cookie' ? [0.14, 0.12, 0.035] : [0.12, 0.2, 0.1]} />
          <meshStandardMaterial
            color={held === 'juice' ? '#ccad77' : held === 'chips' ? '#ce836b' : '#b78b58'}
          />
        </mesh>
      )}
    </>
  );
}
