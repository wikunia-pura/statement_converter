-- Mailing: a dynamic field bound to a mailing kind — one new column in the fields.
--
-- Paste the whole file into Supabase: SQL Editor → New Query → Run.
-- Safe to re-run — the statement is idempotent.
--
-- An excerpt of supabase/schema.sql; running the whole schema.sql does the same.
--
-- RUN THIS BEFORE THE RELEASE THAT SHIPS IT: the app now asks for `typ` when it
-- reads the dynamic fields, so without the column the Mailing tabs („Wysyłka”,
-- „Szablony”, „Pola dynamiczne”) and every Zebrania editor fail to load them.

-- The mailing kind a field belongs to (`mailing_typy.klucz`), or null for a field
-- every kind may use — which is what every existing field stays. A bound field is
-- offered only in templates of that kind. The key rather than the id, like
-- `mailing_szablony.typ`: a restore renumbers rows and the binding must survive
-- one. Deleting a kind sets its fields back to null (done by the app).
alter table public.mailing_pola
  add column if not exists typ text;
