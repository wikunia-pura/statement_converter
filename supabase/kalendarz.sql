-- Kalendarz (spotkania) — v6.5.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Adds three things:
--   * `app_users` — a readable mirror of the application's accounts, so a
--     meeting's participants can be picked from the people who actually have
--     access. `auth.users` is not reachable with the publishable key (and must
--     not be), hence the mirror: it carries only the id, the mailbox and the
--     display name, never a password hash or a token.
--   * `spotkania_typy` — the kinds of meeting, defined by the user inside the
--     calendar module rather than hard-coded here.
--   * `spotkania` — the meetings themselves: name, type, community, when, and
--     the participants.
--
-- Participants live in a jsonb column instead of a join table: they are always
-- read and written together with the meeting, never queried on their own, and
-- the same shape (a snapshotted list) is what `odczyty_history.source_files`
-- and `mailing_history.attachments` already use.

-- ============================================================
-- Accounts, mirrored out of auth into a readable table
-- ============================================================

create table if not exists public.app_users (
  id           uuid        primary key,
  email        text        not null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- One function for insert/update/delete: the participant picker must not offer
-- an account that was revoked, and must show a mailbox the moment it changes.
create or replace function public.sync_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.app_users where id = old.id;
    return old;
  end if;

  insert into public.app_users (id, email, display_name, created_at)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    ),
    coalesce(new.created_at, now())
  )
  on conflict (id) do update
    set email        = excluded.email,
        -- Keep a name already there when the new payload carries none, so a
        -- password change doesn't blank out what the picker displays.
        display_name = coalesce(excluded.display_name, app_users.display_name);
  return new;
end;
$$;

drop trigger if exists sync_app_user_upsert on auth.users;
create trigger sync_app_user_upsert
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_app_user();

drop trigger if exists sync_app_user_delete on auth.users;
create trigger sync_app_user_delete
  after delete on auth.users
  for each row execute function public.sync_app_user();

-- Backfill the accounts that existed before the trigger did.
insert into public.app_users (id, email, display_name, created_at)
select
  u.id,
  coalesce(u.email, ''),
  nullif(
    btrim(
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
    ),
    ''
  ),
  coalesce(u.created_at, now())
from auth.users u
on conflict (id) do update
  set email = excluded.email;

-- ============================================================
-- Meeting types (user-defined dictionary)
-- ============================================================

create table if not exists public.spotkania_typy (
  id         bigserial   primary key,
  nazwa      text        not null,
  -- Hex colour used by the calendar to tint the meeting's chip. A type without
  -- a colour would make a month of meetings unreadable, so it always has one.
  kolor      text        not null default '#5b5ff6',
  opis       text        not null default '',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Meetings
-- ============================================================

create table if not exists public.spotkania (
  id          bigserial   primary key,
  nazwa       text        not null,
  -- ON DELETE SET NULL on both links: removing a type or a community must not
  -- take the meetings with it — the record of what happened outlives both.
  typ_id      bigint      references public.spotkania_typy(id) on delete set null,
  adres_id    bigint      references public.adresy(id) on delete set null,
  -- The community's NAME, kept alongside the id for the same reason `history`
  -- keeps it: a backup restore renumbers `adresy`, and the name is what the
  -- link is re-pointed through afterwards.
  adres_nazwa text        not null default '',
  starts_at   timestamptz not null,
  -- Optional: a meeting with no stated end is a point in the day, not an error.
  ends_at     timestamptz,
  opis        text        not null default '',
  -- [{ userId, email, displayName }] — snapshotted from `app_users` on save, so
  -- a participant stays readable after their account is removed.
  uczestnicy  jsonb       not null default '[]'::jsonb,
  created_by  text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The calendar reads one month at a time, and the community view filters by
-- address.
create index if not exists spotkania_starts_at_idx on public.spotkania (starts_at);
create index if not exists spotkania_adres_id_idx  on public.spotkania (adres_id);

-- ============================================================
-- Row-Level Security
-- Same model as every other table: any signed-in user reads and writes; the
-- account mirror is read-only, because only the auth trigger may write it.
-- ============================================================

alter table public.app_users      enable row level security;
alter table public.spotkania_typy enable row level security;
alter table public.spotkania      enable row level security;

drop policy if exists "authenticated_read" on public.app_users;
create policy "authenticated_read" on public.app_users
  for select to authenticated using (true);

drop policy if exists "authenticated_all" on public.spotkania_typy;
create policy "authenticated_all" on public.spotkania_typy
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.spotkania;
create policy "authenticated_all" on public.spotkania
  for all to authenticated using (true) with check (true);
