import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

export default function RoomSign({ title, subtitle = '', width = 3, height = 0.8, depthTest = true }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f1e9d6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#4e6753';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 44px system-ui';
    context.fillText(title, 384, subtitle ? 70 : 96, 700);
    if (subtitle) {
      context.font = '28px system-ui';
      context.fillText(subtitle, 384, 132, 700);
    }
    // A texture puts locally drawn text on a 3D surface without a separate DOM root.
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [title, subtitle]);

  useEffect(() => () => texture.dispose(), [texture]);

  return <mesh>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial map={texture} toneMapped={false} depthTest={depthTest} />
  </mesh>;
}
