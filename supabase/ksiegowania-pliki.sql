-- Księgowania: files found by "Znajdź pliki księgowe" — v8.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Run it BEFORE tagging the release: the dashboard reads this table on every
-- load (a missing table only hides the new filters, but the scan itself cannot
-- save anything without it).
--
-- One row is one file the folder scan pinned to a community for ONE month:
--
--   * kind 'statement' — a bank statement to convert (XML, MT940, EXP, ZIP),
--   * kind 'pdf'       — the statement's PDF, renamed by the scan to
--                        <adres>_<typ konta>_<RRRR-MM>.pdf,
--   * status 'error'   — a statement of a recognised community that no
--                        converter could read (wrong format, broken file);
--                        it shows under the dashboard's "Błędy" filter.
--
-- `month_key` is the period the statement covers, not the day it was found.
-- `rel_path` is relative to the statements folder set in Settings and uses
-- '/': the folder is shared and mounted differently on every machine.
--
-- Whether a statement has been converted is NOT stored here: the app reads it
-- from `ksiegowania_konwersje` (same community and `file_hash` = its
-- `input_hash`, or for older conversions the same file name, converted after
-- the file's last change), so a statement dragged into the Converter by hand
-- counts too.
--
-- Like `history` and the other dashboard tables, rows keep the community's
-- NAME next to its id — a backup restore renumbers `adresy`.

create table if not exists public.ksiegowania_pliki (
  id                bigint      generated always as identity primary key,
  month_key         text        not null,
  kind              text        not null check (kind in ('statement', 'pdf')),
  status            text        not null default 'ok' check (status in ('ok', 'error')),
  error_message     text,
  adres_id          bigint      references public.adresy(id) on delete set null,
  adres_nazwa       text        not null,
  account_number    text,
  account_type_name text,
  bank_id           bigint      references public.banks(id) on delete set null,
  bank_name         text,
  converter_id      text,
  rel_path          text        not null,
  file_name         text        not null,
  original_name     text,
  file_size         bigint      not null default 0,
  file_mtime        timestamptz not null,
  file_hash         text        not null,
  -- Newer files the user chose not to swap in ("Zostaw obecny"), by hash, so
  -- the next scan does not ask about them again.
  ignored_hashes    text[]      not null default '{}',
  period_from       date,
  period_to         date,
  scanned_at        timestamptz not null default now(),
  scanned_by        text,
  -- One file is pinned once.
  unique (kind, rel_path)
);

create index if not exists ksiegowania_pliki_month_idx
  on public.ksiegowania_pliki (month_key);
create index if not exists ksiegowania_pliki_adres_idx
  on public.ksiegowania_pliki (adres_id);

alter table public.ksiegowania_pliki enable row level security;

drop policy if exists "authenticated_all" on public.ksiegowania_pliki;
create policy "authenticated_all" on public.ksiegowania_pliki
  for all to authenticated using (true) with check (true);
