/**
 * Test AI Error Handling
 * 
 * Ten skrypt pozwala przetestować różne błędy API AI bez faktycznego wywoływania API.
 * 
 * Aby przetestować:
 * 1. Uruchom `node test-ai-error.js`
 * 2. Lub wywołaj funkcję z konsoli deweloperskiej w aplikacji
 */

// Symulacja różnych błędów API
const testErrors = {
  insufficientQuota: {
    status: 429,
    error: { type: 'insufficient_quota' },
    message: 'You exceeded your current quota, please check your plan and billing details'
  },
  
  paymentRequired: {
    status: 402,
    message: 'Payment required to continue using the API'
  },
  
  billingError: {
    status: 400,
    message: 'Billing error: insufficient credits'
  },
  
  quotaExceeded: {
    status: 429,
    message: 'Rate limit exceeded. Quota exhausted for the month.'
  }
};

/**
 * Funkcja testująca obsługę błędów
 */
function testAIError(errorType) {
  console.log(`\n🧪 Testowanie błędu: ${errorType}\n`);
  
  const error = testErrors[errorType];
  
  if (!error) {
    console.error('Nieznany typ błędu. Dostępne typy:', Object.keys(testErrors));
    return;
  }
  
  // Symulacja logiki z ai-extractor.ts
  const status = error.status;
  const message = error.message || '';
  const errorType2 = error.error?.type || '';
  
  console.log('Szczegóły błędu:');
  console.log('  Status:', status);
  console.log('  Message:', message);
  console.log('  Error Type:', errorType2);
  
  // Test warunku z ai-extractor.ts
  if (status === 402 || status === 429 || 
      errorType2 === 'insufficient_quota' || 
      message.toLowerCase().includes('quota') ||
      message.toLowerCase().includes('billing') ||
      message.toLowerCase().includes('payment required')) {
    console.log('\n✅ WYKRYTO BŁĄD BILLINGOWY!');
    console.log('💸 Komunikat użytkownikowi: "Brak kasiory. Pogadaj z Olą"\n');
  } else {
    console.log('\n❌ Błąd nie został rozpoznany jako błąd billingowy');
  }
}

// Jeśli uruchomiony jako skrypt
if (require.main === module) {
  console.log('='.repeat(60));
  console.log('TEST OBSŁUGI BŁĘDÓW AI');
  console.log('='.repeat(60));
  
  // Testuj wszystkie typy błędów
  Object.keys(testErrors).forEach(errorType => {
    testAIError(errorType);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('INSTRUKCJA TESTOWANIA W APLIKACJI:');
  console.log('='.repeat(60));
  console.log(`
1. Otwórz aplikację w trybie dev: npm run dev
2. Otwórz DevTools: View -> Toggle Developer Tools
3. W konsoli wpisz i wykonaj:

   // Test z błędnym API key (zwróci błąd autoryzacji)
   window.testAIKey = 'invalid-key';
   
4. Spróbuj zaimportować plik z AI - dostaniesz błąd

ALBO

5. W pliku config/ai-config.yml ustaw błędny API key:
   
   anthropic_api_key: "sk-ant-invalid-test-key"
   
6. Spróbuj zaimportować plik z AI
7. Powinien pojawić się komunikat o błędzie billingowym
`);
}

module.exports = { testAIError, testErrors };
