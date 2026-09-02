-- Statement Converter — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New Query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.banks (
  id                bigserial primary key,
  name              text        not null,
  converter_id      text        not null,
  account_prefixes  text[]      not null default '{}',
  created_at        timestamptz not null default now()
);

create table if not exists public.kontrahenci (
  id                  bigserial primary key,
  nazwa               text        not null,
  konto_kontrahenta   text        not null,
  nip                 text,
  typ                 text        not null default 'Kontrahent'
                                  check (typ in ('Kontrahent', 'Pozostałe przychody', 'Pozostałe koszty')),
  typy                text[]      not null default '{Kontrahent}',
  alternative_names   text[]      not null default '{}',
  created_at          timestamptz not null default now()
);

-- kontrahenci: multi-type support. `typy` is the source of truth — a contractor
-- can hold several roles at once. Legacy scalar `typ` is kept for backward
-- compatibility and mirrored to typy[1] on every write.
alter table public.kontrahenci
  add column if not exists typy text[];
update public.kontrahenci
  set typy = array[coalesce(typ, 'Kontrahent')]
  where typy is null;
alter table public.kontrahenci alter column typy set default '{Kontrahent}';
alter table public.kontrahenci alter column typy set not null;

-- City units ("jednostki ZGN") notified when a housing community changes its
-- monthly-fee rates. One unit typically serves many communities, so it lives in
-- its own dictionary and each address points at (at most) one of them.
create table if not exists public.zgn_jednostki (
  id          bigserial primary key,
  nazwa       text        not null,
  email       text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.adresy (
  id                 bigserial primary key,
  nazwa              text        not null,
  alternative_names  text[]      not null default '{}',
  swrk_identifiers   text[]      not null default '{}',
  account_numbers    text[]      not null default '{}',
  bank_id            bigint      references public.banks(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Idempotent migrations for existing deployments.
alter table public.adresy
  add column if not exists bank_id bigint references public.banks(id) on delete set null;
alter table public.adresy
  add column if not exists account_numbers text[] not null default '{}';
alter table public.adresy
  add column if not exists apartment_mappings jsonb not null default '[]'::jsonb;
-- Maps a canonical account number to a konto_typy id: { "<account>": <typ id> }.
alter table public.adresy
  add column if not exists account_types jsonb not null default '{}'::jsonb;
-- The city unit notified about this community's rate changes (Mailing module).
alter table public.adresy
  add column if not exists zgn_jednostka_id bigint
    references public.zgn_jednostki(id) on delete set null;

-- Global, configurable account types. Each maps a community bank account to the
-- pair of accounting symbols the exporters emit (bank-account side + apartment
-- account prefix). Exactly one row is the default.
create table if not exists public.konto_typy (
  id                  bigserial primary key,
  name                text        not null,
  bank_account_symbol text        not null default '131-1',
  apartment_prefix    text        not null default '204',
  is_default          boolean     not null default false,
  created_at          timestamptz not null default now()
);

-- Seed a default type on first setup so existing addresses keep the historical
-- 131-1 / 204 behavior. Only inserts when the table is empty.
insert into public.konto_typy (name, bank_account_symbol, apartment_prefix, is_default)
select 'Podstawowy', '131-1', '204', true
where not exists (select 1 from public.konto_typy);

-- Application-level configuration shared by all installations. Holds secrets
-- that must NOT ship inside the (publicly downloadable) release binaries —
-- e.g. the Anthropic API key. Signed-in users can only READ; writes happen
-- exclusively from the Supabase dashboard (SQL editor / table editor):
--
-- Paste the WHOLE key in place of the placeholder — it already starts with
-- `sk-ant-`, so leaving a prefix behind yields `sk-ant-sk-ant-…` and every
-- conversion fails with a 401:
--
--   insert into public.app_config (key, value)
--     values ('anthropic_api_key', '<PASTE_FULL_KEY_HERE>')
--     on conflict (key) do update set value = excluded.value, updated_at = now();
create table if not exists public.app_config (
  key         text primary key,
  value       text        not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.history (
  id              bigserial primary key,
  file_name       text        not null,
  bank_name       text        not null,
  converter_name  text        not null,
  status          text        not null check (status in ('success', 'error')),
  error_message   text,
  input_path      text        not null,
  output_path     text        not null,
  converted_at    timestamptz not null default now(),
  -- Community the file was converted for. The id is the convenience link; the
  -- name is the durable one (a restore renumbers adresy), and rows written
  -- before these columns existed carry neither — the "Księgowania" view then
  -- reads the community out of the generated filename.
  adres_id        bigint      references public.adresy(id) on delete set null,
  adres_nazwa     text,
  -- The user's own "already posted in the DOM program" tick. Nothing reads DOM;
  -- this is the record of what has been booked there, shared by the team.
  booked_in_dom     boolean   not null default false,
  booked_in_dom_at  timestamptz,
  booked_in_dom_by  text
);

-- Idempotent migrations for deployments created before the Księgowania view.
-- Backfilling the community of older rows is a one-off, kept out of here: see
-- supabase/ksiegowania-dom.sql.
alter table public.history
  add column if not exists adres_id bigint references public.adresy(id) on delete set null;
alter table public.history
  add column if not exists adres_nazwa text;
alter table public.history
  add column if not exists booked_in_dom boolean not null default false;
alter table public.history
  add column if not exists booked_in_dom_at timestamptz;
alter table public.history
  add column if not exists booked_in_dom_by text;

-- The Księgowania view reads one month at a time, per community.
create index if not exists history_converted_at_idx
  on public.history (converted_at desc);
create index if not exists history_adres_id_idx
  on public.history (adres_id);

-- Meter-reading conversions ("Odczyty liczników"). One row per operation — a
-- single click can read several supplier workbooks and emit one file per
-- housing community, so the sources and outputs are kept as JSON rather than
-- flattened into rows: skipped source rows belong to a source file, not to an
-- output file, and splitting them would need an artificial attribution rule.
create table if not exists public.odczyty_history (
  id             bigserial primary key,
  supplier       text        not null,          -- 'ISTA', or 'ISTA + TECHEM' for a mixed run
  status         text        not null check (status in ('success', 'error')),
  error_message  text,
  output_dir     text        not null default '',
  -- [{ fileName, filePath, supplierLabel, readingCount, skippedCount, skipped: [...] }]
  source_files   jsonb       not null default '[]'::jsonb,
  -- [{ wm, fileName, outputPath, date, readingCount }]
  output_files   jsonb       not null default '[]'::jsonb,
  reading_count  integer     not null default 0,
  skipped_count  integer     not null default 0,
  converted_at   timestamptz not null default now()
);

create index if not exists odczyty_history_converted_at_idx
  on public.odczyty_history (converted_at desc);

-- ============================================================
-- Mailing (rate-change notifications to city units)
-- ============================================================

-- User-defined dynamic fields. A field carries a fixed lead-in sentence
-- (`tekst`); the value that completes it is typed once per send, so the same
-- field can read "…w kwocie: 350,00 zł" one month and "…410,00 zł" the next.
-- The built-in fields ("Adres Wspólnoty", "Data") are code-side, not rows here.
create table if not exists public.mailing_pola (
  id          bigserial primary key,
  nazwa       text        not null,
  tekst       text        not null default '',
  -- Unit appended to the typed value ("zł/m²", "%"). Part of the field, not of
  -- the value, so "20" typed at send time goes out as "20 zł/m²".
  jednostka     text      not null default '',
  -- How the value is entered at send time: free text (as before), a date
  -- (picked, rendered dd.mm.rrrr) or an hour (picked, rendered gg:mm).
  typ_wartosci  text      not null default 'tekst'
                          check (typ_wartosci in ('tekst', 'data', 'godzina')),
  created_at  timestamptz not null default now()
);

-- Idempotent migrations for deployments created before units / value kinds.
alter table public.mailing_pola
  add column if not exists jednostka text not null default '';
alter table public.mailing_pola
  add column if not exists typ_wartosci text not null default 'tekst';
-- Separate from the column add so the constraint also lands on databases where
-- the column already exists (there `add column if not exists` does nothing).
alter table public.mailing_pola
  drop constraint if exists mailing_pola_typ_wartosci_check;
alter table public.mailing_pola
  add constraint mailing_pola_typ_wartosci_check
  check (typ_wartosci in ('tekst', 'data', 'godzina'));

-- Message templates. Subject and body are authored with {{field}} placeholders
-- resolved at send time; `attach_pdf` is the template's default for the
-- "also attach the body as PDF" switch (the send screen can override it).
create table if not exists public.mailing_szablony (
  id           bigserial primary key,
  nazwa        text        not null,
  typ          text        not null default 'zgn-zaliczki',
  temat        text        not null default '',
  tresc        text        not null default '',
  attach_pdf   boolean     not null default false,
  -- Field names offered by this template's {{Tabela pól}} table, in row order:
  -- ["Zaliczka remontowy", "Zaliczka eksploatacja"]. The shortlist, not the
  -- choice — the send screen ticks which of them actually go out.
  table_fields jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- Idempotent migration for deployments created before the field table existed.
alter table public.mailing_szablony
  add column if not exists table_fields jsonb not null default '[]'::jsonb;

-- One row per (send, community): the rendered subject/body exactly as it went
-- out, the resolved recipient, the field values used, and the attachments.
-- `attachments` keeps file names + on-disk paths — the files themselves live in
-- the local output folder and can be purged from the module's history tab.
create table if not exists public.mailing_history (
  id                bigserial primary key,
  typ               text        not null default 'zgn-zaliczki',
  template_name     text        not null default '',
  status            text        not null check (status in ('success', 'error')),
  error_message     text,
  adres_id          bigint,
  adres_nazwa       text        not null default '',
  jednostka_nazwa   text        not null default '',
  jednostka_email   text        not null default '',
  subject           text        not null default '',
  body_html         text        not null default '',
  body_text         text        not null default '',
  -- [{ nazwa, tekst, wartosc }]
  field_values      jsonb       not null default '[]'::jsonb,
  -- [{ fileName, filePath, kind: 'pdf' | 'custom' }]
  attachments       jsonb       not null default '[]'::jsonb,
  sent_from         text        not null default '',
  sent_at           timestamptz not null default now()
);

create index if not exists mailing_history_sent_at_idx
  on public.mailing_history (sent_at desc);

-- ============================================================
-- Kalendarz (spotkania)
-- ============================================================

-- A readable mirror of the application's accounts, so a meeting's participants
-- can be picked from the people who actually have access. `auth.users` is not
-- reachable with the publishable key (and must not be), hence the mirror: it
-- carries only the id, the mailbox and the display name.
create table if not exists public.app_users (
  id           uuid        primary key,
  email        text        not null,
  display_name text,
  -- The app's OWN name for the person, typed in Ustawienia → Użytkownicy. Kept
  -- apart from `display_name` on purpose: that one mirrors the account's auth
  -- metadata and the trigger below overwrites it whenever the metadata carries
  -- a name, so a name typed in the app would lose to whatever Supabase holds.
  -- The trigger never touches these two.
  first_name   text,
  last_name    text,
  created_at   timestamptz not null default now()
);

-- For projects created before these columns existed.
alter table public.app_users
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- One function for insert/update/delete: the participant picker must not offer
-- an account that was revoked, and must show a mailbox the moment it changes.
create or replace function public.sync_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.app_users where id = old.id;
    return old;
  end if;

  insert into public.app_users (id, email, display_name, created_at)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    ),
    coalesce(new.created_at, now())
  )
  on conflict (id) do update
    set email        = excluded.email,
        -- Keep a name already there when the new payload carries none, so a
        -- password change doesn't blank out what the picker displays.
        display_name = coalesce(excluded.display_name, app_users.display_name);
  return new;
end;
$$;

drop trigger if exists sync_app_user_upsert on auth.users;
create trigger sync_app_user_upsert
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_app_user();

drop trigger if exists sync_app_user_delete on auth.users;
create trigger sync_app_user_delete
  after delete on auth.users
  for each row execute function public.sync_app_user();

-- Backfill the accounts that existed before the trigger did.
insert into public.app_users (id, email, display_name, created_at)
select
  u.id,
  coalesce(u.email, ''),
  nullif(
    btrim(
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
    ),
    ''
  ),
  coalesce(u.created_at, now())
from auth.users u
on conflict (id) do update
  set email = excluded.email;

-- The kinds of meeting, defined by the user inside the calendar module rather
-- than hard-coded. `kolor` is what makes a month of meetings readable, so a
-- type always has one.
create table if not exists public.spotkania_typy (
  id         bigserial   primary key,
  nazwa      text        not null,
  kolor      text        not null default '#5b5ff6',
  opis       text        not null default '',
  created_at timestamptz not null default now()
);

-- Where meetings happen — a dictionary the user owns, like the types above.
create table if not exists public.spotkania_lokalizacje (
  id         bigserial   primary key,
  nazwa      text        not null,
  -- Street address or "how to get there", shown under the name.
  adres      text        not null default '',
  opis       text        not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.spotkania (
  id          bigserial   primary key,
  nazwa       text        not null,
  -- ON DELETE SET NULL on both links: removing a type or a community must not
  -- take the meetings with it — the record of what happened outlives both.
  typ_id      bigint      references public.spotkania_typy(id) on delete set null,
  adres_id    bigint      references public.adresy(id) on delete set null,
  -- The community's NAME, kept alongside the id for the same reason `history`
  -- keeps it: a restore renumbers `adresy`, and the name is what the link is
  -- re-pointed through afterwards.
  adres_nazwa text        not null default '',
  starts_at   timestamptz not null,
  -- Optional: a meeting with no stated end is a point in the day, not an error.
  ends_at     timestamptz,
  opis        text        not null default '',
  -- [{ userId, email, displayName }] — snapshotted from `app_users` on save, so
  -- a participant stays readable after their account is removed.
  uczestnicy  jsonb       not null default '[]'::jsonb,
  -- Where it happens. ON DELETE SET NULL like every other link here; the NAME
  -- travels beside the id because a restore renumbers the dictionary.
  lokalizacja_id    bigint  references public.spotkania_lokalizacje(id) on delete set null,
  lokalizacja_nazwa text    not null default '',
  -- Is the date settled, or still tentative? 'potwierdzony' | 'wstepny'.
  -- Defaults to confirmed so meetings written before this column keep meaning
  -- what they meant.
  termin_status text not null default 'potwierdzony',
  -- The trail a moved date leaves. A meeting whose date moves is the one thing
  -- here somebody has to be TOLD about — everyone wrote the old date down — so
  -- the move is recorded, and `..._odczytana_*` is the acknowledgement that
  -- puts the meeting back to looking ordinary.
  termin_zmieniony_at timestamptz,
  termin_zmieniony_z  timestamptz,
  termin_zmieniony_by text,
  termin_zmiana_odczytana_at timestamptz,
  termin_zmiana_odczytana_by text,
  -- Paperwork sent by hand, with a note of what went out. The Mailing module's
  -- own sends link themselves through mailing_history.spotkanie_id instead.
  dokumenty_wyslane_at timestamptz,
  dokumenty_wyslane_by text,
  dokumenty_opis text not null default '',
  created_by  text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- For projects created before these columns existed.
alter table public.spotkania
  add column if not exists lokalizacja_id bigint
    references public.spotkania_lokalizacje(id) on delete set null,
  add column if not exists lokalizacja_nazwa text not null default '',
  add column if not exists termin_status text not null default 'potwierdzony',
  add column if not exists termin_zmieniony_at timestamptz,
  add column if not exists termin_zmieniony_z  timestamptz,
  add column if not exists termin_zmieniony_by text,
  add column if not exists termin_zmiana_odczytana_at timestamptz,
  add column if not exists termin_zmiana_odczytana_by text,
  add column if not exists dokumenty_wyslane_at timestamptz,
  add column if not exists dokumenty_wyslane_by text,
  add column if not exists dokumenty_opis text not null default '';

alter table public.spotkania
  drop constraint if exists spotkania_termin_status_check;
alter table public.spotkania
  add constraint spotkania_termin_status_check
  check (termin_status in ('potwierdzony', 'wstepny'));

-- The calendar reads one month at a time; the community filter reads by address.
create index if not exists spotkania_starts_at_idx on public.spotkania (starts_at);
create index if not exists spotkania_lokalizacja_id_idx on public.spotkania (lokalizacja_id);
-- The calendar's warning strip counts exactly these.
create index if not exists spotkania_termin_zmiana_idx
  on public.spotkania (termin_zmieniony_at)
  where termin_zmieniony_at is not null and termin_zmiana_odczytana_at is null;
create index if not exists spotkania_adres_id_idx  on public.spotkania (adres_id);

-- Mailing ↔ meeting. Added here rather than on the table above, because
-- `mailing_history` is created before `spotkania` exists to be referenced. The
-- mailing row stays the authority on what was actually sent; this is only the
-- link back to the meeting the send was triggered from.
alter table public.mailing_history
  add column if not exists spotkanie_id bigint
    references public.spotkania(id) on delete set null;

create index if not exists mailing_history_spotkanie_id_idx
  on public.mailing_history (spotkanie_id);

-- ============================================================
-- Row-Level Security
-- Model: any signed-in user can read/write everything (shared data).
-- Anonymous users have no access.
-- ============================================================

alter table public.app_config  enable row level security;
alter table public.banks       enable row level security;
alter table public.kontrahenci enable row level security;
alter table public.adresy      enable row level security;
alter table public.konto_typy  enable row level security;
alter table public.history     enable row level security;
alter table public.odczyty_history enable row level security;
alter table public.zgn_jednostki    enable row level security;
alter table public.mailing_pola     enable row level security;
alter table public.mailing_szablony enable row level security;
alter table public.mailing_history  enable row level security;
alter table public.app_users        enable row level security;
alter table public.spotkania_typy   enable row level security;
alter table public.spotkania_lokalizacje enable row level security;
alter table public.spotkania        enable row level security;

-- app_config: read-only for signed-in users; no insert/update/delete policy,
-- so the anon/authenticated roles can never modify secrets.
drop policy if exists "authenticated_read" on public.app_config;
create policy "authenticated_read" on public.app_config
  for select to authenticated using (true);

-- app_users: readable by signed-in users, and writable in exactly two columns.
-- `id`, `email` and `created_at` remain the auth trigger's business — a client
-- able to rewrite them could point an account at the wrong mailbox — while
-- `first_name`/`last_name` are the app's own fields. RLS cannot say "these
-- columns only", so the policy opens UPDATE and the column grant narrows it;
-- Supabase grants ALL on public tables to `authenticated` by default, hence the
-- revoke first. Still no insert/delete policy: only the trigger adds or removes
-- accounts.
drop policy if exists "authenticated_read" on public.app_users;
create policy "authenticated_read" on public.app_users
  for select to authenticated using (true);

drop policy if exists "authenticated_update_names" on public.app_users;
create policy "authenticated_update_names" on public.app_users
  for update to authenticated using (true) with check (true);

revoke update on public.app_users from authenticated;
grant update (first_name, last_name) on public.app_users to authenticated;

drop policy if exists "authenticated_all" on public.banks;
drop policy if exists "authenticated_all" on public.kontrahenci;
drop policy if exists "authenticated_all" on public.adresy;
drop policy if exists "authenticated_all" on public.konto_typy;
drop policy if exists "authenticated_all" on public.history;
drop policy if exists "authenticated_all" on public.odczyty_history;
drop policy if exists "authenticated_all" on public.zgn_jednostki;
drop policy if exists "authenticated_all" on public.mailing_pola;
drop policy if exists "authenticated_all" on public.mailing_szablony;
drop policy if exists "authenticated_all" on public.mailing_history;
drop policy if exists "authenticated_all" on public.spotkania_lokalizacje;
create policy "authenticated_all" on public.spotkania_lokalizacje
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on public.spotkania_typy;
drop policy if exists "authenticated_all" on public.spotkania;

create policy "authenticated_all" on public.banks
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.kontrahenci
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.adresy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.konto_typy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.history
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.odczyty_history
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.zgn_jednostki
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_pola
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_szablony
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_history
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.spotkania_typy
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.spotkania
  for all to authenticated using (true) with check (true);
