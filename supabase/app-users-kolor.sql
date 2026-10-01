-- A colour for every person, chosen in Ustawienia → Użytkownicy and shown on the
-- Zadania cards.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release, after supabase/app-users-imie-nazwisko.sql. One shared project:
-- without it the user list asks for a column that does not exist yet.
--
-- Safe to re-run.

alter table public.app_users
  -- `#rrggbb`, or NULL for "automatic" — then the app derives a colour from the
  -- mailbox, the same on every machine. NULL is the normal case: nobody has to
  -- choose a colour for the person to have one.
  add column if not exists color text;

alter table public.app_users
  drop constraint if exists app_users_color_hex;
alter table public.app_users
  add constraint app_users_color_hex
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- Same arrangement as the names: the mirror is read-only except for the columns
-- the app authors. The blanket UPDATE has to be taken away first (Supabase
-- grants ALL on public tables to `authenticated` by default), then re-granted
-- for exactly these columns — the previous grant is replaced, so it is repeated
-- here with the new column added.
revoke update on public.app_users from authenticated;
grant update (first_name, last_name, color) on public.app_users to authenticated;
