-- Zadania — a priority on every task (high / normal / low).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads and writes this column with every task, so without
-- it the board fails to load for everyone.
-- Requires `zadania.sql` to have been run first.
--
-- Safe to re-run.

-- A check, not an enum type, like `status`: a fourth level later is one ALTER.
-- Every existing task becomes 'normal', which is what the form defaults to.
alter table public.zadania
  add column if not exists priorytet text not null default 'normal';

alter table public.zadania drop constraint if exists zadania_priorytet_check;
alter table public.zadania
  add constraint zadania_priorytet_check check (priorytet in ('high', 'normal', 'low'));

create index if not exists zadania_priorytet_idx on public.zadania (priorytet);
