-- Zebrania: each document of a version marked ready on its own
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- A version's documents (notice, financial statement, budget plan,
-- resolutions) are each marked ready on their own tab:
--   { "zawiadomienie": true, "sprawozdanie": true, "plan": true, "uchwaly": true }
-- The version's `status` stays as a stored derivation: 'przygotowane' only when
-- all four are ready (the app writes both together).
--
-- Versions already marked prepared (the old, version-wide switch) get a mark
-- only on the documents they actually hold — a version with just a notice is
-- then "in preparation" again, which is what it is. Versions never marked
-- prepared start with no marks.
--
-- Run BEFORE the release that reads it: the app selects this column, so without
-- it the Zebrania list does not load.

alter table public.zebrania_wersje
  add column if not exists gotowe jsonb not null default '{}'::jsonb;

update public.zebrania_wersje w
   set gotowe = jsonb_strip_nulls(jsonb_build_object(
         'zawiadomienie', case when exists (
             select 1 from jsonb_array_elements(coalesce(w.materialy, '[]'::jsonb)) m
              where m->>'rodzaj' = 'zawiadomienie') then true end,
         'sprawozdanie',  case when w.sprawozdanie is not null and w.sprawozdanie <> 'null'::jsonb then true end,
         'plan',          case when w.plan is not null and w.plan <> 'null'::jsonb then true end,
         'uchwaly',       case when exists (
             select 1 from jsonb_array_elements(coalesce(w.materialy, '[]'::jsonb)) m
              where m->>'rodzaj' = 'uchwala') then true end
       ))
 where w.status = 'przygotowane'
   and w.gotowe = '{}'::jsonb;

-- The status is derived from the marks: prepared only when all four are there.
update public.zebrania_wersje
   set status = case
         when gotowe ? 'zawiadomienie' and gotowe ? 'sprawozdanie'
          and gotowe ? 'plan' and gotowe ? 'uchwaly' then 'przygotowane'
         else 'w_przygotowaniu'
       end
 where status = 'przygotowane';

-- A linked meeting follows its newest version (as the app keeps it): a meeting
-- marked "Przygotowane" whose newest version is no longer prepared goes back to
-- "Do przygotowania". "Wysłane" is left alone — that already happened.
update public.spotkania s
   set materialy_status = 'do_przygotowania'
  from public.zebrania z
  join lateral (
    select w.status
      from public.zebrania_wersje w
     where w.zebranie_id = z.id
     order by w.major desc, w.minor desc
     limit 1
  ) newest on true
 where z.spotkanie_id = s.id
   and s.materialy_status = 'przygotowane'
   and newest.status = 'w_przygotowaniu';
