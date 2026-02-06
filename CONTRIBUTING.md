# Contributing to Statement Converter

## Rozwój aplikacji

### Setup środowiska
```bash
npm install
npm run dev
```

### Struktura commitów
Używamy Conventional Commits:
- `feat:` - nowa funkcjonalność
- `fix:` - naprawa błędu
- `docs:` - dokumentacja
- `style:` - formatowanie
- `refactor:` - refaktoryzacja kodu
- `test:` - testy
- `chore:` - inne (dependencies, config)

Przykład:
```bash
git commit -m "feat: add XML converter for ING bank"
git commit -m "fix: resolve file path validation error"
```

### Dodawanie nowego konwertera

1. Dodaj definicję w `config/converters.yml`:
```yaml
- id: new_bank_converter
  name: Konwerter dla Nowego Banku
  description: Converter for New Bank statements
```

2. Zaimplementuj logikę w `src/main/converterRegistry.ts`:
```typescript
async convert(converterId: string, inputPath: string, outputPath: string): Promise<void> {
  switch(converterId) {
    case 'new_bank_converter':
      return this.convertNewBank(inputPath, outputPath);
    // ... other cases
  }
}

private async convertNewBank(inputPath: string, outputPath: string): Promise<void> {
  // Implementation here
}
```

3. Dodaj testy w `tests/converters/`:
```typescript
describe('New Bank Converter', () => {
  it('should convert valid XML file', async () => {
    // test implementation
  });
});
```

### Testowanie

```bash
# Uruchom wszystkie testy
npm test

# Testy w trybie watch
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### Budowanie aplikacji

```bash
# Development build
npm run build

# Production package
npm run package:win  # Windows
npm run package:mac  # macOS
```

### Code Style

Przed commitem uruchom:
```bash
npm run lint        # Sprawdź błędy
npm run lint:fix    # Automatyczne poprawki
npm run format      # Prettier formatting
```

## Pull Request Process

1. Fork repozytorium
2. Stwórz branch (`git checkout -b feature/AmazingFeature`)
3. Commit zmian (`git commit -m 'feat: add AmazingFeature'`)
4. Push do brancha (`git push origin feature/AmazingFeature`)
5. Otwórz Pull Request

### PR Checklist
- [ ] Kod przechodzi testy (`npm test`)
- [ ] Dodano testy dla nowej funkcjonalności
- [ ] Zaktualizowano dokumentację
- [ ] Brak błędów ESLint
- [ ] Kod sformatowany Prettier

## Zgłaszanie błędów

### Template dla Issue

**Opis problemu:**
Krótki opis co nie działa

**Kroki do reprodukcji:**
1. Otwórz aplikację
2. Przejdź do...
3. Kliknij na...
4. Zobacz błąd

**Oczekiwane zachowanie:**
Co powinno się wydarzyć

**Aktualne zachowanie:**
Co się dzieje zamiast tego

**Środowisko:**
- OS: [Windows 11 / macOS 14.2]
- Wersja aplikacji: [1.0.0]
- Node version: [20.x]

**Screenshots:**
Jeśli możliwe, dodaj screenshoty

**Logi:**
```
Wklej logi z konsoli / pliku log
```

## Propozycje nowych funkcji

### Template dla Feature Request

**Czy funkcja rozwiązuje problem?**
Jasny opis problemu, np. "Zawsze jestem sfrustrowany gdy [...]"

**Proponowane rozwiązanie:**
Jasny opis jak chciałbyś aby funkcja działała

**Alternatywy:**
Inne rozwiązania które rozważałeś

**Dodatkowy kontekst:**
Screenshots, mockupy, przykłady z innych aplikacji

---

**Autorzy:** Wikunia & Pura
