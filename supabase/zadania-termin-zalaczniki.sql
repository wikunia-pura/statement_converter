-- Zadania, druga tura: termin, załączniki i ślad ostatniej zmiany.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release, and after supabase/zadania.sql. One shared project: without it
-- the "Zadania" view selects columns that do not exist yet and its reads fail
-- for everyone, and attachments have nowhere to go.
--
-- Safe to re-run.

alter table public.zadania
  -- A day, not an instant: "due on the 3rd" is the 3rd for whoever is looking.
  add column if not exists termin date,
  -- [{ id, nazwa, rozmiar, sciezka, dodanyBy, dodanyAt }] — descriptions only;
  -- the bytes are in the storage bucket below, under `sciezka`.
  add column if not exists zalaczniki jsonb not null default '[]'::jsonb,
  -- Mailbox of whoever last changed the card, so the notifier can skip a change
  -- the signed-in person made themselves.
  add column if not exists updated_by text not null default '';

create index if not exists zadania_termin_idx on public.zadania (termin);

-- ============================================================
-- Attachments — a private bucket, 5 MB per file
-- ============================================================
--
-- Private: files are read through the signed-in session, never a public URL.
-- Any format is accepted (no allowed_mime_types); the size cap is enforced here
-- as well as in the app, so a modified client cannot exceed it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('zadania-zalaczniki', 'zadania-zalaczniki', false, 5242880)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = null;

-- Same model as every other table: any signed-in user reads and writes.
drop policy if exists "zadania_zalaczniki_authenticated_all" on storage.objects;
create policy "zadania_zalaczniki_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'zadania-zalaczniki')
  with check (bucket_id = 'zadania-zalaczniki');
