-- Zadania — comments on a task, with @mentions.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. One shared project: without it the comments panel of a task asks
-- for a table that does not exist yet, and the notifier's comment check fails.
-- Requires `zadania.sql` to have been run first.
--
-- Safe to re-run.

create table if not exists public.zadania_komentarze (
  id          bigserial   primary key,
  -- Comments belong to the card: deleting the card deletes its conversation.
  zadanie_id  bigint      not null references public.zadania (id) on delete cascade,
  -- The author's MAILBOX, like `zadania.created_by`: what the session carries,
  -- and what survives the account being removed.
  autor_email text        not null,
  tresc       text        not null,
  -- Mailboxes tagged with @ in `tresc`. The text keeps the readable "@Anna Nowak";
  -- this is the part the notifier reads, so a rename never un-tags anyone.
  mentions    text[]      not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists zadania_komentarze_zadanie_idx on public.zadania_komentarze (zadanie_id, id);

-- Same model as every other table: any signed-in user reads and writes. The app
-- only lets an author delete their own comment.
alter table public.zadania_komentarze enable row level security;

drop policy if exists "authenticated_all" on public.zadania_komentarze;
create policy "authenticated_all" on public.zadania_komentarze
  for all to authenticated using (true) with check (true);

-- The board shows each card's LAST comment and how many there are. One row per
-- card with comments, so the board reads a handful of rows instead of every
-- comment ever written. (Re-run the file to add it to an existing project.)
-- `security_invoker`: the view obeys the policy of the table underneath.
create or replace view public.zadania_komentarze_podsumowanie
  with (security_invoker = true) as
select distinct on (zadanie_id)
       zadanie_id,
       id,
       autor_email,
       tresc,
       mentions,
       created_at,
       -- A window, so it counts the card's comments before DISTINCT ON keeps one.
       count(*) over (partition by zadanie_id) as liczba
  from public.zadania_komentarze
 order by zadanie_id, id desc;

grant select on public.zadania_komentarze_podsumowanie to authenticated;
