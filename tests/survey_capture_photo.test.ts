import { describe, it, expect } from 'vitest';
import { blobToDataUrl } from '../src/lib/surveys/capturePhoto';
import { dataUrlToBlob } from '../src/lib/supabase/storage';

describe('Capture Photo Tests', () => {
  it('turns a stored photo back into the data URL the reader and uploader expect', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const dataUrl = await blobToDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const { blob, mimeType } = dataUrlToBlob(dataUrl);
    expect(mimeType).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('assumes JPEG when a stored photo has no type', async () => {
    await expect(blobToDataUrl(new Blob([new Uint8Array([1])]))).resolves.toBe('data:image/jpeg;base64,AQ==');
  });
});
