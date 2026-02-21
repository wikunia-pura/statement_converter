# Instalacja na macOS

## Szybka instalacja (3 kroki)

1. **Pobierz** odpowiedni plik ZIP:
   - Mac z Apple Silicon (M1/M2/M3): `FileFunky-X.X.X-arm64.zip`
   - Mac z Intel: `FileFunky-X.X.X-x64.zip`

2. **Rozpakuj** plik ZIP (dwukrotne kliknięcie)

3. **Przeciągnij** aplikację FileFunky do folderu **Applications**

4. **Uruchom** aplikację z folderu Applications

Gotowe! ✅

---

## Problem: "Aplikacja nie może zostać otwarta"

Jeśli podczas PIERWSZEGO uruchomienia widzisz komunikat o nieznanych źródłach:

### Rozwiązanie 1: Kliknięcie prawym przyciskiem (NAJŁATWIEJSZE)

1. W Finderze znajdź aplikację FileFunky w folderze Applications
2. Kliknij **PRAWYM przyciskiem myszy** (lub Ctrl+klik) na FileFunky.app
3. Wybierz **"Otwórz"** z menu
4. W oknie z ostrzeżeniem kliknij **"Otwórz"**
5. Przy kolejnych uruchomieniach będzie się uruchamiać normalnie

### Rozwiązanie 2: Ustawienia systemowe

1. Próba uruchomienia aplikacji (zwykłe kliknięcie)
2. Otwórz **Preferencje Systemowe** → **Prywatność i Bezpieczeństwo**
3. W zakładce **Ogólne** zobaczysz komunikat o zablokowaniu FileFunky
4. Kliknij **"Otwórz mimo to"**

### Rozwiązanie 3: Terminal (dla zaawansowanych)

```bash
xattr -cr /Applications/FileFunky.app
```

---

## Dlaczego to się dzieje?

macOS Gatekeeper blokuje aplikacje, które:
- Nie zostały pobrane z App Store
- Nie mają podpisu od zarejestrowanego Apple Developer

Aplikacja FileFunky jest w 100% bezpieczna, ale nie ma komercyjnego podpisu Apple (koszt $99/rok).

Po **pierwszym** uruchomieniu przez "Otwórz" z menu prawego przycisku, aplikacja będzie działać normalnie przy każdym kolejnym uruchomieniu.

---

## Szczegółowa instrukcja krok po kroku

1. Pobierz odpowiedni plik ZIP z [GitHub Releases](https://github.com/wikunia-pura/statement_converter/releases):
   - Mac z Apple Silicon (M1/M2/M3): `FileFunky-X.X.X-arm64.zip`
   - Mac z Intel: `FileFunky-X.X.X-x64.zip`

2. **Safari** automatycznie rozpakuje ZIP. Jeśli nie:
   - Dwukrotnie kliknij plik `.zip`
   - Zostanie utworzony folder z aplikacją

3. Otwórz Finder i znajdź folder **Applications**:
   - Cmd+Shift+A lub
   - Menu → Idź → Aplikacje

4. **Przeciągnij** FileFunky.app do folderu Applications

5. W folderze Applications:
   - **PRAWY przycisk myszy** na FileFunky.app
   - Wybierz **"Otwórz"**
   - Potwierdź **"Otwórz"** w oknie ostrzeżenia

6. Gotowe! Przy następnych uruchomieniach wystarczy zwykłe kliknięcie.

---

## Potrzebujesz pomocy?

Jeśli nadal masz problemy, utwórz Issue na GitHub:
https://github.com/wikunia-pura/statement_converter/issues

Dołącz:
- Wersję macOS (System Settings → General → About)
- Typ procesora (Apple Silicon lub Intel)
- Komunikat błędu (zrzut ekranu)
