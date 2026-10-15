# Auto-Update Setup

Aplikacja używa `electron-updater` do automatycznych aktualizacji przez GitHub Releases.

## Jak to działa?

1. **Tworzenie Release:**
   - Stwórz tag wersji: `git tag v1.0.1`
   - Wypchnij tag: `git push origin v1.0.1`
   - GitHub Actions automatycznie zbuduje aplikację i utworzy Release

2. **Sprawdzanie aktualizacji:**
   - Aplikacja sprawdza GitHub Releases API przy starcie
   - Jeśli jest nowsza wersja, użytkownik dostaje powiadomienie
   - Użytkownik może pobrać i zainstalować update jednym kliknięciem

3. **Instalacja:**
   - macOS: Update instaluje się po restarcie aplikacji
   - Windows: NSIS installer automatycznie aktualizuje aplikację

## Proces wydawania nowej wersji:

```bash
# 1. Zaktualizuj wersję w package.json i dodaj wpis w src/shared/release-notes.ts
npm version patch --no-git-tag-version  # lub minor/major

# 2. Sprawdź lokalnie
npm run type-check && npm test && npm run lint

# 3. Commit, potem tag i push — tag v* uruchamia build
git tag vX.Y.Z
git push && git push origin vX.Y.Z

# 4. GitHub Actions zbuduje i opublikuje release automatycznie
```

Migracje `supabase/*.sql`, których wymaga wydanie, uruchom w Supabase przed tagiem.

## Ręczne publikowanie

Nie ma skryptów `publish:*`. `npm run package:mac` / `package:win` budują lokalnie z `--publish never`
(do sprawdzenia paczki), a jedyną drogą wydania jest tag `v*` → GitHub Actions → GitHub Release
(zob. [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)).

## Testowanie w developmencie:

Auto-update jest wyłączony w trybie dev (`npm run dev`). 
Przycisk "Sprawdź aktualizacje" w Settings pokaże komunikat o tym.

## Wymagania:

- Tag musi zaczynać się od `v` (np. v1.0.1)
- `package.json` musi mieć poprawną wersję
- Repository musi być publiczne LUB mieć skonfigurowany GH_TOKEN dla prywatnych repo

## Konfiguracja:

W `package.json`:
```json
"publish": {
  "provider": "github",
  "owner": "wikunia-pura",
  "repo": "statement_converter"
}
```

## Bezpieczeństwo:

- Releases są hostowane na GitHub (darmowe)
- Binarki są automatycznie generowane przez CI/CD
- Można dodać code signing dla macOS i Windows (wymaga certyfikatów)
