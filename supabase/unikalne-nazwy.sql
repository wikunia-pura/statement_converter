-- Unique names where the app already relies on them.
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Three rules the app has assumed all along, enforced until now only by the
-- app itself (so two people saving at once, or an import, could still break
-- them):
--   - a community (`adresy.nazwa`) has one row per name — compared trimmed and
--     case-insensitive, the way every lookup by name in the app compares it
--     (the dashboard, the meetings, the backup restore all re-point by name);
--   - a bank (`banks.name`) likewise;
--   - exactly one account type (`konto_typy`) is the default.
-- A backup restore merges these tables row by row BY NAME, keeping their ids;
-- a duplicate name makes that match ambiguous.
--
-- The file checks first. If any existing rows already break a rule it stops
-- with an error listing them, and NOTHING is changed: merge or rename those
-- rows in the app (Adresy / Banki / Typy kont), then run the file again. Only
-- when the data is clean are the indexes created.

do $$
declare
  problems  text[] := '{}';
  offenders text;
begin
  select string_agg(format('"%s" (id %s)', nazwy, ids), '; ')
    into offenders
    from (
      select string_agg(distinct nazwa, ' / ') as nazwy,
             string_agg(id::text, ', ' order by id) as ids
        from public.adresy
       group by lower(btrim(nazwa))
      having count(*) > 1
    ) d;
  if offenders is not null then
    problems := problems || format('adresy — ta sama nazwa wspólnoty więcej niż raz: %s', offenders);
  end if;

  select string_agg(format('"%s" (id %s)', nazwy, ids), '; ')
    into offenders
    from (
      select string_agg(distinct name, ' / ') as nazwy,
             string_agg(id::text, ', ' order by id) as ids
        from public.banks
       group by lower(btrim(name))
      having count(*) > 1
    ) d;
  if offenders is not null then
    problems := problems || format('banks — ta sama nazwa banku więcej niż raz: %s', offenders);
  end if;

  select string_agg(format('"%s" (id %s)', name, id), ', ' order by id)
    into offenders
    from public.konto_typy
   where is_default
  having count(*) > 1;
  if offenders is not null then
    problems := problems || format('konto_typy — więcej niż jeden typ domyślny: %s', offenders);
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Nic nie zostało zmienione. Popraw najpierw te wiersze: %', array_to_string(problems, ' | ');
  end if;
end $$;

create unique index if not exists adresy_nazwa_unique
  on public.adresy (lower(btrim(nazwa)));

create unique index if not exists banks_name_unique
  on public.banks (lower(btrim(name)));

-- A partial index: any number of rows with `false`, at most one with `true`.
create unique index if not exists konto_typy_jeden_domyslny
  on public.konto_typy (is_default)
  where is_default;
