-- Adresy — the community's board (zarząd), and the board members a meeting has.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads these columns with every address and every meeting,
-- so without them Adresy and Kalendarz fail to load for everyone.
-- Requires `schema.sql` (adresy) and `kalendarz.sql` (spotkania) first.
--
-- Safe to re-run.

-- One list per community: [{ id, imieNazwisko, email }]. A list on the row, like
-- `apartment_mappings`: nobody else points at a board member, and the board
-- travels with its community through a backup.
alter table public.adresy
  add column if not exists zarzad jsonb not null default '[]'::jsonb;

-- The board members a meeting is with — a snapshot taken when the community is
-- picked: [{ imieNazwisko, email }]. A later change to the board does not
-- rewrite who a past meeting was with.
alter table public.spotkania
  add column if not exists zarzad jsonb not null default '[]'::jsonb;
