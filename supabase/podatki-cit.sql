-- Podatki → CIT: CIT-8 returns of the communities, per year
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the Podatki module lists these tables,
-- so without them the CIT tab does not load.

-- ============================================================
-- 0. Early test versions of this table were keyed by NIP
-- ============================================================
-- The table is keyed by the community's name now (see below). Test data of the
-- NIP-keyed shape is thrown away here; once the new shape exists this block
-- finds no `nip` column and does nothing, so running the file again is safe.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'podatki_cit' and column_name = 'nip'
  ) then
    drop table public.podatki_cit;
  end if;
end $$;

-- ============================================================
-- 1. Returns — one community and tax year per row
-- ============================================================
-- The community is one of the Adresy list, kept by NAME (like the dashboard and
-- Zebrania tables), so a row survives a backup restore that renumbers `adresy`.
-- `dane` holds the CIT-8's own fields (NIP, tax office, purpose, name, seat, the
-- rate, advances paid, signer), a SNAPSHOT of the financial statement the
-- figures come from (so a later upload never rewrites a filed return), the
-- decisions made on its rows, and the record of downloaded PDFs. The amounts
-- are not stored: the app works them out, so a corrected decision reaches
-- the return at once.

create table if not exists public.podatki_cit (
  id          bigserial primary key,
  adres_nazwa text        not null,
  rok         integer     not null,
  dane        jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default '',
  unique (adres_nazwa, rok)
);

-- ============================================================
-- 2. Module settings
-- ============================================================
-- One row: the dictionary sorting statement rows into taxed income, exempt
-- income and costs. No row = the app's built-in dictionary.

create table if not exists public.podatki_cit_ustawienia (
  id          smallint    primary key default 1 check (id = 1),
  dane        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default ''
);

-- ============================================================
-- 3. Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
-- ============================================================

alter table public.podatki_cit enable row level security;
alter table public.podatki_cit_ustawienia enable row level security;

drop policy if exists "authenticated_all" on public.podatki_cit;
create policy "authenticated_all" on public.podatki_cit
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.podatki_cit_ustawienia;
create policy "authenticated_all" on public.podatki_cit_ustawienia
  for all to authenticated using (true) with check (true);
