import { createClient, isAuthRetryableFetchError, SupabaseClient } from '@supabase/supabase-js';
import Store from 'electron-store';
import WebSocket from 'ws';
import log from 'electron-log';
import { openSecret, sealSecret } from './secretStorage';
import { AppError } from '../shared/app-errors';

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
// Values are sealed with DPAPI on Windows (see secretStorage for why not on macOS);
// a session saved before that is sealed on its first read.
const sessionStore = new Store<{ session: Record<string, string> }>({
  name: 'supabase-session',
  defaults: { session: {} },
});

const electronStorageAdapter = {
  getItem: (key: string): string | null => {
    const stored = sessionStore.get('session', {})[key];
    if (stored == null) return null;
    // Unreadable comes back as null, which supabase-js reads as "logged out";
    // the next sign-in overwrites the entry.
    return openSecret(stored, (sealed) => {
      const session = sessionStore.get('session', {});
      session[key] = sealed;
      sessionStore.set('session', session);
    });
  },
  setItem: (key: string, value: string): void => {
    const session = sessionStore.get('session', {});
    session[key] = sealSecret(value);
    sessionStore.set('session', session);
  },
  removeItem: (key: string): void => {
    const session = sessionStore.get('session', {});
    delete session[key];
    sessionStore.set('session', session);
  },
};

/** The key supabase-js keeps the session under — its default, which every install already uses. */
const SESSION_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

/**
 * The user of the session kept on disk, whatever state its access token is in;
 * null when there is none. supabase-js answers "no session" also when it only
 * failed to refresh an expired token (offline, a wake from sleep) — the session
 * stays on disk then, and this is how to tell the two apart.
 */
export function storedSessionUser(): { id: string; email: string } | null {
  const raw = electronStorageAdapter.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as { refresh_token?: string; user?: { id?: string; email?: string } };
    if (!session.refresh_token || !session.user?.id) return null;
    return { id: session.user.id, email: session.user.email ?? '' };
  } catch {
    return null;
  }
}

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
//
// A missing or rejected token is not yet a dead session, though. supabase-js
// also falls back to the anon key when the refresh of an expired token merely
// could not reach the server — after a wake from sleep, at a start before the
// network is up — and it keeps the session on disk then. So the guard first
// refreshes the session itself and retries the request once; only a refresh
// token the server refuses logs the user out. Unreachable is reported as such.
// ---------------------------------------------------------------------------

/**
 * Shown to the user whenever a dead session is what actually failed — coded, so
 * it reads in the app's language also inside a `${op}: ${message}` wrap.
 */
export const SESSION_EXPIRED_MESSAGE = new AppError('sessionExpired').message;

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

/**
 * The session is intact but the server could not be reached to refresh it.
 * 504 is not in postgrest-js's retryable list either: the call fails at once,
 * auth-js has already spent its own retries on the refresh.
 */
function unreachableResponse(): Response {
  return new Response(
    JSON.stringify({
      message: new AppError('cloudUnreachable').message,
      code: 'cloud_unreachable',
      details: null,
      hint: null,
    }),
    {
      status: 504,
      statusText: 'Gateway Timeout',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

type TokenRecovery = { token: string } | { failed: 'offline' | 'lost' };

/** Recoveries in flight, by the token that failed ('' for none): a burst of reads after a wake is one refresh. */
const recoveries = new Map<string, Promise<TokenRecovery>>();

/**
 * A usable access token for a request that had none, or whose token PostgREST
 * rejected. `offline`: the refresh could not reach the server — the session
 * stays, the user stays logged in. `lost`: there is no session on disk, or the
 * server refused its refresh token (supabase-js has then dropped it).
 */
function recoverAccessToken(rejected: string | null): Promise<TokenRecovery> {
  const key = rejected ?? '';
  let recovery = recoveries.get(key);
  if (!recovery) {
    recovery = (async (): Promise<TokenRecovery> => {
      const auth = getSupabase().auth;
      try {
        // Refreshes an expired token by itself — and another request may
        // already have refreshed the one that was rejected.
        const current = await auth.getSession();
        const token = current.data.session?.access_token;
        if (token && token !== rejected) return { token };
        if (current.error && isAuthRetryableFetchError(current.error)) return { failed: 'offline' };
        if (!storedSessionUser()) return { failed: 'lost' };
        const { data, error } = await auth.refreshSession();
        if (data.session) return { token: data.session.access_token };
        return { failed: isAuthRetryableFetchError(error) ? 'offline' : 'lost' };
      } catch (error) {
        // Not an auth answer at all — no proof the session is dead.
        log.warn('[AUTH] Odświeżenie sesji rzuciło wyjątek:', error);
        return { failed: 'offline' };
      }
    })().finally(() => recoveries.delete(key));
    recoveries.set(key, recovery);
  }
  return recovery;
}

/** Retry a REST request once with a recovered token; log out only when there is none to be had. */
async function retryWithFreshToken(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  rejected: string | null,
): Promise<Response> {
  const recovered = await recoverAccessToken(rejected);
  if ('token' in recovered) {
    sawSession = true;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${recovered.token}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status !== 401) return response;
    reportSessionLost('PostgREST odrzucił także świeżo odświeżony token (HTTP 401)');
    return unauthorizedResponse();
  }
  if (recovered.failed === 'offline') {
    log.warn('[AUTH] Tokenu nie dało się odświeżyć (brak połączenia) — sesja zostaje, żądanie odrzucone');
    return unreachableResponse();
  }
  // Before anyone has logged in (the startup reads) this is no news to announce.
  if (sawSession) {
    reportSessionLost(rejected ? 'PostgREST odrzucił token, a sesji nie da się odświeżyć' : 'brak sesji do odświeżenia (rola anon)');
  }
  return unauthorizedResponse();
}

// ---------------------------------------------------------------------------
// Table writes
//
// Every write to a table goes through the fetch below, whichever method built
// it — a named one, `casUpdate`, the restore's helpers. Reporting it here is
// what lets a read cache drop what a write made stale without each of the
// write sites having to remember to.
// ---------------------------------------------------------------------------

const tableWriteListeners = new Set<(table: string) => void>();

/** Subscribe to "a request that may have changed this table has finished". Returns an unsubscribe function. */
export function onTableWrite(listener: (table: string) => void): () => void {
  tableWriteListeners.add(listener);
  return () => tableWriteListeners.delete(listener);
}

/** The table a REST request is about — the path segment after `/rest/v1/`. */
function restTable(url: string): string {
  const rest = url.slice(url.indexOf(REST_PATH) + REST_PATH.length);
  return decodeURIComponent(rest.split(/[/?#]/)[0] ?? '');
}

function reportTableWrite(table: string): void {
  for (const listener of tableWriteListeners) {
    try {
      listener(table);
    } catch (error) {
      log.error('[DB] Listener zapisu rzucił wyjątek:', error);
    }
  }
}

/** Reads go straight through; a write reports its table once it has finished. */
const reportingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!url.includes(REST_PATH) || method === 'GET' || method === 'HEAD') return guardedFetch(input, init);
  try {
    return await guardedFetch(input, init);
  } finally {
    // Failed or not: a write that errored may still have landed, and dropping
    // a cache entry costs one read.
    reportTableWrite(restTable(url));
  }
};

const guardedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes(REST_PATH)) return fetch(input, init);

  const authorization = headerValue(init?.headers, 'authorization');
  // No token, or the publishable key standing in for one: this request would
  // run as `anon` and come back empty instead of failing.
  if (!authorization || authorization === `Bearer ${SUPABASE_ANON_KEY}`) {
    return retryWithFreshToken(input, init, null);
  }
  sawSession = true;

  const response = await fetch(input, init);

  // 401 from PostgREST means the token itself was rejected — expired by the
  // server's clock, revoked, or signed for a user that no longer exists.
  if (response.status === 401) {
    return retryWithFreshToken(input, init, authorization.replace(/^Bearer /i, ''));
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
      global: { fetch: reportingFetch },
    });
  }
  return client;
}
