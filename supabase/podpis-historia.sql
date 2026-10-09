-- Podpis kwalifikowany: history of the runs that signed PDFs with the card
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: without the table the module's
-- "Historia" tab stays empty and the runs are not recorded (signing itself works).

-- One row per run of "Podpisz zaznaczone" — a single PIN, one certificate, one
-- or more files. `pliki` lists every file the run was handed:
-- [{ nazwa, zrodlo, wynik, status: 'podpisany' | 'pominiety' | 'niepodpisany', powod? }]
create table if not exists public.podpisy_historia (
  id             bigserial primary key,
  signed_at      timestamptz not null default now(),
  signed_by      text        not null default '',   -- who in the app ran it
  podmiot        text        not null default '',   -- certificate holder
  wystawca       text        not null default '',   -- certificate issuer
  numer_seryjny  text        not null default '',
  pliki          jsonb       not null default '[]'::jsonb,
  podpisanych    integer     not null default 0,
  przerwano      text                                -- why the run stopped early, if it did
);

create index if not exists podpisy_historia_signed_at_idx
  on public.podpisy_historia (signed_at desc);

-- Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
alter table public.podpisy_historia enable row level security;

drop policy if exists "authenticated_all" on public.podpisy_historia;
create policy "authenticated_all" on public.podpisy_historia
  for all to authenticated using (true) with check (true);
