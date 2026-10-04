-- Zebrania (meeting materials, versioned) + definable mailing kinds with
-- recipients — v8.1.0.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads `mailing_typy` when the Mailing module opens and the
-- Zebrania tables when its module opens, and writes `mailing_history.odbiorcy`
-- with every send — without them those screens fail to load for everyone.
-- Requires `mailing-module.sql` and `kalendarz.sql` (+ `kalendarz-lokalizacje-terminy.sql`)
-- to have been run first.
--
-- Safe to re-run.

-- ============================================================
-- 1. Mailing kinds (Mailing → Typy mailingu)
-- ============================================================

-- `klucz` is what templates and history rows store (`mailing_szablony.typ`,
-- `mailing_history.typ`) — stable for the life of the kind, so renaming one never
-- rewrites what a letter was filed under, and a restore (which renumbers ids)
-- keeps every template pointing at the same kind.
--
-- `adresaci` is the kind's default recipient groups:
--   { "zgn": bool, "pelnomocnik": bool, "zarzad": bool, "wlasne": ["a@b.pl", …] }
-- The send screen can change them for one send.
--
-- `systemowy` marks the one built-in kind (the meeting notice): the Kalendarz and
-- Zebrania flows look its templates up by key, so it may be neither deleted nor
-- renamed. Enforced by the app and by the trigger below.
create table if not exists public.mailing_typy (
  id          bigserial primary key,
  klucz       text        not null unique,
  nazwa       text        not null,
  opis        text        not null default '',
  systemowy   boolean     not null default false,
  adresaci    jsonb       not null default '{"zgn": true, "pelnomocnik": false, "zarzad": false, "wlasne": []}'::jsonb,
  created_at  timestamptz not null default now()
);

-- The kind every existing template and history row already carries. An ordinary
-- kind from now on — renamable, and deletable once no template uses it.
insert into public.mailing_typy (klucz, nazwa, opis, systemowy, adresaci)
values (
  'zgn-zaliczki',
  'Zmiany zaliczek ZGN',
  'Powiadomienie jednostki ZGN o zmianie zaliczek we wspólnocie.',
  false,
  '{"zgn": true, "pelnomocnik": false, "zarzad": false, "wlasne": []}'::jsonb
)
on conflict (klucz) do nothing;

-- The built-in meeting notice.
insert into public.mailing_typy (klucz, nazwa, opis, systemowy, adresaci)
values (
  'zawiadomienie-o-zebraniu',
  'Zawiadomienie o zebraniu',
  'Zawiadomienie o zebraniu wspólnoty — tworzone ze spotkania w Kalendarzu lub z modułu Zebrania.',
  true,
  '{"zgn": false, "pelnomocnik": false, "zarzad": true, "wlasne": []}'::jsonb
)
on conflict (klucz) do update set systemowy = true, nazwa = excluded.nazwa;

-- The built-in kind cannot be deleted or renamed, whichever client tries.
create or replace function public.mailing_typy_protect_system()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.systemowy then
      raise exception 'Typ mailingu „%” jest wbudowany i nie może zostać usunięty.', old.nazwa;
    end if;
    return old;
  end if;
  if old.systemowy and (new.nazwa is distinct from old.nazwa
                        or new.klucz is distinct from old.klucz
                        or new.systemowy is distinct from old.systemowy) then
    raise exception 'Typ mailingu „%” jest wbudowany — można zmienić tylko jego adresatów i opis.', old.nazwa;
  end if;
  if not old.systemowy and new.klucz is distinct from old.klucz then
    raise exception 'Klucz typu mailingu nie może się zmienić.';
  end if;
  return new;
end;
$$;

drop trigger if exists mailing_typy_protect_system on public.mailing_typy;
create trigger mailing_typy_protect_system
  before update or delete on public.mailing_typy
  for each row execute function public.mailing_typy_protect_system();

-- Everyone a mail was addressed to: [{ rodzaj, nazwa, email }]. Rows written
-- before this existed went to `jednostka_email` alone.
alter table public.mailing_history
  add column if not exists odbiorcy jsonb not null default '[]'::jsonb;

-- ============================================================
-- 2. Zebrania
-- ============================================================

-- One entry per meeting at most (unique `spotkanie_id`), or a standalone one
-- (null). When linked, the app reads date, community and location FROM THE
-- MEETING; the columns here are then only a fallback snapshot, refreshed by the
-- app just before a meeting is deleted (ON DELETE SET NULL keeps the entry).
create table if not exists public.zebrania (
  id                 bigserial primary key,
  spotkanie_id       bigint unique references public.spotkania(id) on delete set null,
  nazwa              text        not null default '',
  adres_id           bigint references public.adresy(id) on delete set null,
  adres_nazwa        text        not null default '',
  lokalizacja_id     bigint references public.spotkania_lokalizacje(id) on delete set null,
  lokalizacja_nazwa  text        not null default '',
  lokalizacja_adres  text        not null default '',
  starts_at          timestamptz,
  created_by         text        not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Versions of an entry's materials: 1.0, then revisions 1.1, 1.2 … Each holds its
-- own documents (`materialy`, the prepared notice: text, typed values, recipients)
-- and its own status. Every version stays editable.
create table if not exists public.zebrania_wersje (
  id           bigserial primary key,
  zebranie_id  bigint      not null references public.zebrania(id) on delete cascade,
  major        integer     not null default 1,
  minor        integer     not null default 0,
  status       text        not null default 'w_przygotowaniu'
                 check (status in ('w_przygotowaniu', 'przygotowane')),
  opis         text        not null default '',
  materialy    jsonb       not null default '[]'::jsonb,
  created_by   text        not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default '',
  unique (zebranie_id, major, minor)
);

create index if not exists zebrania_wersje_zebranie_id_idx
  on public.zebrania_wersje (zebranie_id);

-- ============================================================
-- 3. Row-Level Security — same model as every other table: any signed-in user
-- reads and writes everything (the data is shared). Anonymous users get nothing.
-- ============================================================

alter table public.mailing_typy     enable row level security;
alter table public.zebrania         enable row level security;
alter table public.zebrania_wersje  enable row level security;

drop policy if exists "authenticated_all" on public.mailing_typy;
create policy "authenticated_all" on public.mailing_typy
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.zebrania;
create policy "authenticated_all" on public.zebrania
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.zebrania_wersje;
create policy "authenticated_all" on public.zebrania_wersje
  for all to authenticated using (true) with check (true);
