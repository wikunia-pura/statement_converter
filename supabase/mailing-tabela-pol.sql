-- Mailing: tabela pól dynamicznych (v6.1.0) — jedna nowa kolumna w szablonach.
--
-- Wklej całość do Supabase: SQL Editor → New Query → Run.
-- Bezpieczne do wielokrotnego uruchomienia — instrukcja jest idempotentna,
-- więc puszczenie tego dwa razy nic nie zepsuje i nic nie zduplikuje.
--
-- To wycinek z supabase/schema.sql, obejmujący wyłącznie to, co doszło w 6.1.0.
-- Uruchomienie całego schema.sql daje ten sam efekt.
--
-- URUCHOM TO PRZED WYDANIEM 6.1.0: bez tej kolumny moduł Mailing nie wczyta
-- szablonów (aplikacja pyta bazę o `table_fields`), więc zakładki „Wysyłka”
-- i „Szablony” zgłoszą błąd pobierania danych.

-- Pola dynamiczne udostępnione przez szablon dla wstawki {{Tabela pól}},
-- w kolejności wierszy: ["Zaliczka remontowy", "Zaliczka eksploatacja"].
-- To krótka lista do wyboru, a nie sam wybór — przy wysyłce użytkownik
-- odhacza, które z tych pól faktycznie wchodzą do tabeli, i wpisuje wartości.
alter table public.mailing_szablony
  add column if not exists table_fields jsonb not null default '[]'::jsonb;
