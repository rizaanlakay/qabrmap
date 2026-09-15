import { createHash } from 'node:crypto';

// Server only. Hashes the decoded image bytes, so the same photo is recognised whatever its data URL header says.
export function photoHash(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}
