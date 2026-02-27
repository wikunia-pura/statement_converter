const desc = 'AL.LOTNIKÓW. 20 lok. 5602-668 Warszawa';

// Current pattern
const pattern4 = /\b(?:mieszkanie|lok\.?|loc\.?)\s*(\d+)|\bm\.?\s*(\d+)(?!\s*pln)/i;
const match4 = desc.toLowerCase().match(pattern4);
console.log('Pattern4 (lok.) match:', match4);

// The issue: "5602-668" = apartment 56 + postal code 02-668 (glued together)
// Solution: detect postal code pattern and separate

// Pattern that handles glued postal codes: "lok. 5602-668" -> apartment = 56
// Postal codes in Poland are XX-XXX, so if we see \d{3,4}0[0-9]-\d{3}, extract first part
const patternLokPostal = /lok\.?\s*(\d{1,3})(0[0-9]-\d{3})/i;
const matchPostal = desc.match(patternLokPostal);
console.log('Pattern with postal code detection:', matchPostal);

// Generic: match 1-3 digits, optionally followed by postal code
const patternBest = /lok\.?\s*(\d{1,3})(?:0[0-9]-\d{3}|[-\s]|$)/i;
const matchBest = desc.match(patternBest);
console.log('Best pattern:', matchBest);
