-- Zadania — a simple Kanban board (To Do / In Progress / Done).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. One shared project: without it the "Zadania" view asks for a
-- table that does not exist yet and its read fails for everyone.
--
-- Safe to re-run.

create table if not exists public.zadania (
  id               bigserial   primary key,
  tytul            text        not null,
  opis             text        not null default '',
  -- The three columns of the board. A check, not an enum type, so a fourth
  -- column later is one ALTER rather than a type migration.
  status           text        not null default 'todo'
                   check (status in ('todo', 'in_progress', 'done')),
  -- The assignee's MAILBOX, matched against `app_users.email` by the app. Not a
  -- foreign key on purpose: the mailbox is what the session carries and what a
  -- backup keys people by, and a card must outlive the account it was given to.
  przypisany_email text,
  created_by       text        not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists zadania_status_idx           on public.zadania (status);
create index if not exists zadania_przypisany_email_idx on public.zadania (przypisany_email);

-- Same model as every other table: any signed-in user reads and writes.
alter table public.zadania enable row level security;

drop policy if exists "authenticated_all" on public.zadania;
create policy "authenticated_all" on public.zadania
  for all to authenticated using (true) with check (true);
