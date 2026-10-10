-- Adresy — every community's tax office (name + code) set once.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. Requires `adresy-identyfikacja.sql` (the `identyfikacja` column) first.
--
-- Every community files to Urząd Skarbowy Warszawa-Mokotów (code 1433), except
-- Bokserska 57, which files to Warszawa-Ursynów (code 1438). Both keys live in
-- the `identyfikacja` record: `urzadSkarbowy` (the name CIT-8 prints) and
-- `kodUrzedu` (the e-Deklaracje code PIT-4R takes). This overwrites whatever
-- office was typed before. From then on the office is kept by hand in Adresy.
--
-- Safe to re-run.

update public.adresy
   set identyfikacja = identyfikacja
       || '{"urzadSkarbowy": "URZĄD SKARBOWY WARSZAWA-MOKOTÓW", "kodUrzedu": "1433"}'::jsonb;

update public.adresy
   set identyfikacja = identyfikacja
       || '{"urzadSkarbowy": "URZĄD SKARBOWY WARSZAWA-URSYNÓW", "kodUrzedu": "1438"}'::jsonb
 where nazwa ~* '\mbokserska\s*57\M';

-- Check: exactly one row should say Ursynów — Bokserska 57.
select id, nazwa, identyfikacja->>'urzadSkarbowy' as urzad, identyfikacja->>'kodUrzedu' as kod
  from public.adresy
 order by (identyfikacja->>'kodUrzedu') desc, nazwa;
