-- Księgowania: a statement marked as posted without converting it
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- A statement pinned by the folder scan is normally converted in the app and
-- its accounting file ticked "in DOM". When it was posted some other way — the
-- conversion failed, or it was keyed into DOM by hand — the dashboard lets the
-- user mark it as posted directly. That writes a record here with no output
-- file, already ticked in DOM, and with this flag set, so the app knows there
-- is no accounting file to open and that undoing the mark removes the record.

alter table public.ksiegowania_konwersje
  add column if not exists recznie boolean not null default false;
