-- Zebrania: a revision's own name — v9.1.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- A version of a meeting's materials is "1.0", "1.1" …; the name lets the
-- office say which one it is ("Po uwagach zarządu"). Empty means no name —
-- the app then shows just the number. Run BEFORE the release that reads it:
-- the app selects this column, so without it the Zebrania list does not load.

alter table public.zebrania_wersje
  add column if not exists nazwa text not null default '';
