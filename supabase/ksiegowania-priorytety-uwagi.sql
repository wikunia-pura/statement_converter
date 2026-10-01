-- Księgowania: priorities with a note, and notes on a community — v7.3.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Two small tables, both shared by the whole team:
--
--   * `ksiegowania_priorytety` — the month's "do these first" list. One row is
--     one community flagged for ONE month, with its place in the queue and the
--     reason ("dlaczego to, a nie tamto"). It belongs to a month because a
--     priority is a statement about this month's work: carried into the next
--     month it would pin communities that were finished weeks ago.
--
--   * `ksiegowania_uwagi` — a remark about posting a community ("zaksięguj
--     razem z fakturą X", "poczekaj na korektę"). Not tied to a month or to a
--     priority: it stays open until someone says it is resolved, and the
--     Converter shows it when that community's statement is dropped in.
--
-- Like `history`, both keep the community's NAME next to its id. The id is the
-- convenience link; the name is what survives a backup restore, which
-- renumbers `adresy`.

create table if not exists public.ksiegowania_priorytety (
  id          bigint      generated always as identity primary key,
  month_key   text        not null,
  adres_id    bigint      references public.adresy(id) on delete set null,
  adres_nazwa text        not null,
  -- Order in the queue. Gaps are fine (a removed priority leaves one); the app
  -- numbers the queue by sorting on this, and rewrites it 1..n on a reorder.
  position    integer     not null,
  notatka     text        not null default '',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A community can be flagged once per month.
  unique (month_key, adres_nazwa)
);

create index if not exists ksiegowania_priorytety_month_idx
  on public.ksiegowania_priorytety (month_key, position);

create table if not exists public.ksiegowania_uwagi (
  id          bigint      generated always as identity primary key,
  adres_id    bigint      references public.adresy(id) on delete set null,
  adres_nazwa text        not null,
  tresc       text        not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  -- Null while the matter is open; set by "Rozwiązane" on the dashboard.
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists ksiegowania_uwagi_adres_idx
  on public.ksiegowania_uwagi (adres_id);
create index if not exists ksiegowania_uwagi_open_idx
  on public.ksiegowania_uwagi (resolved_at);

alter table public.ksiegowania_priorytety enable row level security;
alter table public.ksiegowania_uwagi      enable row level security;

drop policy if exists "authenticated_all" on public.ksiegowania_priorytety;
create policy "authenticated_all" on public.ksiegowania_priorytety
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.ksiegowania_uwagi;
create policy "authenticated_all" on public.ksiegowania_uwagi
  for all to authenticated using (true) with check (true);
