-- Księgowania: who posts a community in a month — v9.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- One row = one community assigned to one person for ONE month, like the
-- priorities: the dashboard's "Kto" filter and the person picker on each row
-- read it. A month with no row means the community is unassigned that month.
--
-- Like the other dashboard tables it keeps the community's NAME next to its
-- id: the id is the convenience link, the name is what survives a backup
-- restore, which renumbers `adresy`.

create table if not exists public.ksiegowania_przypisania (
  id           bigint      generated always as identity primary key,
  month_key    text        not null,
  adres_id     bigint      references public.adresy(id) on delete set null,
  adres_nazwa  text        not null,
  -- The person's mailbox, as on tasks (`zadania.przypisany_email`).
  email        text        not null,
  assigned_by  text,
  assigned_at  timestamptz not null default now(),
  -- One person per community per month.
  unique (month_key, adres_nazwa)
);

create index if not exists ksiegowania_przypisania_month_idx
  on public.ksiegowania_przypisania (month_key);

alter table public.ksiegowania_przypisania enable row level security;

drop policy if exists "authenticated_all" on public.ksiegowania_przypisania;
create policy "authenticated_all" on public.ksiegowania_przypisania
  for all to authenticated using (true) with check (true);
