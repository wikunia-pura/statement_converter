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
  alternative_names   text[]      not null default '{}',
  created_at          timestamptz not null default now()
);

create table if not exists public.adresy (
  id                 bigserial primary key,
  nazwa              text        not null,
  alternative_names  text[]      not null default '{}',
  swrk_identifiers   text[]      not null default '{}',
  bank_id            bigint      references public.banks(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Idempotent migration for existing deployments where adresy already existed without bank_id.
alter table public.adresy
  add column if not exists bank_id bigint references public.banks(id) on delete set null;

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
alter table public.history     enable row level security;

drop policy if exists "authenticated_all" on public.banks;
drop policy if exists "authenticated_all" on public.kontrahenci;
drop policy if exists "authenticated_all" on public.adresy;
drop policy if exists "authenticated_all" on public.history;

create policy "authenticated_all" on public.banks
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.kontrahenci
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.adresy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.history
  for all to authenticated using (true) with check (true);
