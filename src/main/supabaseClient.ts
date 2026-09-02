import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Store from 'electron-store';
import WebSocket from 'ws';
import log from 'electron-log';

// Electron 28 ships Node 18, which has no global WebSocket. Supabase's realtime
// module initializes eagerly even though we don't use realtime, and dies without
// one. Polyfill globally before createClient runs.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket: unknown }).WebSocket = WebSocket;
}

// Publishable (anon) key — safe to ship in client code. RLS protects rows;
// only authenticated users can read/write.
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://xyvltgegptamtlzsdjwo.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_7iJwmFOM5lUI4tOTzbYLcg_VVOS5CXF';

// Supabase's JS client expects a Web-Storage-like API for session persistence.
// In the Electron main process there's no localStorage, so back it with electron-store.
const sessionStore = new Store<{ session: Record<string, string> }>({
  name: 'supabase-session',
  defaults: { session: {} },
});

const electronStorageAdapter = {
  getItem: (key: string): string | null => {
    const session = sessionStore.get('session', {});
    return session[key] ?? null;
  },
  setItem: (key: string, value: string): void => {
    const session = sessionStore.get('session', {});
    session[key] = value;
    sessionStore.set('session', session);
  },
  removeItem: (key: string): void => {
    const session = sessionStore.get('session', {});
    delete session[key];
    sessionStore.set('session', session);
  },
};

// ---------------------------------------------------------------------------
// Dead-session detection
//
// supabase-js signs a request with `session?.access_token ?? anonKey`: when the
// session is gone it does NOT fail, it quietly falls back to the publishable
// key. Every policy in this project's schema is `for all to authenticated`, so
// as the `anon` role Postgres answers a SELECT with zero rows and NO error —
// which the app then reads as "that record does not exist" ("Bank not found"),
// an empty address list, an empty backup. The single fix is here: refuse any
// REST request that isn't carrying a user token, and say why.
// ---------------------------------------------------------------------------

/** Shown to the user whenever a dead session is what actually failed. */
export const SESSION_EXPIRED_MESSAGE =
  'Sesja wygasła — zaloguj się ponownie. Wspólne dane (banki, adresy, kontrahenci, historia) ' +
  'są widoczne tylko dla zalogowanego użytkownika.';

/** PostgREST-style code carried by the synthetic 401 below. */
const SESSION_EXPIRED_CODE = 'session_expired';

/** Only table traffic is guarded — `/auth/v1/` legitimately runs on the anon key. */
const REST_PATH = '/rest/v1/';

/**
 * True once a REST request has gone out with a real user token. Distinguishes
 * "the session died under the user" (worth interrupting them for) from "nobody
 * has logged in yet" — the startup reads for the AI key and the auto backup
 * both run before the login screen is answered.
 */
let sawSession = false;

/** One report per lost session; without it a batch of reads fires a storm. */
let lossReported = false;

/**
 * Set when a loss is detected, cleared when the renderer picks it up. Covers
 * the case where the session is already gone before the window can listen —
 * the login screen then asks for it and explains itself.
 */
let expiryNoticePending = false;

const sessionLostListeners = new Set<() => void>();

/** Subscribe to "the session is gone". Returns an unsubscribe function. */
export function onSessionLost(listener: () => void): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

/** Report a session that can no longer authorize requests. Idempotent. */
export function reportSessionLost(reason: string): void {
  if (lossReported) return;
  lossReported = true;
  expiryNoticePending = true;
  log.warn(`[AUTH] Sesja utracona — ${reason}`);
  for (const listener of sessionLostListeners) {
    try {
      listener();
    } catch (error) {
      log.error('[AUTH] Listener sesji rzucił wyjątek:', error);
    }
  }
}

/** Called after a successful sign-in: a fresh session voids any pending notice. */
export function markSignedIn(): void {
  sawSession = true;
  lossReported = false;
  expiryNoticePending = false;
}

/**
 * Called when the user signs out on purpose. Background work that outlives the
 * click — the backup written while the app closes, say — would otherwise hit
 * the guard below and get announced as an expiry the user never suffered.
 */
export function markSignedOut(): void {
  sawSession = false;
  lossReported = false;
  expiryNoticePending = false;
}

/** Reads and clears the pending "session expired" notice for the login screen. */
export function consumeSessionExpiryNotice(): boolean {
  const pending = expiryNoticePending;
  expiryNoticePending = false;
  return pending;
}

/** Pull one header out of whatever shape `fetch` was handed. */
function headerValue(headers: RequestInit['headers'], name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === wanted)?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find(k => k.toLowerCase() === wanted);
  return key === undefined ? null : record[key];
}

/**
 * A 401 shaped like a PostgREST error, so postgrest-js turns it into
 * `{ error: { message: SESSION_EXPIRED_MESSAGE } }`. 401 is not in its
 * retryable status list, so the call fails at once instead of backing off.
 */
function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      message: SESSION_EXPIRED_MESSAGE,
      code: SESSION_EXPIRED_CODE,
      details: null,
      hint: 'Zaloguj się ponownie w aplikacji.',
    }),
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

const guardedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isRest = url.includes(REST_PATH);

  if (isRest) {
    const authorization = headerValue(init?.headers, 'authorization');
    // No token, or the publishable key standing in for one: this request would
    // run as `anon` and come back empty instead of failing.
    if (!authorization || authorization === `Bearer ${SUPABASE_ANON_KEY}`) {
      if (sawSession) reportSessionLost('żądanie poszłoby bez tokenu użytkownika (rola anon)');
      return unauthorizedResponse();
    }
    sawSession = true;
  }

  const response = await fetch(input, init);

  // 401 from PostgREST means the token itself was rejected — expired, revoked,
  // or signed for a user that no longer exists.
  if (isRest && response.status === 401) {
    reportSessionLost('PostgREST odrzucił token (HTTP 401)');
    return unauthorizedResponse();
  }

  return response;
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: electronStorageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      global: { fetch: guardedFetch },
    });
  }
  return client;
}
