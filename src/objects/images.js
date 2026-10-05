import { requestJSON } from '../api.js';

export async function prepareImage(file) {
  if (!file || file.size === 0) throw new Error('Selecciona una imagen válida.');
  if (file.size > 10 * 1024 * 1024) throw new Error('La imagen supera el límite de 10 MB.');
  let bitmap;
  try {
    // The decoder applies EXIF orientation before resizing and drawing the photograph.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      'No se puede decodificar esta imagen. Si es HEIC u otro formato no compatible, conviértela a JPG, PNG o WebP.',
    );
  }
  if (bitmap.width * bitmap.height > 25_000_000) {
    bitmap.close();
    throw new Error('La imagen supera 25 millones de píxeles. Redúcela antes de subirla.');
  }
  const ratio = Math.min(1, 2048 / bitmap.width, 2048 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // WebP preserves transparency; there is no full-resolution original GPU texture.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob) throw new Error('No se pudo convertir la imagen.');
  return blob;
}

export async function uploadMedia(roomId, file, purpose = 'image') {
  const body = new FormData();
  body.append('file', file, file.name || 'image.webp');
  body.append('purpose', purpose);
  return requestJSON(`/api/rooms/${roomId}/media`, { method: 'POST', body });
}

// Crop calculations are shared by the 3D surface and the preview in the editor.
export function imageCrop(imageAspect, surfaceAspect, fit, position = [0.5, 0.5]) {
  if (fit === 'cover') {
    const x = Math.min(1, surfaceAspect / imageAspect),
      y = Math.min(1, imageAspect / surfaceAspect);
    return {
      repeat: [x, y],
      offset: [(1 - x) * position[0], (1 - y) * (1 - position[1])],
      size: [1, 1],
    };
  }
  return {
    repeat: [1, 1],
    offset: [0, 0],
    size: [Math.min(1, imageAspect / surfaceAspect), Math.min(1, surfaceAspect / imageAspect)],
  };
}
