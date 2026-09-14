import { describe, it, expect } from 'vitest';
import { describeCameraError } from '../src/lib/device/cameraErrors';

describe('Camera Error Message Tests', () => {
  it('explains the common reasons a camera will not start', () => {
    expect(describeCameraError(new DOMException('denied', 'NotAllowedError'))).toBe('Camera permission denied');
    expect(describeCameraError(new DOMException('insecure', 'SecurityError'))).toBe('Camera permission denied');
    expect(describeCameraError(new DOMException('none', 'NotFoundError'))).toBe('No camera found');
    expect(describeCameraError(new DOMException('facing mode', 'OverconstrainedError'))).toBe('No camera found');
    expect(describeCameraError(new DOMException('busy', 'NotReadableError'))).toBe('Camera is in use by another app');
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeCameraError(new Error('boom'))).toBe('Camera unavailable');
    expect(describeCameraError(undefined)).toBe('Camera unavailable');
    expect(describeCameraError('NotAllowedError')).toBe('Camera unavailable');
  });
});
