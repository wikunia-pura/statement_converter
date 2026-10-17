-- Restore from a backup in ONE transaction.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. Without it "Przywróć z kopii" stops before touching anything and
-- names this file. Safe to re-run.
--
-- How a restore runs (DatabaseService.importFullBackup):
--   1. The app builds every table's rows from the backup, with the backup's own
--      ids, and uploads them in slices to `restore_staging` — infrastructure,
--      not data: nothing reads it but the function below, which empties it.
--   2. One call to `restore_apply` makes the shared tables equal to the backup
--      inside a single transaction. A failure anywhere (a row the database
--      refuses, a dropped connection) leaves every table exactly as it was.
--
-- What it does, table by table (the order is fixed here, never the caller's):
--   - tables other rows point at by id (banks, account types, city units and
--     their proxies, communities, meeting kinds and places, meetings, the
--     statement library) are brought in line IN PLACE: the rows the backup
--     does not have are deleted, the rest updated or inserted by id. A section
--     an older backup does not carry keeps its links to them;
--   - every other table is emptied and filled with the backup's rows, ids kept;
--   - mailing kinds by their key (templates and history point at the key), the
--     built-in kind never deleted;
--   - account names (app_users) only updated: the rows belong to the sign-in.
--   Then each sequence is moved past the highest id, so the next row the app
--   adds gets a new one.
--
-- If a real restore ever fails with "canceling statement due to statement
-- timeout", raise the limit of the signed-in role (Supabase's default is 8 s) —
-- a limit set on the function itself does not reach the call already running:
--   alter role authenticated set statement_timeout = '60s';

create table if not exists public.restore_staging (
  restore_id  uuid        not null,
  seq         integer     not null,
  tabela      text        not null,
  wiersze     jsonb       not null,
  created_at  timestamptz not null default now(),
  primary key (restore_id, seq)
);

alter table public.restore_staging enable row level security;

drop policy if exists "authenticated_all" on public.restore_staging;
create policy "authenticated_all" on public.restore_staging
  for all to authenticated using (true) with check (true);

-- The rows staged for one table, in the order they were staged.
create or replace function public.restore_wiersze(p_restore_id uuid, p_tabela text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(e.w order by s.seq, e.ord), '[]'::jsonb)
  from public.restore_staging s
  cross join lateral jsonb_array_elements(s.wiersze) with ordinality as e(w, ord)
  where s.restore_id = p_restore_id and s.tabela = p_tabela
$$;

-- `p_tabele`: the tables the backup carries — every other table is left alone.
-- `p_bez_usuwania`: tables whose rows the backup lacks are kept (an older backup
-- adds to them without owning them: the statement library rebuilt from the
-- versions' copies, meeting kinds and places it does not list).
-- Returns the number of rows written per table, for the log.
create or replace function public.restore_apply(
  p_restore_id uuid,
  p_tabele text[],
  p_bez_usuwania text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- What is pointed at before what points at it. `scal`: updated in place by
  -- id; `zastap`: emptied and filled; `klucz`: by `klucz`; `nazwy`: app_users.
  porzadek constant text[][] := array[
    ['banks', 'scal'],
    ['konto_typy', 'scal'],
    ['zgn_jednostki', 'scal'],
    ['zgn_pelnomocnicy', 'scal'],
    ['adresy', 'scal'],
    ['kontrahenci', 'zastap'],
    ['history', 'zastap'],
    ['odczyty_history', 'zastap'],
    ['mailing_typy', 'klucz'],
    ['mailing_pola', 'zastap'],
    ['mailing_szablony', 'zastap'],
    ['spotkania_typy', 'scal'],
    ['spotkania_lokalizacje', 'scal'],
    ['spotkania', 'scal'],
    ['zebrania_sprawozdania', 'scal'],
    ['zebrania', 'zastap'],
    ['zebrania_wersje', 'zastap'],
    ['zebrania_wspolnoty', 'zastap'],
    ['zebrania_ustawienia', 'zastap'],
    ['plany_gospodarcze', 'zastap'],
    ['podatki_nieruchomosci', 'zastap'],
    ['podatki_stawki', 'zastap'],
    ['podatki_cit', 'zastap'],
    ['podatki_pit', 'zastap'],
    ['podatki_cit_ustawienia', 'zastap'],
    ['podpisy_historia', 'zastap'],
    ['ksiegowania_priorytety', 'zastap'],
    ['ksiegowania_przypisania', 'zastap'],
    ['ksiegowania_uwagi', 'zastap'],
    ['ksiegowania_konwersje', 'zastap'],
    ['ksiegowania_pliki', 'zastap'],
    ['zadania', 'zastap'],
    ['zadania_komentarze', 'zastap'],
    ['zadania_notatki', 'zastap'],
    ['notification_prefs', 'zastap'],
    ['mailing_history', 'zastap'],
    ['app_users', 'nazwy']
  ];
  znane text[] := array(select porzadek[i][1] from generate_subscripts(porzadek, 1) as i);
  i int;
  tabela text;
  tryb text;
  wiersze jsonb;
  ids bigint[];
  kolumny text[];
  nieznane text[];
  w_tabeli text[];
  lista text;
  wybor text;
  zmiany text;
  sekwencja text;
  r jsonb;
  wynik jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'restore_apply: brak zalogowanego użytkownika';
  end if;
  select array_agg(t) into nieznane from unnest(p_tabele) t where not t = any(znane);
  if nieznane is not null then
    raise exception 'restore_apply: nieznane tabele: %', array_to_string(nieznane, ', ');
  end if;

  -- 1. What the backup does not have goes first — children before parents, so
  --    nothing is set to null only to be overwritten a moment later.
  for i in reverse array_upper(porzadek, 1) .. 1 loop
    tabela := porzadek[i][1];
    tryb := porzadek[i][2];
    continue when not tabela = any(p_tabele) or tabela = any(p_bez_usuwania);
    wiersze := public.restore_wiersze(p_restore_id, tabela);
    if tryb = 'zastap' then
      execute format('delete from public.%I where true', tabela);
    elsif tryb = 'scal' then
      ids := array(select (e->>'id')::bigint from jsonb_array_elements(wiersze) e);
      execute format('delete from public.%I where id <> all($1)', tabela) using ids;
    elsif tryb = 'klucz' then
      -- mailing_typy: the built-in kind always stays (a trigger guards it too).
      delete from public.mailing_typy m
      where not m.systemowy
        and m.klucz <> all(array(select e->>'klucz' from jsonb_array_elements(wiersze) e));
    end if;
  end loop;

  -- 2. The backup's rows, parents before children.
  for i in 1 .. array_upper(porzadek, 1) loop
    tabela := porzadek[i][1];
    tryb := porzadek[i][2];
    continue when not tabela = any(p_tabele);
    wiersze := public.restore_wiersze(p_restore_id, tabela);
    wynik := wynik || jsonb_build_object(tabela, jsonb_array_length(wiersze));
    continue when jsonb_array_length(wiersze) = 0;

    if tryb = 'nazwy' then
      -- Only the name and (when the backup says anything about it) the colour
      -- of an account that exists; one that does not is simply not there.
      for r in select e from jsonb_array_elements(wiersze) e loop
        update public.app_users u
        set first_name = r->>'first_name',
            last_name = r->>'last_name',
            color = case when r ? 'color' then r->>'color' else u.color end
        where lower(btrim(u.email)) = lower(btrim(r->>'email'));
      end loop;
      continue;
    end if;

    -- Every row carries the same columns (a bulk insert would give a missing
    -- one NULL, not its default), and each is a column of the table — one that
    -- is not means a migration has not been run, said here by name.
    if (select count(distinct (select array_agg(k order by k) from jsonb_object_keys(e) k))
        from jsonb_array_elements(wiersze) e) > 1 then
      raise exception 'restore_apply: wiersze tabeli % mają różne kolumny', tabela;
    end if;
    kolumny := array(select jsonb_object_keys(wiersze->0));
    w_tabeli := array(
      select a.attname::text from pg_attribute a
      where a.attrelid = format('public.%I', tabela)::regclass and a.attnum > 0 and not a.attisdropped
    );
    if exists (select 1 from unnest(kolumny) k where not k = any(w_tabeli)) then
      raise exception 'restore_apply: tabela % nie ma kolumn: % (uruchom brakującą migrację SQL)',
        tabela, array_to_string(array(select k from unnest(kolumny) k where not k = any(w_tabeli)), ', ');
    end if;
    lista := (select string_agg(format('%I', k), ', ') from unnest(kolumny) k);
    -- A NOT NULL column with a default takes the default for a null, as an
    -- insert leaving it out would (a field an older backup did not have yet).
    wybor := (
      select string_agg(
        case when a.attnotnull and d.adbin is not null
          then format('coalesce(%I, %s)', u.k, pg_get_expr(d.adbin, d.adrelid))
          else format('%I', u.k) end,
        ', ' order by u.n)
      from unnest(kolumny) with ordinality as u(k, n)
      join pg_attribute a on a.attrelid = format('public.%I', tabela)::regclass and a.attname = u.k
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    );

    if tryb = 'scal' then
      ids := array(select (e->>'id')::bigint from jsonb_array_elements(wiersze) e);
      -- A unique name or key two kept rows swapped would refuse the first of
      -- the two updates; parked on a value no row can have, then written.
      if tabela = 'banks' then
        update public.banks set name = name || ' #' || id where id = any(ids);
      elsif tabela = 'adresy' then
        update public.adresy set nazwa = nazwa || ' #' || id where id = any(ids);
      elsif tabela = 'konto_typy' then
        update public.konto_typy set is_default = false where is_default;
      elsif tabela = 'zebrania_sprawozdania' then
        update public.zebrania_sprawozdania set nr_wsp = -id where id = any(ids);
      end if;
      zmiany := (
        select string_agg(format('%1$I = excluded.%1$I', k), ', ') from unnest(kolumny) k where k <> 'id'
      );
      execute format(
        'insert into public.%1$I (%2$s) overriding system value '
          || 'select %4$s from jsonb_populate_recordset(null::public.%1$I, $1) '
          || 'on conflict (id) do update set %3$s',
        tabela, lista, zmiany, wybor
      ) using wiersze;
    elsif tryb = 'klucz' then
      zmiany := (
        select string_agg(format('%1$I = excluded.%1$I', k), ', ') from unnest(kolumny) k where k <> 'klucz'
      );
      execute format(
        'insert into public.%1$I (%2$s) select %4$s from jsonb_populate_recordset(null::public.%1$I, $1) '
          || 'on conflict (klucz) do update set %3$s',
        tabela, lista, zmiany, wybor
      ) using wiersze;
    else
      execute format(
        'insert into public.%1$I (%2$s) overriding system value '
          || 'select %3$s from jsonb_populate_recordset(null::public.%1$I, $1)',
        tabela, lista, wybor
      ) using wiersze;
    end if;
  end loop;

  -- 3. Each sequence past the highest id written, so the next row added gets a new one.
  for i in 1 .. array_upper(porzadek, 1) loop
    tabela := porzadek[i][1];
    continue when not tabela = any(p_tabele);
    continue when not exists (
      select 1 from pg_attribute a
      where a.attrelid = format('public.%I', tabela)::regclass and a.attname = 'id' and not a.attisdropped
    );
    sekwencja := pg_get_serial_sequence(format('public.%I', tabela), 'id');
    continue when sekwencja is null;
    execute format(
      'select setval(%L, coalesce((select max(id) from public.%I), 0) + 1, false)', sekwencja, tabela
    );
  end loop;

  -- 4. The staged rows are spent; any left behind by a restore that never got
  --    this far go too.
  delete from public.restore_staging
  where restore_id = p_restore_id or created_at < now() - interval '1 day';

  return wynik;
end;
$$;

revoke all on function public.restore_apply(uuid, text[], text[]) from public, anon;
grant execute on function public.restore_apply(uuid, text[], text[]) to authenticated;
revoke all on function public.restore_wiersze(uuid, text) from public, anon;
grant execute on function public.restore_wiersze(uuid, text) to authenticated;
