-- Podatki → Nieruchomości: DN-1 declarations of the communities, per year
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the Podatki module lists these tables,
-- so without them the module does not load.

-- ============================================================
-- 1. Declarations — one community (NIP) and tax year per row
-- ============================================================
-- `dane` holds the DN-1's fields (authority, purpose, addresses, the plots of
-- the ZDN-1 attachment, contact, signer) and the record of downloaded PDFs.
-- The amounts are not stored: the app works them out from the plots and the
-- year's rates below, so a corrected rate reaches every declaration.

create table if not exists public.podatki_nieruchomosci (
  id          bigserial primary key,
  nip         text        not null,
  rok         integer     not null,
  dane        jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default '',
  unique (nip, rok)
);

-- ============================================================
-- 2. Rates — one row per tax year, from the city council's resolution
-- ============================================================
-- `stawki`: zł per m² (per ha for land under water) by kind of land —
-- { dzialalnosc, wody, pozostale, rewitalizacja }. Rates carried over from the
-- previous year start `potwierdzone = false` until somebody saves them.

create table if not exists public.podatki_stawki (
  rok          integer     primary key,
  stawki       jsonb       not null,
  potwierdzone boolean     not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default ''
);

-- ============================================================
-- 3. Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
-- ============================================================

alter table public.podatki_nieruchomosci enable row level security;
alter table public.podatki_stawki enable row level security;

drop policy if exists "authenticated_all" on public.podatki_nieruchomosci;
create policy "authenticated_all" on public.podatki_nieruchomosci
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.podatki_stawki;
create policy "authenticated_all" on public.podatki_stawki
  for all to authenticated using (true) with check (true);
