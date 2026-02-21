# Instalacja na macOS

## Problem: "Aplikacja jest uszkodzona i nie można jej otworzyć"

Jeśli podczas uruchamiania aplikacji na macOS widzisz komunikat:
```
"FileFunky.app is damaged and can't be opened. You should move it to the Trash."
```

To **NIE oznacza**, że aplikacja jest uszkodzona. To standardowa blokada macOS dla aplikacji spoza App Store, które nie mają podpisu Apple Developer (wymaga $99/rok).

## Rozwiązanie

### Metoda 1: Terminal (Zalecana) ✅

1. Otwórz **Terminal** (Finder → Aplikacje → Narzędzia → Terminal)

2. Wykonaj następującą komendę:
```bash
sudo xattr -cr /Applications/FileFunky.app
```

3. Wpisz hasło administratora (nie zobaczysz liter podczas pisania - to normalne)

4. Uruchom aplikację ponownie

### Metoda 2: Ustawienia systemowe

1. Otwórz **Preferencje Systemowe** → **Prywatność i Bezpieczeństwo**

2. W zakładce **Ogólne** przewiń w dół

3. Zobaczysz komunikat o zablokowaniu FileFunky - kliknij **"Otwórz mimo to"**

4. Potwierdź w kolejnym oknie

### Metoda 3: Kliknięcie prawym przyciskiem myszy

1. Znajdź aplikację w Finderze (w folderze /Applications lub na DMG)

2. Kliknij prawym przyciskiem myszy (lub Ctrl+klik) na FileFunky.app

3. Wybierz **"Otwórz"** z menu

4. W oknie z ostrzeżeniem kliknij **"Otwórz"**

## Dlaczego to się dzieje?

macOS Gatekeeper blokuje aplikacje, które:
- Nie zostały pobrane z App Store
- Nie mają podpisu od zarejestrowanego Apple Developer
- Nie przeszły procesu notaryzacji Apple

Aplikacja FileFunky jest w 100% bezpieczna, ale nie ma komercyjnego podpisu Apple (kosztuje $99/rok).

## Czy to bezpieczne?

**TAK!** Kod źródłowy aplikacji jest publiczny na GitHub:
https://github.com/wikunia-pura/statement_converter

Każda wersja jest budowana automatycznie przez GitHub Actions - możesz sprawdzić dokładnie co zawiera aplikacja.

## Instalacja krok po kroku

1. Pobierz odpowiedni plik DMG:
   - Mac z Apple Silicon (M1/M2/M3): `FileFunky-X.X.X-arm64.dmg`
   - Mac z Intel: `FileFunky-X.X.X-x64.dmg`

2. Otwórz plik DMG (dwukrotne kliknięcie)

3. Przeciągnij ikonę FileFunky do folderu Applications

4. **PRZED pierwszym uruchomieniem**, wykonaj komendę w terminalu:
```bash
sudo xattr -cr /Applications/FileFunky.app
```

5. Uruchom aplikację z folderu Applications

## Aktualizacje

Przy każdej aktualizacji (gdy pobierzesz nową wersję ręcznie), musisz ponownie wykonać:
```bash
sudo xattr -cr /Applications/FileFunky.app
```

## Potrzebujesz pomocy?

Jeśli nadal masz problemy, utwórz Issue na GitHub:
https://github.com/wikunia-pura/statement_converter/issues

Dołącz:
- Wersję macOS (System Settings → General → About)
- Typ procesora (Apple Silicon lub Intel)
- Komunikat błędu (zrzut ekranu)
