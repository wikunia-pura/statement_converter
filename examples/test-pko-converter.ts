/**
 * Test PKO BP MT940 Converter
 * Quick test to verify the converter works correctly
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PKOBPMT940Converter } from '../src/converters/pko-mt940/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing PKO BP MT940 Converter\n');
  
  // Read the test file
  const testFilePath = path.join(__dirname, '..', 'test-data', 'pko.TXT');
  console.log(`📄 Reading test file: ${testFilePath}`);
  
  const mt940Content = fs.readFileSync(testFilePath, 'utf8');
  console.log(`✅ File read successfully (${mt940Content.length} bytes)\n`);
  
  // Create converter (without AI for now)
  const converter = new PKOBPMT940Converter({
    aiProvider: 'none',
    batchSize: 20,
    confidenceThresholds: {
      autoApprove: 85,
      needsReview: 60,
    },
    useCache: false,
    useRegexFirst: true,
    skipNegativeAmounts: false,
    skipBankFees: true,
  });
  
  console.log('🔄 Starting conversion...\n');
  
  try {
    // Convert
    const result = await converter.convert(mt940Content);
    
    console.log('\n📊 CONVERSION RESULTS:');
    console.log('='.repeat(60));
    console.log(`Total transactions: ${result.totalTransactions}`);
    console.log(`Processed: ${result.processed.length}`);
    console.log(`\nSummary:`);
    console.log(`  - Auto-approved: ${result.summary.autoApproved}`);
    console.log(`  - Needs review: ${result.summary.needsReview}`);
    console.log(`  - Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`  - Skipped: ${result.summary.skipped}`);
    console.log(`\nStatistics:`);
    console.log(`  - Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%`);
    console.log(`  - Regex extractions: ${result.statistics.extractionMethods.regex}`);
    console.log(`  - AI extractions: ${result.statistics.extractionMethods.ai}`);
    console.log(`  - Manual entries: ${result.statistics.extractionMethods.manual}`);
    
    // Show first 5 transactions
    console.log('\n\n📝 FIRST 5 TRANSACTIONS:');
    console.log('='.repeat(60));
    
    for (let i = 0; i < Math.min(5, result.processed.length); i++) {
      const trn = result.processed[i];
      console.log(`\nTransaction #${i + 1}:`);
      console.log(`  Type: ${trn.transactionType}`);
      console.log(`  Date: ${trn.original.valueDate}`);
      console.log(`  Amount: ${trn.original.amount} PLN`);
      console.log(`  Description: ${trn.original.details.description.slice(0, 2).join(' ')}`);
      console.log(`  Counterparty: ${trn.original.details.counterpartyName}`);
      
      if (trn.transactionType === 'income') {
        console.log(`  Extracted apartment: ${trn.extracted.apartmentNumber || 'NOT FOUND'}`);
        console.log(`  Extracted address: ${trn.extracted.fullAddress || 'NOT FOUND'}`);
        console.log(`  Tenant name: ${trn.extracted.tenantName || 'N/A'}`);
        console.log(`  Confidence: ${trn.extracted.confidence.overall}%`);
      } else {
        console.log(`  Matched contractor: ${trn.matchedContractor?.contractor?.nazwa || 'NONE'}`);
        console.log(`  Confidence: ${trn.matchedContractor?.confidence || 0}%`);
      }
      
      console.log(`  Status: ${trn.status}`);
    }
    
    // Export to files
    console.log('\n\n💾 Exporting results...');
    const outputDir = path.join(__dirname, '..', 'test-data');
    
    // Export accounting TXT
    const accountingTxt = converter.exportToCsv(result.processed);
    const accountingPath = path.join(outputDir, 'pko-accounting-test.txt');
    fs.writeFileSync(accountingPath, accountingTxt, 'utf8');
    console.log(`✅ Exported accounting file: ${accountingPath}`);
    
    // Export auxiliary file
    const auxiliaryTxt = converter.exportAuxiliaryFile(result.processed);
    const auxiliaryPath = path.join(outputDir, 'pko-preview-test.txt');
    fs.writeFileSync(auxiliaryPath, auxiliaryTxt, 'utf8');
    console.log(`✅ Exported preview file: ${auxiliaryPath}`);
    
    console.log('\n✨ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error during conversion:');
    console.error(error);
    process.exit(1);
  }
}

main();
