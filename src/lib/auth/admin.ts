/**
 * Administrator access control for QabrMap.
 * Restricted exclusively to authorized administrator emails.
 */

export const DEFAULT_ADMIN_EMAIL = 'rizaan@gmail.com';

export const ADMIN_EMAILS: readonly string[] = Object.freeze([
  DEFAULT_ADMIN_EMAIL,
  ...(process.env.NEXT_PUBLIC_ADMIN_EMAILS
    ? process.env.NEXT_PUBLIC_ADMIN_EMAILS.split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : []),
]);

/**
 * Validates whether the given user or email address has administrator privileges.
 */
export function isAdminUser(
  userOrEmail: { email?: string | null } | string | null | undefined
): boolean {
  if (!userOrEmail) return false;
  const rawEmail = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail.email;
  if (!rawEmail) return false;
  const normalized = rawEmail.trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalized);
}
