/**
 * Quick test of Santander XML Converter (without AI)
 * Tests regex extraction only
 */

import * as fs from 'fs';
import * as path from 'path';
import { SantanderXmlConverter } from '../src/converters/santander-xml';

async function quickTest() {
  console.log('🧪 Quick Test - Santander XML Converter (Regex Only)');
  console.log('='.repeat(60));
  console.log();

  // Read XML file
  const xmlPath = path.join(__dirname, '../test-data/wyciag_2702_20250430.xml');
  
  if (!fs.existsSync(xmlPath)) {
    console.error('❌ Test file not found:', xmlPath);
    return;
  }

  const xmlContent = fs.readFileSync(xmlPath, 'latin1');

  // Test without AI (regex only)
  const converter = new SantanderXmlConverter({
    aiProvider: 'none',  // No AI - just regex
    useBatchProcessing: false,
    useCache: true,
    useRegexFirst: true,
    skipNegativeAmounts: true,
    skipBankFees: true,
  });

  console.log('⚙️  Config: Regex only (no AI)');
  console.log();

  const startTime = Date.now();
  const result = await converter.convert(xmlContent);
  const duration = Date.now() - startTime;

  console.log(`⏱️  Processing time: ${duration}ms`);
  console.log();
  console.log('📊 Results:');
  console.log(`  Total transactions: ${result.totalTransactions}`);
  console.log(`  Processed: ${result.processed.length}`);
  console.log(`  ✅ Auto-approved: ${result.summary.autoApproved} (${((result.summary.autoApproved / result.processed.length) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️  Needs review: ${result.summary.needsReview} (${((result.summary.needsReview / result.processed.length) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Needs manual: ${result.summary.needsManualInput} (${((result.summary.needsManualInput / result.processed.length) * 100).toFixed(1)}%)`);
  console.log(`  ⏭️  Skipped: ${result.summary.skipped}`);
  console.log();
  console.log(`  Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%`);
  console.log();

  // Show examples of auto-approved
  const autoApproved = result.processed.filter(t => t.status === 'auto-approved');
  if (autoApproved.length > 0) {
    console.log('✅ Auto-approved examples (regex worked great!):');
    for (let i = 0; i < Math.min(3, autoApproved.length); i++) {
      const txn = autoApproved[i];
      console.log(`  ${i + 1}. ${txn.extracted.fullAddress} - ${txn.extracted.tenantName} (${txn.extracted.confidence.overall}%)`);
    }
    console.log();
  }

  // Show examples that need AI
  const needsAI = result.processed.filter(t => t.status === 'needs-manual-input');
  if (needsAI.length > 0) {
    console.log('❌ Needs AI (complex cases regex couldn\'t handle):');
    for (let i = 0; i < Math.min(3, needsAI.length); i++) {
      const txn = needsAI[i];
      console.log(`  ${i + 1}. ${txn.original.value.toFixed(2)} PLN`);
      console.log(`     DESC-BASE: ${txn.original.descBase.substring(0, 50)}...`);
      console.log(`     DESC-OPT: ${txn.original.descOpt.substring(0, 50)}...`);
    }
    console.log();
  }

  console.log('='.repeat(60));
  console.log('💡 Summary:');
  console.log(`   - Regex handled ${result.summary.autoApproved + result.summary.needsReview} transactions successfully`);
  console.log(`   - ${needsAI.length} transactions would benefit from AI`);
  console.log(`   - Estimated AI cost: ~${(needsAI.length * 0.0018).toFixed(2)} USD with Claude`);
  console.log('='.repeat(60));
  console.log();
  console.log('🚀 To use AI extraction:');
  console.log('   1. Get API key from https://console.anthropic.com/');
  console.log('   2. Set: export ANTHROPIC_API_KEY="your-key"');
  console.log('   3. Run: npx ts-node examples/santander-converter-example.ts');
}

quickTest().catch(console.error);
