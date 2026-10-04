-- Plany gospodarcze: budget plans made outside any meeting — v9.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the Plany gospodarcze module lists
-- this table, so without it the module does not load.

-- ============================================================
-- 1. Plans of the Plany gospodarcze module
-- ============================================================
-- The plans in Zebrania (`zebrania_wersje.plan`) are the source of truth.
-- This module may add a plan of its own, drafted from a library statement,
-- only for a community (vDom number) and year Zebrania has no plan for —
-- the app checks that on every save. A later Zebrania plan of the same
-- community and year takes over: the one here is then shown as replaced.

create table if not exists public.plany_gospodarcze (
  id          bigserial primary key,
  nr_wsp      integer     not null,
  -- The statement's printed name ("Wspólnota Mieszkaniowa Kolberga 8").
  nazwa       text        not null default '',
  rok         integer     not null,
  plan        jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default '',
  unique (nr_wsp, rok)
);

-- ============================================================
-- 2. Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
-- ============================================================

alter table public.plany_gospodarcze enable row level security;

drop policy if exists "authenticated_all" on public.plany_gospodarcze;
create policy "authenticated_all" on public.plany_gospodarcze
  for all to authenticated using (true) with check (true);
