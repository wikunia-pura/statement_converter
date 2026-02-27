// Debug regex patterns for apartment extraction

const patterns = [
  { name: 'Identyfikator lokalu 92', text: 'Identyfikator lokalu 92' },
  { name: 'lokal numer: 111', text: 'lokal numer: 111  GrzegorzPirch' },
  { name: 'ID LOKALU 1/77', text: 'ID LOKALU 1/77' },
  { name: 'identyfikator lokalu 1/108', text: 'czynsz, identyfikator lokalu 1/108' },
];

for (const p of patterns) {
  const desc = p.text.toLowerCase();
  
  // Test patterns
  const patternIdentyfikatorSlash = /identyfikator\s+lokalu\s+\d+\/(\d+)/i;
  const patternIdentyfikator = /identyfikator\s+lokalu\s+(\d+)/i;
  const patternID = /id\.?\s+lokalu\s+\d+\/(\d+)/i;
  const patternID2 = /id\.?\s+lokalu\s+(\d+)(?!\s*\/\d)/i;
  const pattern2 = /lokal(?:\s+numer|\s+nr)?\s*:?\s*(\d+)/i;
  
  console.log(`\n${p.name}:`);
  console.log('  patternIdentyfikatorSlash:', desc.match(patternIdentyfikatorSlash));
  console.log('  patternIdentyfikator:', desc.match(patternIdentyfikator));
  console.log('  patternID:', desc.match(patternID));
  console.log('  patternID2:', desc.match(patternID2));
  console.log('  pattern2:', desc.match(pattern2));
}
