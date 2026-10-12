/**
 * Client-side mirror of the validation in pi-server/auth.py.
 *
 * The server re-checks everything -- these rules exist so the farmer is told
 * about a problem immediately instead of after a round trip. Keep the two in
 * step when either changes.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt only reads the first 72 bytes of a password; the server rejects longer. */
export const PASSWORD_MAX_BYTES = 72;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The Pi stores usernames lower-cased, so normalise before sending or comparing. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** UTF-8 byte length without TextEncoder, which Hermes does not guarantee. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Returns an error message, or null when the username is acceptable. */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!username) return "Enter a username.";
  if (username.length < USERNAME_MIN_LENGTH) return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
  if (username.length > USERNAME_MAX_LENGTH) return `Username must be at most ${USERNAME_MAX_LENGTH} characters.`;
  if (!USERNAME_PATTERN.test(username)) return "Use only letters, numbers, dot, dash and underscore.";
  return null;
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string, confirm?: string): string | null {
  if (!password) return "Enter a password.";
  // Byte limit first, matching the server: bcrypt refuses longer input outright.
  if (utf8Length(password) > PASSWORD_MAX_BYTES) return `Password is too long (maximum ${PASSWORD_MAX_BYTES} bytes).`;
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (confirm !== undefined && password !== confirm) return "The passwords do not match.";
  return null;
}
