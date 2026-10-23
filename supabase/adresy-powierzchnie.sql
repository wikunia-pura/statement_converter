-- Adresy — a community's areas: total, the city's and the leased ("pożytki").
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads this column with every address, so without it
-- Adresy and every module that lists communities fail to load.
-- Requires `schema.sql` (adresy) and `zebrania-sprawozdania.sql` first.
--
-- Safe to re-run: the fill below only touches areas still empty.

-- One record per community: { calkowita, miasto, pozytki }, each m² or null
-- (not entered yet); 0 for the city's or the leased area = the community has
-- none. The budget plans take their header from here and no longer let the
-- areas be typed on the plan.
alter table public.adresy
  add column if not exists powierzchnie jsonb not null default '{}'::jsonb;

-- The city's and the leased areas the plans remembered per community until now
-- (zebrania_wspolnoty.udzialy, keyed by the address's name). There 0 was also
-- the untouched default, so a 0 comes over as not entered (null) — the Adresy
-- list then asks for it, to be typed in or marked as none.
update public.adresy a
   set powierzchnie = a.powierzchnie
     || jsonb_build_object('miasto', nullif((w.udzialy->>'miastoM2')::numeric, 0))
     || jsonb_build_object('pozytki', nullif((w.udzialy->>'pozytkiM2')::numeric, 0))
  from public.zebrania_wspolnoty w
 where lower(w.adres_nazwa) = lower(a.nazwa)
   and w.udzialy is not null
   and a.powierzchnie->'miasto' is null
   and a.powierzchnie->'pozytki' is null;

-- The total area as the community's newest statement prints it.
update public.adresy a
   set powierzchnie = a.powierzchnie || jsonb_build_object('calkowita', s.pow)
  from public.zebrania_wspolnoty w
  join lateral (
    select (z.dane->>'powierzchnia')::numeric as pow
      from public.zebrania_sprawozdania z
     where z.nr_wsp = w.vdom_nr
       and jsonb_typeof(z.dane->'powierzchnia') = 'number'
     order by z.okres_do desc
     limit 1
  ) s on true
 where lower(w.adres_nazwa) = lower(a.nazwa)
   and w.vdom_nr is not null
   and coalesce(jsonb_typeof(a.powierzchnie->'calkowita'), 'null') = 'null';
