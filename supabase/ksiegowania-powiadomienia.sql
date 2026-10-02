-- Księgowania: who wrote a priority's note — for the notifications.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. The app now reads and writes this column with every priority, so
-- without it the priority list and its notes fail for everyone.
-- Requires `ksiegowania-priorytety-uwagi.sql` to have been run first.
--
-- Safe to re-run.

-- `updated_at` cannot say this: a reorder bumps it as well. The mailbox of the
-- last author of `notatka` is what lets the notifier tell "somebody else added a
-- note to a priority" from "I did".
alter table public.ksiegowania_priorytety
  add column if not exists notatka_by text;

-- Notes that were already there were written by whoever flagged the community.
update public.ksiegowania_priorytety
   set notatka_by = created_by
 where notatka_by is null;
