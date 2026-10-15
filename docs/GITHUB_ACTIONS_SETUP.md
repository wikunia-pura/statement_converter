# GitHub Actions — budowanie i wydanie

Workflow **Build and Release** (`.github/workflows/build.yml`) buduje aplikację na macOS i Windows i
publikuje GitHub Release, z którego zainstalowane aplikacje pobierają aktualizację. Dokładne kroki są w
samym pliku workflow — ten opis mówi tylko, jak go używać.

## Uruchomienie

- **Wydanie:** tag zaczynający się od `v`:
  ```bash
  git tag vX.Y.Z
  git push origin vX.Y.Z
  ```
- **Ręcznie (bez release):** zakładka **Actions** → **Build and Release** → **Run workflow**. Instalatory
  trafiają wtedy tylko do artefaktów przebiegu.

Przed tagiem: wpis w `src/shared/release-notes.ts`, uruchomione migracje `supabase/*.sql`, przechodzące
`npm run type-check`, `npm test` i `npm run lint` (zob. README → Releasing).

## Sekrety

Workflow nie potrzebuje żadnych sekretów poza wbudowanym `GITHUB_TOKEN` (tworzenie release).

**Żaden klucz AI nie trafia do builda.** Wydania są publiczne, więc klucz w paczce mógłby wyciągnąć każdy.
Aplikacja pobiera klucz Anthropic po zalogowaniu z tabeli `app_config` w Supabase (dostępnej tylko dla
zalogowanych). Lokalny `config/ai-config.yml` służy wyłącznie do developmentu, jest w `.gitignore` i jest
wykluczony z paczki (`build.files` w `package.json`).

## Problemy

- **AI nie działa w wersji produkcyjnej** — sprawdź wiersz `anthropic_api_key` w `app_config` i czy
  użytkownik jest zalogowany (log aplikacji: `[AI Config]`).
- **Build Windows** — `pkcs11js` kompiluje się przy instalacji; workflow używa obrazu `windows-2022` z
  powodów opisanych w komentarzu w pliku workflow.
