-- Księgowania: the dashboard's own record of conversions — v8.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Until now the dashboard (Pulpit → Księgowania) read the `history` table and
-- kept the "posted in DOM" tick on its rows — so "Historia → Wyczyść historię"
-- wiped the whole posting state with it. The history is a log, an extra
-- module; the posting state is the team's work and must not depend on it.
--
-- From this version every conversion is written twice: to `history` (the log,
-- free to clear) and here (the dashboard's record, with the DOM tick). The
-- dashboard, the folder scan and the Converter's "already processed" warning
-- read only this table.
--
-- The backfill at the end copies every row `history` has now — run it AFTER
-- the history was restored, so the posting state comes over complete. It skips
-- rows already copied, so running the file again is safe.

create table if not exists public.ksiegowania_konwersje (
  id                bigint      generated always as identity primary key,
  file_name         text        not null,
  bank_name         text        not null,
  converter_name    text        not null,
  status            text        not null check (status in ('success', 'error')),
  error_message     text,
  input_path        text        not null,
  output_path       text        not null,
  converted_at      timestamptz not null default now(),
  -- Like history: the id is the link, the name survives a restore (which
  -- renumbers adresy).
  adres_id          bigint      references public.adresy(id) on delete set null,
  adres_nazwa       text,
  -- The user's own "already posted in the DOM program" tick.
  booked_in_dom     boolean     not null default false,
  booked_in_dom_at  timestamptz,
  booked_in_dom_by  text
);

-- The month the converted STATEMENT covers (`YYYY-MM`), read from its
-- transactions at conversion time — September's statement converted in October
-- is September's work. Null for rows converted before it was recorded; the app
-- fills those in when it can still read the source file, and otherwise falls
-- back to the conversion date.
alter table public.ksiegowania_konwersje
  add column if not exists month_key text;

-- SHA-1 of the converted input file, the same hash the folder scan stores in
-- `ksiegowania_pliki.file_hash`. It ties a conversion to the pinned statement
-- it converted even after the file was renamed or moved — the file name alone
-- loses the link then and the statement shows as "not converted". Null for
-- rows converted before it was recorded; the app fills those in when the file
-- is still where it was converted and unchanged since.
alter table public.ksiegowania_konwersje
  add column if not exists input_hash text;

create index if not exists ksiegowania_konwersje_converted_idx
  on public.ksiegowania_konwersje (converted_at desc);
create index if not exists ksiegowania_konwersje_adres_idx
  on public.ksiegowania_konwersje (adres_id);

alter table public.ksiegowania_konwersje enable row level security;

drop policy if exists "authenticated_all" on public.ksiegowania_konwersje;
create policy "authenticated_all" on public.ksiegowania_konwersje
  for all to authenticated using (true) with check (true);

-- Backfill: everything the history holds now, ticks included.
insert into public.ksiegowania_konwersje (
  file_name, bank_name, converter_name, status, error_message, input_path,
  output_path, converted_at, adres_id, adres_nazwa, booked_in_dom,
  booked_in_dom_at, booked_in_dom_by
)
select
  h.file_name, h.bank_name, h.converter_name, h.status, h.error_message,
  h.input_path, h.output_path, h.converted_at, h.adres_id, h.adres_nazwa,
  h.booked_in_dom, h.booked_in_dom_at, h.booked_in_dom_by
from public.history h
where not exists (
  select 1 from public.ksiegowania_konwersje k
  where k.file_name = h.file_name and k.converted_at = h.converted_at
);
