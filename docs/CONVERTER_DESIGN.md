# Design konwertera XML - Analiza i propozycja rozwiązania

## Analiza problemu

### Struktura danych wejściowych

Z pliku XML (`wyciag_2702_20250430.xml`) interesują nas transakcje z node'a `<transactions>`, konkretnie:
- Wpłaty od lokatorów (wartość dodatnia w `<value>`)
- Ignorujemy wydatki (wartość ujemna)

### Wyzwania

1. **Niespójna struktura opisów**:
   - Numery lokali w różnych formatach:
     - `3/27` (standardowy)
     - `3 M.11`, `3 M 11`, `3 m 1`, `3.33` (z "M" lub bez)
     - `JOLIOT-CURIE 3/4`, `joliot curie 3/47`, `Joliot Curie 3/37`
     - `F 3/47`, `F. 3/28` (z literą F)
   
2. **Brak konsystencji w nazwiskach**:
   - Pełne imię i nazwisko: `EWA TERESA OSIECKA-CISOWSKA`
   - Tylko nazwisko: `KRZYSZTOF MIECZYS�AW WA�BI�SKI`
   - Różna kolejność: nazwisko-imię vs imię-nazwisko
   - Różne wielkości liter: UPPERCASE, Proper Case, mixed case

3. **Dane rozproszone**:
   - Czasem informacja w `<desc-base>`, czasem w `<desc-opt>`
   - Czasem w obu miejscach z duplikacją
   - Czasem z dodatkowymi informacjami (ID lokalu, dodatkowe opisy)

4. **Dodatkowe informacje**:
   - `IDENTYFIKATOR: 27/4`, `ID 22211214`, `ID.22211201`
   - Informacje o funduszu remontowym
   - Adresy wpłacających (często inne niż lokal)

### Przykłady wzorców do analizy

```xml
<!-- Wzorzec 1: Czytelny, standardowy -->
<desc-base>FUNDUSZ REMONTOWY</desc-base>
<desc-opt>EWA TERESA OSIECKA-CISOWSKA UL. JOLIOT-CURIE 3/27 02-646 WARSZAWA</desc-opt>

<!-- Wzorzec 2: Lokal w desc-base -->
<desc-base>CZYNSZ JOLIOT CURIE 3/2</desc-base>
<desc-opt>BARBARA MACI�G  UL.OLCHY 6 04-837 WARSZAWA ELIXIR 04-04-2025</desc-opt>

<!-- Wzorzec 3: Wszystko w desc-base -->
<desc-base>zap�ata za czynsz za lV/2025Maria Mo�odzi�ska Joliot Curie 3/37</desc-base>
<desc-opt>MO�ODZI�SKI MICHA� WOJCIECH RABSZTY�SKA 4/10 01-140 WARSZAWA ELIXIR 04-04-2025</desc-opt>

<!-- Wzorzec 4: Z identyfikatorem -->
<desc-base>CZYNSZ I FUNDUSZ REMONTOWY ZA LOKALJOLIOT-CURIE 3/4 IDENTYFIKATOR: 27/4</desc-base>
<desc-opt>SYLWESTER �CI�LEWSKI  UL.JOLIOT-CURIE 3 M.4 02-646 WARSZAWA ELIXIR 05-04-2025</desc-opt>

<!-- Wzorzec 5: Format "M." -->
<desc-opt>KRZYSZTOF MIECZYS�AW WA�BI�SKI  UL. JOLIOT CURIE 3  M.11 02-646 WARSZAWA ELIXIR 02-04-2025</desc-opt>
```

## Propozycja rozwiązania

### 1. Architektura wieloetapowa

```
XML Input → Parser → Extractor (multiple strategies) → Validator → Confidence Scorer → Output
```

### 2. Ekstraktor z wieloma strategiami

Zamiast jednego rozwiązania, zastosuj **cascade pattern** - próbuj różnych strategii w kolejności od najbardziej pewnych do najmniej pewnych:

#### Strategia 1: Identyfikator (najwyższa pewność)
```typescript
// Pattern: IDENTYFIKATOR: 27/4, ID 22211214, ID.22211201
// Jeśli znaleziono → confidence: 95%
regex: /(?:IDENTYFIKATOR|ID)[:\s\.]+(\d+\/?\d*)/i
```

#### Strategia 2: Adres z numerem (wysoka pewność)
```typescript
// Pattern: JOLIOT[-\s]?CURIE\s+\d+[/\s]+(M\.?|m\.?)?\s*\d+
// confidence: 85%
regex: /JOLIOT[-\s]?CURIE\s+(\d+)[\/\s]+(M\.?|m\.?)?\s*(\d+)/i
```

#### Strategia 3: Samodzielny numer (średnia pewność)
```typescript
// Pattern: 3/27, 3/4
// confidence: 70%
regex: /\b(\d+)[\/\.](\d+)\b/
```

#### Strategia 4: Nazwisko - Fuzzy matching
```typescript
// Ekstrakcja potencjalnych nazwisk z tekstu
// Porównanie z bazą znanych lokatorów (jeśli istnieje)
// confidence: 50-80% (zależnie od dopasowania)
```

### 3. Walidator z scoring confidence

```typescript
interface ExtractionResult {
  apartmentNumber: string | null;
  tenantName: string | null;
  confidence: {
    overall: number;        // 0-100
    apartmentNumber: number; // 0-100
    tenantName: number;      // 0-100
  };
  sources: {
    apartmentNumber: 'desc-base' | 'desc-opt' | 'both' | 'identifier';
    tenantName: 'desc-base' | 'desc-opt' | 'both';
  };
  warnings: string[];
  rawData: {
    descBase: string;
    descOpt: string;
  };
}
```

#### Kryteria obniżające pewność:
- Brak numeru lokalu: -50 punktów
- Numer znaleziony tylko raz: -10 punktów
- Brak nazwiska: -30 punktów
- Konflikt danych (różne numery w desc-base i desc-opt): -40 punktów
- Numer poza zakresem (np. lokal 99 przy 48 lokalach): -50 punktów

#### Kryteria podwyższające pewność:
- Numer potwierdzony w obu polach: +20 punktów
- Numer z identyfikatora: +30 punktów
- Nazwisko dopasowane do bazy: +25 punktów

### 4. Reaction strategy - jak aplikacja powinna reagować

#### Poziomy pewności (Confidence Levels):

**WYSOKIE (85-100%)**
- ✅ Auto-akceptacja
- Dane automatycznie importowane
- Zielony status w UI

**ŚREDNIE (60-84%)**
- ⚠️ Wymaga przeglądu
- Import z flagą "do weryfikacji"
- Żółty status w UI
- Użytkownik widzi:
  - Wykryte dane
  - Surowe dane (desc-base, desc-opt)
  - Opcje: Potwierdź | Edytuj | Odrzuć

**NISKIE (< 60%)**
- ❌ Wymaga ręcznej interwencji
- Czerwony status w UI
- Użytkownik musi:
  - Ręcznie wpisać numer lokalu
  - Ręcznie wpisać nazwisko
  - Lub oznaczyć jako "nie dotyczy" (błędny przelew)

### 5. UI/UX Flow

```
Import XML
    ↓
Parsing (progress bar)
    ↓
Results Summary:
├─ ✅ Auto-accepted: 35 transactions
├─ ⚠️ Need review: 8 transactions
└─ ❌ Need manual input: 3 transactions
    ↓
Review Interface (dla ⚠️ i ❌):
┌────────────────────────────────────────────┐
│ Transaction #12                            │
│ Date: 04/04/2025  Amount: 722.69 PLN      │
│                                            │
│ Detected:                                  │
│ 🏢 Apartment: 3/28  [85% confidence]      │
│ 👤 Name: Andrzej Fronczak  [75% conf.]    │
│                                            │
│ Raw data:                                  │
│ • Joliot-Curie 3/28, opłata eksploat...   │
│ • Andrzej Fronczak  Joliot-Curie F...     │
│                                            │
│ [✓ Confirm] [✏️ Edit] [✗ Skip]            │
└────────────────────────────────────────────┘
```

### 6. Implementacja - struktura kodu

```typescript
// src/converters/santander-xml/
├── parser.ts              // XML parsing
├── extractor.ts           // Strategy pattern dla ekstrakcji
│   ├── strategies/
│   │   ├── identifier-strategy.ts
│   │   ├── address-strategy.ts
│   │   ├── number-strategy.ts
│   │   └── name-strategy.ts
├── validator.ts           // Walidacja i confidence scoring
├── types.ts              // Typy TypeScript
└── index.ts              // Main converter interface

// UI Components
src/renderer/components/
├── ImportReview/
│   ├── ImportSummary.tsx
│   ├── TransactionReview.tsx
│   └── ManualInput.tsx
```

### 7. Dodatkowe funkcjonalności

#### A. Uczenie się z danych użytkownika
```typescript
// Zapisuj potwierdzone mapowania
interface TenantMapping {
  apartmentNumber: string;
  tenantNames: string[];      // możliwe warianty nazwiska
  lastUpdated: Date;
  confirmedCount: number;     // ile razy potwierdzono
}

// Przy kolejnych importach:
// - Priorytetyzuj dopasowania z historii
// - Sugeruj na podstawie poprzednich potwierdzeń
```

#### B. Raport po imporcie
```typescript
interface ImportReport {
  totalTransactions: number;
  imported: number;
  skipped: number;
  errors: TransactionError[];
  warnings: TransactionWarning[];
  statistics: {
    averageConfidence: number;
    byConfidenceLevel: {
      high: number;
      medium: number;
      low: number;
    };
  };
}
```

#### C. Export nieokreślonych transakcji
```
// Możliwość eksportu do CSV transakcji wymagających ręcznej weryfikacji
// + późniejszy re-import po uzupełnieniu
```

## ⚠️ AKTUALIZACJA: XML z wielu budynków

**KLUCZOWA INFORMACJA**: XML jest eksportem z **banku**, nie z pojedynczego budynku.
- Może zawierać wpłaty z różnych adresów/budynków
- Brak stałej listy lokatorów
- Brak stałej liczby mieszkań
- Różne formaty adresów w zależności od tego, jak lokatorzy wypełniają przelewy

**To zmienia wszystko - potrzebujemy AI/LLM do ekstrakcji!**

---

## 🤖 Rozwiązanie z AI/LLM

### Dlaczego AI?

1. **Naturalne przetwarzanie tekstu**: LLM świetnie radzi sobie z nieustrukturyzowanymi danymi tekstowymi
2. **Wieloformatowość**: Potrafi rozpoznać ten sam adres w dziesiątkach różnych zapisów
3. **Kontekst**: Rozumie, że "Joliot Curie 3/27" i "UL. JOLIOT-CURIE 3 M.27" to to samo
4. **Nazwiska**: Radzi sobie z błędami ortograficznymi, różnymi kolejnościami (imię-nazwisko vs nazwisko-imię)
5. **Inteligentne wnioskowanie**: Jeśli w desc-base jest "lokal 27" a w desc-opt "Kowalski", połączy to logicznie

### Architektura hybrydowa: Regex + AI

```
XML Parser
    ↓
Quick Regex Filter (filtruj oczywiste przypadki: opłaty bankowe, faktury dostawców)
    ↓
AI Extractor ← [Tu dzieje się magia]
    ↓
Validator & Confidence Scorer
    ↓
User Review Interface
```

### Implementacja z OpenAI/Anthropic

#### Opcja 1: OpenAI GPT-4 (Structured Output)

```typescript
import OpenAI from 'openai';

interface TransactionExtraction {
  address: string | null;           // "Joliot-Curie 3"
  apartmentNumber: string | null;   // "27" lub "3/27"
  fullAddress: string | null;       // "Joliot-Curie 3/27"
  tenantName: string | null;        // "Ewa Teresa Osiecka-Cisowska"
  confidence: {
    address: number;        // 0-100
    apartment: number;      // 0-100
    tenantName: number;     // 0-100
  };
  reasoning: string;        // Wyjaśnienie, skąd AI wzięło te dane
}

async function extractWithAI(
  descBase: string, 
  descOpt: string
): Promise<TransactionExtraction> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const prompt = `You are analyzing a bank transfer description to extract:
1. Building address (street name and building number)
2. Apartment/unit number
3. Tenant name (person making the payment)

The descriptions are in Polish and may contain typos, inconsistent formatting, or missing data.

DESC-BASE: ${descBase}
DESC-OPT: ${descOpt}

Extract structured data. If you find an identifier like "IDENTYFIKATOR: 27/4" or "ID 22211214", use it for apartment number. The address format is typically "street buildingNumber/apartmentNumber" (e.g., "Joliot-Curie 3/27" means building 3, apartment 27).

Return your confidence (0-100) for each field and explain your reasoning.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1, // Niska temperatura = bardziej deterministyczne
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result;
}
```

#### Opcja 2: Anthropic Claude (lepszy dla polskiego?)

```typescript
import Anthropic from '@anthropic-ai/sdk';

async function extractWithClaude(
  descBase: string,
  descOpt: string
): Promise<TransactionExtraction> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 500,
    temperature: 0,
    system: `You are a data extraction specialist for Polish real estate management.
Your job is to extract structured data from messy bank transfer descriptions.

Extract:
- Building address (e.g., "Joliot-Curie 3")
- Apartment number (e.g., "27" or "3/27")
- Tenant name

Provide confidence scores (0-100) and reasoning for each extraction.
Return only valid JSON matching this schema:
{
  "address": string | null,
  "apartmentNumber": string | null,
  "fullAddress": string | null,
  "tenantName": string | null,
  "confidence": {
    "address": number,
    "apartment": number,
    "tenantName": number
  },
  "reasoning": string
}`,
    messages: [{
      role: "user",
      content: `DESC-BASE: ${descBase}\nDESC-OPT: ${descOpt}`
    }]
  });

  const result = JSON.parse(message.content[0].text);
  return result;
}
```

### Optymalizacja kosztów

#### 1. Batch Processing
```typescript
// Grupuj wiele transakcji w jeden request
async function extractBatch(transactions: Transaction[]): Promise<ExtractionResult[]> {
  const prompt = `Extract data from these ${transactions.length} bank transfers:

${transactions.map((t, i) => `
Transaction ${i + 1}:
DESC-BASE: ${t.descBase}
DESC-OPT: ${t.descOpt}
AMOUNT: ${t.value} PLN
DATE: ${t.date}
`).join('\n---\n')}

Return an array of JSON objects, one per transaction.`;

  // Pojedynczy request zamiast N requestów
  const response = await callAI(prompt);
  return response;
}
```

#### 2. Caching
```typescript
// Zapisuj wyniki, żeby nie przetwarzać tych samych danych
const cache = new Map<string, TransactionExtraction>();

function getCacheKey(descBase: string, descOpt: string): string {
  return `${descBase}|${descOpt}`;
}

async function extractWithCache(
  descBase: string,
  descOpt: string
): Promise<TransactionExtraction> {
  const key = getCacheKey(descBase, descOpt);
  
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  
  const result = await extractWithAI(descBase, descOpt);
  cache.set(key, result);
  
  return result;
}
```

#### 3. Smart Fallback
```typescript
// Najpierw regex (darmowy), tylko jeśli zawiedzie → AI (płatny)
async function smartExtract(
  descBase: string,
  descOpt: string
): Promise<TransactionExtraction> {
  
  // Faza 1: Quick regex patterns
  const regexResult = tryRegexExtraction(descBase, descOpt);
  
  // Jeśli regex ma wysoką pewność, pomiń AI
  if (regexResult.confidence.overall > 85) {
    return regexResult;
  }
  
  // Faza 2: AI dla trudnych przypadków
  const aiResult = await extractWithAI(descBase, descOpt);
  
  // Połącz wyniki (AI może uzupełnić brakujące dane z regex)
  return mergeResults(regexResult, aiResult);
}
```

#### 4. Lokalna AI (offline, darmowa)
```typescript
// Opcja dla małych modeli lokalnych (Ollama, LLaMA)
import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

async function extractWithLocal(
  descBase: string,
  descOpt: string
): Promise<TransactionExtraction> {
  const response = await ollama.generate({
    model: 'llama3.1',  // Lub mistral, phi-3
    prompt: `Extract address, apartment, and tenant name from:
DESC-BASE: ${descBase}
DESC-OPT: ${descOpt}

Return JSON only.`,
    format: 'json'
  });
  
  return JSON.parse(response.response);
}
```

**Zalety lokalnej AI**:
- ✅ Bez kosztów API
- ✅ Prywatność danych
- ✅ Offline
- ❌ Wolniejsze
- ❌ Gorsza jakość niż GPT-4/Claude

### Zaawansowane techniki

#### Few-Shot Learning
```typescript
const EXAMPLES = `
Examples of correct extractions:

Input:
  DESC-BASE: "FUNDUSZ REMONTOWY"
  DESC-OPT: "EWA TERESA OSIECKA-CISOWSKA UL. JOLIOT-CURIE 3/27 02-646 WARSZAWA"
Output:
  {
    "address": "Joliot-Curie 3",
    "apartmentNumber": "27",
    "fullAddress": "Joliot-Curie 3/27",
    "tenantName": "Ewa Teresa Osiecka-Cisowska",
    "confidence": { "address": 95, "apartment": 95, "tenantName": 90 }
  }

Input:
  DESC-BASE: "CZYNSZ I FUNDUSZ REMONTOWY ZA LOKALJOLIOT-CURIE 3/4 IDENTYFIKATOR: 27/4"
  DESC-OPT: "SYLWESTER ŚCIŚLEWSKI  UL.JOLIOT-CURIE 3 M.4 02-646 WARSZAWA"
Output:
  {
    "address": "Joliot-Curie 3",
    "apartmentNumber": "4",
    "fullAddress": "Joliot-Curie 3/4",
    "tenantName": "Sylwester Ściślewski",
    "confidence": { "address": 98, "apartment": 95, "tenantName": 92 }
  }

Now extract from:
DESC-BASE: ${descBase}
DESC-OPT: ${descOpt}
`;
```

#### Iterative Refinement
```typescript
// Jeśli pewność jest niska, zapytaj AI o szczegóły
async function refineLowConfidence(
  result: TransactionExtraction,
  descBase: string,
  descOpt: string
): Promise<TransactionExtraction> {
  if (result.confidence.overall > 70) {
    return result; // OK, nie trzeba poprawiać
  }
  
  // Dopytaj AI o konkretne problemy
  const refinementPrompt = `
The initial extraction had low confidence. Please re-analyze carefully:

DESC-BASE: ${descBase}
DESC-OPT: ${descOpt}

Previous extraction (low confidence):
${JSON.stringify(result, null, 2)}

What information is missing or uncertain? Can you extract it with more confidence now?
`;

  const refinedResult = await callAI(refinementPrompt);
  return refinedResult;
}
```

## Rekomendowana architektura

### Warstwa 1: XML Parser (darmowa)
- Parsuj XML do struktury Transaction[]
- Opłat bankowych (trn-code: X_06) nie filtruj — to zwykłe wydatki, dopasowywane do kontrahentów

### Warstwa 2: Smart Extractor (hybrydowa)
```typescript
async function extractTransaction(txn: Transaction): Promise<ExtractionResult> {
  // 1. Quick wins - proste regex patterns
  const regexResult = tryRegexExtraction(txn);
  if (regexResult.confidence.overall >= 90) {
    return { ...regexResult, method: 'regex' };
  }
  
  // 2. Sprawdź cache (poprzednie AI extractions)
  const cached = await checkCache(txn);
  if (cached) {
    return { ...cached, method: 'cache' };
  }
  
  // 3. AI extraction (kosztowne, ale dokładne)
  const aiResult = await extractWithAI(txn.descBase, txn.descOpt);
  await saveToCache(txn, aiResult);
  
  return { ...aiResult, method: 'ai' };
}
```

### Warstwa 3: Validator
- Cross-reference z historycznymi danymi
- Detekcja anomalii
- Grupowanie po adresach

### Warstwa 4: User Review
- High confidence (≥85%): auto-approve
- Medium (60-84%): suggest with edit option
- Low (<60%): manual input required

## Szacunkowe koszty AI

### OpenAI GPT-4 Turbo
- Input: $10 / 1M tokens
- Output: $30 / 1M tokens
- ~200 tokens per transaction
- **Koszt: ~$0.004 na transakcję** (~40 groszy za 100 transakcji)

### Anthropic Claude 3.5 Sonnet
- Input: $3 / 1M tokens  
- Output: $15 / 1M tokens
- **Koszt: ~$0.0018 na transakcję** (~18 groszy za 100 transakcji)

### Ollama (lokalne)
- **Koszt: $0** (wymaga mocnej karty graficznej lub CPU)
- Wolniejsze (~2-5s na transakcję vs ~0.5s dla API)

### Rekomendacja kosztowa

Dla 100 transakcji miesięcznie:
- **Claude**: ~18-40 groszy/miesiąc ← **REKOMENDOWANE**
- **GPT-4**: ~40 groszy/miesiąc
- **Ollama**: darmowe, ale wymaga sprzętu

Z batch processing i cachingiem:
- Pierwszy import: pełna cena
- Kolejne: ~50% taniej (cache duplikatów)

## Plan implementacji

### MVP - Faza 1 (Tydzień 1)
1. ✅ XML Parser
2. ✅ Integracja Claude API
3. ✅ Podstawowy prompt engineering
4. ✅ Simple UI preview

### Faza 2 (Tydzień 2)  
1. Batch processing (optymalizacja kosztów)
2. Caching system
3. Confidence scoring
4. User review interface

### Faza 3 (Tydzień 3)
1. Learning from corrections (fine-tuning promptów)
2. Anomaly detection
3. Export/import
4. Raporty

### Faza 4 (Opcjonalna)
1. Lokalna AI (Ollama) jako fallback
2. Custom fine-tuned model (jeśli masz dużo danych)

## Pytania do decyzji

1. **API Key**: Masz dostęp do OpenAI/Anthropic, czy mam użyć lokalnej AI?
2. **Budget**: Jaki jest akceptowalny koszt miesięczny? (przy Claude: grosze)
3. **Privacy**: Czy dane mogą iść do API zewnętrznego? (opcja: Ollama lokalne)
4. **Volume**: Ile transakcji miesięcznie będziesz importować? (50? 500? 5000?)

## Następne kroki

Czy zacznę implementację z:
- **Claude API** (najlepszy stosunek cena/jakość)
- **GPT-4** (nieznacznie lepsze, droższe)
- **Ollama lokalne** (darmowe, wolniejsze)

Mogę przygotować prototyp z wybranym rozwiązaniem!
