-- Zebrania: financial statements and budget plans — v9.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the app selects the new version
-- columns, so without them the Zebrania list does not load.

-- ============================================================
-- 1. A version's statement and plan
-- ============================================================
-- Each version of a meeting's materials carries its own copy of the statement
-- (a snapshot of the library row below, so a later upload never rewrites what
-- a meeting already presented) and the plan drafted from it.

alter table public.zebrania_wersje
  add column if not exists sprawozdanie jsonb,
  add column if not exists plan         jsonb;

-- ============================================================
-- 2. The statement library
-- ============================================================
-- One vDom "RozliczenieWsp" file holds every community's statement. An upload
-- stores all of them here, so each meeting finds its own without the file
-- being uploaded again. One row per community per period: uploading a newer
-- print of the same period replaces the row.

create table if not exists public.zebrania_sprawozdania (
  id           bigserial primary key,
  nr_wsp       integer     not null,
  nazwa        text        not null default '',
  okres_od     date        not null,
  okres_do     date        not null,
  dane         jsonb       not null,
  plik_nazwa   text        not null default '',
  imported_at  timestamptz not null default now(),
  imported_by  text        not null default '',
  unique (nr_wsp, okres_od, okres_do)
);

-- Where a library row came from. The files uploaded in Zebrania are the source
-- of truth ('zebrania'); the Sprawozdania module may add a statement of its own
-- ('sprawozdania') only for a community and period Zebrania does not have, and
-- a later Zebrania upload of that period takes the row over.

alter table public.zebrania_sprawozdania
  add column if not exists zrodlo text not null default 'zebrania';

-- ============================================================
-- 3. What the module remembers per community
-- ============================================================
-- Keyed by the community's NAME, like the dashboard tables, so it survives a
-- backup restore (which renumbers `adresy`). `vdom_nr` matches statements to
-- the community; the areas are the plan's ownership split, which the
-- statement does not carry.

create table if not exists public.zebrania_wspolnoty (
  adres_nazwa  text        primary key,
  vdom_nr      integer,
  udzialy      jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default ''
);

-- ============================================================
-- 4. Module settings
-- ============================================================
-- One row: the dictionary sorting statement rows into plan lines, the default
-- number of the resolution adopting the plan, the rounding of planned costs.

create table if not exists public.zebrania_ustawienia (
  id          smallint    primary key default 1 check (id = 1),
  dane        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default ''
);

-- ============================================================
-- 5. Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
-- ============================================================

alter table public.zebrania_sprawozdania enable row level security;
alter table public.zebrania_wspolnoty    enable row level security;
alter table public.zebrania_ustawienia   enable row level security;

drop policy if exists "authenticated_all" on public.zebrania_sprawozdania;
create policy "authenticated_all" on public.zebrania_sprawozdania
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.zebrania_wspolnoty;
create policy "authenticated_all" on public.zebrania_wspolnoty
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.zebrania_ustawienia;
create policy "authenticated_all" on public.zebrania_ustawienia
  for all to authenticated using (true) with check (true);
