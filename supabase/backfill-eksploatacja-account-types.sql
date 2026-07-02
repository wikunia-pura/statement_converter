-- One-time backfill: przypisz typ konta "eksploatacja" (131-1) do wszystkich
-- obecnych adresów.
--
-- Uruchom raz w Supabase: SQL Editor → New Query → wklej → Run.
--
-- Zasada:
--   • dla każdego adresu, dla każdego numeru konta (account_numbers),
--     ustaw account_types[<konto>] = <id typu "eksploatacja">,
--   • ale NIE nadpisuj kont, które mają już przypisany jakikolwiek typ.
--
-- Idempotentne: ponowne uruchomienie nic nie zmieni (klucze już istnieją).

do $$
declare
  eksp_id bigint;
begin
  -- Znajdź istniejący typ "eksploatacja" (dopasowanie po nazwie, niezależnie od wielkości liter).
  select id into eksp_id
  from public.konto_typy
  where lower(name) = 'eksploatacja'
  order by id
  limit 1;

  if eksp_id is null then
    raise exception 'Nie znaleziono typu konta "eksploatacja" w tabeli konto_typy.';
  end if;

  update public.adresy a
  set account_types =
    -- Nowe wpisy tylko dla kont bez przypisanego typu; istniejące zawsze wygrywają.
    (
      select coalesce(jsonb_object_agg(acc, eksp_id), '{}'::jsonb)
      from unnest(a.account_numbers) as acc
      where not (a.account_types ? acc)
    ) || a.account_types
  where exists (
    select 1
    from unnest(a.account_numbers) as acc
    where not (a.account_types ? acc)
  );

  raise notice 'Backfill zakończony. Typ "eksploatacja" (id=%) przypisany do kont bez typu.', eksp_id;
end $$;
