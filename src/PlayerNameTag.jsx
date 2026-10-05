import { useEffect, useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import { CanvasTexture, SRGBColorSpace } from 'three';

export default function PlayerNameTag({ name, voiceEnabled, voiceMuted, heightOffset = 0 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const label = name || 'Guest';
    const font = '600 48px system-ui, sans-serif';
    context.font = font;
    // Measure actual letters so short names stay compact without stretching the text.
    const textWidth = Math.ceil(context.measureText(label).width);
    const badgeWidth = textWidth + 64 + (voiceEnabled ? 68 : 0);
    canvas.width = badgeWidth + 24;
    canvas.height = 112;

    // Resizing a canvas resets its drawing settings, including the font.
    context.font = font;
    context.fillStyle = '#314e46';
    context.shadowColor = 'rgba(20, 36, 29, 0.28)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 4;
    context.beginPath();
    context.roundRect(12, 8, badgeWidth, 88, 32);
    context.fill();
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.strokeStyle = 'rgba(237, 243, 218, 0.35)';
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = '#fff8e8';
    context.textBaseline = 'middle';
    context.fillText(label, 44, 54);

    if (voiceEnabled) {
      const iconX = 44 + textWidth + 36;
      context.strokeStyle = 'rgba(237, 243, 218, 0.22)';
      context.beginPath();
      context.moveTo(iconX - 24, 31);
      context.lineTo(iconX - 24, 73);
      context.stroke();

      // This shows microphone availability/mute, not whether someone is speaking.
      context.strokeStyle = voiceMuted ? '#f1b4a7' : '#bce1b0';
      context.lineWidth = 4;
      context.lineCap = 'round';
      context.beginPath();
      context.roundRect(iconX - 8, 29, 16, 29, 8);
      context.stroke();
      context.beginPath();
      context.arc(iconX, 50, 15, 0, Math.PI);
      context.moveTo(iconX, 65);
      context.lineTo(iconX, 75);
      context.moveTo(iconX - 9, 75);
      context.lineTo(iconX + 9, 75);
      if (voiceMuted) {
        context.moveTo(iconX - 19, 30);
        context.lineTo(iconX + 19, 74);
      }
      context.stroke();
    }

    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [name, voiceEnabled, voiceMuted]);

  // Release the previous GPU texture when the name or microphone state changes.
  useEffect(() => () => texture.dispose(), [texture]);

  const height = 0.55;
  const width = height * texture.image.width / texture.image.height;

  return <Billboard position={[0, 1.9 + heightOffset, 0]}>
    <mesh renderOrder={100}>
      <planeGeometry args={[width, height]} />
      {/* Transparent corners preserve the rounded shape; labels stay readable behind scenery. */}
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthTest={false} depthWrite={false} />
    </mesh>
  </Billboard>;
}
