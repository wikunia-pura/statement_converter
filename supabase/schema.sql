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

-- City units ("jednostki ZGN") notified when a housing community changes its
-- monthly-fee rates. One unit typically serves many communities, so it lives in
-- its own dictionary and each address points at (at most) one of them.
create table if not exists public.zgn_jednostki (
  id          bigserial primary key,
  nazwa       text        not null,
  email       text        not null,
  created_at  timestamptz not null default now()
);

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
-- The city unit notified about this community's rate changes (Mailing module).
alter table public.adresy
  add column if not exists zgn_jednostka_id bigint
    references public.zgn_jednostki(id) on delete set null;

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

-- Application-level configuration shared by all installations. Holds secrets
-- that must NOT ship inside the (publicly downloadable) release binaries —
-- e.g. the Anthropic API key. Signed-in users can only READ; writes happen
-- exclusively from the Supabase dashboard (SQL editor / table editor):
--
-- Paste the WHOLE key in place of the placeholder — it already starts with
-- `sk-ant-`, so leaving a prefix behind yields `sk-ant-sk-ant-…` and every
-- conversion fails with a 401:
--
--   insert into public.app_config (key, value)
--     values ('anthropic_api_key', '<PASTE_FULL_KEY_HERE>')
--     on conflict (key) do update set value = excluded.value, updated_at = now();
create table if not exists public.app_config (
  key         text primary key,
  value       text        not null,
  updated_at  timestamptz not null default now()
);

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

-- Meter-reading conversions ("Odczyty liczników"). One row per operation — a
-- single click can read several supplier workbooks and emit one file per
-- housing community, so the sources and outputs are kept as JSON rather than
-- flattened into rows: skipped source rows belong to a source file, not to an
-- output file, and splitting them would need an artificial attribution rule.
create table if not exists public.odczyty_history (
  id             bigserial primary key,
  supplier       text        not null,          -- 'ISTA', or 'ISTA + TECHEM' for a mixed run
  status         text        not null check (status in ('success', 'error')),
  error_message  text,
  output_dir     text        not null default '',
  -- [{ fileName, filePath, supplierLabel, readingCount, skippedCount, skipped: [...] }]
  source_files   jsonb       not null default '[]'::jsonb,
  -- [{ wm, fileName, outputPath, date, readingCount }]
  output_files   jsonb       not null default '[]'::jsonb,
  reading_count  integer     not null default 0,
  skipped_count  integer     not null default 0,
  converted_at   timestamptz not null default now()
);

create index if not exists odczyty_history_converted_at_idx
  on public.odczyty_history (converted_at desc);

-- ============================================================
-- Mailing (rate-change notifications to city units)
-- ============================================================

-- User-defined dynamic fields. A field carries a fixed lead-in sentence
-- (`tekst`); the value that completes it is typed once per send, so the same
-- field can read "…w kwocie: 350,00 zł" one month and "…410,00 zł" the next.
-- The built-in fields ("Adres Wspólnoty", "Data") are code-side, not rows here.
create table if not exists public.mailing_pola (
  id          bigserial primary key,
  nazwa       text        not null,
  tekst       text        not null default '',
  created_at  timestamptz not null default now()
);

-- Message templates. Subject and body are authored with {{field}} placeholders
-- resolved at send time; `attach_pdf` is the template's default for the
-- "also attach the body as PDF" switch (the send screen can override it).
create table if not exists public.mailing_szablony (
  id           bigserial primary key,
  nazwa        text        not null,
  typ          text        not null default 'zgn-zaliczki',
  temat        text        not null default '',
  tresc        text        not null default '',
  attach_pdf   boolean     not null default false,
  -- Field names offered by this template's {{Tabela pól}} table, in row order:
  -- ["Zaliczka remontowy", "Zaliczka eksploatacja"]. The shortlist, not the
  -- choice — the send screen ticks which of them actually go out.
  table_fields jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- Idempotent migration for deployments created before the field table existed.
alter table public.mailing_szablony
  add column if not exists table_fields jsonb not null default '[]'::jsonb;

-- One row per (send, community): the rendered subject/body exactly as it went
-- out, the resolved recipient, the field values used, and the attachments.
-- `attachments` keeps file names + on-disk paths — the files themselves live in
-- the local output folder and can be purged from the module's history tab.
create table if not exists public.mailing_history (
  id                bigserial primary key,
  typ               text        not null default 'zgn-zaliczki',
  template_name     text        not null default '',
  status            text        not null check (status in ('success', 'error')),
  error_message     text,
  adres_id          bigint,
  adres_nazwa       text        not null default '',
  jednostka_nazwa   text        not null default '',
  jednostka_email   text        not null default '',
  subject           text        not null default '',
  body_html         text        not null default '',
  body_text         text        not null default '',
  -- [{ nazwa, tekst, wartosc }]
  field_values      jsonb       not null default '[]'::jsonb,
  -- [{ fileName, filePath, kind: 'pdf' | 'custom' }]
  attachments       jsonb       not null default '[]'::jsonb,
  sent_from         text        not null default '',
  sent_at           timestamptz not null default now()
);

create index if not exists mailing_history_sent_at_idx
  on public.mailing_history (sent_at desc);

-- ============================================================
-- Row-Level Security
-- Model: any signed-in user can read/write everything (shared data).
-- Anonymous users have no access.
-- ============================================================

alter table public.app_config  enable row level security;
alter table public.banks       enable row level security;
alter table public.kontrahenci enable row level security;
alter table public.adresy      enable row level security;
alter table public.konto_typy  enable row level security;
alter table public.history     enable row level security;
alter table public.odczyty_history enable row level security;
alter table public.zgn_jednostki    enable row level security;
alter table public.mailing_pola     enable row level security;
alter table public.mailing_szablony enable row level security;
alter table public.mailing_history  enable row level security;

-- app_config: read-only for signed-in users; no insert/update/delete policy,
-- so the anon/authenticated roles can never modify secrets.
drop policy if exists "authenticated_read" on public.app_config;
create policy "authenticated_read" on public.app_config
  for select to authenticated using (true);

drop policy if exists "authenticated_all" on public.banks;
drop policy if exists "authenticated_all" on public.kontrahenci;
drop policy if exists "authenticated_all" on public.adresy;
drop policy if exists "authenticated_all" on public.konto_typy;
drop policy if exists "authenticated_all" on public.history;
drop policy if exists "authenticated_all" on public.odczyty_history;
drop policy if exists "authenticated_all" on public.zgn_jednostki;
drop policy if exists "authenticated_all" on public.mailing_pola;
drop policy if exists "authenticated_all" on public.mailing_szablony;
drop policy if exists "authenticated_all" on public.mailing_history;

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

create policy "authenticated_all" on public.odczyty_history
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.zgn_jednostki
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_pola
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_szablony
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_history
  for all to authenticated using (true) with check (true);
