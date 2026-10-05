import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import PlayerAvatar, { AVATAR_HIP_HEIGHT } from './PlayerAvatar.jsx';
import PlayerNameTag from './PlayerNameTag.jsx';

export default function RemotePlayer({ player }) {
  const group = useRef(null);
  const initialPosition = useRef(player.position);
  const target = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    if (!group.current) return;
    target.set(...player.position);
    // Network updates arrive less often than render frames; blend toward the latest pose.
    const blend = 1 - Math.exp(-15 * Math.min(delta, 0.1));
    group.current.position.lerp(target, blend);
    const angle = player.rotation - group.current.rotation.y;
    // atan2 chooses the short turn when an angle crosses -π/π.
    group.current.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * blend;
  });

  return (
    <group ref={group} position={initialPosition.current}>
      <PlayerAvatar
        color="#bd8076"
        seated={player.seated}
        seatHeight={player.seatHeight}
        seatPose={player.seatPose}
        crown={player.crown}
        cosmetic={player.cosmetic}
        cosmeticExpires={player.cosmeticExpires}
        snack={player.snack}
        reaction={player.reaction}
        snackExpires={player.snackExpires}
      />
      <PlayerNameTag
        name={player.name}
        voiceEnabled={player.voiceEnabled}
        voiceMuted={player.voiceMuted}
        heightOffset={player.seated ? player.seatHeight - AVATAR_HIP_HEIGHT : 0}
      />
    </group>
  );
}
