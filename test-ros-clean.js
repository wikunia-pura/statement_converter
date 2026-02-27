const fs = require('fs');
const iconv = require('iconv-lite');

// Simulate contractor from database
const contractors = [
  {
    id: 3523,
    nazwa: "ROS-CLEAN SP. Z O.O.",
    kontoKontrahenta: "201-00936",
    alternativeNames: ["ROS CLEAN"]
  }
];

// Parse MT940 file
const content = fs.readFileSync('./test-data/pko.TXT');
const decoded = iconv.decode(content, 'windows-1250');
const lines = decoded.split('\n');

// Find ROS CLEAN transaction
let inTransaction = false;
let currentTransaction = {};
let foundTransactions = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  if (line.startsWith(':61:')) {
    if (Object.keys(currentTransaction).length > 0) {
      foundTransactions.push(currentTransaction);
    }
    currentTransaction = { lineNum: i, line61: line };
    inTransaction = true;
  }
  
  if (inTransaction && line.includes('ROS CLEAN')) {
    currentTransaction.rosCleanLine = line;
    currentTransaction.rosCleanLineNum = i;
    
    // Extract the value after ~32
    if (line.startsWith('~32')) {
      const value = line.substring(3);
      currentTransaction.counterparty = value;
      
      console.log('\n=== FOUND ROS CLEAN TRANSACTION ===');
      console.log('Line number:', i);
      console.log('Raw line:', JSON.stringify(line));
      console.log('Counterparty extracted:', JSON.stringify(value));
      console.log('Counterparty length:', value.length);
      console.log('Counterparty trimmed:', JSON.stringify(value.trim()));
      console.log('Counterparty trimmed length:', value.trim().length);
      
      // Test matching
      const counterpartyLower = value.toLowerCase();
      const counterpartyTrimmedLower = value.trim().toLowerCase();
      
      contractors.forEach(contractor => {
        console.log('\n--- Testing contractor:', contractor.nazwa);
        
        // Test main name
        const mainNameLower = contractor.nazwa.toLowerCase();
        console.log('Main name match:', counterpartyLower.includes(mainNameLower));
        console.log('Main name match (trimmed):', counterpartyTrimmedLower.includes(mainNameLower));
        
        // Test alternative names
        if (contractor.alternativeNames) {
          contractor.alternativeNames.forEach(altName => {
            const altNameLower = altName.toLowerCase();
            console.log(`Alt name "${altName}" match:`, counterpartyLower.includes(altNameLower));
            console.log(`Alt name "${altName}" match (trimmed):`, counterpartyTrimmedLower.includes(altNameLower));
            
            // Character comparison
            console.log('\nCharacter-by-character comparison (trimmed):');
            console.log('Counterparty chars:', counterpartyTrimmedLower.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
            console.log('AltName chars:     ', altNameLower.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
          });
        }
      });
    }
  }
}

console.log('\n\n=== SUMMARY ===');
console.log('Total transactions with ROS CLEAN found:', foundTransactions.length);
