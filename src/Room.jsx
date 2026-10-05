import MainHall from './MainHall.jsx';
import { Color } from 'three';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE } from './roomAppearance.js';
import { useImageTexture } from './objects/InteractiveModel.jsx';
import { ImageFinish, TileFinish } from './RoomAppearance.jsx';
import citySkyline from './assets/city-skyline.svg';

export default function Room({
  size,
  wallThickness,
  isEditing,
  isCentral,
  hall,
  onFloorMove,
  onFloorClick,
  appearance = DEFAULT_APPEARANCE,
}) {
  const floorImage = useImageTexture(isCentral ? null : appearance.floor.image);
  const wallImage = useImageTexture(isCentral ? null : appearance.walls.image);
  const windowImage = useImageTexture(isCentral ? null : citySkyline);
  if (isCentral)
    return (
      <MainHall
        hall={hall}
        isEditing={isEditing}
        onFloorMove={onFloorMove}
        onFloorClick={onFloorClick}
      />
    );
  const half = size / 2;
  const floorPreset = APPEARANCE_OPTIONS.floor.presets[appearance.floor.preset];
  const wallPreset = APPEARANCE_OPTIONS.walls.presets[appearance.walls.preset];
  const plankColors =
    appearance.floor.color === floorPreset.color && floorPreset.colors
      ? floorPreset.colors
      : [
          new Color(appearance.floor.color).offsetHSL(0, 0, 0.025).getStyle(),
          appearance.floor.color,
        ];
  // Lower front walls create a cutaway view while keeping all four room edges.
  const walls = [
    {
      position: [0, 1.3, -half],
      size: [size + wallThickness, 2.6, wallThickness],
      face: [0, 1.3, -half + wallThickness / 2 + 0.003],
      width: size - wallThickness,
      height: 2.6,
      angle: 0,
    },
    {
      position: [-half, 1.3, 0],
      size: [wallThickness, 2.6, size - wallThickness],
      face: [-half + wallThickness / 2 + 0.003, 1.3, 0],
      width: size - wallThickness,
      height: 2.6,
      angle: Math.PI / 2,
    },
    // Leave a visible opening for the travel door; movement still uses the room boundary.
    {
      position: [-(half + 1) / 2, 0.2, half],
      size: [half - 1, 0.4, wallThickness],
      face: [-(half + 1) / 2, 0.2, half - wallThickness / 2 - 0.003],
      width: half - 1,
      height: 0.4,
      angle: Math.PI,
    },
    {
      position: [(half + 1) / 2, 0.2, half],
      size: [half - 1, 0.4, wallThickness],
      face: [(half + 1) / 2, 0.2, half - wallThickness / 2 - 0.003],
      width: half - 1,
      height: 0.4,
      angle: Math.PI,
    },
    {
      position: [half, 0.2, 0],
      size: [wallThickness, 0.4, size - wallThickness],
      face: [half - wallThickness / 2 - 0.003, 0.2, 0],
      width: size - wallThickness,
      height: 0.4,
      angle: -Math.PI / 2,
    },
  ];

  return (
    <group>
      <mesh
        position={[0, -0.13, 0]}
        receiveShadow
        onPointerMove={
          isEditing
            ? (event) => {
                event.stopPropagation();
                onFloorMove([event.point.x, 0, event.point.z]);
              }
            : undefined
        }
        onClick={
          isEditing
            ? (event) => {
                event.stopPropagation();
                onFloorClick([event.point.x, 0, event.point.z]);
              }
            : undefined
        }
      >
        <boxGeometry args={[size, 0.26, size]} />
        <meshStandardMaterial color={appearance.floor.color} roughness={0.95} />
      </mesh>

      {!appearance.floor.image &&
        floorPreset.pattern === 'planks' &&
        Array.from({ length: 10 }, (_, index) => (
          <mesh
            key={index}
            position={[-half + size / 20 + (index * size) / 10, 0.005, 0]}
            receiveShadow
          >
            <boxGeometry args={[size / 10 - 0.03, 0.01, size - wallThickness]} />
            <meshStandardMaterial color={plankColors[index % 2]} roughness={0.95} />
          </mesh>
        ))}
      {!appearance.floor.image && floorPreset.pattern === 'tiles' && (
        <TileFinish size={size} color={appearance.floor.color} />
      )}
      <ImageFinish
        source={floorImage}
        config={appearance.floor}
        width={size}
        height={size}
        position={[0, 0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {walls.map((wall, index) => (
        <group key={index}>
          <mesh position={wall.position} castShadow receiveShadow>
            <boxGeometry args={wall.size} />
            <meshStandardMaterial
              color={
                index === 1 && appearance.walls.color === wallPreset.color
                  ? (wallPreset.accent ?? appearance.walls.color)
                  : appearance.walls.color
              }
              roughness={1}
            />
          </mesh>
          <ImageFinish
            source={wallImage}
            config={appearance.walls}
            width={wall.width}
            height={wall.height}
            position={wall.face}
            rotation={[0, wall.angle, 0]}
          />
        </group>
      ))}

      <mesh position={[0, 0.08, -half + 0.12]} receiveShadow>
        <boxGeometry args={[size - wallThickness, 0.16, 0.06]} />
        <meshStandardMaterial color="#b39170" />
      </mesh>
      <mesh position={[-half + 0.12, 0.08, 0]} receiveShadow>
        <boxGeometry args={[0.06, 0.16, size - wallThickness]} />
        <meshStandardMaterial color="#b39170" />
      </mesh>

      {/* The window shows the same elevated city view as the default backdrop. */}
      <mesh position={[0.2, 1.65, -half + 0.14]}>
        <boxGeometry args={[1.8, 1.25, 0.1]} />
        <meshStandardMaterial color="#b98e6d" />
      </mesh>
      <mesh position={[0.2, 1.65, -half + 0.2]}>
        <boxGeometry args={[1.55, 1, 0.035]} />
        {/* Rebuild the shader after loading: changing from no map to a map needs new defines. */}
        <meshBasicMaterial
          key={windowImage ? 'city' : 'loading'}
          map={windowImage}
          color={windowImage ? 'white' : '#c3d8d1'}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0.2, 1.65, -half + 0.23]}>
        <boxGeometry args={[0.065, 1, 0.025]} />
        <meshStandardMaterial color="#b98e6d" />
      </mesh>

      <mesh position={[-0.6, 0.025, 1.7]} receiveShadow>
        <cylinderGeometry args={[1.2, 1.2, 0.025, 32]} />
        <meshStandardMaterial color="#e8daca" roughness={1} />
      </mesh>
      {isEditing && (
        <gridHelper
          args={[size, 20, '#918578', '#aa9e8f']}
          position={[0, 0.045, 0]}
          material-transparent
          material-opacity={0.25}
        />
      )}
    </group>
  );
}
