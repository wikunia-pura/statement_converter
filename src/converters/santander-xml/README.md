# Santander XML Converter

Inteligentny konwerter wyciągów bankowych Santander w formacie XML do ustrukturyzowanych danych.

## ✨ Funkcje

- **Hybrydowe przetwarzanie**: Regex (szybkie, darmowe) + AI (dokładne dla trudnych przypadków)
- **Batch processing**: Grupowanie transakcji w pakiety dla optymalizacji kosztów API
- **Cache system**: Zapamiętywanie poprzednich ekstrakcji
- **Confidence scoring**: Automatyczna ocena pewności dla każdego pola
- **Multi-provider AI**: Obsługa Claude, OpenAI, lub lokalne modele

## 📊 Wynik przetwarzania

Dla każdej transakcji ekstrahuje:
- **Adres**: Ulica, numer budynku, numer mieszkania
- **Lokator**: Imię i nazwisko płacącego
- **Confidence score**: 0-100% dla każdego pola

Transakcje są automatycznie kategoryzowane:
- ✅ **Auto-approved** (≥85% pewności) - gotowe do importu
- ⚠️ **Needs review** (60-84% pewności) - wymaga przeglądu
- ❌ **Needs manual input** (<60% pewności) - wymaga ręcznego uzupełnienia

## 🚀 Instalacja

```bash
npm install
```

### Zależności AI (opcjonalne, ale zalecane):

```bash
# Dla Claude (rekomendowane - najtaniej)
npm install @anthropic-ai/sdk

# Lub dla OpenAI
npm install openai
```

## 🔑 Konfiguracja API Key

### Option 1: Claude (REKOMENDOWANE - ~18 groszy za 100 transakcji)

1. Załóż konto na https://console.anthropic.com/
2. Wygeneruj API key
3. Ustaw zmienną środowiskową:
   ```bash
   export ANTHROPIC_API_KEY="your-key-here"
   ```

### Option 2: OpenAI (~40 groszy za 100 transakcji)

1. Załóż konto na https://platform.openai.com/
2. Wygeneruj API key
3. Ustaw zmienną środowiskową:
   ```bash
   export OPENAI_API_KEY="your-key-here"
   ```

### Option 3: Bez AI (tylko regex)
Działa bez API key, ale będzie miało niską pewność dla skomplikowanych przypadków.

## 📖 Użycie

### Podstawowe użycie:

```typescript
import { SantanderXmlConverter } from './src/converters/santander-xml';
import * as fs from 'fs';

// Wczytaj XML
const xmlContent = fs.readFileSync('wyciag.xml', 'latin1');

// Skonfiguruj konwerter
const converter = new SantanderXmlConverter({
  aiProvider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  useBatchProcessing: true,
  batchSize: 20,
  useCache: true,
});

// Konwertuj
const result = await converter.convert(xmlContent);

console.log(`Processed: ${result.processed.length} transactions`);
console.log(`Auto-approved: ${result.summary.autoApproved}`);
console.log(`Needs review: ${result.summary.needsReview}`);
```

### Uruchom przykład:

```bash
# Ustaw API key
export ANTHROPIC_API_KEY="your-key-here"

# Uruchom przykład
npx ts-node examples/santander-converter-example.ts
```

## 💰 Koszty

### Dla 5000 transakcji miesięcznie:

Z optymalizacją (regex + cache):
- **Regex wyłapie ~50%** (2500 transakcji) → **darmowe**
- **Cache zmniejszy o ~30%** przy powtórzeniach
- **AI przetworzy ~2500** trudnych przypadków

**Koszt miesięczny**:
- Claude: **~$4.50** (~18 zł)
- OpenAI GPT-4: **~$10** (~40 zł)

### Optymalizacja kosztów:

1. **Batch processing** - 20 transakcji w jednym zapytaniu (oszczędność ~30%)
2. **Cache** - powtarzające się opisy są przetwarzane tylko raz
3. **Regex first** - proste przypadki nie trafiają do AI
4. **Filtrowanie** - pomijamy wydatki i opłaty bankowe

## 🏗️ Architektura

```
XML Input
    ↓
Parser (filtruje wydatki, opłaty bankowe)
    ↓
Quick Extraction (Regex + Cache)
    ↓
AI Extraction (tylko trudne przypadki, batch processing)
    ↓
Confidence Scoring
    ↓
Categorization (auto-approved / needs-review / needs-manual-input)
```

## 📝 Format wyjściowy

```typescript
{
  totalTransactions: 60,
  processed: [
    {
      original: {
        trnCode: "EC2G",
        exeDate: "01/04/2025",
        value: 678.57,
        descBase: "FUNDUSZ REMONTOWY",
        descOpt: "EWA TERESA OSIECKA-CISOWSKA UL. JOLIOT-CURIE 3/27..."
      },
      extracted: {
        streetName: "Joliot-Curie",
        buildingNumber: "3",
        apartmentNumber: "27",
        fullAddress: "Joliot-Curie 3/27",
        tenantName: "Ewa Teresa Osiecka-Cisowska",
        confidence: {
          address: 95,
          apartment: 95,
          tenantName: 90,
          overall: 93
        },
        extractionMethod: "regex",
        reasoning: "Clear address format in desc-opt",
        warnings: []
      },
      status: "auto-approved"
    }
  ],
  summary: {
    autoApproved: 45,
    needsReview: 10,
    needsManualInput: 2,
    skipped: 3
  },
  statistics: {
    averageConfidence: 87.5,
    extractionMethods: {
      regex: 30,
      ai: 20,
      cache: 5,
      manual: 2
    }
  }
}
```

## 🔧 Konfiguracja zaawansowana

```typescript
const converter = new SantanderXmlConverter({
  // Provider AI
  aiProvider: 'anthropic' | 'openai' | 'none',
  apiKey: 'your-key',
  model: 'claude-3-5-sonnet-20241022', // lub 'gpt-4-turbo-preview'
  
  // Batch processing
  useBatchProcessing: true,
  batchSize: 20,  // 10-30 optymalnie
  
  // Cache
  useCache: true,
  
  // Extraction
  useRegexFirst: true,  // Zawsze true dla optymalizacji kosztów
  
  // Filtrowanie
  skipNegativeAmounts: true,  // Pomija wydatki
  
  // Progi pewności
  confidenceThresholds: {
    autoApprove: 85,    // ≥85% → auto-approved
    needsReview: 60,    // 60-84% → needs-review
  },
});
```

## 🧪 Testowanie

```bash
# Uruchom przykład z testowym plikiem
npx ts-node examples/santander-converter-example.ts

# Wynik zostanie zapisany do:
# test-data/conversion-result.json
```

## 📈 Statystyki

Konwerter zbiera statystyki:
- Średnia pewność ekstrakcji
- Podział na metody (regex/AI/cache)
- Cache hit rate
- Liczba transakcji w każdej kategorii

```typescript
const stats = converter.getCacheStats();
console.log(stats);
// { size: 150, hitRate: 67.5, mostUsed: [...] }
```

## 🐛 Troubleshooting

### Błąd: "No AI provider configured"
- Upewnij się, że ustawiłeś `apiKey` i `aiProvider`
- Sprawdź czy zainstalowałeś odpowiedni package (`@anthropic-ai/sdk` lub `openai`)

### Niskie confidence scores
- Sprawdź czy dane w XML są kompletne
- Rozważ manual review dla transakcji <60%
- AI może potrzebować lepszych przykładów (few-shot learning)

### Wysokie koszty API
- Zwiększ `batchSize` do 30
- Upewnij się że `useCache` i `useRegexFirst` są `true`
- Rozważ filtrowanie transakcji przed przetwarzaniem

## 🔮 Przyszłe ulepszenia

- [ ] Fine-tuning modelu na własnych danych
- [ ] Obsługa Ollama (lokalne AI, darmowe)
- [ ] UI do review i korekt
- [ ] Export do różnych formatów (CSV, Excel)
- [ ] Detekcja anomalii (duplikaty, podejrzane kwoty)
- [ ] Learning from corrections (ML feedback loop)

## 📄 Licencja

Proprietary - Statement Converter Project

---

**Autor**: Statement Converter Team  
**Data**: 2025  
**Wersja**: 1.0.0
