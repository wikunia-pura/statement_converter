-- ZGN proxies (pełnomocnicy) and the city unit / proxy assigned to a meeting.
--
-- Run this in Supabase (SQL Editor → New Query → paste → Run) BEFORE tagging the
-- release. The app now reads these with every meeting and with the address
-- book, so without them Kalendarz and Adresy fail to load for everyone.
-- Requires `mailing-module.sql` (zgn_jednostki) and `kalendarz.sql` first.
--
-- Safe to re-run.

-- A proxy belongs to one city unit; a unit can have several. Deleting the unit
-- deletes its proxies — they act for that unit and for nothing else.
create table if not exists public.zgn_pelnomocnicy (
  id             bigserial primary key,
  jednostka_id   bigint      not null references public.zgn_jednostki(id) on delete cascade,
  imie_nazwisko  text        not null,
  email          text        not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists zgn_pelnomocnicy_jednostka_id_idx
  on public.zgn_pelnomocnicy (jednostka_id);

alter table public.zgn_pelnomocnicy enable row level security;
drop policy if exists "authenticated_all" on public.zgn_pelnomocnicy;
create policy "authenticated_all" on public.zgn_pelnomocnicy
  for all to authenticated using (true) with check (true);

-- The meeting side: a unit, or a proxy (then the unit is the proxy's own). Both
-- links are ON DELETE SET NULL, and `zgn_nazwa` keeps what the meeting showed, so
-- a deleted unit or proxy still leaves the meeting saying who it was with.
alter table public.spotkania
  add column if not exists zgn_jednostka_id bigint
    references public.zgn_jednostki(id) on delete set null,
  add column if not exists zgn_pelnomocnik_id bigint
    references public.zgn_pelnomocnicy(id) on delete set null,
  add column if not exists zgn_nazwa text not null default '';
