// Debug specific transaction using actual converter

const fs = require('fs');
const { PKOBPMT940Converter } = require('../dist/main/converters/pko-mt940/index.js');
const { RegexExtractor } = require('../dist/main/converters/pko-mt940/regex-extractor.js');

// Mock transaction
const mockTransaction = {
  valueDate: '260101',
  entryDate: '260101',
  amount: 500,
  debitCredit: 'C',
  fundsCode: 'N',
  transactionType: 'U13',
  reference: 'NONREF',
  details: {
    description: ['JAROSŁAW KUS ALEJA LOTNIKÓW 20/51  02-668 WARSZAWA'],
    counterpartyName: 'JAROSŁAW KUŚ 02-676 WARSZAWA UL. POSTĘPU 12C M.205',
    counterpartyIBAN: 'PL00000000000000000000000000',
    counterpartyBankCode: '10201127',
    counterpartyAccount: '0000110201435817',
  },
};

console.log('=== Testing RegexExtractor directly ===');
const description = mockTransaction.details.description.join('');
const counterparty = mockTransaction.details.counterpartyName;
console.log('Description:', description);
console.log('Counterparty:', counterparty);
console.log('');

// Test if address pattern matches
const addresses = [{ id: 1, nazwa: 'Aleja Lotników 20' }];
const addr = addresses[0];

// From extractAddress logic:
const addressMatch = addr.nazwa.match(/^(.+?)\s+(\d+)$/);
console.log('addressMatch from nazwa:', addressMatch);

const street = addressMatch[1].toLowerCase();
const building = addressMatch[2];
console.log('street:', street);
console.log('building:', building);

// Normalize
const normalizePolishChars = (str) => str
  .replace(/[ąĄ]/g, 'a')
  .replace(/[ćĆ]/g, 'c')
  .replace(/[ęĘ]/g, 'e')
  .replace(/[łŁ]/g, 'l')
  .replace(/[ńŃ]/g, 'n')
  .replace(/[óÓ]/g, 'o')
  .replace(/[śŚ]/g, 's')
  .replace(/[źŹżŻ]/g, 'z');

const streetAscii = normalizePolishChars(street);
console.log('streetAscii:', streetAscii);

// Prepare fullText
const fullText = `${description} ${counterparty}`.toLowerCase();
let normalizedText = fullText
  .replace(/\bal\.\s*/gi, 'aleja ')
  .replace(/\bul\.\s*/gi, 'ulica ')
  .replace(/\bm\.\s*/gi, ' ')
  .replace(/\blok\.\s*/gi, ' ')
  .replace(/\bloc\.\s*/gi, ' ')
  .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ])(\d)/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

const normalizedTextAscii = normalizePolishChars(normalizedText);
console.log('normalizedTextAscii:', normalizedTextAscii);

// Try pattern
const escapeRegex = (str) => str.replace(/[.*+?^${}()[\]\\]/g, '\\$&');
const streetPattern = new RegExp(
  `(${escapeRegex(streetAscii)})\\s*${escapeRegex(building)}\\s*[/\\s]?\\s*(?:m\\.?\\s*)?(?:lok\\.?\\s*)?(?:loc\\.?\\s*)?([0-9]+)?`,
  'i'
);

console.log('streetPattern:', streetPattern);
const match = normalizedTextAscii.match(streetPattern);
console.log('match:', match);

console.log('\n=== Now test with RegexExtractor ===');
const extractor = new RegexExtractor(addresses);
const result = extractor.extract(mockTransaction);

console.log('Extracted result:');
console.log('  apartmentNumber:', result.apartmentNumber);
console.log('  streetName:', result.streetName);
console.log('  buildingNumber:', result.buildingNumber);
console.log('  fullAddress:', result.fullAddress);


