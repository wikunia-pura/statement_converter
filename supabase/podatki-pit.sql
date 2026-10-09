-- Podatki → PIT: the PIT-11s and the PIT-4R of the communities, per community and year
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the Podatki module lists this table,
-- so without it the PIT tab does not load.

-- One community (NIP) and tax year per row. `dane` holds the payer's name and office, the people the
-- community paid in the year (identity, address, tax office, the amounts of each title, what was filed and
-- downloaded) and the PIT-4R's monthly advances. The figures the forms print (costs, income, sums) are not
-- stored: the app works them out from the amounts.

create table if not exists public.podatki_pit (
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

-- Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
alter table public.podatki_pit enable row level security;

drop policy if exists "authenticated_all" on public.podatki_pit;
create policy "authenticated_all" on public.podatki_pit
  for all to authenticated using (true) with check (true);
