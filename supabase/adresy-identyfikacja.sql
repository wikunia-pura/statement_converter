-- Adresy — a community's tax identification (NIP, REGON, full name, seat, tax office, contact).
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads this column with every address, so without it
-- Adresy and every module that lists communities fail to load.
-- Requires `schema.sql` (adresy) first.
--
-- Safe to re-run.

-- One record per community: { nip, regon, nazwaPelna, siedziba: {kraj,
-- wojewodztwo, powiat, gmina, ulica, nrDomu, nrLokalu, miejscowosc,
-- kodPocztowy}, urzadSkarbowy, telefon, email }. A record on the row, like
-- `zarzad`: nobody else points at it, and it travels with its community through
-- a backup. The tax modules (CIT) read it instead of asking again per return.
alter table public.adresy
  add column if not exists identyfikacja jsonb not null default '{}'::jsonb;
