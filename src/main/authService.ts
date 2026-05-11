import { getSupabase } from './supabaseClient';

export interface SessionInfo {
  email: string;
  userId: string;
}

export async function signIn(email: string, password: string): Promise<
  { ok: true; session: SessionInfo } | { ok: false; error: string }
> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: 'Nie zwrócono użytkownika.' };
  return {
    ok: true,
    session: { email: data.user.email ?? email, userId: data.user.id },
  };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

export async function getSession(): Promise<SessionInfo | null> {
  const { data } = await getSupabase().auth.getSession();
  if (!data.session?.user) return null;
  return {
    email: data.session.user.email ?? '',
    userId: data.session.user.id,
  };
}
