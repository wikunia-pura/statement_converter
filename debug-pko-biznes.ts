/**
 * Debug PKO Biznes parser
 */

import { PKOBiznesConverter } from './src/converters/pko-biznes';
import * as fs from 'fs';
import * as path from 'path';

const testFile = path.join(__dirname, 'test-data', 'pko_biznes.zip');
const buffer = fs.readFileSync(testFile);

console.log('Testing PKO Biznes parser...\n');

const converter = new PKOBiznesConverter({
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

converter.convert(buffer).then(result => {
  console.log(`Total: ${result.totalTransactions}\n`);
  
  // Show first income transaction
  const income = result.processed.find((t: any) => t.transactionType === 'income');
  if (income) {
    console.log('=== FIRST INCOME TRANSACTION ===');
    console.log('Date:', income.normalized.exeDate);
    console.log('Amount:', income.normalized.value);
    console.log('\nDescBase (description):', income.normalized.descBase);
    console.log('\nDescOpt (counterparty):', income.normalized.descOpt);
    console.log('\nExtracted:');
    console.log('  apartmentNumber:', income.extracted.apartmentNumber || 'NOT FOUND');
    console.log('  fullAddress:', income.extracted.fullAddress || 'NOT FOUND');
    console.log('  confidence:', income.extracted.confidence.overall + '%');
  }
  
  // Show first expense transaction  
  const expense = result.processed.find((t: any) => t.transactionType === 'expense');
  if (expense) {
    console.log('\n=== FIRST EXPENSE TRANSACTION ===');
    console.log('Date:', expense.normalized.exeDate);
    console.log('Amount:', expense.normalized.value);
    console.log('\nDescBase (description):', expense.normalized.descBase);
    console.log('\nDescOpt (counterparty):', expense.normalized.descOpt);
    console.log('\nContractor:');
    console.log('  name:', expense.matchedContractor?.contractor?.nazwa || 'NOT MATCHED');
    console.log('  confidence:', expense.matchedContractor?.confidence || 0 + '%');
  }
}).catch(error => {
  console.error('ERROR:', error);
  process.exit(1);
});
