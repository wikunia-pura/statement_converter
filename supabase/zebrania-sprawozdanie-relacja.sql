-- Zebrania: a version links a statement of the library instead of copying it
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- The Sprawozdania module is the source of truth: statements are uploaded there
-- only, and a meeting's version points at one of them. A newer print of the
-- same community and period, uploaded later, replaces the library row in place
-- (same id), so every meeting linked to it shows the new figures.
--
-- The version keeps in `sprawozdanie` (jsonb) only what is its own: who linked
-- the statement and when, its downloads and its edited introduction.
--
-- Run BEFORE the release that reads it: the app selects this column, so without
-- it neither Zebrania nor Sprawozdania loads. Needs zebrania-sprawozdania.sql
-- (the statement library) to have run first.

alter table public.zebrania_wersje
  add column if not exists sprawozdanie_id bigint
    references public.zebrania_sprawozdania(id) on delete set null;

create index if not exists zebrania_wersje_sprawozdanie_id_idx
  on public.zebrania_wersje (sprawozdanie_id);

-- ============================================================
-- Existing versions: link the statement each one holds a copy of
-- ============================================================

-- 1. The library row the copy was taken from, while it is still there.
update public.zebrania_wersje w
   set sprawozdanie_id = s.id
  from public.zebrania_sprawozdania s
 where w.sprawozdanie_id is null
   and w.sprawozdanie ? 'dane'
   and s.id = nullif(w.sprawozdanie->>'zrodloId', '')::bigint;

-- 2. A copy whose row is gone: put the copy back in the library (when no other
--    print of that community and period is there) ...
insert into public.zebrania_sprawozdania
  (nr_wsp, nazwa, okres_od, okres_do, dane, plik_nazwa, imported_at, imported_by)
select distinct on ((w.sprawozdanie->'dane'->>'nrWsp')::integer,
                    (w.sprawozdanie->'dane'->>'okresOd')::date,
                    (w.sprawozdanie->'dane'->>'okresDo')::date)
       (w.sprawozdanie->'dane'->>'nrWsp')::integer,
       coalesce(w.sprawozdanie->'dane'->>'nazwa', ''),
       (w.sprawozdanie->'dane'->>'okresOd')::date,
       (w.sprawozdanie->'dane'->>'okresDo')::date,
       w.sprawozdanie->'dane',
       coalesce(w.sprawozdanie->>'plikNazwa', ''),
       coalesce(nullif(w.sprawozdanie->>'dodano', '')::timestamptz, now()),
       coalesce(w.sprawozdanie->>'dodal', '')
  from public.zebrania_wersje w
 where w.sprawozdanie_id is null
   and w.sprawozdanie ? 'dane'
   and coalesce(w.sprawozdanie->'dane'->>'nrWsp', '') ~ '^\d+$'
   and coalesce(w.sprawozdanie->'dane'->>'okresOd', '') ~ '^\d{4}-\d{2}-\d{2}$'
   and coalesce(w.sprawozdanie->'dane'->>'okresDo', '') ~ '^\d{4}-\d{2}-\d{2}$'
 order by (w.sprawozdanie->'dane'->>'nrWsp')::integer,
          (w.sprawozdanie->'dane'->>'okresOd')::date,
          (w.sprawozdanie->'dane'->>'okresDo')::date,
          w.updated_at desc
on conflict (nr_wsp, okres_od, okres_do) do nothing;

-- ... and link it by community and period.
update public.zebrania_wersje w
   set sprawozdanie_id = s.id
  from public.zebrania_sprawozdania s
 where w.sprawozdanie_id is null
   and w.sprawozdanie ? 'dane'
   and coalesce(w.sprawozdanie->'dane'->>'nrWsp', '') ~ '^\d+$'
   and s.nr_wsp   = (w.sprawozdanie->'dane'->>'nrWsp')::integer
   and s.okres_od::text = w.sprawozdanie->'dane'->>'okresOd'
   and s.okres_do::text = w.sprawozdanie->'dane'->>'okresDo';

-- 3. The copies themselves go: the figures are read from the library now.
update public.zebrania_wersje
   set sprawozdanie = sprawozdanie - 'dane' - 'plikNazwa' - 'zrodloId'
 where sprawozdanie_id is not null
   and sprawozdanie ? 'dane';
