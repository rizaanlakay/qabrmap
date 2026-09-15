import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataUrlToBlob, uploadGravePhoto, GRAVE_PHOTOS_BUCKET } from '../src/lib/supabase/storage';
import { offlineDb } from '../src/lib/offline/db';

describe('Supabase Storage & Gravestone Photo Management Tests', () => {
  beforeEach(async () => {
    await offlineDb.graves.clear();
  });

  it('correctly converts base64 DataURL into binary Blob and extracts MIME type', () => {
    // 1x1 transparent GIF / mock jpeg base64
    const mockJpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const result = dataUrlToBlob(mockJpegDataUrl);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.blob).toBeDefined();
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe('image/jpeg');
  });

  it('correctly parses PNG DataURLs', () => {
    const mockPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = dataUrlToBlob(mockPngDataUrl);

    expect(result.mimeType).toBe('image/png');
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('bypasses upload for existing remote HTTP / static SVG URLs', async () => {
    const staticUrl = '/sample-gravestone.svg';
    const res = await uploadGravePhoto({
      file: staticUrl,
      cemeteryId: 'cem_mowbray',
    });

    expect(res).toBeDefined();
    expect(res?.publicUrl).toBe(staticUrl);
    expect(res?.path).toBe('');

    const remoteUrl = 'https://mtrfkytpzvdeieicuuia.supabase.co/storage/v1/object/public/grave-photos/mowbray/grave_1.jpg';
    const remoteRes = await uploadGravePhoto({
      file: remoteUrl,
    });
    expect(remoteRes?.publicUrl).toBe(remoteUrl);
  });

  it('uses grave-photos as the target storage bucket', () => {
    expect(GRAVE_PHOTOS_BUCKET).toBe('grave-photos');
  });
});
