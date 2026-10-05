import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';

export function SceneSurface({ surface, scene, reduced }) {
  const ref = useRef(null);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const c = canvas.getContext('2d');
    const colors = {
      space: ['#192039', '#6d629b'],
      rain: ['#657186', '#aaa5b1'],
      beach: ['#8cc5d1', '#e9d5a6'],
      sea: ['#175878', '#7aa9af'],
    };
    const [sky, land] = colors[scene] ?? colors.space;
    c.fillStyle = sky;
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = land;
    c.fillRect(0, 150, 256, 106);
    if (scene === 'space') {
      c.fillStyle = '#cec3ec';
      c.beginPath();
      c.arc(120, 135, 50, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 35; i++) {
        c.fillStyle = '#efead7';
        c.fillRect((i * 73) % 256, (i * 31) % 140, 2, 2);
      }
    }
    if (scene === 'rain')
      for (let i = 0; i < 12; i++) {
        c.fillStyle = i % 2 ? '#51576c' : '#7c8094';
        c.fillRect(i * 23, 90 + ((i * 43) % 90), 20, 180);
        c.fillStyle = '#e1ce9d';
        c.fillRect(i * 23 + 5, 120 + ((i * 43) % 70), 5, 6);
      }
    if (scene === 'beach') {
      c.fillStyle = '#f4deb0';
      c.beginPath();
      c.arc(190, 50, 22, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#63aebc';
      c.fillRect(0, 145, 256, 35);
    }
    if (scene === 'sea') {
      for (let i = 0; i < 10; i++) {
        c.fillStyle = i % 2 ? '#648b62' : '#8eae78';
        c.fillRect(i * 29, 195 - ((i * 13) % 60), 7, 100);
      }
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [scene]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ clock }) => {
    if (ref.current)
      ref.current.position.x = reduced ? 0 : Math.sin(clock.elapsedTime * 0.25) * 0.004;
  });
  return (
    <group>
      <mesh position={[0, surface.y, surface.z + 0.004]}>
        <planeGeometry args={[surface.width, surface.height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <group ref={ref} position={[0, 0, 0]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh
            key={i}
            position={[
              ((i - 2.5) * surface.width) / 7,
              surface.y + ((((i * 17) % 10) - 5) * surface.height) / 14,
              surface.z + 0.008,
            ]}
          >
            <circleGeometry args={[scene === 'rain' ? 0.006 : 0.012, 6]} />
            <meshBasicMaterial
              color={scene === 'space' ? '#ece4c9' : '#afd0da'}
              transparent
              opacity={0.6}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
