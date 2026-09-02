-- Księgowania (bookings seen from the communities' side) — v6.4.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
--
-- Adds to `history`:
--   * which community a conversion was run for (id + name), so the accounting
--     files can be grouped per address instead of per day/bank only,
--   * the user's "posted in the DOM program" tick, with who set it and when.
--
-- The id is a convenience link; the NAME is the durable one — a backup restore
-- renumbers `adresy`, so the app resolves a community by name (and, for rows
-- written before this migration, from the generated filename).

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

-- The view always reads one month at a time, per community.
create index if not exists history_converted_at_idx
  on public.history (converted_at desc);
create index if not exists history_adres_id_idx
  on public.history (adres_id);

-- Backfill the community for rows written before it was stored. Generated files
-- are named `{sanitized address}_{YYYYMMDD}_{HHMMSS}.txt`, so the address is
-- recoverable from `output_path` — this is the same reading the app does for
-- unattributed rows, written into the table once. Mirrors the app's sanitize
-- step: drop `<>:"/\|?*`, collapse runs of whitespace/underscores to one `_`,
-- trim `_` at the ends, cut to 50 characters. Only untouched rows are updated.
with named as (
  select
    h.id     as history_id,
    a.id     as adres_id,
    a.nazwa  as adres_nazwa
  from public.history h
  join public.adresy a
    on lower(
         left(
           btrim(
             regexp_replace(
               regexp_replace(a.nazwa, '[<>:"/\\|?*]', '', 'g'),
               '[[:space:]_]+', '_', 'g'
             ),
             '_'
           ),
           50
         )
       ) = lower(
         regexp_replace(
           -- basename, extension dropped, trailing _YYYYMMDD_HHMMSS dropped
           regexp_replace(
             regexp_replace(h.output_path, '^.*[/\\]', ''),
             '\.[^.]+$', ''
           ),
           '_[0-9]{8}_[0-9]{6}$', ''
         )
       )
  where h.adres_id is null
    and h.adres_nazwa is null
    and h.output_path <> ''
)
update public.history h
   set adres_id    = named.adres_id,
       adres_nazwa = named.adres_nazwa
  from named
 where h.id = named.history_id;
