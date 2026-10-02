-- Notifications: each person's own switches (Ustawienia → Powiadomienia).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. One shared project: without it the notification list in Settings
-- cannot save a switch, and a backup cannot be taken (it reads this table).
--
-- Safe to re-run.

create table if not exists public.notification_prefs (
  -- The person's MAILBOX, lower-cased — the key a person is known by everywhere
  -- else (assignments, backups). Not a foreign key on purpose: the choice
  -- survives the account being recreated.
  email      text        primary key,
  -- `{ "ksiegowaniaUwaga": true, ... }` — only the switches the person has
  -- flipped. A notification they never touched follows the app's default, so a
  -- notification added in a later version needs no migration here.
  prefs      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Same model as every other table: any signed-in user reads and writes. The app
-- only ever writes the signed-in person's own row.
alter table public.notification_prefs enable row level security;

drop policy if exists "authenticated_all" on public.notification_prefs;
create policy "authenticated_all" on public.notification_prefs
  for all to authenticated using (true) with check (true);
