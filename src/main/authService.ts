import log from 'electron-log';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import {
  getSupabase,
  markSignedIn,
  markSignedOut,
  reportSessionLost,
  storedSessionUser,
} from './supabaseClient';
import { AppError } from '../shared/app-errors';

export interface SessionInfo {
  email: string;
  userId: string;
}

/**
 * True only while `signOut()` below is running. supabase-js emits the same
 * `SIGNED_OUT` event for "the user clicked Wyloguj" and "the refresh token was
 * rejected, session dropped" — this flag keeps the second case from being
 * announced as an expiry when it was the user's own doing.
 */
let signingOutOnPurpose = false;

export async function signIn(email: string, password: string): Promise<
  { ok: true; session: SessionInfo } | { ok: false; error: string }
> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: new AppError('signInNoUser').message };
  markSignedIn();
  return {
    ok: true,
    session: { email: data.user.email ?? email, userId: data.user.id },
  };
}

export async function signOut(): Promise<void> {
  signingOutOnPurpose = true;
  try {
    await getSupabase().auth.signOut();
  } finally {
    markSignedOut();
    signingOutOnPurpose = false;
  }
}

export async function getSession(): Promise<SessionInfo | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (data.session?.user) {
    return {
      email: data.session.user.email ?? '',
      userId: data.session.user.id,
    };
  }
  // An expired token whose refresh could not reach the server — the app started
  // with the system before the network was up, the machine just woke. The
  // session is still on disk and refreshes on the next request: the user is
  // logged in, not to be sent to the login screen.
  if (error && isAuthRetryableFetchError(error)) {
    const user = storedSessionUser();
    if (user) {
      log.warn('[AUTH] Token nieodświeżony (brak połączenia) — sesja z dysku zostaje');
      return { email: user.email, userId: user.id };
    }
  }
  return null;
}

/**
 * Guard for operations that are worthless without cloud data. Throws the
 * user-facing expiry message so the failure reads as "log in again" instead of
 * surfacing three layers down as a missing bank or an empty address list.
 *
 * Deliberately does NOT announce a lost session: being wrong there would throw
 * the user out of a session that is in fact still alive. The two definitive
 * signals — a REST call whose token cannot be refreshed and supabase-js
 * dropping the session — do the announcing.
 */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) throw new AppError('sessionExpired');
  return session;
}

/**
 * Watch for a session that dies on its own — an expired or revoked refresh
 * token, a password change, a user removed in Supabase. supabase-js clears the
 * stored session in those cases (`_removeSession`) and emits `SIGNED_OUT`;
 * without this subscription nothing in the app noticed, and the user kept
 * clicking a UI that could no longer read a single row.
 */
export function watchSessionLoss(): void {
  getSupabase().auth.onAuthStateChange((event) => {
    switch (event) {
      case 'SIGNED_OUT':
        if (!signingOutOnPurpose) {
          reportSessionLost('supabase-js usunął sesję (zdarzenie SIGNED_OUT)');
        }
        break;
      case 'TOKEN_REFRESHED':
        // Logged because the opposite — refreshes silently stopping — is what
        // the whole guard exists for, and a log with no such line dates it.
        log.info('[AUTH] Token odświeżony');
        break;
      default:
        break;
    }
  });
}
