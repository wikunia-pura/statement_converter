/**
 * Test PKO SA converter with pko_sa.exp file
 */

import { PKOSAConverter } from './src/converters/pko-sa';
import * as fs from 'fs';
import * as path from 'path';

const testFile = path.join(__dirname, 'test-data', 'pko_sa.exp');
const content = fs.readFileSync(testFile, 'utf-8');

console.log('='.repeat(80));
console.log('PKO SA CONVERTER TEST');
console.log('='.repeat(80));
console.log(`\nTest file: ${testFile}`);
console.log(`File size: ${content.length} bytes\n`);

const converter = new PKOSAConverter({
  aiProvider: 'none',
  apiKey: '',
  batchSize: 20,
  confidenceThresholds: {
    autoApprove: 85,
    needsReview: 70,
  },
  contractors: [],
  addresses: [],
  language: 'pl',
});

console.log('Converting...\n');

converter.convert(content).then(result => {
  console.log('='.repeat(80));
  console.log('CONVERSION RESULTS');
  console.log('='.repeat(80));
  console.log(`\nTotal transactions: ${result.totalTransactions}`);
  console.log(`\nSummary:`);
  console.log(`  Auto-approved:      ${result.summary.autoApproved}`);
  console.log(`  Needs review:       ${result.summary.needsReview}`);
  console.log(`  Needs manual input: ${result.summary.needsManualInput}`);
  console.log(`  Skipped:            ${result.summary.skipped}`);
  console.log(`\nStatistics:`);
  console.log(`  Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%`);
  
  // Separate into income and expenses
  const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
  const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');
  
  console.log(`\nTransaction breakdown:`);
  console.log(`  Income:  ${incomeTransactions.length}`);
  console.log(`  Expense: ${expenseTransactions.length}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('INCOME TRANSACTIONS');
  console.log('='.repeat(80));
  
  incomeTransactions.slice(0, 3).forEach((trn, idx) => {
    console.log(`\n[${idx + 1}] ${trn.normalized.exeDate} | ${trn.normalized.value} PLN`);
    console.log(`    Description: ${trn.normalized.descBase}`);
    console.log(`    Counterparty: ${trn.normalized.descOpt}`);
    console.log(`    Extracted: ${trn.extracted.apartmentNumber || 'NOT FOUND'}`);
    console.log(`    Confidence: ${trn.extracted.confidence.overall}%`);
    console.log(`    Status: ${trn.status}`);
  });
  
  if (incomeTransactions.length > 3) {
    console.log(`\n... and ${incomeTransactions.length - 3} more income transactions`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('EXPENSE TRANSACTIONS');
  console.log('='.repeat(80));
  
  expenseTransactions.slice(0, 3).forEach((trn, idx) => {
    console.log(`\n[${idx + 1}] ${trn.normalized.exeDate} | ${trn.normalized.value} PLN`);
    console.log(`    Description: ${trn.normalized.descBase}`);
    console.log(`    Counterparty: ${trn.normalized.descOpt}`);
    console.log(`    Contractor: ${trn.matchedContractor?.contractor?.nazwa || 'NOT MATCHED'}`);
    console.log(`    Confidence: ${trn.matchedContractor?.confidence || 0}%`);
    console.log(`    Status: ${trn.status}`);
  });
  
  if (expenseTransactions.length > 3) {
    console.log(`\n... and ${expenseTransactions.length - 3} more expense transactions`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  
}).catch(error => {
  console.error('❌ ERROR:', error);
  process.exit(1);
});
