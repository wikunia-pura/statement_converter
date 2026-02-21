# Rozwiązywanie problemów z aktualizacjami

## Problem: Aktualizacja nie działa

Jeśli próbujesz zaktualizować aplikację, ale nic się nie dzieje, wykonaj następujące kroki:

### 1. Sprawdź logi aplikacji

Od wersji 1.0.24+ aplikacja zapisuje szczegółowe logi do pliku, które pomogą zdiagnozować problem:

1. Otwórz aplikację
2. Przejdź do **Ustawień** (Settings)
3. W sekcji "Aktualizacje" kliknij przycisk **"📋 Pokaż logi"**
4. Otworzy się folder z plikiem logów
5. Otwórz plik `main.log` w notatniku

### 2. Co sprawdzić w logach

Szukaj następujących informacji:

#### Sprawdzanie wersji:
```
=== Auto-updater configuration ===
App version: 1.0.23
Is packaged: true
Platform: win32
```

#### Sprawdzanie dostępności aktualizacji:
```
=== Checking for updates ===
Current version: 1.0.23
```

#### Gdy aktualizacja jest dostępna:
```
=== Update available ===
New version: 1.0.24
Release date: 2025-01-15
Download URL: ...
```

#### Postęp pobierania:
```
Download progress: 45% Speed: 1234 KB/s
```

#### Błędy:
```
=== Update error ===
Error message: [szczegóły błędu]
```

### 3. Typowe problemy i rozwiązania

#### Błąd: "Cannot find latest.yml"
**Przyczyna:** Brak pliku konfiguracji w GitHub Releases  
**Rozwiązanie:** Aplikacja musi być zainstalowana z oficjalnego wydania na GitHub

#### Błąd: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
**Przyczyna:** Nieprawidłowa konfiguracja auto-updatera  
**Rozwiązanie:** Upewnij się, że korzystasz z oficjalnej wersji aplikacji z GitHub Releases

#### Błąd: "HttpError: 404"
**Przyczyna:** Release nie istnieje lub nie jest publiczny  
**Rozwiązanie:** Sprawdź https://github.com/wikunia-pura/statement_converter/releases

#### Błąd związany z podpisem (signature/certificate)
**Przyczyna:** Aplikacja nie jest cyfrowo podpisana  
**Rozwiązanie:** To ostrzeżenie jest normalne dla niekomercyjnych aplikacji. Możesz bezpiecznie zainstalować aktualizację ręcznie.

### 4. Ręczna aktualizacja

Jeśli automatyczna aktualizacja nie działa:

1. Przejdź do https://github.com/wikunia-pura/statement_converter/releases
2. Pobierz najnowszą wersję dla swojej platformy:
   - **Windows:** `Statement-Converter-Setup-X.X.X.exe`
   - **macOS (Apple Silicon):** `Statement-Converter-X.X.X-arm64.dmg`
   - **macOS (Intel):** `Statement-Converter-X.X.X.dmg`
3. Zamknij starą wersję aplikacji
4. Uruchom pobrany instalator
5. Instalator automatycznie nadpisze starą wersję

### 5. Windows: Specyficzne problemy

#### Aplikacja instaluje się, ale nie uruchamia automatycznie
To normalne zachowanie. Po instalacji trzeba uruchomić aplikację ręcznie.

#### Windows Defender blokuje instalację
1. Kliknij "Więcej informacji"
2. Kliknij "Uruchom mimo to"
3. To ostrzeżenie pojawia się, bo aplikacja nie ma certyfikatu komercyjnego

### 6. macOS: Specyficzne problemy

#### "Aplikacja jest uszkodzona i nie można jej otworzyć"
```bash
# W terminalu wykonaj:
xattr -cr /Applications/Statement-Converter.app
```

#### Aktualizacja pobrana do folderu Pobrane
Na macOS aktualizacje są pobierane jako plik .dmg do folderu Pobrane. Musisz:
1. Otworzyć plik .dmg
2. Przeciągnąć aplikację do folderu Applications
3. Zastąpić starą wersję

### 7. Dodatkowa pomoc

Jeśli problem nadal występuje:

1. Zapisz zawartość pliku `main.log`
2. Utwórz zgłoszenie (Issue) na GitHub: https://github.com/wikunia-pura/statement_converter/issues
3. Dołącz:
   - Wersję aplikacji (widoczna w Settings)
   - System operacyjny i wersję
   - Odpowiednie fragmenty z pliku logów
   - Opis problemu

## Lokalizacja plików logów

### Windows
```
C:\Users\[TwojaNazwa]\AppData\Roaming\statement-converter\logs\main.log
```

### macOS
```
~/Library/Logs/statement-converter/main.log
```

### Linux
```
~/.config/statement-converter/logs/main.log
```

## Automatyczne sprawdzanie aktualizacji

Aplikacja automatycznie sprawdza dostępność aktualizacji:
- Przy każdym uruchomieniu (po 3 sekundach)
- Raz dziennie gdy aplikacja jest uruchomiona

Możesz też ręcznie sprawdzić aktualizacje w Ustawieniach klikając "Sprawdź aktualizacje".
