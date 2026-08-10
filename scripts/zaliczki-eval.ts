/**
 * Accuracy harness for the "Podsumowanie zaliczek" extraction.
 *
 * Every change to this pipeline — a prompt edit, a cheaper model, a different
 * page resolution — is a bet on accuracy, and until now there was no way to
 * settle it except eyeballing a spreadsheet. This measures instead, using three
 * oracles that need no hand-labelling:
 *
 *   1. Arithmetic self-consistency. Each page prints both its component fees and
 *      its totals, so a misread digit is detectable from the page alone. This is
 *      the primary signal (see src/main/zaliczki/validator.ts).
 *   2. Coverage. Pages that yielded nothing, or a property with no address.
 *   3. An optional expected-values file, for exact per-field comparison.
 *
 * It runs against the real extractor, so the per-page cache applies: the first
 * run costs API calls, and re-runs over the same PDFs are free. That is what
 * makes it usable as a regression gate rather than a once-a-quarter exercise.
 *
 *   npx tsx scripts/zaliczki-eval.ts test-data/zaliczkisuewiec          # cached only
 *   npx tsx scripts/zaliczki-eval.ts test-data/zaliczkisuewiec --live   # allow API calls
 *   npx tsx scripts/zaliczki-eval.ts <dir> --live --model claude-haiku-4-5
 *   npx tsx scripts/zaliczki-eval.ts <dir> --expected fixtures/sluzewiec.json
 *   npx tsx scripts/zaliczki-eval.ts <dir> --json > report.json
 *
 * `--live` is required before anything is sent to the API. Without it the run
 * reports only what the cache already knows, so an accidental invocation can
 * never spend money.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  DEFAULT_ZALICZKI_MODEL,
  ExtractionResult,
  extractZaliczkiFromPdf,
  ZALICZKI_CATEGORIES,
  ZaliczkiCategory,
} from '../src/main/zaliczki/extractor';

interface Args {
  dir: string;
  live: boolean;
  model: string;
  expected?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (positional.length === 0) {
    console.error('Podaj katalog z PDF-ami, np. npx tsx scripts/zaliczki-eval.ts test-data/Wierzbno');
    process.exit(2);
  }
  return {
    dir: positional[0],
    live: flag('live'),
    model: value('model') ?? DEFAULT_ZALICZKI_MODEL,
    expected: value('expected'),
    json: flag('json'),
  };
}

/**
 * Read the API key the same way the app does, minus Supabase: `ai.anthropic_api_key`
 * in config/ai-config.yml, or ANTHROPIC_API_KEY. Only consulted with --live.
 *
 * The app's own key normally lives in the Supabase `app_config` row, which this
 * script deliberately does not reach into — pass the key explicitly to run live.
 */
function readApiKey(): string {
  const fromEnv = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;

  const configPath = path.join(process.cwd(), 'config', 'ai-config.yml');
  if (fs.existsSync(configPath)) {
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as
      | { ai?: { anthropic_api_key?: string } }
      | undefined;
    const key = (parsed?.ai?.anthropic_api_key ?? '').trim();
    if (key) return key;
  }
  return '';
}

type ExpectedFile = Record<string, Record<string, Partial<Record<ZaliczkiCategory, number | null>>>>;

interface FileReport {
  file: string;
  month: number | null;
  year: number | null;
  properties: number;
  pages: number;
  fromCache: number;
  escalated: number;
  failedPages: number;
  arithmeticErrors: number;
  notices: number;
  missingAddress: number;
  fieldsCompared: number;
  fieldMismatches: number;
  mismatchDetails: string[];
  error?: string;
}

function compareToExpected(
  result: ExtractionResult,
  expected: ExpectedFile,
): { compared: number; mismatches: number; details: string[] } {
  const forFile = expected[result.filename];
  if (!forFile) return { compared: 0, mismatches: 0, details: [] };

  let compared = 0;
  let mismatches = 0;
  const details: string[] = [];

  for (const [propertyName, want] of Object.entries(forFile)) {
    const got = result.properties.find((p) => p.property === propertyName);
    if (!got) {
      mismatches++;
      details.push(`${propertyName}: brak w wyniku`);
      continue;
    }
    for (const cat of ZALICZKI_CATEGORIES) {
      if (!(cat in want)) continue;
      const wantValue = want[cat] ?? null;
      const gotValue = got.values[cat] ?? null;
      compared++;
      const equal =
        wantValue === null || gotValue === null
          ? wantValue === gotValue
          : Math.abs(wantValue - gotValue) <= 0.02;
      if (!equal) {
        mismatches++;
        details.push(`${propertyName} ${cat}: oczekiwano ${wantValue}, odczytano ${gotValue}`);
      }
    }
  }
  return { compared, mismatches, details };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const pdfs = fs
    .readdirSync(args.dir)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((n) => path.join(args.dir, n));

  if (pdfs.length === 0) {
    console.error(`Brak plików PDF w ${args.dir}`);
    process.exit(2);
  }

  const apiKey = args.live ? readApiKey() : '';
  if (args.live && !apiKey) {
    console.error(
      'Brak klucza API. Ustaw ANTHROPIC_API_KEY=... albo ai.anthropic_api_key w config/ai-config.yml.\n' +
        '(Klucz używany przez aplikację leży w Supabase app_config — ten skrypt tam nie zagląda.)',
    );
    process.exit(2);
  }

  const expected: ExpectedFile = args.expected
    ? (JSON.parse(fs.readFileSync(args.expected, 'utf8')) as ExpectedFile)
    : {};

  if (!args.json) {
    console.log(`Model: ${args.model}`);
    console.log(`Plików: ${pdfs.length}   tryb: ${args.live ? 'LIVE (płatny)' : 'tylko cache'}`);
    if (!args.live) {
      console.log(
        'Bez --live nic nie zostanie wysłane do API; strony bez wpisu w cache zgłoszą błąd.',
      );
    }
    console.log('');
  }

  const reports: FileReport[] = [];

  for (const pdf of pdfs) {
    const name = path.basename(pdf);
    try {
      const result = await extractZaliczkiFromPdf(pdf, apiKey, args.model, {
        force: false,
        // Without --live the extractor is handed no client at all, so a page
        // missing from the cache is reported, never fetched.
        cacheOnly: !args.live,
      });
      const cmp = compareToExpected(result, expected);
      const report: FileReport = {
        file: name,
        month: result.month,
        year: result.year,
        properties: result.properties.length,
        pages: result.stats.pages,
        fromCache: result.stats.fromCache,
        escalated: result.stats.escalated,
        failedPages: result.stats.failed,
        // Counted over extracted properties only. Pages that never answered are
        // `failedPages`; folding them in here would make the accuracy ratio
        // meaningless (and negative when nothing was extracted at all).
        arithmeticErrors: result.warnings.filter(
          (w) => w.check === 'swiadczenia_sum' || w.check === 'empty_property',
        ).length,
        notices: result.warnings.filter((w) => w.severity === 'warning').length,
        missingAddress: result.properties.filter((p) => !p.property.trim()).length,
        fieldsCompared: cmp.compared,
        fieldMismatches: cmp.mismatches,
        mismatchDetails: cmp.details,
      };
      reports.push(report);
      if (!args.json) printFileLine(report, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reports.push({
        file: name,
        month: null,
        year: null,
        properties: 0,
        pages: 0,
        fromCache: 0,
        escalated: 0,
        failedPages: 0,
        arithmeticErrors: 0,
        notices: 0,
        missingAddress: 0,
        fieldsCompared: 0,
        fieldMismatches: 0,
        mismatchDetails: [],
        error: message,
      });
      if (!args.json) console.log(`✗ ${name}: ${message}`);
    }
  }

  const totals = reports.reduce(
    (acc, r) => ({
      properties: acc.properties + r.properties,
      pages: acc.pages + r.pages,
      fromCache: acc.fromCache + r.fromCache,
      escalated: acc.escalated + r.escalated,
      failedPages: acc.failedPages + r.failedPages,
      arithmeticErrors: acc.arithmeticErrors + r.arithmeticErrors,
      notices: acc.notices + r.notices,
      fieldsCompared: acc.fieldsCompared + r.fieldsCompared,
      fieldMismatches: acc.fieldMismatches + r.fieldMismatches,
      filesWithError: acc.filesWithError + (r.error ? 1 : 0),
    }),
    {
      properties: 0, pages: 0, fromCache: 0, escalated: 0, failedPages: 0,
      arithmeticErrors: 0, notices: 0, fieldsCompared: 0, fieldMismatches: 0,
      filesWithError: 0,
    },
  );

  if (args.json) {
    console.log(JSON.stringify({ model: args.model, totals, files: reports }, null, 2));
  } else {
    const checked = totals.properties;
    const clean = Math.max(0, checked - totals.arithmeticErrors);
    console.log('');
    console.log('──────────────────────────────────────────────');
    console.log(`Wspólnot odczytanych:        ${totals.properties}`);
    console.log(`Stron:                      ${totals.pages} (z cache: ${totals.fromCache})`);
    console.log(`Stron nieudanych:           ${totals.failedPages}`);
    console.log(`Ponowionych (eskalacja):    ${totals.escalated}`);
    console.log(
      checked > 0
        ? `Kontrola arytmetyczna:      ${clean}/${checked} wspólnot bez błędu ` +
            `(${((clean / checked) * 100).toFixed(1)}%)`
        : 'Kontrola arytmetyczna:      brak danych (nic nie odczytano)',
    );
    console.log(`Ostrzeżenia (noty globalne): ${totals.notices}`);
    if (totals.fieldsCompared > 0) {
      const ok = totals.fieldsCompared - totals.fieldMismatches;
      console.log(
        `Zgodność z oczekiwanymi:    ${ok}/${totals.fieldsCompared} pól ` +
          `(${((ok / totals.fieldsCompared) * 100).toFixed(2)}%)`,
      );
    }
    if (totals.filesWithError > 0) console.log(`Plików z błędem:            ${totals.filesWithError}`);
    console.log('──────────────────────────────────────────────');
  }

  // Non-zero exit on anything that would need a human, so this can gate a change.
  const bad =
    totals.arithmeticErrors > 0 || totals.failedPages > 0 || totals.fieldMismatches > 0 ||
    totals.filesWithError > 0;
  process.exit(bad ? 1 : 0);
}

function printFileLine(r: FileReport, result: ExtractionResult): void {
  const mark = r.arithmeticErrors > 0 || r.failedPages > 0 ? '✗' : r.notices > 0 ? '!' : '✓';
  const monthLabel = r.month ? `${String(r.month).padStart(2, '0')}/${r.year}` : '  ?  ';
  console.log(
    `${mark} ${r.file.padEnd(38)} ${monthLabel}  ` +
      `${String(r.properties).padStart(2)} wsp.  ` +
      `${r.fromCache}/${r.pages} cache  ` +
      `bledy=${r.arithmeticErrors} ostrz=${r.notices}` +
      (r.escalated ? `  ponowione=${r.escalated}` : '') +
      (r.fieldsCompared ? `  niezgodne=${r.fieldMismatches}/${r.fieldsCompared}` : ''),
  );
  // Page-failure noise is already summarised as `x/y cache`; only show the
  // findings a human would actually act on, capped so one bad file cannot bury
  // the rest of the report.
  const actionable = result.warnings.filter(
    (x) => x.severity === 'error' && x.check !== 'page_failed',
  );
  for (const w of actionable.slice(0, 5)) {
    console.log(`    └─ ${w.property}: ${w.message}`);
  }
  if (actionable.length > 5) {
    console.log(`    └─ …oraz ${actionable.length - 5} kolejnych`);
  }
  for (const d of r.mismatchDetails.slice(0, 5)) {
    console.log(`    └─ ${d}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
