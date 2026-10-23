-- Adresy — a community can be marked as having no city unit ("jednostka ZGN").
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads this column with every address, so without it
-- Adresy fails to load for everyone. Requires `schema.sql` (adresy) first.
--
-- Safe to re-run.

-- True ⇒ the community deliberately has no unit: the list no longer flags the
-- missing unit. Always false while `zgn_jednostka_id` is set.
alter table public.adresy
  add column if not exists bez_zgn boolean not null default false;
