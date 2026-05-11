import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Store from 'electron-store';
import WebSocket from 'ws';

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
    });
  }
  return client;
}
