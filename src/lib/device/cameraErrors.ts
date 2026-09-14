// Readable reasons a camera stream could not start, from the DOMException names getUserMedia rejects with
export function describeCameraError(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found';
    case 'NotReadableError':
      return 'Camera is in use by another app';
    default:
      return 'Camera unavailable';
  }
}
