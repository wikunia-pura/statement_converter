-- Zadania — a task can belong to a meeting (Kalendarz).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads and writes this column with every task, so without
-- it the board fails to load for everyone.
-- Requires `zadania.sql` and `kalendarz.sql` to have been run first.
--
-- Safe to re-run.

-- Null = a task of its own, which is every existing one. Deleting the meeting
-- keeps the task: it only stops being listed under a meeting that is gone.
alter table public.zadania
  add column if not exists spotkanie_id bigint
    references public.spotkania(id) on delete set null;

create index if not exists zadania_spotkanie_id_idx on public.zadania (spotkanie_id);
