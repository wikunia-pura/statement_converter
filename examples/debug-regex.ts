/**
 * Debug regex patterns
 */

import { RegexExtractor } from '../src/converters/santander-xml/regex-extractor';

const extractor = new RegexExtractor();

const testCases = [
  {
    descBase: 'FUNDUSZ REMONTOWY',
    descOpt: 'EWA TERESA OSIECKA-CISOWSKA UL. JOLIOT-CURIE 3/27 02-646 WARSZAWA',
  },
  {
    descBase: 'opłata mieszkaniowa m-c kwiecień2025, joliot curie 3/47, warszawa wtym fundusz remontowy: 145,35',
    descOpt: 'ŁASICA AGNIESZKA MARIA JOLIOT-CURIE F 3/47 02-646 WARSZAWA ELIXIR 01-04-2025',
  },
  {
    descBase: 'OPŁATA EKSPLOATACYJNA ZA 04 2025 WTYM FUNDUSZ REMONTOWY 145,80 PLNID.22211201',
    descOpt: 'KRZYSZTOF MIECZYSŁAW WAŁBIŃSKI  UL. JOLIOT CURIE 3  M.11 02-646 WARSZAWA ELIXIR 02-04-2025',
  },
  {
    descBase: 'CZYNSZ JOLIOT CURIE 3/2',
    descOpt: 'BARBARA MACIĄG  UL.OLCHY 6 04-837 WARSZAWA ELIXIR 04-04-2025',
  },
];

console.log('🧪 Testing Regex Extractor\n');
console.log('='.repeat(70));

for (let i = 0; i < testCases.length; i++) {
  const testCase = testCases[i];
  console.log(`\nTest ${i + 1}:`);
  console.log(`DESC-BASE: ${testCase.descBase}`);
  console.log(`DESC-OPT: ${testCase.descOpt}`);
  
  const result = extractor.extract({
    trnCode: 'TEST',
    exeDate: '01/04/2025',
    creatDate: '01/04/2025',
    value: 100,
    accValue: 100,
    realValue: 100,
    descBase: testCase.descBase,
    descOpt: testCase.descOpt,
  });
  
  if (result) {
    console.log(`✅ EXTRACTED:`);
    console.log(`   Address: ${result.fullAddress}`);
    console.log(`   Tenant: ${result.tenantName}`);
    console.log(`   Confidence: ${result.confidence.overall}%`);
    console.log(`   Method: ${result.extractionMethod}`);
  } else {
    console.log(`❌ NO EXTRACTION (confidence too low or no match)`);
  }
  console.log('-'.repeat(70));
}
