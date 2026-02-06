# Test Data for Converters

Ten folder zawiera przykładowe pliki do testowania konwerterów.

## Struktura

```
test-data/
├── ing/
│   ├── valid_statement.xml
│   ├── invalid_statement.xml
│   └── empty_statement.xml
├── millenium/
│   ├── valid_statement.xml
│   └── large_statement.xml
├── mt940/
│   ├── valid_statement.940
│   └── valid_statement.mt940
├── csv/
│   ├── valid_statement.csv
│   └── invalid_format.csv
└── excel/
    ├── valid_statement.xlsx
    └── valid_statement.xls
```

## Dodawanie nowych plików testowych

1. Stwórz folder dla banku/formatu jeśli nie istnieje
2. Dodaj przynajmniej 3 pliki:
   - `valid_statement.*` - poprawny plik
   - `invalid_statement.*` - niepoprawny format
   - `empty_statement.*` - pusty lub minimalny plik

3. Dodaj opis w README w folderze:
```markdown
## ING Bank Test Files

### valid_statement.xml
- Zawiera 10 transakcji
- Okres: 2024-01-01 do 2024-01-31
- Saldo początkowe: 1000.00 PLN
- Saldo końcowe: 850.50 PLN

### invalid_statement.xml
- Brakuje wymaganego pola <AccountNumber>
- Powinien zwrócić błąd walidacji
```

## Oczekiwany format wyjściowy

Wszystkie konwertery powinny generować plik TXT w formacie:
```
Data | Opis | Kwota | Saldo
YYYY-MM-DD | Transaction description | -100.00 | 900.00
YYYY-MM-DD | Another transaction | +50.00 | 950.00
```

## Użycie w testach

```typescript
import path from 'path';
import fs from 'fs';

describe('ING Converter', () => {
  it('should convert valid XML file', async () => {
    const inputPath = path.join(__dirname, '../test-data/ing/valid_statement.xml');
    const outputPath = path.join(__dirname, '../test-output/result.txt');
    
    await converter.convert('ing_converter', inputPath, outputPath);
    
    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('Data | Opis | Kwota | Saldo');
  });
});
```
