/**
 * Secrets at rest — the Supabase session (its refresh token opens every shared
 * row and the AI key in `app_config`) and the SMTP password.
 *
 * Windows: sealed with `safeStorage`, which is DPAPI there — bound to the user's
 * Windows login, no prompt, and unaffected by app updates. A stolen
 * `supabase-session.json` or `config.json` is then useless on another account or
 * machine.
 *
 * macOS: deliberately left as plain text. There `safeStorage` keys off a Keychain
 * item whose access list names the app's code signature, and FileFunky is
 * ad-hoc signed (`identity: "-"`): every update is a new signature, so after each
 * update macOS would ask the user to allow Keychain access — or, declined,
 * silently log them out and drop the SMTP password. Revisit once the app is
 * signed with a real Developer ID. The files stay in the user's own profile.
 *
 * Migration is transparent: a plain value found where a sealed one is expected
 * is returned as is and re-sealed in place; a sealed value that no longer
 * decrypts (profile copied to another machine, Windows password reset) reads as
 * absent — the user logs in again or re-enters the password; nothing crashes.
 */

import { app, safeStorage } from 'electron';
import log from 'electron-log';

/** Marks a sealed value. Plain values never start with it: they are tokens, JSON or a password. */
const SEALED_PREFIX = 'ffsafe1:';

/** Whether this machine seals: Windows only, and only once the app is ready (DPAPI needs it). */
function canSeal(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** The form to store `plain` in on this machine: sealed on Windows, as is elsewhere. */
export function sealSecret(plain: string): string {
  if (!plain || !canSeal()) return plain;
  try {
    return SEALED_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch (error: unknown) {
    // Better stored as before than lost: the user would be logged out for nothing.
    log.warn('[SECRETS] sealing failed, keeping the value unsealed:', error instanceof Error ? error.message : error);
    return plain;
  }
}

/**
 * The plain value of a stored secret, or null when it cannot be read. A plain
 * value on a machine that seals is passed to `reseal` in its sealed form, so the
 * caller can write it back — the one-time migration of an existing install.
 */
export function openSecret(stored: string, reseal?: (sealed: string) => void): string | null {
  if (!stored.startsWith(SEALED_PREFIX)) {
    if (stored && reseal && canSeal()) {
      const sealed = sealSecret(stored);
      if (sealed !== stored) {
        try {
          reseal(sealed);
        } catch (error: unknown) {
          log.warn('[SECRETS] re-sealing failed:', error instanceof Error ? error.message : error);
        }
      }
    }
    return stored;
  }
  if (!canSeal()) {
    log.warn('[SECRETS] a sealed value cannot be opened on this machine — treated as absent');
    return null;
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'));
  } catch (error: unknown) {
    log.warn('[SECRETS] a sealed value did not decrypt — treated as absent:', error instanceof Error ? error.message : error);
    return null;
  }
}
