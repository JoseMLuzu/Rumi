import { Suspense } from 'react';
import FurnitureModel, { BoxPart } from './FurnitureModel.jsx';
import InteractiveModel from './objects/InteractiveModel.jsx';
import { OBJECTS } from './data/furniture.js';
import { FURNITURE_CATALOG } from './data/furniture.js';

function FootprintMarker({ width, depth, color }) {
  const edges = [
    {
      size: [width + 0.1, 0.025, 0.045],
      position: [0, 0.025, -depth / 2 - 0.05],
    },
    {
      size: [width + 0.1, 0.025, 0.045],
      position: [0, 0.025, depth / 2 + 0.05],
    },
    {
      size: [0.045, 0.025, depth + 0.1],
      position: [-width / 2 - 0.05, 0.025, 0],
    },
    {
      size: [0.045, 0.025, depth + 0.1],
      position: [width / 2 + 0.05, 0.025, 0],
    },
  ];
  return edges.map((edge, index) => (
    <mesh key={index} position={edge.position}>
      <boxGeometry args={edge.size} />
      <meshBasicMaterial color={color} />
    </mesh>
  ));
}

export default function Furniture({
  item,
  selected = false,
  preview = false,
  valid = true,
  onSelect,
  cozy = false,
  onInteract,
  playerRef,
  peers,
  onFish,
  lights = false,
  motionPaused = false,
}) {
  const { width, depth } = FURNITURE_CATALOG[item.type];
  return (
    <group
      position={item.position}
      rotation={[0, item.rotation, 0]}
      scale={item.scale ?? 1}
      onClick={
        onSelect || onInteract
          ? (event) => {
              // Stop the floor behind this piece from also receiving the click.
              event.stopPropagation();
              if (onSelect) onSelect(item.id);
              else onInteract(item.id);
            }
          : undefined
      }
    >
      {OBJECTS[item.type] ? (
        <Suspense
          fallback={<BoxPart size={[0.15, 0.15, 0.15]} position={[0, 0.08, 0]} color="#bbaeca" />}
        >
          <InteractiveModel
            item={item}
            playerRef={playerRef}
            peers={peers}
            onFish={onFish}
            lights={lights}
            motionPaused={motionPaused}
          />
        </Suspense>
      ) : (
        <FurnitureModel type={item.type} cozy={cozy} lights={lights} />
      )}
      {(selected || preview) && (
        <FootprintMarker width={width} depth={depth} color={valid ? '#4c8b75' : '#c46c60'} />
      )}
    </group>
  );
}
