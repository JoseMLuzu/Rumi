import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Texture, SRGBColorSpace, Vector3 } from 'three';
import { OBJECTS } from '../data/furniture.js';
import { imageCrop } from './images.js';
import useReducedMotion from './useReducedMotion.js';
import { SceneSurface } from './SceneSurface.jsx';
import FurnitureModel from '../FurnitureModel.jsx';
import RoomSign from '../RoomSign.jsx';
import { ObjectEffects } from './ObjectEffects.jsx';

const urls = import.meta.glob('../assets/interactive/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
});
const uses = new Map();

export function useImageTexture(url) {
  const [texture, setTexture] = useState(null);
  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    setTexture(null);
    let active = true,
      loaded = null;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      loaded = new Texture(img);
      loaded.colorSpace = SRGBColorSpace;
      loaded.needsUpdate = true;
      setTexture(loaded);
    };
    img.onerror = () => {
      if (active) setTexture(null);
    };
    img.src = url;
    return () => {
      active = false;
      loaded?.dispose();
      img.removeAttribute('src');
    };
  }, [url]);
  return texture;
}

function ImageSurface({ url, surface, config, z = 0 }) {
  const texture = useImageTexture(url);
  const crop = useMemo(() => {
    if (!texture) return null;
    return imageCrop(
      texture.image.width / texture.image.height,
      surface.width / surface.height,
      config.fit,
      config.crop,
    );
  }, [texture, surface, config.fit, config.crop]);
  useEffect(() => {
    if (!crop) return;
    texture.repeat.set(...crop.repeat);
    texture.offset.set(...crop.offset);
    texture.needsUpdate = true;
  }, [crop, texture]);
  if (!texture || !crop) return null;
  return (
    <mesh position={[0, surface.y, surface.z + 0.003 + z]} rotation={[0, 0, surface.tilt ?? 0]}>
      <planeGeometry args={[surface.width * crop.size[0], surface.height * crop.size[1]]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

export function PreparedModel({ type, config = {}, animate, hideSurface = false, onClick }) {
  const url = urls[`../assets/interactive/${OBJECTS[type].file}`];
  const { scene } = useGLTF(url);
  const clone = useMemo(() => {
    const result = scene.clone(true);
    // Geometry is shared. Each instance owns its materials so a changed frame cannot recolor its neighbours.
    result.traverse((node) => {
      if (node.isMesh) {
        node.material = node.material.clone();
        node.castShadow = true;
        node.receiveShadow = true;
        node.userData.home = node.position.clone();
      }
    });
    return result;
  }, [scene]);
  useEffect(() => {
    clone.traverse((node) => {
      if (!node.isMesh) return;
      if (type === 'retroRadio' && node.material.name === 'teal') {
        node.material.emissive.set('#5cad8b');
        node.material.emissiveIntensity = config.playing ? 0.5 : 0;
      }
      if (type === 'coneLamp' && node.material.name === 'orange') {
        node.material.emissive.set(config.color ?? '#ffce8c');
        node.material.emissiveIntensity = config.active ? 0.4 : 0;
      }
      node.visible =
        !(hideSurface && node.name.startsWith('surface')) && !node.name.startsWith('samples');
      const materialName = node.material.name;
      if (config.frameColor && materialName === 'darkwood')
        node.material.color.set(config.frameColor);
      if (
        config.color &&
        ((type === 'giantDuck' && materialName === 'gold') ||
          (type === 'monsterRug' && materialName === 'purple'))
      )
        node.material.color.set(config.color);
    });
  }, [clone, config.frameColor, config.color, config.playing, config.active, hideSurface, type]);
  useEffect(
    () => () =>
      clone.traverse((node) => {
        if (node.isMesh) node.material.dispose();
      }),
    [clone],
  );
  useEffect(() => {
    const current = uses.get(url) ?? { count: 0, timer: null };
    clearTimeout(current.timer);
    current.count++;
    uses.set(url, current);
    return () => {
      current.count--;
      // Grace time prevents StrictMode/editor transitions from unloading a model in active use.
      current.timer = setTimeout(() => {
        if (current.count) return;
        const resources = new Set();
        scene.traverse((node) => {
          if (node.isMesh) {
            resources.add(node.geometry);
            resources.add(node.material);
            for (const value of Object.values(node.material))
              if (value?.isTexture) resources.add(value);
          }
        });
        resources.forEach((resource) => resource.dispose());
        useGLTF.clear(url);
        uses.delete(url);
      }, 10000);
    };
  }, [url, scene]);
  useFrame((state, delta) => animate?.(clone, state, delta));
  return <primitive object={clone} dispose={null} onClick={onClick} />;
}

function MiniCollection({ values = [], positions }) {
  return values.slice(0, 3).map((type, index) =>
    type ? (
      <group key={`${type}-${index}`} position={positions[index]} scale={0.17}>
        {OBJECTS[type] ? (
          <Suspense fallback={null}>
            <PreparedModel type={type} />
          </Suspense>
        ) : (
          <FurnitureModel type={type} lights={false} />
        )}
      </group>
    ) : null,
  );
}

export default function InteractiveModel({
  item,
  playerRef,
  peers = [],
  onFish,
  lights = false,
  motionPaused = false,
}) {
  const info = OBJECTS[item.type];
  const config = { ...info.defaults, ...item.config };
  const group = useRef(null);
  const prefersReduced = useReducedMotion();
  const reduced = prefersReduced || motionPaused;
  const effect = item.state?.effect;
  const [photoIndex, setPhotoIndex] = useState(0);
  const target = useMemo(() => new Vector3(), []);
  useEffect(() => {
    if (item.type !== 'photoFrame') return;
    const update = () =>
      setPhotoIndex(
        ((item.state?.photoIndex ?? 0) +
          (config.slideshow
            ? Math.floor((Date.now() / 1000 - (item.state?.photoAt ?? 0)) / config.interval)
            : 0)) %
          Math.max(1, config.images.length),
      );
    update();
    if (!config.slideshow) return;
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [
    item.type,
    item.state?.photoIndex,
    item.state?.photoAt,
    config.slideshow,
    config.interval,
    config.images?.length,
  ]);
  const image = config.images?.[item.type === 'photoFrame' ? photoIndex : 0];
  const drawings = item.state?.drawings ?? [];
  const activeEffect = () => !motionPaused && effect && Date.now() / 1000 < effect.expires;
  function animate(clone, state, delta) {
    const time = state.clock.elapsedTime;
    const running = activeEffect();
    const progress = running ? (Date.now() / 1000 - effect.at) / (effect.expires - effect.at) : 0;
    // Always return to the saved transform, instead of accumulating offsets each frame.
    if (group.current) {
      group.current.position.y =
        item.type === 'wingToaster' && running && !reduced
          ? Math.sin(progress * Math.PI) * 0.35
          : 0;
      group.current.scale.set(
        1,
        item.type === 'giantDuck' && running && !reduced
          ? 1 - 0.18 * Math.sin(progress * Math.PI)
          : item.type === 'monsterRug' && running && !reduced
            ? 1 + 0.7 * Math.sin(progress * Math.PI)
            : 1,
        1,
      );
      group.current.rotation.z =
        item.type === 'crookedPicture' && running
          ? 0.14 * (reduced ? 1 : Math.min(1, progress * 8, (1 - progress) * 8))
          : 0;
    }
    let nearest = playerRef?.current?.position;
    let nearestDistance = nearest
      ? Math.hypot(nearest.x - item.position[0], nearest.z - item.position[2])
      : Infinity;
    for (const peer of peers) {
      const d = Math.hypot(
        peer.position[0] - item.position[0],
        peer.position[2] - item.position[2],
      );
      if (d < nearestDistance) {
        target.set(...peer.position);
        nearest = target;
        nearestDistance = d;
      }
    }
    clone.traverse((node) => {
      if (!node.isMesh) return;
      const home = node.userData.home;
      if (node.name.startsWith('fish')) {
        const index = +node.name[4];
        node.position.x = reduced
          ? 0
          : running && effect.action === 'feed'
            ? [0.11, -0.07, -0.02][index]
            : Math.sin(time * 0.55 + index * 2) * 0.06;
        node.position.y = reduced
          ? 0
          : Math.sin(time * 0.8 + index) * 0.018 + (running && effect.action === 'feed' ? 0.1 : 0);
      }
      if (node.name.startsWith('eyes') && nearest && !reduced) {
        const dx = nearest.x - item.position[0],
          dz = nearest.z - item.position[2];
        const localX = dx * Math.cos(item.rotation) - dz * Math.sin(item.rotation);
        node.position.x +=
          (Math.max(-0.018, Math.min(0.018, localX * 0.008)) - node.position.x) *
          (1 - Math.exp(-8 * Math.min(delta, 0.1)));
      }
      if (node.name.startsWith('wing'))
        node.rotation.z =
          running && !reduced
            ? Math.sin(progress * Math.PI * 8) * 0.18 * (node.name.startsWith('wingLeft') ? 1 : -1)
            : 0;
      if (node.name.startsWith('toast')) {
        node.position.y = running && !reduced ? Math.sin(progress * Math.PI) * 0.55 : 0;
        node.visible = running;
      }
      if (node.name.startsWith('leaves'))
        node.rotation.z = running && !reduced ? Math.sin(progress * Math.PI * 4) * 0.08 : 0;
      if (node.name.startsWith('ball'))
        node.rotation.y = item.state?.active && !reduced ? time * 0.2 : 0;
      if (node.name.startsWith('lid')) {
        node.position.y = running
          ? home.y + 0.18 * (reduced ? 1 : Math.sin(progress * Math.PI))
          : home.y;
        node.rotation.x = running && !reduced ? -0.25 * Math.sin(progress * Math.PI) : 0;
      }
      if (node.name.startsWith('door')) {
        node.position.x = home.x;
        node.rotation.y = running ? -0.9 : 0;
      }
    });
  }
  const surfaceConfig =
    item.type === 'visitorBoard' ? { fit: 'contain', crop: [0.5, 0.5] } : config;
  return (
    <group position={info.center.map((n) => -n)}>
      <group ref={group}>
        <PreparedModel
          type={item.type}
          config={{
            ...config,
            playing: !!item.state?.radio?.playing,
            active: !!item.state?.active,
          }}
          animate={animate}
          onClick={
            onFish
              ? (event) => {
                  const name = event.object.name;
                  if (item.type === 'aquarium' && name.startsWith('fish')) {
                    event.stopPropagation();
                    onFish(config.fishNames[Number(name[4])]);
                  }
                }
              : undefined
          }
          hideSurface={!!image || drawings.length > 0 || item.type === 'sceneWindow'}
        />
        {info.surface && image && (
          <ImageSurface url={image} surface={info.surface} config={surfaceConfig} />
        )}
        {item.type === 'visitorBoard' && drawings.length > 0 && (
          <>
            <mesh position={[0, info.surface.y, info.surface.z + 0.001]}>
              <planeGeometry args={[info.surface.width, info.surface.height]} />
              <meshBasicMaterial color="#529b96" />
            </mesh>
            <group position={[0, 0.16, 0.145]}>
              <RoomSign
                title={drawings[drawings.length - 1].author}
                subtitle={drawings[drawings.length - 1].text.slice(0, 55)}
                width={0.8}
                height={0.14}
              />
            </group>
          </>
        )}
        {item.type === 'visitorBoard' &&
          drawings.map((drawing, index) => (
            <ImageSurface
              key={drawing.id}
              url={drawing.url}
              surface={info.surface}
              config={surfaceConfig}
              z={index * 0.001}
            />
          ))}
        {item.type === 'sceneWindow' && (
          <SceneSurface surface={info.surface} scene={config.scene} reduced={reduced} />
        )}
        {item.type === 'memoryCabinet' && (
          <MiniCollection
            values={config.slots}
            positions={[
              [-0.14, 0.91, 0],
              [0.14, 0.91, 0],
              [0, 0.48, 0],
            ]}
          />
        )}
        {item.type === 'dartRack' && (
          <MiniCollection
            values={config.accessories}
            positions={[
              [-0.25, 0.49, 0.16],
              [0.23, 0.49, 0.16],
              [0, 0.3, 0.16],
            ]}
          />
        )}
        {lights && item.type === 'aquarium' && (
          <pointLight
            position={[0, 0.5, 0]}
            color={config.color}
            intensity={config.intensity}
            distance={1.4}
          />
        )}
        {lights && item.type === 'coneLamp' && item.state?.active && (
          <pointLight
            position={[0, 0.5, 0]}
            color={config.color}
            intensity={config.intensity}
            distance={2.5}
          />
        )}
        {lights && item.type === 'discoBall' && item.state?.active && (
          <>
            <pointLight
              position={[0, 1.4, 0]}
              color={config.color}
              intensity={config.intensity}
              distance={4}
            />
            <ambientLight color={config.color} intensity={config.intensity * 0.08} />
          </>
        )}
        <ObjectEffects effect={motionPaused ? null : effect} type={item.type} reduced={reduced} />
      </group>
    </group>
  );
}
