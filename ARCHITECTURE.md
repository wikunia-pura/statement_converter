# Architecture Documentation

## Overview

Statement Converter to aplikacja desktopowa zbudowana w architekturze Electron (main process + renderer process) z wykorzystaniem React jako framework UI.

## Diagram Architektury

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐         ┌──────────────────┐     │
│  │  Renderer Process│         │   Main Process   │     │
│  │    (React UI)    │ ◄─IPC─► │   (Node.js)      │     │
│  └──────────────────┘         └──────────────────┘     │
│         │                             │                 │
│         │                             │                 │
│    ┌────▼────┐                  ┌────▼────┐           │
│    │  Views  │                  │ Services│           │
│    ├─────────┤                  ├─────────┤           │
│    │Converter│                  │Database │           │
│    │Settings │                  │Registry │           │
│    │History  │                  │FS Utils │           │
│    └─────────┘                  └─────────┘           │
│                                       │                 │
│                                  ┌────▼────┐           │
│                                  │electron-│           │
│                                  │  store  │           │
│                                  └─────────┘           │
└─────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────▼─────┐      ┌────▼────┐       ┌────▼────┐
              │  Config   │      │   DB    │       │  Output │
              │   YAML    │      │  JSON   │       │   TXT   │
              └───────────┘      └─────────┘       └─────────┘
```

## Core Components

### 1. Main Process (`src/main/`)

#### main.ts
**Odpowiedzialność:** Zarządzanie oknem aplikacji i lifecycle
- Tworzenie BrowserWindow
- Obsługa trybu development/production
- Setup IPC handlers
- Zarządzanie zamykaniem aplikacji

**Kluczowe funkcje:**
- `createWindow()` - Tworzy główne okno
- `setupIpcHandlers()` - Rejestruje handlery IPC

#### database.ts
**Odpowiedzialność:** Zarządzanie danymi aplikacji
- Przechowywanie banków
- Historia konwersji
- Ustawienia użytkownika

**Technologia:** electron-store (JSON storage)

**API:**
```typescript
// Banks
getAllBanks(): Bank[]
addBank(name, converterId): Bank
updateBank(id, name, converterId): void
deleteBank(id): void

// History
addConversionHistory(data): void
getAllHistory(): ConversionHistory[]
clearHistory(): void

// Settings
getSetting(key): string
setSetting(key, value): void
```

#### converterRegistry.ts
**Odpowiedzialność:** Zarządzanie konwerterami i konwersja plików
- Ładowanie definicji konwerterów z YAML
- Routing do odpowiedniego konwertera
- Wykonywanie konwersji

**API:**
```typescript
getAllConverters(): Converter[]
getConverter(id): Converter | undefined
convert(converterId, inputPath, outputPath): Promise<void>
```

**Obecnie:** Mock implementation - zwraca "wikunia i pura"
**TODO:** Implementacja prawdziwych parserów

#### preload.ts
**Odpowiedzialność:** Security bridge między main a renderer
- Expose bezpiecznego API do renderer process
- Context isolation
- Type-safe IPC communication

### 2. Renderer Process (`src/renderer/`)

#### App.tsx
**Odpowiedzialność:** Root component, routing, state management
- Zarządza aktualnym widokiem (converter/settings/history)
- Global state (files, selectedBank, theme, language)
- Ładowanie ustawień przy starcie

#### views/Converter.tsx
**Odpowiedzialność:** UI dla konwersji plików
- Wybór banku
- Drag & drop / file selection
- Wyświetlanie listy plików
- Uruchamianie konwersji
- Status updates

**State:**
- `banks` - lista banków
- `isLoading` - status ładowania
- `dragOver` - drag&drop state

#### views/Settings.tsx
**Odpowiedzialność:** UI dla konfiguracji
- Zarządzanie bankami (CRUD)
- Wybór folderu wyjściowego
- Ustawienia wyglądu (dark mode)
- Wybór języka
- Lista dostępnych konwerterów

**State:**
- `banks`, `converters` - dane
- `showAddBank`, `editingBank` - modal states
- `isLoading` - status ładowania

#### views/History.tsx
**Odpowiedzialność:** UI dla historii konwersji
- Wyświetlanie listy konwersji
- Otwieranie skonwertowanych plików
- Czyszczenie historii

**State:**
- `history` - lista konwersji
- `isLoading` - status ładowania

### 3. Shared (`src/shared/`)

#### types.ts
**Odpowiedzialność:** Wspólne typy TypeScript
- Interfaces dla Bank, Converter, FileEntry, ConversionHistory
- IPC channel constants
- AppSettings type

### 4. Configuration (`config/`)

#### converters.yml
Definicje dostępnych konwerterów:
```yaml
converters:
  - id: ing_converter
    name: Konwerter dla banku ING
    description: Converter for ING bank statements
```

#### accepted-formats.yml
Lista akceptowanych rozszerzeń plików:
```yaml
accepted_formats:
  - .xml
  - .txt
  - .csv
```

## Data Flow

### Konwersja pliku - szczegółowy flow:

```
1. User: Select Bank → Drag & Drop File
   ↓
2. Converter.tsx: addFiles()
   - Tworzy FileEntry z status='pending'
   - Dodaje do state `files`
   ↓
3. User: Click "Convert"
   ↓
4. Converter.tsx: handleConvert()
   - Zmienia status na 'processing'
   - Wywołuje: window.electronAPI.convertFile()
   ↓
5. Preload.ts: ipcRenderer.invoke()
   - Przekazuje request do main process
   ↓
6. Main.ts: IPC Handler CONVERT_FILE
   - Waliduje input file
   - Pobiera bank z database
   - Pobiera converter z registry
   - Sprawdza output folder
   ↓
7. ConverterRegistry.ts: convert()
   - Wykonuje konwersję (obecnie mock)
   - Zapisuje plik do output folder
   ↓
8. Database.ts: addConversionHistory()
   - Zapisuje wynik do historii
   ↓
9. Main.ts: Return result
   - { success: true, outputPath: '...' }
   ↓
10. Converter.tsx: Update UI
    - Zmienia status na 'success'
    - Pokazuje przycisk "Open"
```

## IPC Communication

### Channels

**Banks:**
- `db:get-banks` → `Bank[]`
- `db:add-bank` → `Bank`
- `db:update-bank` → `boolean`
- `db:delete-bank` → `boolean`

**Converters:**
- `converters:get-all` → `Converter[]`

**Files:**
- `files:select` → `{fileName, filePath}[]`
- `files:convert` → `ConversionResult`
- `files:open` → `boolean`

**Settings:**
- `settings:get` → `AppSettings`
- `settings:set-output-folder` → `boolean`
- `settings:set-dark-mode` → `boolean`
- `settings:set-language` → `boolean`

**History:**
- `history:get-all` → `ConversionHistory[]`
- `history:clear` → `boolean`

## Security

### Context Isolation
- Renderer process NIE MA bezpośredniego dostępu do Node.js
- Komunikacja tylko przez preload API
- Żadne `require()` w renderer

### Safe API Exposure
```typescript
// ❌ ZŁE
contextBridge.exposeInMainWorld('electron', electron);

// ✅ DOBRE
contextBridge.exposeInMainWorld('electronAPI', {
  getBanks: () => ipcRenderer.invoke('db:get-banks'),
  // ... tylko potrzebne metody
});
```

## Storage

### electron-store
- **Lokalizacja:** 
  - macOS: `~/Library/Application Support/statement-converter/`
  - Windows: `%APPDATA%\statement-converter\`
- **Format:** JSON
- **Zawartość:** Banks, History, Settings

### File System
- **Input:** Pliki wybrane przez użytkownika
- **Output:** Domyślnie `Documents/StatementConverter/`
- **Config:** `config/*.yml` w app bundle

## Error Handling

### Strategie:

1. **Validation errors** - Rzucane przed operacją
   ```typescript
   if (!fs.existsSync(inputPath)) {
     throw new Error('Input file not found');
   }
   ```

2. **IPC errors** - Catch w handler, return error object
   ```typescript
   try {
     // operation
     return { success: true, ... };
   } catch (error: unknown) {
     return { success: false, error: errorMessage };
   }
   ```

3. **UI errors** - Wyświetlane użytkownikowi
   - Alerts dla krytycznych błędów
   - Status w tabeli dla błędów konwersji
   - Error messages w history

## Performance Considerations

### Current
- Synchronous file operations (small files, OK)
- In-memory state management (React useState)
- No virtualization (lists < 1000 items)

### Future Optimizations
- Worker threads dla dużych plików
- Virtualized lists (react-window)
- Incremental parsing dla XML/CSV
- Batch operations queue

## Build Process

```
1. TypeScript Compilation
   - Main process: tsconfig.main.json → dist/main/
   - Types checking: tsconfig.json

2. Vite Build
   - Renderer process: vite.config.ts → dist/renderer/
   - React bundling + optimization

3. Electron Builder
   - Package into executable
   - Include: dist/, config/, node_modules/
   - Output: release/
```

## Testing Strategy (TODO)

```
┌─────────────────────────────────┐
│ Unit Tests                      │
│ - Converters                    │
│ - Database operations           │
│ - Utils functions               │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Integration Tests               │
│ - IPC communication             │
│ - File operations               │
│ - Settings persistence          │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ E2E Tests                       │
│ - Full user flows               │
│ - UI interactions               │
│ - File conversion scenarios     │
└─────────────────────────────────┘
```

---

**Autorzy:** Wikunia & Pura  
**Ostatnia aktualizacja:** 2026-02-06
