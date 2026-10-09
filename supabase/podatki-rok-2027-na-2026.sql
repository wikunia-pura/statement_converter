-- Podatki → Nieruchomości: declarations and rates entered under 2027 belong to 2026
-- One-off correction. Run once in Supabase: SQL Editor → New Query → paste → Run.
-- Idempotent: a second run finds nothing left to move.
--
-- The Excel import took the year from the sheet, which said 2027, so the first
-- declarations were stored for a year too far ahead. A year in the Podatki
-- module is the tax year the documents are FOR — 2026 now, 2027 next year —
-- so those rows (and the rates carried with them) move back one year.
--
-- Nothing is overwritten: a community that already has a 2026 declaration keeps
-- it, and its 2027 row stays where it is for you to look at (the final query
-- lists such rows). Rates are moved only when 2026 has none.

begin;

-- 1. Declarations: 2027 → 2026, except where the community already has 2026.
update public.podatki_nieruchomosci p
   set rok = 2026
 where p.rok = 2027
   and not exists (
     select 1 from public.podatki_nieruchomosci q
      where q.nip = p.nip and q.rok = 2026
   );

-- 2. Rates: 2027 → 2026, only when 2026 has no rates yet.
update public.podatki_stawki
   set rok = 2026
 where rok = 2027
   and not exists (select 1 from public.podatki_stawki where rok = 2026);

commit;

-- 3. What is still under 2027 — both a 2026 and a 2027 row for one NIP, to settle by hand.
select nip, rok, dane->>'nazwaPelna' as nazwa
  from public.podatki_nieruchomosci
 where rok = 2027
 order by nazwa;
