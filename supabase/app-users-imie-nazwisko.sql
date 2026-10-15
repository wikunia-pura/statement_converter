-- Named people instead of mailboxes: the app's own first/last name for every
-- account, editable in Ustawienia → Użytkownicy.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. One shared project: without it the user list and the calendar's
-- participant picker ask for columns that do not exist yet.
--
-- Safe to re-run.

-- ============================================================
-- The two name columns
-- ============================================================
--
-- Deliberately NOT `display_name`. That column mirrors the account's own
-- metadata (`raw_user_meta_data ->> 'full_name'`) and the auth trigger
-- overwrites it whenever the metadata carries a name — a name typed in the app
-- would silently lose to whatever Supabase holds. `first_name`/`last_name` are
-- the app's own fields: the trigger never touches them, and `display_name`
-- stays the fallback for accounts nobody has named yet.
alter table public.app_users
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- ============================================================
-- Who may write them
-- ============================================================
--
-- The mirror stays read-only in every other respect: `id`, `email` and
-- `created_at` are the auth trigger's business, and a client that could rewrite
-- them could make an account point at the wrong mailbox. RLS cannot express
-- "these columns only", so the policy opens UPDATE and the column grant narrows
-- it — Supabase grants ALL on public tables to `authenticated` by default, so
-- the blanket UPDATE has to be taken away first.
drop policy if exists "authenticated_update_names" on public.app_users;
create policy "authenticated_update_names" on public.app_users
  for update to authenticated using (true) with check (true);

-- The colour column (app-users-kolor.sql) is writable too. The grant below
-- REPLACES the previous one, so it must name every column the app writes — a
-- re-run without `color` would make choosing a colour, and the last step of a
-- backup restore, fail with "permission denied". The column is created here as
-- well, so the grant also works on a project that never ran that file.
alter table public.app_users
  add column if not exists color text;
alter table public.app_users
  drop constraint if exists app_users_color_hex;
alter table public.app_users
  add constraint app_users_color_hex
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

revoke update on public.app_users from authenticated;
grant update (first_name, last_name, color) on public.app_users to authenticated;
