-- Podatki → ZUS: the communities as contribution payers — their register of insured people, the monthly
-- settlements (DRA with RCA / RSA) and the sends of documents straight to ZUS (EWD).
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that reads it: the Podatki module lists these tables, so without them the ZUS tab
-- does not load. Then run restore-transakcja.sql again — it now lists these tables too, and a restore of a
-- backup that carries them stops on the older function.

-- One payer (NIP) per row. `dane` holds the short name and REGON as Płatnik has them, the accident rate, the
-- FP / FGŚP switches and the insured people — identity, addresses, NFZ branch, occupation, their insurance
-- titles (period, code, what each covers, what was sent) and family members (ZCNA).
create table if not exists public.podatki_zus (
  id          bigserial primary key,
  nip         text        not null unique,
  dane        jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text        not null default '',
  constraint podatki_zus_nip check (nip ~ '^\d{10}$')
);

-- One month's set of one payer; a correction is the same month with the next identifier (01, 02…). `dane`
-- holds the bases typed per person and title, the RSA lines and the "sent" mark. The contributions are not
-- stored: the app works them out from the bases, the register and the rates.
create table if not exists public.podatki_zus_rozliczenia (
  id             bigserial primary key,
  nip            text        not null,
  okres          text        not null,
  identyfikator  integer     not null default 1,
  dane           jsonb       not null,
  created_at     timestamptz not null default now(),
  created_by     text        not null default '',
  updated_at     timestamptz not null default now(),
  updated_by     text        not null default '',
  unique (nip, okres, identyfikator),
  constraint podatki_zus_rozliczenia_okres check (okres ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint podatki_zus_rozliczenia_id check (identyfikator between 1 and 99)
);

create index if not exists podatki_zus_rozliczenia_okres_idx on public.podatki_zus_rozliczenia (okres);

-- One send of one document (a month's set, or a registration) to ZUS's EWD service, test or production.
-- `dokument` is the document as the month list names it, `klucz` the same plus the set's identifier (a
-- correction is another document). `dane` holds who sent it, ZUS's id of the przesyłka, its confirmation
-- (the XML too — the receipt) and how a send without an answer was settled. `aktywna`: a production send that
-- may have reached ZUS or still waits for its confirmation — the unique index lets one such send of a
-- document exist at a time, so two computers cannot file the same document twice.
create table if not exists public.podatki_zus_wysylki (
  id          bigserial primary key,
  nip         text        not null,
  okres       text        not null,
  dokument    text        not null,
  klucz       text        not null,
  srodowisko  text        not null,
  aktywna     boolean     not null default false,
  at          timestamptz not null default now(),
  dane        jsonb       not null,
  updated_at  timestamptz not null default now(),
  constraint podatki_zus_wysylki_okres check (okres ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint podatki_zus_wysylki_srodowisko check (srodowisko in ('test', 'prod'))
);

create unique index if not exists podatki_zus_wysylki_aktywna
  on public.podatki_zus_wysylki (klucz) where aktywna and srodowisko = 'prod';
create index if not exists podatki_zus_wysylki_nip_okres_idx on public.podatki_zus_wysylki (nip, okres);

-- Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
alter table public.podatki_zus enable row level security;
alter table public.podatki_zus_rozliczenia enable row level security;
alter table public.podatki_zus_wysylki enable row level security;

drop policy if exists "authenticated_all" on public.podatki_zus;
create policy "authenticated_all" on public.podatki_zus
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.podatki_zus_rozliczenia;
create policy "authenticated_all" on public.podatki_zus_rozliczenia
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.podatki_zus_wysylki;
create policy "authenticated_all" on public.podatki_zus_wysylki
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
