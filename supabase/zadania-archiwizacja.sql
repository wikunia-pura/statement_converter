-- Zadania — archiving: a finished card can be put away instead of deleted.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads and writes this column with every task, so without
-- it the board fails to load for everyone.
-- Requires `zadania.sql` to have been run first.
--
-- Safe to re-run.

-- Every existing task stays on the board: false is "not archived".
alter table public.zadania
  add column if not exists zarchiwizowane boolean not null default false;

create index if not exists zadania_zarchiwizowane_idx on public.zadania (zarchiwizowane);
