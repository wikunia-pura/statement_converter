# GitHub Actions - Konfiguracja dla Budowania Aplikacji

## Automatyczne budowanie z AI

Aplikacja używa GitHub Actions do automatycznego budowania wersji produkcyjnych dla macOS i Windows.
Klucz API dla AI jest automatycznie wstrzykiwany podczas budowania z GitHub Secrets.

## Konfiguracja GitHub Secrets

### 1. Dodaj klucz API do GitHub Secrets

1. Przejdź do swojego repozytorium na GitHub
2. Kliknij **Settings** (Ustawienia)
3. W lewym menu wybierz **Secrets and variables** → **Actions**
4. Kliknij **New repository secret**
5. Dodaj sekret:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** Twój klucz API z https://console.anthropic.com
6. Kliknij **Add secret**

### 2. Uruchom budowanie

#### Automatyczne budowanie (z tagiem):
```bash
# Utwórz nowy tag wersji
git tag v2.0.4
git push origin v2.0.4
```

#### Ręczne budowanie:
1. Przejdź do zakładki **Actions**
2. Wybierz workflow **Build and Release**
3. Kliknij **Run workflow**
4. Wybierz branch (np. `main`)
5. Kliknij **Run workflow**

## Jak to działa

1. GitHub Actions pobiera kod z repozytorium
2. Instaluje zależności (`npm ci`)
3. **Tworzy plik `config/ai-config.yml`** z kluczem API z GitHub Secrets
4. Buduje aplikację dla macOS i/lub Windows
5. Pakuje aplikację z Electron Builder
6. Uploaduje artefakty (instalatory)
7. Tworzy release na GitHub (jeśli był tag)

## Bezpieczeństwo

✅ **Bezpieczne:**
- Klucz API jest przechowywany w GitHub Secrets (szyfrowany)
- Klucz NIE jest widoczny w logach GitHub Actions
- Klucz NIE jest commitowany do repozytorium
- Plik `config/ai-config.yml` jest w `.gitignore`

⚠️ **Ważne:**
- NIE commituj nigdy pliku `config/ai-config.yml` z prawdziwym kluczem do repozytorium
- Używaj tylko `config/ai-config.example.yml` jako przykładu (bez klucza)

## Zmiana providera AI

Jeśli chcesz użyć OpenAI zamiast Anthropic:

1. W GitHub Secrets dodaj `OPENAI_API_KEY` zamiast (lub oprócz) `ANTHROPIC_API_KEY`
2. Zmodyfikuj workflow w `.github/workflows/build.yml`:
```yaml
- name: Create AI config file
  run: |
    cat > config/ai-config.yml << 'EOF'
    ai:
      anthropic_api_key: ""
      openai_api_key: "${{ secrets.OPENAI_API_KEY }}"
      default_provider: "openai"
    EOF
  shell: bash
```

## Testowanie lokalnie

Przed pushem do GitHub, możesz przetestować lokalnie:

```bash
# Upewnij się że masz plik z kluczem
cp config/ai-config.example.yml config/ai-config.yml
# Edytuj i dodaj swój klucz
nano config/ai-config.yml

# Zbuduj lokalnie
npm run package:mac  # lub package:win na Windows
```

## Troubleshooting

### Problem: "AI nie działa w wersji produkcyjnej"

Sprawdź:
1. Czy GitHub Secret `ANTHROPIC_API_KEY` jest ustawiony
2. Czy workflow zawiera krok "Create AI config file"
3. Czy w logach GitHub Actions nie ma błędów w tym kroku

### Problem: "Build fails on Windows"

To normalne - workflow ma `continue-on-error: true` dla Windows.
Sprawdź logi, ale często Windows buildy wymagają dodatkowej konfiguracji certyfikatów.

## Dodatkowe zmienne środowiskowe

Możesz dodać więcej secrets jeśli potrzebujesz:

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  OTHER_CONFIG: ${{ secrets.OTHER_CONFIG }}
```

Aplikacja automatycznie sprawdzi `process.env.ANTHROPIC_API_KEY` jeśli plik config nie istnieje.
