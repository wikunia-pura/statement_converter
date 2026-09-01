-- Mailing module (v5.8.0) — tabele dla powiadomień o zmianach stawek.
--
-- Wklej całość do Supabase: SQL Editor → New Query → Run.
-- Bezpieczne do wielokrotnego uruchomienia — każda instrukcja jest idempotentna,
-- więc puszczenie tego dwa razy nic nie zepsuje i nic nie zduplikuje.
--
-- To wycinek z supabase/schema.sql, obejmujący wyłącznie to, co doszło w 5.8.0.
-- Uruchomienie całego schema.sql daje ten sam efekt.

-- ============================================================
-- 1. Jednostki ZGN + powiązanie z adresami
-- ============================================================

-- Jednostki miasta, które trzeba poinformować o zmianie stawek we wspólnocie.
-- Jedna jednostka obsługuje zwykle wiele wspólnot, dlatego jest osobnym
-- słownikiem, a każdy adres wskazuje najwyżej jedną.
create table if not exists public.zgn_jednostki (
  id          bigserial primary key,
  nazwa       text        not null,
  email       text        not null,
  created_at  timestamptz not null default now()
);

-- Adresat maili o zmianie stawek dla danej wspólnoty. ON DELETE SET NULL:
-- usunięcie jednostki nie usuwa adresów, tylko odbiera im adresata.
alter table public.adresy
  add column if not exists zgn_jednostka_id bigint
    references public.zgn_jednostki(id) on delete set null;

-- ============================================================
-- 2. Tabele modułu Mailing
-- ============================================================

-- Pola dynamiczne definiowane przez użytkownika. Pole nosi stałe zdanie
-- (`tekst`), a wartość, która je dopełnia, wpisywana jest raz na wysyłkę —
-- dzięki temu to samo pole raz brzmi „…w kwocie: 350,00 zł", a raz „…410,00 zł".
-- Pola wbudowane („Adres Wspólnoty", „Data") są w kodzie, nie w tej tabeli.
create table if not exists public.mailing_pola (
  id          bigserial primary key,
  nazwa       text        not null,
  tekst       text        not null default '',
  -- Jednostka dopisywana po wpisanej wartości ("zł/m²", "%"). Należy do pola,
  -- a nie do wartości — wpisane przy wysyłce "20" wychodzi jako "20 zł/m²".
  jednostka     text      not null default '',
  -- Czym uzupełnia się pole przy wysyłce: 'tekst' (dowolny wpis), 'data'
  -- (kalendarz, w liście dd.mm.rrrr) albo 'godzina' (zegar, w liście gg:mm).
  typ_wartosci  text      not null default 'tekst'
                          check (typ_wartosci in ('tekst', 'data', 'godzina')),
  created_at  timestamptz not null default now()
);

-- Migracje dla baz założonych przed jednostkami i typami pól (idempotentne).
alter table public.mailing_pola
  add column if not exists jednostka text not null default '';
alter table public.mailing_pola
  add column if not exists typ_wartosci text not null default 'tekst';
alter table public.mailing_pola
  drop constraint if exists mailing_pola_typ_wartosci_check;
alter table public.mailing_pola
  add constraint mailing_pola_typ_wartosci_check
  check (typ_wartosci in ('tekst', 'data', 'godzina'));

-- Szablony wiadomości. Tytuł i treść pisane są ze wstawkami {{pole}},
-- podstawianymi przy wysyłce; `attach_pdf` to domyślna wartość przełącznika
-- „dołącz treść jako PDF" (ekran wysyłki może ją nadpisać).
create table if not exists public.mailing_szablony (
  id          bigserial primary key,
  nazwa       text        not null,
  typ         text        not null default 'zgn-zaliczki',
  temat       text        not null default '',
  tresc       text        not null default '',
  attach_pdf  boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Jeden wiersz na parę (wysyłka, wspólnota): tytuł i treść dokładnie w tej
-- formie, w jakiej poszły, ustalony adresat, użyte wartości pól i załączniki.
-- `attachments` trzyma nazwy plików i ścieżki — same pliki leżą w lokalnym
-- folderze wyjściowym i można je wyczyścić z zakładki „Historia" w module.
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
-- 3. Row-Level Security
-- Model jak w pozostałych tabelach: każdy zalogowany użytkownik czyta i pisze
-- wszystko (dane są wspólne). Anonimowi nie mają dostępu.
-- ============================================================

alter table public.zgn_jednostki    enable row level security;
alter table public.mailing_pola     enable row level security;
alter table public.mailing_szablony enable row level security;
alter table public.mailing_history  enable row level security;

drop policy if exists "authenticated_all" on public.zgn_jednostki;
drop policy if exists "authenticated_all" on public.mailing_pola;
drop policy if exists "authenticated_all" on public.mailing_szablony;
drop policy if exists "authenticated_all" on public.mailing_history;

create policy "authenticated_all" on public.zgn_jednostki
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_pola
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_szablony
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on public.mailing_history
  for all to authenticated using (true) with check (true);
