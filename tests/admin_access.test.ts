import { describe, it, expect } from 'vitest';
import { isAdminUser, DEFAULT_ADMIN_EMAIL } from '../src/lib/auth/admin';

describe('Administrator Access Control Tests', () => {
  it('default admin email is rizaan@gmail.com', () => {
    expect(DEFAULT_ADMIN_EMAIL).toBe('rizaan@gmail.com');
  });

  it('recognizes rizaan@gmail.com as authorized administrator', () => {
    expect(isAdminUser('rizaan@gmail.com')).toBe(true);
    expect(isAdminUser('RIZAAN@GMAIL.COM')).toBe(true);
    expect(isAdminUser('  rizaan@gmail.com  ')).toBe(true);
    expect(isAdminUser({ email: 'rizaan@gmail.com' })).toBe(true);
  });

  it('rejects unauthorized users and visitors', () => {
    expect(isAdminUser('visitor@gmail.com')).toBe(false);
    expect(isAdminUser('user@example.com')).toBe(false);
    expect(isAdminUser('admin@qabrmap.com')).toBe(false);
    expect(isAdminUser({ email: 'user@example.com' })).toBe(false);
  });

  it('handles null, undefined, or empty values safely', () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser('')).toBe(false);
    expect(isAdminUser({})).toBe(false);
    expect(isAdminUser({ email: undefined })).toBe(false);
  });
});
