import { dataUrlToBlob } from '../supabase/storage';
import { shrinkPhotoDataUrl } from '../capture/stonePhoto';

export const THUMBNAIL_MAX_EDGE = 160;

// Browser only. The full photo is stored at the size it will be read and uploaded at, plus a small thumbnail.
export async function prepareCapturePhoto(dataUrl: string): Promise<{ photo: Blob; thumbnail: string }> {
  const [full, thumbnail] = await Promise.all([shrinkPhotoDataUrl(dataUrl), shrinkPhotoDataUrl(dataUrl, THUMBNAIL_MAX_EDGE)]);
  return { photo: dataUrlToBlob(full).blob, thumbnail };
}

// Works without FileReader, so it can be tested outside a browser
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}
