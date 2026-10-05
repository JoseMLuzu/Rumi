import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { CanvasTexture, ClampToEdgeWrapping, Color, RepeatWrapping, SRGBColorSpace } from 'three';
import { useImageTexture } from './objects/InteractiveModel.jsx';
import { imageCrop } from './objects/images.js';
import citySkyline from './assets/city-skyline.svg';

export function ImageFinish({ source, config, width, height, position, rotation }) {
  // UV transforms belong to each wall, but clones share the decoded image/texture source.
  const map = useMemo(() => source?.clone() ?? null, [source]);
  const crop =
    source &&
    imageCrop(source.image.width / source.image.height, width / height, config.fit, config.crop);
  useEffect(() => {
    if (!map) return;
    if (config.fit === 'tile') {
      map.wrapS = map.wrapT = RepeatWrapping;
      map.repeat.set(
        (config.repeat * (width / height)) / (source.image.width / source.image.height),
        config.repeat,
      );
      map.offset.set(0, 0);
    } else {
      map.wrapS = map.wrapT = ClampToEdgeWrapping;
      map.repeat.set(...crop.repeat);
      map.offset.set(...crop.offset);
    }
    map.needsUpdate = true;
  }, [map, config, width, height, source]);
  useEffect(() => () => map?.dispose(), [map]);
  if (!map) return null;
  const size = config.fit === 'contain' ? crop.size : [1, 1];
  return (
    <mesh position={position} rotation={rotation} receiveShadow raycast={() => null}>
      <planeGeometry args={[width * size[0], height * size[1]]} />
      <meshStandardMaterial map={map} color="white" roughness={0.95} transparent />
    </mesh>
  );
}

export function TileFinish({ size, color }) {
  const map = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#e6e2d7';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(8, 8);
    return texture;
  }, [color]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh
      position={[0, 0.004, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      raycast={() => null}
    >
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={map} roughness={1} />
    </mesh>
  );
}

export function RoomBackdrop({ config }) {
  const { scene, size } = useThree();
  // The city is a static backdrop, not hundreds of buildings in the render loop.
  // An uploaded image takes priority over the preset.
  const source = useImageTexture(config.image || (config.preset === 'city' ? citySkyline : null));
  const background = useMemo(() => {
    if (!source) return new Color(config.color);
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 2048 / Math.max(size.width, size.height));
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = config.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const image = source.image;
    const factors = [canvas.width / image.width, canvas.height / image.height];
    const scale = config.fit === 'contain' ? Math.min(...factors) : Math.max(...factors);
    const width = image.width * scale,
      height = image.height * scale;
    // Compose transparency onto the chosen color, preserving proportion at every viewport size.
    ctx.drawImage(
      image,
      (canvas.width - width) * config.crop[0],
      (canvas.height - height) * config.crop[1],
      width,
      height,
    );
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [source, config, size.width, size.height]);
  useEffect(() => {
    const previous = scene.background;
    scene.background = background;
    return () => {
      if (scene.background === background) scene.background = previous;
      if (background.isTexture) background.dispose();
    };
  }, [scene, background]);
  return null;
}
