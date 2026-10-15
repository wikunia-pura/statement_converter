# Architektura

FileFunky to aplikacja desktopowa (Electron 44, React 18, TypeScript) dla biura obsługującego wspólnoty
mieszkaniowe: wyciągi bankowe → pliki księgowe, podatki wspólnot, zebrania, mailing, kalendarz i zadania zespołu.

## Procesy

```
┌──────────────── renderer (React, src/renderer) ───────────────┐
│ widoki, komponenty, translations.ts (pl + en)                 │
│ window.electronAPI  ── jedyna droga do reszty aplikacji        │
└───────────────┬───────────────────────────────────────────────┘
                │ IPC (ipcRenderer.invoke ↔ ipcMain.handle)
┌───────────────▼──────── preload (src/main/preload.ts) ────────┐
│ contextBridge.exposeInMainWorld('electronAPI', { … })         │
└───────────────┬───────────────────────────────────────────────┘
┌───────────────▼──────── main (Node, src/main) ────────────────┐
│ main.ts: okno, tray, IPC, aktualizacje, kopie zapasowe        │
│ database.ts ──► Supabase (dane wspólne)                       │
│             └─► electron-store (ustawienia tego komputera)    │
│ converterRegistry.ts ──► src/converters/<bank>                │
│ moduły: podatki/, podpis/, zebrania/, mailing/, kalendarz/ …  │
│ AI (Anthropic) wyłącznie stąd                                 │
└───────────────────────────────────────────────────────────────┘
```

- **src/main** — proces główny. `main.ts` rejestruje handlery IPC (kanały w `IPC_CHANNELS`, `src/shared/types.ts`),
  tworzy okno i tray (aplikacja może działać w tle dla powiadomień), uruchamia auto-update i automatyczne kopie.
- **src/main/preload.ts** — wystawia rendererowi `window.electronAPI`; typy po stronie renderera:
  `src/renderer/electronAPI.d.ts`.
- **src/renderer** — UI. Widoki w `views/`, wspólne komponenty w `components/` (modale: `Modal.tsx` +
  `FormSection.tsx`, podpowiedzi: `Tip.tsx`, powiadomienia: `Notifications.tsx`). Każdy tekst UI w
  `translations.ts` w obu językach.
- **src/shared** — czysta logika używana przez oba procesy (typy, dopasowanie adresów i kontrahentów, konta
  lokali, obliczenia podatkowe, kalendarz, sprawozdania). Bez Electrona i bez DOM — to tu są testy jednostkowe.
- **src/converters** — konwertery wyciągów, po jednym katalogu na format.

## Dane

- **Supabase (Postgres + RLS)** — wspólna baza zespołu: banki, adresy, kontrahenci, historia konwersji,
  stan Pulpitu (`ksiegowania_konwersje`), zadania, kalendarz, zebrania, sprawozdania i plany, mailing, podatki.
  Klient (`supabaseClient.ts`) działa tylko w procesie głównym, z kluczem publishable; dostęp mają wyłącznie
  zalogowani użytkownicy (polityki RLS). Sesja jest zapisywana w electron-store (na Windows szyfrowana DPAPI).
  Klucz Anthropic leży w tabeli `app_config`, nie w binarkach.
- **Migracje** — `supabase/*.sql`, idempotentne, uruchamiane ręcznie w SQL Editorze przed wydaniem, które
  ich potrzebuje. Kod do tego czasu działa w trybie zgodności (brakująca kolumna nie wywraca widoku).
- **electron-store** — ustawienia tego komputera (motyw, język, foldery, konfiguracja SMTP itp.). Do kopii
  trafiają tylko `PORTABLE_SETTINGS`.
- **Kopie zapasowe** — `backupService.ts`: pełny eksport danych z Supabase do JSON w `userData/backups`
  co kilka godzin i przy zamknięciu, z retencją; ręczny eksport/przywracanie w Ustawieniach. Każda nowa
  tabela lub ustawienie trwałe musi trafić do eksportu, przywracania i liczników (lista kontrolna przy
  `BackupData` w `src/shared/types.ts`).

## Konwertery wyciągów

`converterRegistry.ts` mapuje identyfikator konwertera banku (`config/converters.yml`) na implementację:

| Katalog | Format |
|---|---|
| `pko-mt940`, `ing`, `alior`, `pocztowy` | MT940 (wspólny odczyt `:61:`/`:86:` w `converters/shared/mt940.ts`) |
| `santander-xml` | XML Santandera (własny format) |
| `bnp-xml`, `bos-xml` | XML CAMT.053 / CAMT.052 (wspólny odczyt w `converters/shared/camt.ts`) |
| `pko-biznes` | ELIXIR w ZIP |
| `pko-sa` | EXP |

Każdy konwerter dziedziczy po `BaseConverter` (`src/shared/base-converter.ts`): parsowanie → podział na
wpływy i wydatki → regex/cache → AI (opcjonalnie) → podgląd do akceptacji → pliki księgowe. Zasady, których
nie wolno złamać:

- konto lokalu tylko z `apartment-account.ts`; lokal z literą, sklejony lub ucięty numer są wstrzymywane do
  przeglądu (strażniki), nigdy „naprawiane” heurystyką;
- `typ` kontrahenta wyznacza kierunek: `Pozostałe przychody` tylko wpływy, `Pozostałe koszty` i
  `Kontrahent` tylko wydatki;
- prowizje bankowe to zwykłe wydatki (bez filtrów);
- wyniki AI są przypisywane po `index`, brak lub dubel odpowiedzi = wiersz do przeglądu.

## Moduły

- **Księgowania / Pulpit** — konwersje miesiąca per wspólnota, oznaczenia „zaksięgowane”, priorytety, uwagi
  i wzmianki @ (stan w `ksiegowania_konwersje`, nigdy w `history`, którą Historia czyści).
- **Konwerter, Historia, Homebanking, Scalanie wpłat** — wyciągi i pliki przelewów; Homebanking kieruje
  linie do banku po rachunku nadawcy.
- **Adresy, Kontrahenci, Banki** — słowniki dopasowania (z regułami lokali i zarządem wspólnoty).
- **Mailing** — szablony (HTML sanityzowany), typy, pola, wysyłka SMTP (nodemailer) z historią.
- **Kalendarz, Zadania, Zebrania** — spotkania z terminem materiałów, zadania z komentarzami i plikami,
  zebrania z wersjami dokumentów, uchwałami i pakietem PDF.
- **Sprawozdania, Plany gospodarcze** — import sprawozdań z PDF vDom (`zebrania/sprawozdanieParser.ts`),
  plan liczony ze sprawozdania. Kwoty INTER-EJ nigdy nie trafiają do tekstów ani AI (`shared/inter-ej.ts`).
- **Podatki** — DN-1 (podatek od nieruchomości, PDF na wzorze), CIT-8 z CIT-8/O i PIT (PIT-11/PIT-4R):
  XML, PDF, wysyłka przez bramkę e-Deklaracji (`podatki/eDeklaracjeBramka.ts`) z UPO.
- **Podpis kwalifikowany** — karta Szafir przez PKCS#11 (`podpis/karta.ts`, moduł natywny `pkcs11js`),
  podpisy XAdES/PAdES/CAdES; klucz prywatny nie opuszcza karty.
- **Odczyty liczników, Noty świadczeń, Zaliczki** — import plików dostawców i PDF (zaliczki przez AI z
  kontrolą sum strony).

## Bezpieczeństwo

- Okno: `contextIsolation: true`, `nodeIntegration: false`, sandbox renderera (domyślny w Electronie);
  nawigacja i nowe okna zablokowane (`lockNavigation`), uprawnienia przeglądarki odrzucane poza zapisem do
  schowka. Podgląd PDF w osobnym oknie z `sandbox: true`.
- CSP wstrzykiwane przy buildzie (`vite.config.ts`): skrypty tylko z paczki, bez `eval` i inline, bez ramek;
  renderer nie łączy się z siecią — Supabase i AI działają w procesie głównym.
- HTML z bazy (szablony, uchwały, treści maili) przechodzi przez DOMPurify z listą dozwolonych tagów
  (`src/renderer/sanitize.ts`).
- Ścieżki z renderera (a więc z bazy) są sprawdzane w `src/main/pathGuards.ts` przed `shell.openPath` /
  `showItemInFolder`: tylko ścieżki absolutne, bez `..`, bez obcych hostów UNC, bez plików wykonywalnych
  (także po rozwiązaniu dowiązań), bez strumieni NTFS.
- Repo jest publiczne: żadnych kluczy w kodzie i binarkach, `test-data/` tylko lokalnie (gitignore).

## Narzędzia

- `npm run dev` — tsc w trybie watch dla main + Vite (renderer) + Electron.
- `npm run type-check` — oba tsconfigi (`tsconfig.main.json`, `tsconfig.renderer.json`); Vite nie sprawdza typów.
- `npm test` — Vitest (`vitest.config.ts`): pliki `*.test.ts` obok kodu w `src/` i `scripts/`, środowisko
  Node, strefa `Europe/Warsaw`, tylko dane syntetyczne.
- `npm run lint` — ESLint (`eslint.config.mjs`); natywny `title` i `cursor: help` to błąd.
- `scripts/*-eval.ts`, `scripts/*-check.ts` — dłuższe harnessy (`npm run eval:lokal-cases` bez plików wyciągów).

## Build i wydanie

- `npm run build` — `tsc -p tsconfig.main.json` → `dist/main`, `vite build` → `dist/renderer`.
- `npm run package:mac` / `package:win` — electron-builder do `release/` (bez publikacji).
- Wydanie: podbicie wersji + wpis w `src/shared/release-notes.ts` („Co nowego”), migracje SQL uruchomione w
  Supabase, potem tag `v*` → GitHub Actions (`.github/workflows/build.yml`) buduje macOS i Windows i tworzy
  GitHub Release, z którego aplikacje pobierają aktualizację (`electron-updater`, zob. docs/AUTO_UPDATE.md).
- Zależności: lockfile sprawdzany przez `npx npm@11 ci --dry-run`; nie generować go `npm install --package-lock-only`.
