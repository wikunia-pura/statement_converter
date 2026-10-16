-- Księgowania: a conversion discarded as a duplicate
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- A statement converted again by mistake — the same file, to the same account
-- as a conversion already posted in DOM — leaves an accounting file that must
-- not be posted, and the community would wait for it forever. The dashboard
-- lets the user discard such a conversion: the record stays (it did happen,
-- and the file exists), but it no longer counts as a file to post. Set when
-- discarded, cleared when restored.

alter table public.ksiegowania_konwersje
  add column if not exists odrzucone_at timestamptz,
  add column if not exists odrzucone_by text;
