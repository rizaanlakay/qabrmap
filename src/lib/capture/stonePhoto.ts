// Photos are shrunk before being read: detail beyond this adds cost and upload time, not accuracy
export const STONE_PHOTO_MAX_EDGE = 1600;

export function scaledSize(width: number, height: number, maxEdge = STONE_PHOTO_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Browser only. Returns the original photo when it is already small enough or can't be redrawn.
export function shrinkPhotoDataUrl(dataUrl: string, maxEdge = STONE_PHOTO_MAX_EDGE): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const size = scaledSize(image.naturalWidth, image.naturalHeight, maxEdge);
      if (size.width === image.naturalWidth && size.height === image.naturalHeight) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(image, 0, 0, size.width, size.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}
