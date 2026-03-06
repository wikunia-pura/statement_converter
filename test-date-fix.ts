/**
 * Test fix for date pattern bug (03/2026 matched as apartment 202)
 */

import { AddressMatcher } from './src/shared/address-matcher';

const address = {
  id: 1,
  nazwa: 'Pułku Baszta 2',
  dataOd: '2020-01-01',
  dataDo: null,
  lokale: [],
  createdAt: '2020-01-01T00:00:00Z',
};

const matcher = new AddressMatcher([address]);

// Test case: User's reported issue
const text1 = 'ZALICZKI I FUNDUSZ REMONTOWY 03/2026 PUŁKU AK BASZTA 2B LOK 10';
const result1 = matcher.match(text1);

console.log('Test 1: Date should NOT be matched as apartment');
console.log('Text:', text1);
console.log('Extracted apartment:', result1.apartmentNumber);
console.log('Expected: 10');
console.log('Status:', result1.apartmentNumber === '10' ? '✅ PASS' : '❌ FAIL');
console.log('Full address:', result1.fullAddress);
console.log('Confidence:', result1.confidence.overall + '%');
console.log();

// Test case 2: Should still work with normal dates in text
const text2 = '03/2026 PUŁKU AK BASZTA 2B/10';
const result2 = matcher.match(text2);

console.log('Test 2: Address pattern should work');
console.log('Text:', text2);
console.log('Extracted apartment:', result2.apartmentNumber);
console.log('Expected: 10');
console.log('Status:', result2.apartmentNumber === '10' ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 3: Normal address pattern without date
const text3 = 'PUŁKU BASZTA 2B/15';
const result3 = matcher.match(text3);

console.log('Test 3: Normal address pattern');
console.log('Text:', text3);
console.log('Extracted apartment:', result3.apartmentNumber);
console.log('Expected: 15');
console.log('Status:', result3.apartmentNumber === '15' ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 4: Date in different format
const text4 = 'CZYNSZ 02/2025 LOTNIKOW 20/33';
const result4 = matcher.match(text4, '');

console.log('Test 4: Date then address');
console.log('Text:', text4);
console.log('Extracted apartment:', result4.apartmentNumber);
console.log('Expected: 33');
console.log('Status:', result4.apartmentNumber === '33' ? '✅ PASS' : '❌ FAIL');
