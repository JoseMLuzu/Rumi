import AvatarExtras, { useTemporaryValue } from './objects/AvatarExtras.jsx';
import { RoundedBox } from '@react-three/drei';

export const AVATAR_HIP_HEIGHT = 0.38; // Torso bottom: 0.67 - 0.58 / 2.

// Geometry only: local and remote players share a look, but have different controls.
export default function PlayerAvatar({
  color = '#658a80',
  seated = false,
  seatHeight = 0,
  seatPose = 'normal',
  crown,
  cosmetic,
  cosmeticExpires,
  snack,
  snackExpires,
  reaction,
}) {
  const effect = useTemporaryValue(cosmetic, cosmeticExpires);
  return (
    <group position={[0, seated ? seatHeight - AVATAR_HIP_HEIGHT : 0, 0]}>
      <group rotation={[0, 0, seated && seatPose === 'relaxed' ? 0.08 : 0]}>
        <RoundedBox
          args={[0.46, 0.58, 0.32]}
          position={[0, 0.67, 0]}
          radius={0.09}
          smoothness={2}
          castShadow
        >
          <meshStandardMaterial color={effect === 'color' ? '#ac90bf' : color} roughness={1} />
        </RoundedBox>
        {[-1, 1].map((side) => (
          <group key={side}>
            {seated && (
              <RoundedBox
                args={[0.16, 0.16, 0.4]}
                position={[side * 0.12, 0.47, 0.18]}
                radius={0.05}
                smoothness={2}
                castShadow
              >
                <meshStandardMaterial color="#685d55" />
              </RoundedBox>
            )}
            <RoundedBox
              args={seated ? [0.16, 0.36, 0.18] : [0.16, 0.28, 0.25]}
              position={seated ? [side * 0.12, 0.24, 0.36] : [side * 0.12, 0.18, 0.035]}
              radius={0.05}
              smoothness={2}
              castShadow
            >
              <meshStandardMaterial color="#685d55" />
            </RoundedBox>
            <mesh
              position={[side * 0.3, seated && seatPose === 'wave' && side === 1 ? 1.02 : 0.62, 0]}
              rotation={[0, 0, seated && seatPose === 'wave' && side === 1 ? -0.6 : 0]}
              castShadow
            >
              <capsuleGeometry args={[0.055, 0.25, 4, 6]} />
              <meshStandardMaterial color="#e7c3a2" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.18, 0]} castShadow>
          <sphereGeometry args={[0.25, 12, 10]} />
          <meshStandardMaterial color="#e7c3a2" roughness={1} />
        </mesh>
        <mesh position={[0, 1.3, -0.025]} scale={[1, 0.6, 1]} castShadow>
          <sphereGeometry args={[0.26, 12, 8]} />
          <meshStandardMaterial color="#685043" />
        </mesh>
        {[-0.085, 0.085].map((x) => (
          <mesh key={x} position={[x, 1.2, 0.23]}>
            <sphereGeometry args={[0.023, 6, 6]} />
            <meshBasicMaterial color="#45392f" />
          </mesh>
        ))}
        <AvatarExtras
          crown={crown}
          cosmetic={cosmetic}
          cosmeticExpires={cosmeticExpires}
          snack={snack}
          snackExpires={snackExpires}
          reaction={reaction}
        />
      </group>
    </group>
  );
}
