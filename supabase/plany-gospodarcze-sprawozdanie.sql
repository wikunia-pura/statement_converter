-- Plany gospodarcze: a plan's own part of its statement — v9.6.0
-- Run once in Supabase: SQL Editor → New Query → paste → Run. Idempotent.
-- Run BEFORE the release that writes it. Without it the module still loads,
-- but merging items, subcategories and the introduction of a plan made in
-- Plany gospodarcze cannot be saved, and restoring a backup fails (it writes
-- the column).

-- ============================================================
-- 1. The statement tab of a plan made outside any meeting
-- ============================================================
-- A plan of the module is drafted from a library statement (the community's,
-- of the plan's period — `plan.sprawozdanieOkres`). Like a meeting version, it
-- keeps its own regrouping of that statement: merges, subcategories, the
-- edited introduction and the statement's downloads. The figures stay the
-- library's.

alter table public.plany_gospodarcze
  add column if not exists sprawozdanie jsonb not null default '{}'::jsonb;
