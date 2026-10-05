import { useImageTexture } from './objects/InteractiveModel.jsx';
import citySkyline from './assets/city-skyline.svg';

// Repeated geometry lives here; the backend supplies dimensions and door positions.
function WoodFloor({ width, depth }) {
  return (
    <group>
      <mesh position={[0, -0.13, 0]} receiveShadow>
        <boxGeometry args={[width, 0.26, depth]} />
        <meshStandardMaterial color="#c7a47d" roughness={0.9} />
      </mesh>
      {Array.from({ length: Math.floor(depth / 0.65) }, (_, index) => (
        <mesh key={index} position={[0, 0.004, -depth / 2 + (index + 1) * 0.65]} receiveShadow>
          <boxGeometry args={[width, 0.008, 0.015]} />
          <meshStandardMaterial color="#b6926e" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Wall({ position, size, color = '#e5d8bd' }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <mesh position={[0, -size[1] / 2 + 0.08, 0]}>
        <boxGeometry args={[size[0] + 0.03, 0.16, size[2] + 0.03]} />
        <meshStandardMaterial color="#f7efdc" />
      </mesh>
    </group>
  );
}

function Window({ position, cityTexture }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.9, 1.3, 0.08]} />
        <meshStandardMaterial color="#a78764" />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[1.66, 1.08, 0.06]} />
        {/* The loaded material must compile with texture support instead of the fallback shader. */}
        <meshBasicMaterial
          key={cityTexture ? 'city' : 'loading'}
          map={cityTexture}
          color={cityTexture ? 'white' : '#e2e9d8'}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <boxGeometry args={[0.07, 1.1, 0.04]} />
        <meshStandardMaterial color="#fff5dd" />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <boxGeometry args={[1.68, 0.06, 0.04]} />
        <meshStandardMaterial color="#fff5dd" />
      </mesh>
      {[-1.05, 1.05].map((x) => (
        <mesh key={x} position={[x, -0.06, 0.12]}>
          <boxGeometry args={[0.45, 1.48, 0.1]} />
          <meshStandardMaterial color="#c6b29c" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function BedroomShell({ door, hall, index }) {
  const side = Math.sign(door.position[2]);
  const width = hall.bedroomWidth;
  const depth = hall.bedroomDepth;
  const front = (-side * depth) / 2;
  const wallHeight = 2.8;
  const doorHeight = 2.2;
  const color = ['#d3d8bc', '#e6d5c0', '#dfc7b8', '#c9d5cb'][index % 4];
  return (
    <group position={[door.position[0], 0, side * (hall.corridorWidth / 2 + depth / 2)]}>
      {/* Outside bedrooms are opaque shells. The saved interior loads after entering. */}
      {[-1, 1].map((sign) => (
        <Wall
          key={sign}
          position={[sign * (width / 4 + 0.5), wallHeight / 2, front]}
          size={[width / 2 - 1, wallHeight, 0.18]}
          color={color}
        />
      ))}
      <mesh position={[0, (wallHeight + doorHeight) / 2, front]} castShadow receiveShadow>
        <boxGeometry args={[2, wallHeight - doorHeight, 0.18]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      {[-1, 1].map((sign) => (
        <Wall
          key={sign}
          position={[(sign * width) / 2, wallHeight / 2, 0]}
          size={[0.18, wallHeight, depth]}
          color={color}
        />
      ))}
      <Wall
        position={[0, wallHeight / 2, (side * depth) / 2]}
        size={[width, wallHeight, 0.18]}
        color={color}
      />
      <mesh position={[0, wallHeight + 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.18, 0.16, depth + 0.18]} />
        <meshStandardMaterial color="#ede5d6" roughness={1} />
      </mesh>
    </group>
  );
}

export default function MainHall({ hall, isEditing, onFloorMove, onFloorClick }) {
  // Both panes share one texture; no extra lights or live reflections are needed.
  const cityTexture = useImageTexture(citySkyline);
  const length = hall.halfLength * 2;
  const hallwayLength = hall.halfLength - 5;
  return (
    <group>
      <WoodFloor width={length} depth={hall.corridorWidth} />
      <WoodFloor width={10} depth={10} />
      {isEditing && (
        <>
          {/* One invisible hit surface sits above rugs and floor seams, only inside the living room. */}
          <mesh
            position={[0, 0.05, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerMove={(event) => {
              event.stopPropagation();
              onFloorMove([event.point.x, 0, event.point.z]);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onFloorClick([event.point.x, 0, event.point.z]);
            }}
          >
            <planeGeometry args={[10, 10]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <gridHelper
            args={[10, 20, '#918578', '#aa9e8f']}
            position={[0, 0.06, 0]}
            material-transparent
            material-opacity={0.25}
          />
        </>
      )}
      {/* A reading-corner rug and emissive fairy lights add warmth without extra shadow lights. */}
      <mesh position={[-2.45, 0.018, 2.85]} receiveShadow>
        <cylinderGeometry args={[1.55, 1.55, 0.025, 40]} />
        <meshStandardMaterial color="#a8987c" roughness={1} />
      </mesh>
      <mesh position={[-2.45, 0.034, 2.85]} receiveShadow>
        <cylinderGeometry args={[1.43, 1.43, 0.015, 40]} />
        <meshStandardMaterial color="#c5bea2" roughness={1} />
      </mesh>
      <mesh position={[0, 2.4, -4.88]}>
        <boxGeometry args={[9, 0.018, 0.018]} />
        <meshStandardMaterial color="#8c7c62" />
      </mesh>
      {[-4.3, -3.6, -2.9, -2.2, 2.2, 2.9, 3.6, 4.3].map((x) => (
        <group key={x} position={[x, 2.4, -4.86]}>
          <mesh position={[0, -0.09, 0]}>
            <boxGeometry args={[0.012, 0.18, 0.012]} />
            <meshStandardMaterial color="#8c7c62" />
          </mesh>
          <mesh position={[0, -0.21, 0]}>
            <sphereGeometry args={[0.065, 8, 6]} />
            <meshStandardMaterial color="#ffe4af" emissive="#ffd18b" emissiveIntensity={1.2} />
          </mesh>
        </group>
      ))}
      {/* The living room stays central; runners guide walking into its hallways. */}
      <mesh position={[0, 0.016, -0.7]} receiveShadow>
        <boxGeometry args={[6.5, 0.025, 4.9]} />
        <meshStandardMaterial color="#b9b798" roughness={1} />
      </mesh>
      <mesh position={[0, 0.033, -0.7]} receiveShadow>
        <boxGeometry args={[6.05, 0.014, 4.45]} />
        <meshStandardMaterial color="#c9c5a7" roughness={1} />
      </mesh>
      <Wall position={[0, 1.15, -5]} size={[10, 2.3, 0.18]} />
      <Wall position={[0, 0.2, 5]} size={[10, 0.4, 0.18]} />
      {[-1, 1].flatMap((side) =>
        [-1, 1].map((end) => (
          <Wall
            key={`${side}-${end}`}
            position={[side * 5, 0.5, (end * (5 + hall.corridorWidth / 2)) / 2]}
            size={[0.18, 1, 5 - hall.corridorWidth / 2]}
          />
        )),
      )}
      <Window position={[-3.3, 1.35, -4.85]} cityTexture={cityTexture} />
      <Window position={[3.3, 1.35, -4.85]} cityTexture={cityTexture} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Wall
            position={[side * hall.halfLength, 0.7, 0]}
            size={[0.18, 1.4, hall.corridorWidth]}
          />
          {hallwayLength > 0 && (
            <>
              <mesh position={[side * (5 + hallwayLength / 2), 0.014, 0]} receiveShadow>
                <boxGeometry args={[hallwayLength, 0.025, 1.5]} />
                <meshStandardMaterial color="#bb8f77" roughness={1} />
              </mesh>
              <mesh position={[side * (5 + hallwayLength / 2), 0.029, 0]} receiveShadow>
                <boxGeometry args={[hallwayLength - 0.25, 0.012, 1.22]} />
                <meshStandardMaterial color="#d6b39a" roughness={1} />
              </mesh>
            </>
          )}
        </group>
      ))}
      {hall.doors.map((door, index) => (
        <BedroomShell key={door.roomId} door={door} hall={hall} index={index} />
      ))}
    </group>
  );
}
