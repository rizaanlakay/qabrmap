// Supabase Storage Manager for Gravestone Photos
// Bucket: 'grave-photos'

import { supabase, isSupabaseConfigured } from './client';

export const GRAVE_PHOTOS_BUCKET = 'grave-photos';

/**
 * Converts a base64 data URL to a binary Blob
 */
export function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binaryStr =
    typeof atob !== 'undefined'
      ? atob(parts[1])
      : Buffer.from(parts[1], 'base64').toString('binary');
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

export interface UploadPhotoOptions {
  file: Blob | string; // Base64 Data URL or Blob
  cemeteryId?: string;
  graveId?: string;
  fileName?: string;
}

export interface UploadPhotoResult {
  publicUrl: string;
  path: string;
}

/**
 * Uploads a gravestone photo to Supabase Storage ('grave-photos' bucket)
 */
export async function uploadGravePhoto({
  file,
  cemeteryId = 'general',
  graveId = `grave_${Date.now()}`,
  fileName,
}: UploadPhotoOptions): Promise<UploadPhotoResult | null> {
  // If already a remote URL or default placeholder, do not re-upload
  if (
    typeof file === 'string' &&
    (file.startsWith('http://') || file.startsWith('https://') || file.startsWith('/'))
  ) {
    return {
      publicUrl: file,
      path: '',
    };
  }

  if (!isSupabaseConfigured || !supabase) {
    console.warn('Supabase not configured, cannot upload photo to storage');
    return null;
  }

  try {
    let fileBody: Blob | Uint8Array;
    let contentType = 'image/jpeg';

    if (typeof file === 'string' && file.startsWith('data:')) {
      const parsed = dataUrlToBlob(file);
      fileBody = parsed.blob;
      contentType = parsed.mimeType;
    } else if (file instanceof Blob) {
      fileBody = file;
      contentType = file.type || 'image/jpeg';
    } else {
      console.warn('Unsupported file format for upload');
      return null;
    }

    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : 'jpg';
    const cleanCemId = cemeteryId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanGraveId = graveId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = fileName || `${cleanGraveId}_${Date.now()}.${ext}`;
    const filePath = `${cleanCemId}/${name}`;

    const { error: uploadError } = await supabase.storage
      .from(GRAVE_PHOTOS_BUCKET)
      .upload(filePath, fileBody, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      throw uploadError;
    }

    const { data } = supabase.storage
      .from(GRAVE_PHOTOS_BUCKET)
      .getPublicUrl(filePath);

    return {
      publicUrl: data.publicUrl,
      path: filePath,
    };
  } catch (err) {
    console.error('Failed to upload grave photo to Supabase Storage:', err);
    throw err;
  }
}

/**
 * Gets the public URL for a stored photo path
 */
export function getGravePhotoPublicUrl(path: string): string {
  if (!isSupabaseConfigured || !supabase) return '';
  const { data } = supabase.storage.from(GRAVE_PHOTOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Deletes a photo from Supabase Storage
 */
export async function deleteGravePhoto(path: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !path) return false;
  try {
    const { error } = await supabase.storage.from(GRAVE_PHOTOS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}
