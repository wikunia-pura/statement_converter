-- Zadania — the order of cards inside a column (drag and drop).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads and writes this column with every task, so without
-- it the board fails to load for everyone.
-- Requires `zadania.sql` to have been run first.
--
-- Safe to re-run.

-- Lower = higher up in its column. Gaps and negative numbers are fine: a new card
-- (or one moved to another column) goes on top as "lowest so far minus one", and
-- a drag renumbers the column 1..n.
alter table public.zadania
  add column if not exists pozycja integer not null default 0;

-- Existing cards keep the order they had on the board — latest change on top —
-- numbered per column. Only rows still at the default are touched, so running
-- this again never undoes an order somebody has dragged into place.
update public.zadania z
   set pozycja = r.rn
  from (
    select id,
           row_number() over (partition by status order by updated_at desc, id desc) as rn
      from public.zadania
  ) r
 where r.id = z.id
   and z.pozycja = 0;

create index if not exists zadania_status_pozycja_idx on public.zadania (status, pozycja);
