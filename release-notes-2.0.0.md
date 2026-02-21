# FileFunky 2.0.0 - Wydanie AI

## 🚀 Główne zmiany

### Integracja AI (Claude/OpenAI)
- **Automatyczne dopasowanie kontrahentów** dla wydatków przy użyciu sztucznej inteligencji
- **Dwufazowe przetwarzanie**: szybkie dopasowanie częściowe (regex) → AI dla trudnych przypadków
- **Optymalizacja kosztów**: pre-filtrowanie top 10 kandydatów (95% redukcja tokenów, 73% oszczędności)
- **Batch processing**: 50 transakcji/batch dla wydatków, 20/batch dla wpłat

### Moduł Kontrahenci
- **CRUD kontrahentów**: dodawanie, edycja, usuwanie z interfejsu graficznego
- **Import z PlanKont**: masowy import kontrahentów z plików CSV
- **Wyszukiwanie i filtrowanie**: szybkie znajdowanie kontrahentów w bazie
- **Zarządzanie kontami**: przypisywanie kont kontrahentów (k_wn)

### Konwerter Santander XML
- **Przetwarzanie wydatków**: automatyczna detekcja i eksport kwot ujemnych
- **Dual-section export**: wpłaty i wydatki w jednym pliku księgowym
- **Pliki pomocnicze**: szczegółowe raporty dopasowań z poziomami pewności
- **Cache AI**: zapobiega duplikacji zapytań do API

## 🔧 Konfiguracja

### AI Setup
Dodaj klucze API w `config/ai-config.yml`:
```yaml
ai:
  anthropic_api_key: "sk-ant-..."
  default_provider: "anthropic"
```

Obsługiwane modele:
- **Claude Sonnet 4** (domyślny): `claude-sonnet-4-6`
- **Claude 3 Opus**: `claude-3-opus-20240229`
- **OpenAI GPT-4**: `gpt-4-turbo-preview`

### Progi pewności
- **Regex extraction**: min. 90% pewności
- **Partial matching**: min. 90% podobieństwa
- **AI matching**: min. 50% pewności

## 📊 Wyniki optymalizacji

| Parametr | Wartość |
|----------|---------|
| Redukcja tokenów | 95% (940 → 10 kontrahentów/transakcja) |
| Oszczędność kosztów | 73% |
| Batch size (wydatki) | 50 transakcji |
| Batch size (wpłaty) | 20 transakcji |

## 🐛 Naprawione błędy
- Obsługa markdown formatowania w odpowiedziach JSON z AI
- Kompatybilność z nowymi modelami Claude (claude-sonnet-4-6)
- Parsowanie odpowiedzi z blokami ```json

## 📝 Format eksportu

### Plik księgowy (accounting.txt)
```
=== WPŁATY ===
data | kwota | opis | k_wn | k_ma | adres

=== WYDATKI ===
data | kwota | opis | k_wn | k_ma | adres
```

### Plik pomocniczy (auxiliary.txt)
Szczegółowe informacje o dopasowaniach:
- Poziom pewności
- Metoda dopasowania (regex/partial/AI)
- Dopasowany tekst

## 🔮 Następne kroki
- Wsparcie dla innych banków
- Fine-tuning modeli AI dla polskich banków
- Lokalne modele AI (brak kosztów API)

---

**Pełna dokumentacja**: [ARCHITECTURE.md](ARCHITECTURE.md)  
**Konfiguracja AI**: [config/ai-config.yml](config/ai-config.yml)
