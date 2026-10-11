-- Księgowania: @tags in a priority's note and in a note on a community.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. The app now reads and writes these columns with every priority
-- and every note, so without them the dashboard's priorities and notes fail for
-- everyone.
-- Requires `ksiegowania-priorytety-uwagi.sql` and
-- `ksiegowania-powiadomienia.sql` to have been run first.
--
-- Safe to re-run.

-- Mailboxes tagged with @ in `notatka`. The text keeps the readable "@Anna
-- Nowak"; this is the part the notifier reads, so a rename never un-tags anyone.
alter table public.ksiegowania_priorytety
  add column if not exists mentions text[] not null default '{}';

-- The same for the text of a note on a community.
alter table public.ksiegowania_uwagi
  add column if not exists mentions text[] not null default '{}';
