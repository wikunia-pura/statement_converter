# Test Obsługi Błędów AI - Instrukcja

## Cel
Przetestowanie czy aplikacja poprawnie obsługuje błędy związane z brakiem środków/quota na API AI (Anthropic/OpenAI).

## Oczekiwany komunikat
Gdy wystąpi błąd billingowy/quota, użytkownik powinien zobaczyć:
> 💸 Brak kasiory. Pogadaj z Olą

---

## Metoda 1: Symulacja błędu przez zmienną środowiskową (NAJŁATWIEJSZA)

### Krok 1: Ustaw zmienną środowiskową
W terminalu przed uruchomieniem aplikacji:

```bash
export TEST_AI_BILLING_ERROR=true
npm run dev
```

### Krok 2: Spróbuj użyć AI
1. Otwórz aplikację
2. Przejdź do konwertera
3. Wybierz plik do konwersji
4. Kliknij opcję konwersji z AI
5. **Powinien pojawić się alert z komunikatem: "💸 Brak kasiory. Pogadaj z Olą"**

### Krok 3: Wyłącz tryb testowy
Aby wrócić do normalnego działania:
```bash
unset TEST_AI_BILLING_ERROR
npm run dev
```

---

## Metoda 2: Użycie nieprawidłowego API key

### Krok 1: Edytuj config/ai-config.yml
```yaml
ai:
  default_provider: anthropic
  anthropic_api_key: "sk-ant-invalid-test-key-12345"  # Błędny klucz
  # lub dla OpenAI:
  # openai_api_key: "sk-invalid-test-key-12345"
```

### Krok 2: Uruchom aplikację i testuj
```bash
npm run dev
```

### Krok 3: Spróbuj użyć AI
Aplikacja powinna zwrócić błąd autoryzacji lub billingowy.

---

## Metoda 3: Test jednostkowy (dla developera)

Uruchom plik testowy:
```bash
node test-ai-error.js
```

Zobaczy różne symulowane błędy i jak są obsługiwane.

---

## Sprawdzenie w kodzie

Kod obsługi błędów znajduje się w:
- **src/shared/ai-extractor.ts** (linie ~122-140 i ~182-200)
- Wykrywane błędy:
  - Status 402 (payment required)
  - Status 429 (rate limit/quota exceeded)
  - Error type: 'insufficient_quota'
  - Message zawiera: 'quota', 'billing', 'payment required'

---

## Debug

Jeśli chcesz zobaczyć szczegóły błędu:
1. Otwórz DevTools (View -> Toggle Developer Tools)
2. Przejdź do zakładki Console
3. Spróbuj wywołać błąd - zobaczysz szczegółowe logi:
   ```
   Claude API error (extract): ...
   Error details: { status: 429, ... }
   ```

---

## Po testach

**Pamiętaj aby:**
1. Usunąć/wyłączyć zmienną TEST_AI_BILLING_ERROR
2. Przywrócić poprawny API key w config/ai-config.yml
3. Zrestartować aplikację

---

## Możliwe komunikaty błędów

| Typ błędu | Status | Komunikat użytkownikowi |
|-----------|--------|------------------------|
| Brak środków/quota | 402/429 | 💸 Brak kasiory. Pogadaj z Olą |
| Błędny API key | 401 | Claude/OpenAI API error (401): ... |
| Inne błędy API | różne | Claude/OpenAI API error (...): ... |
