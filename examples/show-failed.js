const fs = require('fs');
const { PKOBPMT940Converter } = require('../dist/main/converters/pko-mt940/index.js');

const mt940Content = fs.readFileSync('./test-data/pko.TXT', 'latin1');
const converter = new PKOBPMT940Converter({
  aiProvider: 'none',
  addresses: [{ id: 1, nazwa: 'Aleja Lotników 20' }],
});

converter.convert(mt940Content).then(result => {
  console.log('\n❌ TRANSAKCJE WYMAGAJĄCE RĘCZNEGO WPROWADZENIA (income):');
  console.log('='.repeat(70));
  result.processed
    .filter(t => t.transactionType === 'income' && t.status === 'needs-manual-input')
    .slice(0, 15)
    .forEach((t, i) => {
      console.log(`\n#${i+1}: ${t.original.amount} PLN`);
      console.log(`   Opis: ${t.original.details.description.join('')}`);
      console.log(`   Counterparty: ${t.original.details.counterpartyName}`);
      console.log(`   Wyciągnięty lokal: ${t.extracted.apartmentNumber || 'BRAK'}`);
      console.log(`   Confidence: ${t.extracted.confidence.overall}%`);
    });
});
