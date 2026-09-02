-- Kalendarz, druga tura: lokalizacje, status terminu, ślad po zmianie terminu,
-- dokumenty wysłane na spotkanie i powiązanie spotkania z mailingiem.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging
-- the release. One shared project: without it the Kalendarz asks for tables and
-- columns that do not exist yet, and its reads fail for everyone.
--
-- Safe to re-run.

-- ============================================================
-- Locations — a dictionary the user owns, exactly like the meeting types
-- ============================================================
--
-- Where a meeting happens is a property of this office's world (a community's
-- own building, the ZGN office, the accountant's room), not something to retype
-- on every meeting. Same shape as `spotkania_typy`: a name, an optional
-- address, an optional note.
create table if not exists public.spotkania_lokalizacje (
  id         bigserial   primary key,
  nazwa      text        not null,
  -- Street address or "how to get there". Shown under the name in the picker
  -- and in the meeting's own card.
  adres      text        not null default '',
  opis       text        not null default '',
  created_at timestamptz not null default now()
);

alter table public.spotkania
  -- ON DELETE SET NULL like every other link here: removing a location must not
  -- take the meetings with it.
  add column if not exists lokalizacja_id bigint
    references public.spotkania_lokalizacje(id) on delete set null,
  -- The location's NAME, kept beside the id for the same reason `adres_nazwa`
  -- is: a backup restore renumbers the dictionary, and the name is what the
  -- link is re-pointed through afterwards — and what the card displays.
  add column if not exists lokalizacja_nazwa text not null default '';

create index if not exists spotkania_lokalizacja_id_idx
  on public.spotkania (lokalizacja_id);

-- ============================================================
-- Is the date settled, or still tentative?
-- ============================================================
--
-- Defaults to 'potwierdzony' so every meeting written before this column
-- existed keeps meaning what it meant. A new meeting picks its own answer in
-- the form.
alter table public.spotkania
  add column if not exists termin_status text not null default 'potwierdzony';

alter table public.spotkania
  drop constraint if exists spotkania_termin_status_check;
alter table public.spotkania
  add constraint spotkania_termin_status_check
  check (termin_status in ('potwierdzony', 'wstepny'));

-- ============================================================
-- The trail a moved date leaves
-- ============================================================
--
-- A meeting whose date moves is the one thing in this module that somebody has
-- to be TOLD about — everyone has already written the old date down. So the
-- move is recorded rather than silently applied: when it happened, what the
-- start was before, and who moved it. `..._odczytana_*` is the acknowledgement:
-- once a person says they have seen it, the meeting goes back to looking
-- ordinary, and the record stays for anyone reading its details later.
alter table public.spotkania
  add column if not exists termin_zmieniony_at timestamptz,
  add column if not exists termin_zmieniony_z  timestamptz,
  add column if not exists termin_zmieniony_by text,
  add column if not exists termin_zmiana_odczytana_at timestamptz,
  add column if not exists termin_zmiana_odczytana_by text;

-- The calendar's warning strip counts exactly these, so let Postgres find them.
create index if not exists spotkania_termin_zmiana_idx
  on public.spotkania (termin_zmieniony_at)
  where termin_zmieniony_at is not null and termin_zmiana_odczytana_at is null;

-- ============================================================
-- Documents sent for the meeting
-- ============================================================
--
-- Two paths to the same question ("did the paperwork go out?"), because both
-- happen in real life: somebody sends it by hand from their own mailbox and
-- ticks it here with a note of what went, or it goes through the Mailing module
-- and the send records itself against the meeting (see `spotkanie_id` below).
alter table public.spotkania
  add column if not exists dokumenty_wyslane_at timestamptz,
  add column if not exists dokumenty_wyslane_by text,
  add column if not exists dokumenty_opis text not null default '';

-- ============================================================
-- Mailing ↔ meeting
-- ============================================================
--
-- The mailing rows stay the authority on what was actually sent — recipient,
-- subject, field values, attachments. This is only the link back to the meeting
-- the send was triggered from, so the meeting can show it.
alter table public.mailing_history
  add column if not exists spotkanie_id bigint
    references public.spotkania(id) on delete set null;

create index if not exists mailing_history_spotkanie_id_idx
  on public.mailing_history (spotkanie_id);

-- ============================================================
-- Row-Level Security — same model as every other table here
-- ============================================================
alter table public.spotkania_lokalizacje enable row level security;

drop policy if exists "authenticated_all" on public.spotkania_lokalizacje;
create policy "authenticated_all" on public.spotkania_lokalizacje
  for all to authenticated using (true) with check (true);
