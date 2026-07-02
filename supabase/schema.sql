-- Statement Converter — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New Query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.banks (
  id                bigserial primary key,
  name              text        not null,
  converter_id      text        not null,
  account_prefixes  text[]      not null default '{}',
  created_at        timestamptz not null default now()
);

create table if not exists public.kontrahenci (
  id                  bigserial primary key,
  nazwa               text        not null,
  konto_kontrahenta   text        not null,
  nip                 text,
  typ                 text        not null default 'Kontrahent'
                                  check (typ in ('Kontrahent', 'Pozostałe przychody', 'Pozostałe koszty')),
  typy                text[]      not null default '{Kontrahent}',
  alternative_names   text[]      not null default '{}',
  created_at          timestamptz not null default now()
);

-- kontrahenci: multi-type support. `typy` is the source of truth — a contractor
-- can hold several roles at once. Legacy scalar `typ` is kept for backward
-- compatibility and mirrored to typy[1] on every write.
alter table public.kontrahenci
  add column if not exists typy text[];
update public.kontrahenci
  set typy = array[coalesce(typ, 'Kontrahent')]
  where typy is null;
alter table public.kontrahenci alter column typy set default '{Kontrahent}';
alter table public.kontrahenci alter column typy set not null;

create table if not exists public.adresy (
  id                 bigserial primary key,
  nazwa              text        not null,
  alternative_names  text[]      not null default '{}',
  swrk_identifiers   text[]      not null default '{}',
  account_numbers    text[]      not null default '{}',
  bank_id            bigint      references public.banks(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Idempotent migrations for existing deployments.
alter table public.adresy
  add column if not exists bank_id bigint references public.banks(id) on delete set null;
alter table public.adresy
  add column if not exists account_numbers text[] not null default '{}';
alter table public.adresy
  add column if not exists apartment_mappings jsonb not null default '[]'::jsonb;
-- Maps a canonical account number to a konto_typy id: { "<account>": <typ id> }.
alter table public.adresy
  add column if not exists account_types jsonb not null default '{}'::jsonb;

-- Global, configurable account types. Each maps a community bank account to the
-- pair of accounting symbols the exporters emit (bank-account side + apartment
-- account prefix). Exactly one row is the default.
create table if not exists public.konto_typy (
  id                  bigserial primary key,
  name                text        not null,
  bank_account_symbol text        not null default '131-1',
  apartment_prefix    text        not null default '204',
  is_default          boolean     not null default false,
  created_at          timestamptz not null default now()
);

-- Seed a default type on first setup so existing addresses keep the historical
-- 131-1 / 204 behavior. Only inserts when the table is empty.
insert into public.konto_typy (name, bank_account_symbol, apartment_prefix, is_default)
select 'Podstawowy', '131-1', '204', true
where not exists (select 1 from public.konto_typy);

create table if not exists public.history (
  id              bigserial primary key,
  file_name       text        not null,
  bank_name       text        not null,
  converter_name  text        not null,
  status          text        not null check (status in ('success', 'error')),
  error_message   text,
  input_path      text        not null,
  output_path     text        not null,
  converted_at    timestamptz not null default now()
);

-- ============================================================
-- Row-Level Security
-- Model: any signed-in user can read/write everything (shared data).
-- Anonymous users have no access.
-- ============================================================

alter table public.banks       enable row level security;
alter table public.kontrahenci enable row level security;
alter table public.adresy      enable row level security;
alter table public.konto_typy  enable row level security;
alter table public.history     enable row level security;

drop policy if exists "authenticated_all" on public.banks;
drop policy if exists "authenticated_all" on public.kontrahenci;
drop policy if exists "authenticated_all" on public.adresy;
drop policy if exists "authenticated_all" on public.konto_typy;
drop policy if exists "authenticated_all" on public.history;

create policy "authenticated_all" on public.banks
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.kontrahenci
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.adresy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.konto_typy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.history
  for all to authenticated using (true) with check (true);
