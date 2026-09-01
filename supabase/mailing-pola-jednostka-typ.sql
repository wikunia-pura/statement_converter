-- Mailing: jednostka i typ wartości pola dynamicznego (v6.3.0)
-- — dwie nowe kolumny w polach dynamicznych.
--
-- Wklej całość do Supabase: SQL Editor → New Query → Run.
-- Bezpieczne do wielokrotnego uruchomienia — każda instrukcja jest idempotentna,
-- więc puszczenie tego dwa razy nic nie zepsuje i nic nie zduplikuje.
--
-- To wycinek z supabase/schema.sql, obejmujący wyłącznie to, co doszło w 6.3.0.
-- Uruchomienie całego schema.sql daje ten sam efekt.
--
-- URUCHOM TO PRZED WYDANIEM 6.3.0: bez tych kolumn moduł Mailing nie wczyta
-- pól dynamicznych (aplikacja pyta bazę o `jednostka` i `typ_wartosci`), więc
-- zakładki „Wysyłka”, „Szablony” i „Pola dynamiczne” zgłoszą błąd pobierania.

-- Dopisek po wpisanej wartości: "zł/m²", "%", "zł". Należy do pola, a nie do
-- wartości — dzięki temu przy wysyłce wpisuje się samo "20", a w liście
-- pojawia się "20 zł/m²". Puste = wartość zostaje sama, czyli tak jak dotąd.
alter table public.mailing_pola
  add column if not exists jednostka text not null default '';

-- Czym uzupełnia się pole przy wysyłce: 'tekst' (jak dotąd — dowolny wpis),
-- 'data' (wybór z kalendarza, w liście dd.mm.rrrr) albo 'godzina' (wybór
-- godziny, w liście gg:mm). Wszystkie istniejące pola zostają tekstowe.
alter table public.mailing_pola
  add column if not exists typ_wartosci text not null default 'tekst';

-- Osobno od dodania kolumny, żeby ograniczenie dołożyło się także w bazach,
-- w których kolumna powstała wcześniej (wtedy `add column if not exists` nic
-- nie robi, razem z zapisanym w nim ograniczeniem).
alter table public.mailing_pola
  drop constraint if exists mailing_pola_typ_wartosci_check;
alter table public.mailing_pola
  add constraint mailing_pola_typ_wartosci_check
  check (typ_wartosci in ('tekst', 'data', 'godzina'));
