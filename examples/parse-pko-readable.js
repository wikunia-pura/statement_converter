/**
 * Parse PKO MT940 to human-readable format
 */

const fs = require('fs');
const path = require('path');

async function main() {
  try {
    console.log('📄 Parsing PKO MT940 to readable format...\n');
    
    const { PKOBPMT940Parser } = require('../dist/main/converters/pko-mt940/parser.js');
    
    const inputPath = path.join(__dirname, '..', 'test-data', 'pko.TXT');
    const outputPath = path.join(__dirname, '..', 'test-data', 'pko-parsed-readable.txt');
    
    const mt940Content = fs.readFileSync(inputPath, 'latin1');
    console.log(`✅ Read file: ${inputPath} (${mt940Content.length} bytes)\n`);
    
    const parser = new PKOBPMT940Parser();
    const statement = parser.parse(mt940Content);
    
    console.log(`✅ Parsed successfully!`);
    console.log(`   Transactions: ${statement.transactions.length}`);
    console.log(`   Opening balance: ${statement.openingBalance.amount} PLN (${statement.openingBalance.debitCredit})`);
    console.log(`   Closing balance: ${statement.closingBalance.amount} PLN (${statement.closingBalance.debitCredit})\n`);
    
    // Generate readable output
    const output = [];
    
    output.push('='.repeat(100));
    output.push('PKO BP MT940 - WYCIĄG BANKOWY (PARSED)');
    output.push('='.repeat(100));
    output.push('');
    
    output.push('INFORMACJE OGÓLNE:');
    output.push(`  Referencja:        ${statement.reference}`);
    output.push(`  Numer rachunku:    ${statement.accountIBAN}`);
    output.push(`  Numer wyciągu:     ${statement.statementNumber}`);
    output.push('');
    
    output.push('SALDO POCZĄTKOWE:');
    output.push(`  Data:              ${formatDate(statement.openingBalance.date)}`);
    output.push(`  Typ:               ${statement.openingBalance.debitCredit === 'C' ? 'CREDIT (Ma)' : 'DEBIT (Wn)'}`);
    output.push(`  Kwota:             ${formatAmount(statement.openingBalance.amount)} PLN`);
    output.push('');
    
    output.push('SALDO KOŃCOWE:');
    output.push(`  Data:              ${formatDate(statement.closingBalance.date)}`);
    output.push(`  Typ:               ${statement.closingBalance.debitCredit === 'C' ? 'CREDIT (Ma)' : 'DEBIT (Wn)'}`);
    output.push(`  Kwota:             ${formatAmount(statement.closingBalance.amount)} PLN`);
    output.push('');
    
    if (statement.availableBalance) {
      output.push('SALDO DOSTĘPNE:');
      output.push(`  Data:              ${formatDate(statement.availableBalance.date)}`);
      output.push(`  Typ:               ${statement.availableBalance.debitCredit === 'C' ? 'CREDIT (Ma)' : 'DEBIT (Wn)'}`);
      output.push(`  Kwota:             ${formatAmount(statement.availableBalance.amount)} PLN`);
      output.push('');
    }
    
    output.push('');
    output.push('='.repeat(100));
    output.push('TRANSAKCJE');
    output.push('='.repeat(100));
    output.push('');
    
    statement.transactions.forEach((trn, idx) => {
      output.push('─'.repeat(100));
      output.push(`TRANSAKCJA #${idx + 1}`);
      output.push('─'.repeat(100));
      output.push('');
      
      output.push('📋 PODSTAWOWE INFORMACJE:');
      output.push(`  Data waluty:       ${formatDate(trn.valueDate)}`);
      output.push(`  Data księgowania:  ${formatDate(trn.entryDate)}`);
      output.push(`  Typ operacji:      ${trn.debitCredit === 'C' ? 'WPŁATA (Credit)' : 'WYPŁATA (Debit)'}`);
      output.push(`  Kwota:             ${formatAmount(trn.amount)} PLN`);
      output.push(`  Typ transakcji:    ${trn.transactionType}`);
      output.push(`  Referencja:        ${trn.reference}`);
      output.push('');
      
      output.push('🏦 SZCZEGÓŁY TRANSAKCJI:');
      output.push(`  Kod transakcji:    ${trn.details.transactionCode}`);
      output.push('');
      
      output.push('📝 OPIS:');
      trn.details.description.forEach((line, i) => {
        output.push(`  ${i + 1}. ${line}`);
      });
      output.push('');
      
      output.push('👤 KONTRAHENT:');
      output.push(`  Nazwa:             ${trn.details.counterpartyName || '(brak)'}`);
      output.push(`  IBAN:              ${trn.details.counterpartyIBAN || '(brak)'}`);
      output.push(`  Bank (kod):        ${trn.details.bankCode || '(brak)'}`);
      output.push(`  Nr rachunku:       ${trn.details.accountNumber || '(brak)'}`);
      output.push('');
      
      if (trn.details.transactionDate) {
        output.push('📅 DODATKOWE DATY:');
        output.push(`  Data transakcji:   ${trn.details.transactionDate}`);
        output.push('');
      }
      
      if (trn.details.additionalInfo && trn.details.additionalInfo !== '�') {
        output.push('ℹ️  INFORMACJE DODATKOWE:');
        output.push(`  ${trn.details.additionalInfo}`);
        output.push('');
      }
      
      output.push('🔍 RAW DATA (dla debugowania):');
      output.push(`  Field :61: ${trn.raw.field61.substring(0, 80)}...`);
      output.push('');
      
    });
    
    output.push('');
    output.push('='.repeat(100));
    output.push('KONIEC WYCIĄGU');
    output.push('='.repeat(100));
    
    const outputText = output.join('\n');
    fs.writeFileSync(outputPath, outputText, 'utf8');
    
    console.log(`✅ Saved readable format to: ${outputPath}`);
    console.log(`📊 Total transactions: ${statement.transactions.length}`);
    console.log(`   - Credits (wpłaty): ${statement.transactions.filter(t => t.debitCredit === 'C').length}`);
    console.log(`   - Debits (wypłaty): ${statement.transactions.filter(t => t.debitCredit === 'D').length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

function formatDate(dateStr) {
  // YYMMDD -> DD.MM.20YY
  if (!dateStr || dateStr.length < 6) return dateStr;
  const year = '20' + dateStr.substring(0, 2);
  const month = dateStr.substring(2, 4);
  const day = dateStr.substring(4, 6);
  return `${day}.${month}.${year}`;
}

function formatAmount(amount) {
  return amount.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

main();
