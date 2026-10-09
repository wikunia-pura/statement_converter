-- Kalendarz: a meeting's own "send by" day
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- The day a meeting's documents have to be out by. Null (every existing row)
-- means "as the meeting's type says" — its notice period before the start —
-- so nothing changes until someone sets a day in the meeting form.
--
-- Run BEFORE the release that reads it: the app selects this column, so without
-- it the Kalendarz does not load.

alter table public.spotkania
  add column if not exists termin_wysylki date;
