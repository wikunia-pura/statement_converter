/**
 * Example usage of Santander XML Converter
 * Run this with: npx ts-node examples/santander-converter-example.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { SantanderXmlConverter } from '../src/converters/santander-xml';

async function main() {
  console.log('='.repeat(60));
  console.log('Santander XML Converter - Example');
  console.log('='.repeat(60));
  console.log();

  // Read XML file
  const xmlPath = path.join(__dirname, '../../test-data/wyciag_2702_20250430.xml');
  
  if (!fs.existsSync(xmlPath)) {
    console.error('❌ XML file not found. Please copy the XML file to:');
    console.error(`   ${xmlPath}`);
    console.error();
    console.error('Or update the path in this example file.');
    return;
  }

  const xmlContent = fs.readFileSync(xmlPath, 'latin1'); // ISO-8859-2 encoding
  console.log(`📄 Loaded XML file: ${path.basename(xmlPath)}`);
  console.log();

  // Configure converter
  const converter = new SantanderXmlConverter({
    // Option 1: Use Claude (recommended)
    aiProvider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || 'your-api-key-here',
    
    // Option 2: Use OpenAI
    // aiProvider: 'openai',
    // apiKey: process.env.OPENAI_API_KEY,
    
    // Option 3: No AI (regex only - will have low confidence for complex cases)
    // aiProvider: 'none',

    // Settings
    useBatchProcessing: true,
    batchSize: 20,
    useCache: true,
    useRegexFirst: true,
    skipNegativeAmounts: true,
    skipBankFees: true,
    
    confidenceThresholds: {
      autoApprove: 85,
      needsReview: 60,
    },
  });

  // Convert
  try {
    const result = await converter.convert(xmlContent);

    // Display results
    console.log();
    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log();
    console.log(`Total transactions: ${result.totalTransactions}`);
    console.log(`Processed: ${result.processed.length}`);
    console.log();
    console.log('Summary:');
    console.log(`  ✅ Auto-approved: ${result.summary.autoApproved}`);
    console.log(`  ⚠️  Needs review: ${result.summary.needsReview}`);
    console.log(`  ❌ Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`  ⏭️  Skipped: ${result.summary.skipped}`);
    console.log();
    console.log('Statistics:');
    console.log(`  Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%`);
    console.log(`  Extraction methods:`);
    console.log(`    - Regex: ${result.statistics.extractionMethods.regex}`);
    console.log(`    - AI: ${result.statistics.extractionMethods.ai}`);
    console.log(`    - Cache: ${result.statistics.extractionMethods.cache}`);
    console.log(`    - Manual: ${result.statistics.extractionMethods.manual}`);
    console.log();

    // Show cache stats
    const cacheStats = converter.getCacheStats();
    console.log('Cache:');
    console.log(`  Size: ${cacheStats.size} entries`);
    console.log(`  Hit rate: ${cacheStats.hitRate.toFixed(1)}%`);
    console.log();

    // Display sample results
    console.log('='.repeat(60));
    console.log('SAMPLE RESULTS (first 5)');
    console.log('='.repeat(60));
    console.log();

    for (let i = 0; i < Math.min(5, result.processed.length); i++) {
      const txn = result.processed[i];
      const statusEmoji = {
        'auto-approved': '✅',
        'needs-review': '⚠️',
        'needs-manual-input': '❌',
        'skipped': '⏭️',
      }[txn.status];

      console.log(`Transaction #${i + 1} ${statusEmoji}`);
      console.log(`  Date: ${txn.original.exeDate}`);
      console.log(`  Amount: ${txn.original.value.toFixed(2)} PLN`);
      console.log(`  Address: ${txn.extracted.fullAddress || '(not found)'}`);
      console.log(`  Tenant: ${txn.extracted.tenantName || '(not found)'}`);
      console.log(`  Confidence: ${txn.extracted.confidence.overall}%`);
      console.log(`  Method: ${txn.extracted.extractionMethod}`);
      if (txn.extracted.reasoning) {
        console.log(`  Reasoning: ${txn.extracted.reasoning}`);
      }
      if (txn.extracted.warnings.length > 0) {
        console.log(`  Warnings: ${txn.extracted.warnings.join(', ')}`);
      }
      console.log(`  Raw desc-base: ${txn.original.descBase.substring(0, 60)}...`);
      console.log(`  Raw desc-opt: ${txn.original.descOpt.substring(0, 60)}...`);
      console.log();
    }

    // Display needs-review transactions
    const needsReview = result.processed.filter(t => t.status === 'needs-review');
    if (needsReview.length > 0) {
      console.log('='.repeat(60));
      console.log(`NEEDS REVIEW (${needsReview.length} transactions)`);
      console.log('='.repeat(60));
      console.log();

      for (let i = 0; i < Math.min(3, needsReview.length); i++) {
        const txn = needsReview[i];
        console.log(`Transaction ${i + 1}:`);
        console.log(`  Amount: ${txn.original.value.toFixed(2)} PLN`);
        console.log(`  Extracted: ${txn.extracted.fullAddress || '?'} - ${txn.extracted.tenantName || '?'}`);
        console.log(`  Confidence: ${txn.extracted.confidence.overall}%`);
        console.log(`  DESC-BASE: ${txn.original.descBase}`);
        console.log(`  DESC-OPT: ${txn.original.descOpt}`);
        console.log();
      }
    }

    // Display needs-manual-input transactions
    const needsManual = result.processed.filter(t => t.status === 'needs-manual-input');
    if (needsManual.length > 0) {
      console.log('='.repeat(60));
      console.log(`NEEDS MANUAL INPUT (${needsManual.length} transactions)`);
      console.log('='.repeat(60));
      console.log();

      for (let i = 0; i < Math.min(3, needsManual.length); i++) {
        const txn = needsManual[i];
        console.log(`Transaction ${i + 1}:`);
        console.log(`  Amount: ${txn.original.value.toFixed(2)} PLN`);
        console.log(`  DESC-BASE: ${txn.original.descBase}`);
        console.log(`  DESC-OPT: ${txn.original.descOpt}`);
        console.log();
      }
    }

    // Export to JSON
    const outputPath = path.join(__dirname, '../../test-data/conversion-result.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log('='.repeat(60));
    console.log(`📝 Full results exported to: ${outputPath}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Conversion failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
