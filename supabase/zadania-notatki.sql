-- Zadania — pinned notes: remarks fixed to the board itself (not to one task).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. One shared project: without it the notes strip of the "Zadania" view
-- cannot load or save, and a backup cannot be taken (it reads this table).
--
-- Safe to re-run.

create table if not exists public.zadania_notatki (
  id          bigserial   primary key,
  tresc       text        not null,
  -- The author's MAILBOX, like `zadania.created_by` and the comments': what the
  -- session carries, and what survives the account being removed.
  autor_email text        not null,
  created_at  timestamptz not null default now()
);

-- Same model as every other table: any signed-in user reads and writes. The app
-- only lets an author delete their own note.
alter table public.zadania_notatki enable row level security;

drop policy if exists "authenticated_all" on public.zadania_notatki;
create policy "authenticated_all" on public.zadania_notatki
  for all to authenticated using (true) with check (true);
