-- Kalendarz — materials of a meeting: whether it needs any, and how far along
-- they are (to prepare → prepared → sent), like its documents.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads these columns with every meeting, so without them
-- the calendar fails to load for everyone.
-- Requires `kalendarz.sql` to have been run first.
--
-- Safe to re-run, also over the earlier draft of this file (its 'gotowe' becomes
-- 'przygotowane').

-- 'brak' = no materials needed; 'potrzebne' = needed, nothing marked yet. Every
-- existing meeting starts as 'brak' — nothing is suddenly flagged as outstanding;
-- a meeting created in the app starts as 'potrzebne' unless the form says no.
alter table public.spotkania
  add column if not exists materialy_status text not null default 'brak';

alter table public.spotkania drop constraint if exists spotkania_materialy_status_check;
update public.spotkania set materialy_status = 'przygotowane' where materialy_status = 'gotowe';
alter table public.spotkania
  add constraint spotkania_materialy_status_check
    check (materialy_status in ('brak', 'potrzebne', 'do_przygotowania', 'przygotowane', 'wyslane'));

-- Who moved it last, and when — what the card shows and what lets the notifier
-- skip a change the signed-in person made themselves.
alter table public.spotkania
  add column if not exists materialy_zmienione_at timestamptz,
  add column if not exists materialy_zmienione_by text;
