/**
 * Test script for PKO Biznes converter
 */

import { PKOBiznesConverter } from './src/converters/pko-biznes';
import fs from 'fs';
import path from 'path';

async function test() {
  try {
    console.log('🧪 Testing PKO Biznes converter...\n');

    // Read ZIP file
    const zipPath = path.join(__dirname, 'test-data', 'pko_biznes.zip');
    const zipBuffer = fs.readFileSync(zipPath);
    console.log(`📦 Loaded ZIP file: ${zipPath} (${zipBuffer.length} bytes)\n`);

    // Create converter
    const converter = new PKOBiznesConverter({
      aiProvider: 'none',
      apiKey: '',
      useBatchProcessing: false,
      batchSize: 20,
      confidenceThresholds: {
        autoApprove: 85,
        needsReview: 70,
      },
      useCache: false,
      useRegexFirst: true,
      skipNegativeAmounts: false,
      skipBankFees: false,
      contractors: [],
      addresses: [],
      language: 'pl',
    });

    // Convert
    console.log('🔄 Converting...\n');
    const result = await converter.convert(zipBuffer);

    // Display results
    console.log('✅ Conversion complete!\n');
    console.log('📊 Summary:');
    console.log(`   Total transactions: ${result.totalTransactions}`);
    console.log(`   Auto-approved: ${result.summary.autoApproved}`);
    console.log(`   Needs review: ${result.summary.needsReview}`);
    console.log(`   Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`   Skipped: ${result.summary.skipped}`);
    console.log(`   Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n`);

    // Show first 3 transactions
    console.log('📝 First 3 transactions:');
    result.processed.slice(0, 3).forEach((trn: any, idx: number) => {
      console.log(`\n${idx + 1}. ${trn.transactionType.toUpperCase()}`);
      console.log(`   Date: ${trn.original.date}`);
      console.log(`   Amount: ${trn.original.amount} PLN`);
      console.log(`   Description: ${trn.original.description.substring(0, 50)}...`);
      console.log(`   Counterparty: ${trn.original.counterpartyName.substring(0, 50)}...`);
      if (trn.extracted.apartmentNumber) {
        console.log(`   Apartment: ${trn.extracted.apartmentNumber} (confidence: ${trn.extracted.confidence.apartment}%)`);
      } else {
        console.log(`   Apartment: NOT FOUND`);
      }
    });

    console.log('\n✨ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

test();
