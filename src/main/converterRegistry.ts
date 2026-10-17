import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { Converter, TransactionForReview, ConversionReviewData, CLARIFICATION_ACCOUNT, DEFAULT_ACCOUNT_CONFIG, DroppedStatementLine } from '../shared/types';
import { readFileWithEncoding, readStatementText, writeFileWin1250 } from '../shared/encoding';
import { isAccountSymbol, isLetteredApartment, needsExplicitAccount } from '../shared/apartment-account';
import type { BaseConverterConfig, BaseImportResult, BaseProcessedTransaction, ConversionProgressCallback, ConvertOptions } from '../shared/base-converter';
import { incomeGateConfidence } from '../shared/base-converter';
import { ExtractionCache } from '../shared/extraction-cache';
import { SantanderXmlConverter } from '../converters/santander-xml';
import { PKOBPMT940Converter } from '../converters/pko-mt940';
import { BnpXmlConverter } from '../converters/bnp-xml';
import { BosXmlConverter } from '../converters/bos-xml';
import { AliorConverter } from '../converters/alior';
import { PKOBiznesConverter } from '../converters/pko-biznes';
import { PKOSAConverter } from '../converters/pko-sa';
import { INGConverter } from '../converters/ing';
import { PocztowyConverter } from '../converters/pocztowy';
import { AIExtractor } from '../shared/ai-extractor';
import { ContractorMatcher } from '../shared/contractor-matcher';
import { MatchCache } from '../shared/match-cache';
import { matchExpensesWithAI } from '../shared/expense-ai-matcher';
import DatabaseService from './database';
import { conversionCache } from './conversionCache';
import { AppError } from '../shared/app-errors';

export interface ConvertResult {
  success: boolean;
  needsReview?: boolean;
  reviewData?: ConversionReviewData;
  outputPath?: string;
  fileName?: string;
  bankName?: string;
  converterId?: string;
  inputPath?: string;
  /** Community the conversion belonged to, echoed back so the history row keeps it. */
  adresId?: number | null;
  warningMessage?: string;
  error?: string;
}

// Database instance will be passed from main.ts
let dbInstance: DatabaseService | null = null;

export function setDatabaseInstance(db: DatabaseService) {
  dbInstance = db;
}

/**
 * Helper function to save accounting file to IMPEX folder if configured
 */
function saveToImpexFolder(accountingFilePath: string, csvOutput: string): void {
  if (!dbInstance) return;
  
  const impexFolder = dbInstance.getSetting('impexFolder');
  if (!impexFolder) return; // IMPEX folder not configured
  
  try {
    // Ensure IMPEX folder exists
    if (!fs.existsSync(impexFolder)) {
      fs.mkdirSync(impexFolder, { recursive: true });
    }
    
    // Get just the filename from the accounting file path
    const fileName = path.basename(accountingFilePath);
    
    // Write the file to IMPEX folder
    const impexFilePath = path.join(impexFolder, fileName);
    writeFileWin1250(impexFilePath, csvOutput);
    
    console.log(`✅ Saved accounting file to IMPEX folder: ${impexFilePath}`);
  } catch (error) {
    console.error('Error saving to IMPEX folder:', error);
    // Don't throw - IMPEX is optional, main file save is more important
  }
}

/**
 * Build the destination path for a generated file inside a dedicated subfolder
 * of the configured output folder. The subfolder (e.g. "podglad" / "accounting")
 * is created if it doesn't exist yet. The original extension is stripped and
 * replaced with the given suffix.
 */
function buildSubfolderPath(outputPath: string, subfolder: string, suffix: string): string {
  const targetDir = path.join(path.dirname(outputPath), subfolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const fileName = path.basename(outputPath).replace(/\.[^.]+$/, '') + suffix;
  return path.join(targetDir, fileName);
}

/** Destination path for the preview (podglad) file, inside the "podglad" subfolder. */
function podgladOutputPath(outputPath: string): string {
  return buildSubfolderPath(outputPath, 'podglad', '-podglad.txt');
}

/** Destination path for the accounting file, inside the "accounting" subfolder. */
function accountingOutputPath(outputPath: string): string {
  return buildSubfolderPath(outputPath, 'accounting', '-accounting.txt');
}

/**
 * A bank's converter as the registry drives it. Every bank goes through the
 * same analyze → convert → review → finalize path; this is all that differs.
 */
interface StatementConverter {
  convert(content: any, options?: ConvertOptions): Promise<BaseImportResult<any>>;
  exportToCsv(
    transactions: BaseProcessedTransaction<any>[],
    accountConfig?: { bankAccountSymbol?: string; apartmentPrefix?: string },
  ): string;
}

/** What the registry configures a converter with — never the local Ollama provider. */
type RegistryConverterConfig = Omit<Partial<BaseConverterConfig>, 'aiProvider'> & {
  aiProvider: 'none' | 'anthropic' | 'openai';
};

interface BankConversion {
  create(config: RegistryConverterConfig): StatementConverter;
  /** The statement as the converter takes it: text in the bank's encoding, or the file itself. */
  read(inputPath: string): string | Buffer;
  /** The bank's name when the caller gives none (review screen, pending conversion). */
  defaultBankName: string;
  /** The preview file's first line. */
  title: string;
  /** Prefix of the analysis log line. */
  logLabel: string;
  /** The preview's block with a transaction as the statement has it. */
  describe(trn: any): string;
  /** How the preview names the field a contractor was matched in. */
  matchedIn?: (matchedIn: string | undefined) => string;
  /**
   * The analysis matches against every community, not only the chosen one —
   * so its result may differ from the conversion's and is never reused for it
   * (see fileMemoKey).
   */
  analyzesAllAddresses?: true;
}

/** "Description", or the field the bank's contractor name sits in. */
const matchedInCounterpartyName = (matchedIn: string | undefined) =>
  matchedIn === 'desc-opt' ? 'Counterparty name' : 'Description';

/** The MT940 block of PKO BP, ING and Alior — the field after the name is the bank's own extra. */
function describeMt940(label: string, extra?: (trn: any) => string | undefined) {
  return (trn: any): string => {
    let out = `📄 ${label} DATA:\n`;
    out += `   Value Date:       ${trn.original.valueDate}\n`;
    out += `   Entry Date:       ${trn.original.entryDate}\n`;
    out += `   Transaction Type: ${trn.original.transactionType}\n`;
    out += `   Amount:           ${trn.original.amount} PLN\n`;
    out += `   Reference:        ${trn.original.reference}\n\n`;
    out += `   Description:\n`;
    out += `   ${trn.original.details.description.join(' ')}\n\n`;
    out += `   Counterparty:\n`;
    out += `   ${trn.original.details.counterpartyName}\n`;
    const more = extra?.(trn);
    if (more) out += `   ${more}\n`;
    out += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;
    return out;
  };
}

/** The camt block of BNP Paribas and BOŚ (BOŚ's report has no TX code or address). */
function describeCamt(label: string, withTxCodeAndAddress: boolean) {
  return (trn: any): string => {
    let out = `📄 ${label} DATA:\n`;
    out += `   Booking Date:     ${trn.original.bookingDate}\n`;
    out += `   Value Date:       ${trn.original.valueDate}\n`;
    out += `   Amount:           ${trn.original.amount} ${trn.original.currency}\n`;
    if (withTxCodeAndAddress) out += `   TX Code:          ${trn.original.txCode}\n`;
    out += `   Reference:        ${trn.original.instrId}\n\n`;
    out += `   Description:\n`;
    out += `   ${trn.original.description || '(empty)'}\n\n`;
    out += `   Counterparty:\n`;
    out += `   ${trn.original.counterpartyName || '(empty)'}\n`;
    if (withTxCodeAndAddress) out += `   ${trn.original.counterpartyAddress || '(empty)'}\n`;
    out += `   Account: ${trn.original.counterpartyAccount || '(empty)'}\n\n`;
    return out;
  };
}

const BANKS: Record<string, BankConversion> = {
  santander_xml: {
    create: (config) => new SantanderXmlConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath),
    defaultBankName: 'Santander',
    title: 'SANTANDER XML',
    logLabel: 'Santander',
    describe: (trn) => {
      let out = `📄 XML DATA:\n`;
      out += `   Transaction Code: ${trn.original.trnCode}\n`;
      out += `   Execution Date:   ${trn.original.exeDate}\n`;
      out += `   Creation Date:    ${trn.original.creatDate}\n`;
      out += `   Amount:           ${trn.original.value} PLN\n`;
      out += `   Account Value:    ${trn.original.accValue} PLN\n`;
      out += `   Real Value:       ${trn.original.realValue} PLN\n\n`;
      out += `   Description (base):\n`;
      out += `   ${trn.original.descBase}\n\n`;
      out += `   Description (optional):\n`;
      out += `   ${trn.original.descOpt || '(empty)'}\n\n`;
      return out;
    },
    matchedIn: (matchedIn) => (matchedIn === 'desc-opt' ? 'Description (optional)' : 'Description (base)'),
    analyzesAllAddresses: true,
  },
  pko_mt940: {
    create: (config) => new PKOBPMT940Converter(config),
    // A PKO BP ZIP of daily reports too.
    read: (inputPath) => readStatementText(inputPath),
    defaultBankName: 'PKO BP',
    title: 'PKO BP MT940',
    logLabel: 'PKO BP',
    describe: describeMt940('MT940'),
  },
  bnp_xml: {
    create: (config) => new BnpXmlConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath),
    defaultBankName: 'BNP Paribas',
    title: 'BNP PARIBAS XML',
    logLabel: 'BNP',
    describe: describeCamt('BNP', true),
  },
  alior: {
    create: (config) => new AliorConverter(config),
    // Alior MT940 is encoded in CP852 (DOS Latin-2), like ING. Auto-detection
    // mis-picks win1250 (it sees 0x80-0x9F bytes), corrupting Polish chars
    // (e.g. ń→ä, ł→�), so force cp852.
    read: (inputPath) => readFileWithEncoding(inputPath, 'cp852'),
    defaultBankName: 'Alior Bank',
    title: 'ALIOR BANK MT940',
    logLabel: 'Alior',
    describe: describeMt940('ALIOR', (trn) => trn.original.details.counterpartyAddress),
  },
  pko_biznes: {
    create: (config) => new PKOBiznesConverter(config),
    // A ZIP of ELIXIR files: the converter unpacks it.
    read: (inputPath) => fs.readFileSync(inputPath),
    defaultBankName: 'PKO Biznes',
    title: 'PKO BIZNES ELIXIR',
    logLabel: 'PKO Biznes',
    describe: (trn) => {
      let out = `📄 PKO BIZNES DATA:\n`;
      out += `   Date:             ${trn.original.date}\n`;
      out += `   Operation Type:   ${trn.original.operationType === '111' ? 'Credit (Income)' : 'Debit (Expense)'}\n`;
      out += `   Amount:           ${trn.original.amount} PLN\n`;
      out += `   Reference:        ${trn.original.referenceNumber}\n`;
      out += `   Source File:      ${trn.original.sourceFile}\n\n`;
      out += `   Description:\n`;
      out += `   ${trn.original.description}\n\n`;
      out += `   Counterparty:\n`;
      out += `   ${trn.original.counterpartyName}\n`;
      if (trn.original.counterpartyNameExtra) out += `   ${trn.original.counterpartyNameExtra}\n`;
      out += `   IBAN: ${trn.original.counterpartyIBAN}\n\n`;
      return out;
    },
  },
  pko_sa: {
    create: (config) => new PKOSAConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath),
    defaultBankName: 'PKO SA',
    title: 'PKO SA EXP',
    logLabel: 'PKO SA',
    describe: (trn) => {
      let out = `📄 PKO SA EXP DATA:\n`;
      out += `   Date:             ${trn.original.exeDate}\n`;
      out += `   Amount:           ${trn.original.value} PLN\n`;
      out += `   Transaction Code: ${trn.original.trnCode}\n`;
      out += `   Raw Data:\n`;
      out += `     Description:    ${trn.extracted.rawData.description}\n`;
      out += `     Counterparty:   ${trn.extracted.rawData.counterparty}\n`;
      out += `     Account:        ${trn.extracted.rawData.accountNumber}\n\n`;
      return out;
    },
    matchedIn: (matchedIn) => (matchedIn === 'desc-opt' ? 'Counterparty' : 'Description'),
  },
  ing: {
    create: (config) => new INGConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath, 'cp852'),
    defaultBankName: 'ING Bank',
    title: 'ING BANK MT940',
    logLabel: 'ING',
    describe: describeMt940('ING', (trn) => trn.original.details.additionalInfo),
  },
  bos_xml: {
    create: (config) => new BosXmlConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath),
    defaultBankName: 'BOŚ Bank',
    title: 'BOŚ BANK XML',
    logLabel: 'BOŚ',
    describe: describeCamt('BOŚ', false),
  },
  pocztowy: {
    create: (config) => new PocztowyConverter(config),
    read: (inputPath) => readFileWithEncoding(inputPath, 'win1250'),
    defaultBankName: 'Bank Pocztowy',
    title: 'BANK POCZTOWY MT940',
    logLabel: 'Pocztowy',
    describe: (trn) => {
      let out = `📄 POCZTOWY DATA:\n`;
      out += `   Value Date:       ${trn.original.valueDate}\n`;
      out += `   Entry Date:       ${trn.original.entryDate}\n`;
      out += `   Operation No.:    ${trn.original.ordinal}\n`;
      out += `   Amount:           ${trn.original.amount} PLN\n`;
      out += `   Bank Reference:   ${trn.original.reference}\n\n`;
      out += `   Description:\n`;
      out += `   ${trn.original.details.description.join('')}\n\n`;
      out += `   Counterparty:\n`;
      out += `   ${trn.original.details.counterpartyName}\n`;
      out += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;
      // Our own side of the transfer, as the payer/payee spelled it. Kept out
      // of the matching text on purpose — see PocztowyTransaction.
      out += `   Account Owner:\n`;
      out += `   ${trn.original.accountOwnerName}\n\n`;
      return out;
    },
  },
};

/** The bank's conversion, or the refusal every entry point gives for an unknown one. */
function bankOf(converterId: string): BankConversion {
  const bank = BANKS[converterId];
  if (!bank) throw new Error(`Unknown converter: ${converterId}`);
  return bank;
}

/**
 * The preview file of a conversion: a summary, then every income and every
 * expense with what the statement says and what was recognised. Written as is
 * when nothing needs review; otherwise kept with the pending conversion and
 * written after it (with the review summary appended).
 */
function conversionPreview(bank: BankConversion, result: BaseImportResult<any>, language: 'pl' | 'en'): string {
  const pl = language === 'pl';
  const incomeTransactions = result.processed.filter((t) => t.transactionType === 'income');
  const expenseTransactions = result.processed.filter((t) => t.transactionType === 'expense');
  const rule = '━'.repeat(72);
  const matchedIn = bank.matchedIn ?? matchedInCounterpartyName;

  let output = `=== ${bank.title} CONVERSION RESULTS ===\n\n`;
  output += `Summary:\n`;
  output += `- Total transactions: ${result.totalTransactions}\n`;
  output += `- Income transactions: ${incomeTransactions.length}\n`;
  output += `- Expense transactions: ${expenseTransactions.length}\n`;
  output += `- Auto-approved: ${result.summary.autoApproved}\n`;
  output += `- Needs review: ${result.summary.needsReview}\n`;
  output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
  output += `- Skipped: ${result.summary.skipped}\n`;
  output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

  // ========== INCOME SECTION ==========
  output += '='.repeat(80) + '\n';
  output += '=== WPŁATY (INCOME) ===\n';
  output += '='.repeat(80) + '\n\n';

  incomeTransactions.forEach((trn: any, idx) => {
    output += `${rule}\n#${idx + 1}\n${rule}\n\n`;
    output += bank.describe(trn);

    output += `🔍 ${pl ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
    output += `   ${pl ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (pl ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
    output += `   ${pl ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (pl ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
    output += `   ${pl ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
    output += `   ${pl ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
    output += `   ${pl ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

    output += `📊 ${pl ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
    output += `   ${pl ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
    output += `   ${pl ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
    output += `   ${pl ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
    output += `   ${pl ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
    output += `   ${pl ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
    output += `   Status:                ${trn.status}\n`;
    if (trn.extracted.warnings?.length) {
      output += `   ${pl ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
    }
    // The user's review is not in this file: nothing has been reviewed yet when
    // it is made, and the finalized conversion appends a review summary.

    if (trn.extracted.reasoning) {
      output += `\n   ${pl ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
      output += `   ${trn.extracted.reasoning}\n`;
    }
    output += `\n`;
  });

  // ========== EXPENSES SECTION ==========
  output += '='.repeat(80) + '\n';
  output += '=== WYDATKI (EXPENSES) ===\n';
  output += '='.repeat(80) + '\n\n';

  expenseTransactions.forEach((trn: any, idx) => {
    output += `${rule}\n#${idx + 1}\n${rule}\n\n`;
    output += bank.describe(trn);

    if (trn.matchedContractor) {
      output += `💼 MATCHED CONTRACTOR:\n`;
      if (trn.matchedContractor.contractor) {
        output += `   Contractor Name:       ${trn.matchedContractor.contractor.nazwa}\n`;
        output += `   Contractor Account:    ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
        output += `   Match Confidence:      ${trn.matchedContractor.confidence}%\n`;
        output += `   Matched In:            ${matchedIn(trn.matchedContractor.matchedIn)}\n`;
        if (trn.matchedContractor.contractor.nip) {
          output += `   NIP:                   ${trn.matchedContractor.contractor.nip}\n`;
        }
      } else {
        output += `   Status:                No contractor matched - needs manual assignment\n`;
      }
      output += `\n`;
    } else {
      output += `💼 CONTRACTOR:\n`;
      output += `   Status:                No contractor matched - needs manual assignment\n\n`;
    }

    output += `📊 STATUS:\n`;
    output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
    output += `   Status:                ${trn.status}\n`;
    if (trn.extracted.warnings?.length) {
      output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
    }
    output += `\n`;
  });

  return output;
}

interface AIConfig {
  ai: {
    anthropic_api_key: string;
    openai_api_key: string;
    default_provider: 'anthropic' | 'openai';
  };
}

/**
 * API keys are pasted by hand — into config/ai-config.yml or the Supabase
 * `app_config` row — so they arrive with the usual paste damage: surrounding
 * quotes, stray whitespace/newlines, or a doubled `sk-ant-` prefix when only
 * the `…` of a `sk-ant-…` placeholder gets overwritten. Every one of those
 * surfaces as an opaque 401 during a conversion, long after the paste, so
 * repair them at load time instead.
 */
export function normalizeApiKey(raw: string | undefined | null): string {
  let key = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  while (key.startsWith('sk-ant-sk-ant-')) key = key.slice('sk-ant-'.length);
  return key;
}

/** Safe-to-log key identity: never the secret itself. */
export function keyFingerprint(key: string): string {
  return key ? `…${key.slice(-4)} (${key.length} chars)` : '(none)';
}

class ConverterRegistry {
  private converters: Map<string, Converter> = new Map();
  private aiConfig: AIConfig | null = null;

  // Memo of the non-AI parse+match result per file, so the mandatory analyze pass
  // (analyzeWithoutAI, run to decide whether AI is needed) isn't repeated by the
  // subsequent non-AI convert of the same file. Keyed by file identity + mtime so
  // an edited file busts it. Read is one-shot (take) to avoid aliasing the shared
  // result object; TTL + a small cap bound memory.
  private nonAiResultMemo = new Map<string, { result: any; expires: number }>();
  private static readonly NONAI_MEMO_TTL_MS = 5 * 60 * 1000;
  private static readonly NONAI_MEMO_MAX = 20;

  constructor() {
    this.loadConverters();
    this.loadAIConfig();
  }

  /**
   * Build a memo key from file identity + mtime; null if the file can't be stat'd.
   * A bank whose analysis matches against every community (Santander,
   * `analyzesAllAddresses`) is excluded: its convert filters by adresId, so the
   * results can differ — reusing the memo there would change convert's output.
   *
   * The key also carries a fingerprint of the contractors and addresses the
   * result was matched against. Without it, "analyze, then add the missing
   * contractor (or an apartment rule), then convert" handed back the result from
   * before the change for up to five minutes.
   */
  private async fileMemoKey(converterId: string, inputPath: string, adresId?: number | null): Promise<string | null> {
    if (BANKS[converterId]?.analyzesAllAddresses) return null;
    try {
      const mtime = fs.statSync(inputPath).mtimeMs;
      const contractors = dbInstance ? await dbInstance.getAllKontrahenci() : [];
      const addresses = dbInstance ? await dbInstance.getAllAdresy() : [];
      const matchingData = JSON.stringify([
        contractors.map((k) => [k.id, k.nazwa, k.kontoKontrahenta, k.nip ?? '', k.alternativeNames ?? [], k.typy ?? []]),
        addresses.map((a) => [a.id, a.nazwa, a.alternativeNames ?? [], a.apartmentMappings ?? []]),
      ]);
      const fingerprint = crypto.createHash('sha1').update(matchingData).digest('hex').slice(0, 16);
      return `${converterId}|${inputPath}|${mtime}|${adresId ?? 'all'}|${fingerprint}`;
    } catch {
      return null;
    }
  }

  /**
   * The preview-file section listing statement lines the parser could not read,
   * or '' when there are none. Written into the preview so the record of what was
   * left out survives the review screen.
   */
  private droppedLinesSection(dropped: DroppedStatementLine[]): string {
    if (dropped.length === 0) return '';
    const reasons: Record<DroppedStatementLine['reason'], string> = {
      amount: 'nieczytelna kwota',
      structure: 'nierozpoznany układ linii',
      direction: 'nierozpoznany kierunek (uznanie/obciążenie)',
      date: 'nieczytelna data',
      error: 'błąd odczytu',
    };
    let section = '\n' + '='.repeat(80) + '\n';
    section += '=== ⚠️ LINIE WYCIĄGU POMINIĘTE PRZY ODCZYCIE (NIE MA ICH W PLIKU KSIĘGOWYM) ===\n';
    section += '='.repeat(80) + '\n\n';
    for (const d of dropped) {
      section += `- ${d.line ? `linia ${d.line}: ` : ''}${d.excerpt} — ${reasons[d.reason]}\n`;
    }
    return section + '\n';
  }

  /** Take (read + remove) a memoized non-AI result if present and unexpired. */
  private takeNonAiMemo(key: string | null): any | null {
    if (!key) return null;
    const entry = this.nonAiResultMemo.get(key);
    if (!entry) return null;
    this.nonAiResultMemo.delete(key);
    if (entry.expires < Date.now()) return null;
    return entry.result;
  }

  /** Store a non-AI result, evicting the oldest entry when over the cap. */
  private setNonAiMemo(key: string | null, result: any): void {
    if (!key) return;
    if (this.nonAiResultMemo.size >= ConverterRegistry.NONAI_MEMO_MAX) {
      const oldest = this.nonAiResultMemo.keys().next().value;
      if (oldest !== undefined) this.nonAiResultMemo.delete(oldest);
    }
    this.nonAiResultMemo.set(key, { result, expires: Date.now() + ConverterRegistry.NONAI_MEMO_TTL_MS });
  }

  /**
   * Run a non-AI converter, reusing/populating the per-file memo. Used by
   * analyzeWithoutAI (and reused by the non-AI convert path) so the same file
   * isn't parsed+matched twice within one analyze→convert cycle.
   */
  private async runNonAiMemoized<T>(key: string | null, run: () => Promise<T>): Promise<T> {
    const hit = this.takeNonAiMemo(key);
    if (hit) {
      // Re-store so a following convert of the same file can still reuse it.
      this.setNonAiMemo(key, hit);
      return hit as T;
    }
    const result = await run();
    this.setNonAiMemo(key, result);
    return result;
  }

  /**
   * Reuse a memoized non-AI result if present, else run `run()`. Generic so the
   * caller's `result` keeps its precise (non-`any`) converter result type.
   * Take semantics — the convert path consumes the memo once.
   */
  private async convertReusingMemo<T>(key: string | null, run: () => Promise<T>): Promise<T> {
    const hit = this.takeNonAiMemo(key);
    if (hit) return hit as T;
    return run();
  }

  private loadAIConfig() {
    try {
      // Priority 1: Try to load from bundled config file (works in both dev and production)
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'ai-config.yml');
      
      if (fs.existsSync(configPath)) {
        const fileContents = fs.readFileSync(configPath, 'utf8');
        const loaded = yaml.load(fileContents) as AIConfig;
        // A yml with only blank/placeholder keys must not shadow the cloud
        // config, so treat it as "no local override" rather than as a key.
        const anthropic = normalizeApiKey(loaded?.ai?.anthropic_api_key);
        const openai = normalizeApiKey(loaded?.ai?.openai_api_key);
        if (anthropic || openai) {
          this.aiConfig = {
            ai: {
              anthropic_api_key: anthropic,
              openai_api_key: openai,
              default_provider: loaded?.ai?.default_provider ?? (anthropic ? 'anthropic' : 'openai'),
            },
          };
          console.log(
            `[AI Config] Loaded from bundled config: ${configPath} ` +
              `(anthropic ${keyFingerprint(anthropic)})`
          );
          return;
        }
        console.log('[AI Config] Bundled config has no API keys — will use cloud config:', configPath);
      }

      // Priority 2: Try environment variables (useful for deployment)
      const anthropicKey = normalizeApiKey(process.env.ANTHROPIC_API_KEY);
      const openaiKey = normalizeApiKey(process.env.OPENAI_API_KEY);

      if (anthropicKey || openaiKey) {
        this.aiConfig = {
          ai: {
            anthropic_api_key: anthropicKey || '',
            openai_api_key: openaiKey || '',
            default_provider: anthropicKey ? 'anthropic' : 'openai',
          }
        };
        console.log('[AI Config] Loaded from environment variables');
        return;
      }
      
      console.warn('[AI Config] No configuration found. AI features will be disabled.');
      console.warn('[AI Config] To enable AI:');
      console.warn('[AI Config]   1. Add config/ai-config.yml with your API keys, or');
      console.warn('[AI Config]   2. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
    } catch (error) {
      console.error('[AI Config] Error loading configuration:', error);
      console.warn('[AI Config] AI features will be disabled');
    }
  }

  /**
   * The model picked in Settings, for the Anthropic provider only — a Claude id
   * would be meaningless to OpenAI, which keeps its own default.
   */
  private aiModelFor(provider: string): string | undefined {
    return provider === 'anthropic' ? dbInstance?.getAiModel() : undefined;
  }

  public getAnthropicApiKey(): string {
    return this.aiConfig?.ai?.anthropic_api_key || '';
  }

  /**
   * Inject the Anthropic key fetched from the shared Supabase `app_config`
   * table (authenticated-only read). Release binaries are public, so the key
   * is deliberately NOT bundled — the cloud is the production source. A key
   * from a local ai-config.yml / env (dev override) wins, except when the
   * caller has established it is rejected by the API (`replace`) — a revoked
   * dev key must not permanently shadow the working cloud one.
   */
  public setAnthropicApiKey(key: string, replace = false): void {
    const normalized = normalizeApiKey(key);
    if (!normalized) return;
    if (this.aiConfig?.ai?.anthropic_api_key && !replace) return;
    if (normalized !== key.trim()) {
      console.warn(
        '[AI Config] Stored Anthropic key was malformed (duplicated prefix or stray quotes) ' +
          '— repaired on load; fix the value in Supabase app_config.'
      );
    }
    this.aiConfig = {
      ai: {
        anthropic_api_key: normalized,
        openai_api_key: this.aiConfig?.ai?.openai_api_key ?? '',
        default_provider: 'anthropic',
      },
    };
    console.log(`[AI Config] Anthropic key set from cloud config ${keyFingerprint(normalized)}`);
  }

  private loadConverters() {
    try {
      // Use app.getAppPath() to get the root directory in both dev and production
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'converters.yml');
      
      console.log('[ConverterRegistry] Loading converters from:', configPath);
      
      if (!fs.existsSync(configPath)) {
        console.error('[ConverterRegistry] Config file not found:', configPath);
        throw new Error(`Converters config file not found at: ${configPath}`);
      }
      
      const fileContents = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContents) as { converters: Converter[] };

      if (!config || !config.converters || !Array.isArray(config.converters)) {
        console.error('[ConverterRegistry] Invalid config structure');
        throw new Error('Invalid converters config structure');
      }

      config.converters.forEach((converter) => {
        this.converters.set(converter.id, converter);
        console.log('[ConverterRegistry] Loaded converter:', converter.id, '-', converter.name);
      });
      
      console.log(`[ConverterRegistry] Successfully loaded ${this.converters.size} converters`);
    } catch (error) {
      console.error('[ConverterRegistry] Error loading converters config:', error);
      // Re-throw to make it visible that converters failed to load
      throw error;
    }
  }

  getAllConverters(): Converter[] {
    return Array.from(this.converters.values());
  }

  getConverter(id: string): Converter | undefined {
    return this.converters.get(id);
  }

  async analyzeWithoutAI(
    converterId: string,
    inputPath: string,
    confidenceThreshold: number = 90,
    adresId?: number | null
  ): Promise<{ totalTransactions: number; lowConfidenceCount: number; averageConfidence: number; needsAI: boolean }> {
    // Memo the parse+match result so the subsequent non-AI convert of this same
    // file reuses it instead of re-running the whole pipeline.
    const memoKey = await this.fileMemoKey(converterId, inputPath, adresId);
    const bank = bankOf(converterId);
    const contractors = (dbInstance ? await dbInstance.getAllKontrahenci() : []);
    // If adresId is provided, use only that address; otherwise use all addresses
    // (always all of them for a bank whose analysis says so — see fileMemoKey).
    let addresses = (dbInstance ? await dbInstance.getAllAdresy() : []);
    if (!bank.analyzesAllAddresses && adresId !== null && adresId !== undefined) {
      addresses = addresses.filter(a => a.id === adresId);
    }
    const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

    const converter = bank.create({
      aiProvider: 'none',
      apiKey: '',
      batchSize: 20,
      confidenceThresholds: { autoApprove: 85, needsReview: 70 },
      contractors,
      addresses,
      language,
    });

    const content = bank.read(inputPath);
    const result = await this.runNonAiMemoized(memoKey, () => converter.convert(content));

    // Count all transactions that will need AI (both income and expenses < 70%)
    const lowConfidenceTransactions = result.processed.filter(trn => {
      if (trn.transactionType === 'income') {
        return incomeGateConfidence(trn.extracted) < 70;
      } else {
        return (trn.matchedContractor?.confidence || 0) < 70;
      }
    });

    const incomeCount = result.processed.filter(t => t.transactionType === 'income' && incomeGateConfidence(t.extracted) < 70).length;
    const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
    console.log(`[${bank.logLabel}] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

    return {
      totalTransactions: result.processed.length,
      lowConfidenceCount: lowConfidenceTransactions.length,
      averageConfidence: result.statistics.averageConfidence,
      needsAI: lowConfidenceTransactions.length > 0, // Both income and expenses trigger AI
    };
  }

  /**
   * Extract transactions that need review: everything not auto-approved.
   */
  private extractReviewTransactions(
    transactions: any[], // ProcessedTransaction from either converter
    converterId: string
  ): TransactionForReview[] {
    const reviewTransactions: TransactionForReview[] = [];

    transactions.forEach((trn, index) => {
      // Include in review if:
      // 1. The row is not auto-approved. Only `confidence < 70` used to count, so
      //    a 70–84 "needs-review" row — an AI apartment guess averaged up by a
      //    confident address, a partial contractor-name match — was booked
      //    without anyone seeing it. The status already folds in the apartment
      //    gate (incomeGateConfidence) and every hold (storno, batch entry…), OR
      // 2. Income transaction without apartment number (regardless of confidence), OR
      // 3. Apartment number came from a user-defined mapping rule — always shown
      //    for confirmation ("assign, but show for acceptance"), OR
      // 4. Income transaction whose apartment carries a letter with no account
      //    symbol to book it to (17A). Checked independently of confidence because
      //    the AI can return such a number with a high score of its own, and the
      //    alternative to asking the user is booking onto the wrong apartment.
      // Expenses keep 10.1.0's gate — a contractor matched from 70 up is booked
      // unseen; whole-word matching and the minimum name length are what now keep
      // a stray "FR" out — unless the row is held. Incomes keep the status gate:
      // a payment booked to the wrong apartment is the costly mistake.
      const expenseConfident =
        trn.transactionType === 'expense' &&
        !trn.extracted.holdReason &&
        (trn.matchedContractor?.confidence || 0) >= 70;
      const needsReview = (trn.status !== 'auto-approved' && !expenseConfident)
        || (trn.transactionType === 'income' && !trn.extracted.apartmentNumber)
        || trn.extracted.matchedByManualMapping === true
        || (trn.transactionType === 'income' && this.needsAccountDecision(trn));
      
      if (needsReview) {
        reviewTransactions.push(this.toReviewTransaction(trn, index, converterId));
      }
    });

    return reviewTransactions;
  }

  /**
   * Apartment-account prefix handed to the review screen, so the "Konto lokalu"
   * field shows the same fixed part the exporters will use.
   */
  private apartmentPrefixOf(
    accountConfig?: { bankAccountSymbol: string; apartmentPrefix: string }
  ): string {
    return accountConfig?.apartmentPrefix || DEFAULT_ACCOUNT_CONFIG.apartmentPrefix;
  }

  /**
   * True when the recognized apartment cannot be turned into an account symbol on
   * its own, so only the user can say where the money goes.
   *
   * Re-derived from the transaction rather than trusting `extracted.needsAccount`:
   * that flag comes from the regex matcher, and a result produced by the AI or read
   * back from the extraction cache does not carry it. The AI can also return a
   * confident plain "17" for text that says "17A" — which is the original bug — so
   * the transaction text is re-read here as the evidence.
   */
  private needsAccountDecision(trn: any): boolean {
    const text = `${trn.normalized?.descBase ?? ''} ${trn.normalized?.descOpt ?? ''}`;
    return needsExplicitAccount(
      trn.extracted?.apartmentNumber,
      trn.extracted?.accountOverride,
      text,
    );
  }

  /**
   * Map one processed transaction onto the renderer-facing review row.
   * Shared with the on-demand expense re-match so a refreshed row is byte-for-byte
   * the same shape the review screen was originally handed.
   */
  private toReviewTransaction(
    trn: any,
    index: number,
    converterId: string
  ): TransactionForReview {
    // The same figure the review gate reads, so the card shows why it is here.
    const confidence = trn.transactionType === 'income'
      ? incomeGateConfidence(trn.extracted)
      : (trn.matchedContractor?.confidence || 0);

    // For Santander, use 'value' (transaction amount) not 'realValue' (account balance)
    // For other converters, 'realValue' is the absolute transaction amount
    const amount = converterId === 'santander_xml'
      ? Math.abs(trn.normalized.value)
      : trn.normalized.realValue;

    const review: TransactionForReview = {
      index,
      transactionType: trn.transactionType,
      original: {
        date: trn.normalized.exeDate,
        amount: amount,
        description: trn.normalized.descBase,
        counterparty: trn.normalized.descOpt,
      },
      extracted: {
        apartmentNumber: trn.extracted.apartmentNumber,
        fullAddress: trn.extracted.fullAddress,
        streetName: trn.extracted.streetName,
        buildingNumber: trn.extracted.buildingNumber,
        tenantName: trn.extracted.tenantName,
        confidence,
        reasoning: trn.extracted.reasoning,
        matchedByManualMapping: trn.extracted.matchedByManualMapping === true,
        accountOverride: trn.extracted.accountOverride ?? null,
        needsAccount: this.needsAccountDecision(trn),
        holdReason: trn.extracted.holdReason ?? null,
      },
    };

    // Add contractor info for expenses
    if (trn.transactionType === 'expense' && trn.matchedContractor) {
      review.matchedContractor = {
        contractorName: trn.matchedContractor.contractor?.nazwa || null,
        contractorAccount: trn.matchedContractor.contractor?.kontoKontrahenta || null,
        confidence: trn.matchedContractor.confidence,
      };
    }

    return review;
  }

  /**
   * Re-run AI contractor matching for selected expenses of a pending conversion,
   * on demand from the acceptance screen.
   *
   * The point of the feature is that the contractor set may have changed since
   * the conversion ran — the user just added the missing vendor — so the matcher
   * is rebuilt from the database on every call rather than reusing anything from
   * the original conversion. Rows the user already resolved are filtered out by
   * the caller; rows that already carry a contractor are skipped here as well,
   * so a stray second click can't overwrite a match.
   */
  async rerunExpenseAI(
    tempConversionId: string,
    indices: number[],
    onProgress?: (e: { completed: number; total: number; inFlight: number }) => void
  ): Promise<{ updated: TransactionForReview[]; matchedCount: number; processedCount: number }> {
    const cached = conversionCache.get(tempConversionId);
    if (!cached) {
      throw new Error('Conversion not found or expired. Please try again.');
    }

    const provider = this.aiConfig?.ai?.default_provider ?? 'none';
    const apiKey = provider === 'anthropic'
      ? this.aiConfig?.ai?.anthropic_api_key
      : this.aiConfig?.ai?.openai_api_key;
    if (!apiKey) {
      throw new AppError('aiNotConfiguredShort');
    }

    // Deduplicated: a repeated index would be sent to the AI twice and billed twice.
    const targets = Array.from(new Set(Array.isArray(indices) ? indices : []))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < cached.processedTransactions.length)
      .map((i) => ({ index: i, trn: cached.processedTransactions[i] }))
      .filter(({ trn }) => trn.transactionType === 'expense' && !trn.matchedContractor?.contractor);

    if (targets.length === 0) {
      return { updated: [], matchedCount: 0, processedCount: 0 };
    }

    const contractors = dbInstance ? await dbInstance.getAllKontrahenci() : [];
    if (contractors.length === 0) {
      throw new AppError('noKontrahenci');
    }

    const contractorMatcher = new ContractorMatcher(contractors);
    const aiExtractor = new AIExtractor({
      aiProvider: provider,
      model: this.aiModelFor(provider),
      apiKey,
      batchSize: 20,
      confidenceThresholds: { autoApprove: 85, needsReview: 70 },
      contractors,
      language: (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en',
    });
    const matchCache = new MatchCache(
      path.join(app.getPath('userData'), 'match-cache.json'),
      contractors
    );

    let total = 0;
    let completed = 0;
    let started = 0;
    const matches = await matchExpensesWithAI(
      targets.map(({ trn }) => trn.normalized),
      {
        aiExtractor,
        contractorMatcher,
        matchCache,
        onProgress: (event) => {
          if (event.type === 'planned') total = event.batches;
          else if (event.type === 'started') started += 1;
          else completed += 1;
          onProgress?.({ completed, total, inFlight: started - completed });
        },
      }
    );

    let matchedCount = 0;
    targets.forEach(({ index, trn }, i) => {
      const match = matches[i];
      if (match?.contractor) matchedCount++;

      trn.matchedContractor = match;
      trn.extracted = {
        ...trn.extracted,
        extractionMethod: 'ai',
        reasoning: match?.reasoning,
        warnings: match?.contractor ? [] : ['AI could not match contractor'],
      };
      // Mirror createProcessedTransaction's thresholds so the finalize-time
      // summary counts a re-matched row the same as one matched during conversion
      // — a held row (storno, batch entry) included: it stays held.
      const confidence = match?.confidence || 0;
      trn.status = confidence >= 85 && !trn.extracted?.holdReason
        ? 'auto-approved'
        : confidence >= 70
          ? 'needs-review'
          : 'needs-manual-input';
      cached.processedTransactions[index] = trn;
    });

    conversionCache.updateProcessedTransactions(tempConversionId, cached.processedTransactions);

    return {
      updated: targets.map(({ index }) =>
        this.toReviewTransaction(cached.processedTransactions[index], index, cached.converterId)
      ),
      matchedCount,
      processedCount: targets.length,
    };
  }

  /**
   * Apply user review decisions to transactions
   */
  private applyReviewDecisions(
    transactions: any[],
    decisions: import('../shared/types').ReviewDecision[],
    contractors: import('../shared/types').Kontrahent[]
  ): any[] {
    const updatedTransactions = [...transactions];
    
    decisions.forEach(decision => {
      const trn = updatedTransactions[decision.index];
      if (!trn) return;
      
      // Store original value for preview
      const originalApartmentNumber = trn.extracted.apartmentNumber;
      
      if (decision.action === 'accept') {
        // User accepts the extracted data as it is. A row without an apartment
        // stays unrecognized: the review screen offers no "Akceptuj" for one, and
        // the auto-accept of "skip approval" must not invent the number either —
        // it used to be pattern-matched out of the free-text address ("Plac Bem 5"
        // read as apartment 5). Only the user names an apartment that was not found.
        trn.reviewedByUser = {
          action: 'accept',
          originalValue: originalApartmentNumber,
        };
      } else if (decision.action === 'reject') {
        if (trn.transactionType === 'expense') {
          // An expense is booked by its contractor, so rejecting it must clear the
          // contractor — clearing the apartment fields only left the rejected
          // guess in place, and the accounting file booked it on the contractor's
          // account while the preview said "NIEROZPOZNANY".
          const originalContractorName = trn.matchedContractor?.contractor?.nazwa || null;
          const originalContractorAccount = trn.matchedContractor?.contractor?.kontoKontrahenta || null;
          trn.matchedContractor = { contractor: null, confidence: 0, matchedIn: 'none' };

          trn.reviewedByUser = {
            action: 'reject',
            originalContractorValue: {
              name: originalContractorName,
              account: originalContractorAccount
            }
          };
          return;
        }

        // Clear apartmentNumber - mark as unrecognized. The account override goes
        // with it: it belongs to the apartment that was just rejected, and left
        // behind it would still decide where the money lands.
        trn.extracted.apartmentNumber = null;
        trn.extracted.accountOverride = null;

        // Mark as reviewed by user
        trn.reviewedByUser = {
          action: 'reject',
          originalValue: originalApartmentNumber
        };
      } else if (decision.action === 'clarify') {
        // Assign to the special clarification account (235-1) so the record is
        // actually booked (not left unrecognized) in both preview and accounting files.
        if (trn.transactionType === 'income') {
          trn.extracted.apartmentNumber = CLARIFICATION_ACCOUNT;
          // "Wyjaśnij" replaces the destination outright, so any override from an
          // apartment rule must not keep pointing somewhere else, and the
          // lettered-apartment hold no longer applies — the user just decided.
          // The clarification account is itself the override: an account travels
          // as one (see needsExplicitAccount).
          trn.extracted.accountOverride = CLARIFICATION_ACCOUNT;
          trn.extracted.needsAccount = false;
          if (trn.extracted.confidence) {
            trn.extracted.confidence.overall = 100;
            trn.extracted.confidence.apartment = 100;
          }

          trn.reviewedByUser = {
            action: 'clarify',
            originalValue: originalApartmentNumber,
            manualValue: CLARIFICATION_ACCOUNT
          };
        } else {
          // Expense: book against a synthetic contractor whose account is 235-1,
          // so the existing exporters emit k_wn = 235-1, k_ma = 131-1.
          const originalContractorName = trn.matchedContractor?.contractor?.nazwa || null;
          const originalContractorAccount = trn.matchedContractor?.contractor?.kontoKontrahenta || null;

          trn.matchedContractor = {
            contractor: {
              id: -1,
              nazwa: `Konto wyjaśnień ${CLARIFICATION_ACCOUNT}`,
              kontoKontrahenta: CLARIFICATION_ACCOUNT,
              typy: ['Kontrahent'],
              createdAt: ''
            },
            confidence: 100,
            matchedIn: 'manual'
          };

          trn.reviewedByUser = {
            action: 'clarify',
            originalContractorValue: {
              name: originalContractorName,
              account: originalContractorAccount
            }
          };
        }
      } else if (decision.action === 'manual') {
        if (decision.manualRemainingIncomeId) {
          // Use user-selected "Pozostałe przychody" entry (for income)
          const selectedEntry = contractors.find(k => k.id === decision.manualRemainingIncomeId);
          if (selectedEntry) {
            // Set apartment number to the account of the remaining income entry.
            // The entry's own account is the destination now, and it travels as the
            // override: used only when it is a real account symbol, so an entry
            // typed as a bare "760" stays unrecognized instead of landing on
            // apartment 760 (204-000760).
            trn.extracted.apartmentNumber = selectedEntry.kontoKontrahenta;
            trn.extracted.accountOverride = selectedEntry.kontoKontrahenta;
            trn.extracted.needsAccount = false;
            trn.extracted.confidence.overall = 100;
            trn.extracted.confidence.apartment = 100;
            
            trn.reviewedByUser = {
              action: 'manual',
              originalValue: originalApartmentNumber,
              manualValue: selectedEntry.kontoKontrahenta,
              manualRemainingIncomeId: decision.manualRemainingIncomeId
            };
          }
        } else if (decision.manualApartmentAccount) {
          // User typed the account symbol directly ("Konto lokalu"). This is how a
          // lettered apartment gets booked: the number stays 17A for the record,
          // while the symbol the user gave decides where the money lands.
          const account = decision.manualApartmentAccount.trim();
          if (isAccountSymbol(account)) {
            // A pick from a multi-apartment rule sends both halves: the account
            // decides where the money goes, the number says which apartment that
            // was — and unlike a typed pair, these two come from one rule entry and
            // cannot contradict each other.
            const pickedNumber = decision.manualApartmentNumber?.trim();
            if (pickedNumber) trn.extracted.apartmentNumber = pickedNumber;
            trn.extracted.accountOverride = account;
            trn.extracted.needsAccount = false;
            trn.extracted.confidence.overall = 100;
            trn.extracted.confidence.apartment = 100;

            trn.reviewedByUser = {
              action: 'manual',
              originalValue: originalApartmentNumber,
              manualValue: pickedNumber ? `${pickedNumber} (${account})` : account
            };
          }
        } else if (decision.manualApartmentNumber) {
          // Use user-provided apartmentNumber (for income)
          const manual = decision.manualApartmentNumber.trim();
          // A bare lettered number is refused on purpose: it names the apartment
          // but not its account, and the app must not derive one. The review screen
          // blocks this too — this is the server-side half of the same rule.
          if (!isLetteredApartment(manual)) {
            trn.extracted.apartmentNumber = manual;
            trn.extracted.accountOverride = null;
            // The user typed this number, so the hold is answered.
            trn.extracted.needsAccount = false;
            // Boost confidence since user manually entered it
            trn.extracted.confidence.overall = 100;
            trn.extracted.confidence.apartment = 100;

            // Mark as reviewed by user
            trn.reviewedByUser = {
              action: 'manual',
              originalValue: originalApartmentNumber,
              manualValue: manual
            };
          }
        }
        
        if (decision.manualRemainingCostId && trn.matchedContractor) {
          // Use user-selected "Pozostałe koszty" entry (for expense)
          const selectedEntry = contractors.find(k => k.id === decision.manualRemainingCostId);
          if (selectedEntry) {
            trn.matchedContractor.contractor = selectedEntry;
            trn.matchedContractor.confidence = 100;
            trn.matchedContractor.matchedIn = 'manual' as any;
            
            trn.reviewedByUser = {
              ...trn.reviewedByUser,
              action: 'manual',
              originalContractorValue: {
                name: trn.matchedContractor.contractor?.nazwa || null,
                account: trn.matchedContractor.contractor?.kontoKontrahenta || null
              },
              manualRemainingCostId: decision.manualRemainingCostId
            };
          }
        } else if (decision.manualContractorId && trn.matchedContractor) {
          // Use user-selected contractor (for expense)
          const originalContractorName = trn.matchedContractor.contractor?.nazwa || null;
          const originalContractorAccount = trn.matchedContractor.contractor?.kontoKontrahenta || null;
          
          // Find the contractor by ID
          const selectedContractor = contractors.find(k => k.id === decision.manualContractorId);
          
          if (selectedContractor) {
            // Update matchedContractor with the manually selected one
            trn.matchedContractor.contractor = selectedContractor;
            trn.matchedContractor.confidence = 100; // Max confidence for manual selection
            trn.matchedContractor.matchedIn = 'manual' as any; // Mark as manually selected
            
            // Mark as reviewed by user
            trn.reviewedByUser = {
              ...trn.reviewedByUser,
              action: 'manual',
              originalContractorValue: {
                name: originalContractorName,
                account: originalContractorAccount
              },
              manualContractorId: decision.manualContractorId
            };
          }
        }
      }
    });
    
    return updatedTransactions;
  }

  async convert(
    converterId: string,
    inputPath: string,
    outputPath: string,
    useAI: boolean = false,
    adresId?: number | null,
    fileName?: string,
    bankName?: string,
    onProgress?: ConversionProgressCallback,
    accountConfig?: { bankAccountSymbol: string; apartmentPrefix: string },
    /** Aborted by "Anuluj": the converter stops and nothing is written. */
    signal?: AbortSignal
  ): Promise<ConvertResult> {
    // Persistent extraction cache lives in userData so it survives across runs.
    // Only used by AI-enabled conversions; non-AI flows don't write to it.
    const cachePath = useAI
      ? path.join(app.getPath('userData'), 'extraction-cache.json')
      : undefined;

    return new Promise(async (resolve, reject) => {
      try {
        // Reuse the non-AI result computed during analyzeWithoutAI for this file
        // (only valid for non-AI conversions; the AI path recomputes).
        const memoKey = useAI ? null : await this.fileMemoKey(converterId, inputPath, adresId);
        const bank = bankOf(converterId);
        let provider: 'none' | 'anthropic' | 'openai' = 'none';
        let apiKey = '';

        // Use AI if requested and config available
        if (useAI && this.aiConfig) {
          provider = this.aiConfig.ai.default_provider;
          apiKey = provider === 'anthropic'
            ? this.aiConfig.ai.anthropic_api_key
            : this.aiConfig.ai.openai_api_key;
        }

        const contractors = (dbInstance ? await dbInstance.getAllKontrahenci() : []);
        // If adresId is provided, use only that address; otherwise use all addresses
        let addresses = (dbInstance ? await dbInstance.getAllAdresy() : []);
        if (adresId !== null && adresId !== undefined) {
          addresses = addresses.filter(a => a.id === adresId);
        }
        const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

        const converter = bank.create({
          aiProvider: provider,
          model: this.aiModelFor(provider),
          apiKey,
          batchSize: 20,
          confidenceThresholds: { autoApprove: 85, needsReview: 70 },
          contractors,
          addresses,
          language,
          cachePath,
        });

        const content = bank.read(inputPath);
        const result = await this.convertReusingMemo(memoKey, () => converter.convert(content, { onProgress, signal }));

        let output = conversionPreview(bank, result, language);

        // Check if transactions need review
        const reviewTransactions = this.extractReviewTransactions(result.processed, converterId);

        // Lines the parser could not read force the review screen too: the
        // file must not be written before the user has seen them.
        const dropped = result.dropped ?? [];
        if (reviewTransactions.length > 0 || dropped.length > 0) {
          output += this.droppedLinesSection(dropped);

          // Store in cache and return review data
          const tempConversionId = conversionCache.store(
            fileName || path.basename(inputPath),
            bankName || bank.defaultBankName,
            converterId,
            inputPath,
            outputPath,
            result.processed,
            output,
            accountConfig,
            adresId ?? null
          );

          // Get address name from database
          let adresName: string | null = null;
          if (adresId !== null && adresId !== undefined) {
            const adres = (dbInstance ? await dbInstance.getAdresById(adresId) : undefined);
            adresName = adres?.nazwa || null;
          }

          console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

          const convertResult: ConvertResult = {
            success: true,
            needsReview: true,
            reviewData: {
              needsReview: true,
              tempConversionId,
              fileName: fileName || path.basename(inputPath),
              bankName: bankName || bank.defaultBankName,
              adresId: adresId || null,
              adresName,
              transactions: reviewTransactions,
              apartmentPrefix: this.apartmentPrefixOf(accountConfig),
              droppedLines: dropped,
            },
          };

          resolve(convertResult);
          return;
        }

        // No review needed - save files normally
        const podgladPath = podgladOutputPath(outputPath);
        fs.writeFileSync(podgladPath, output, 'utf8');

        // Generate TXT file for accounting system (tab-separated format)
        const csvOutput = converter.exportToCsv(result.processed, accountConfig);
        const txtPath = accountingOutputPath(outputPath);
        writeFileWin1250(txtPath, csvOutput);
        saveToImpexFolder(txtPath, csvOutput);

        console.log(`✅ Generated preview file: ${podgladPath}`);
        console.log(`✅ Generated accounting file: ${txtPath}`);

        resolve({ success: true });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Finalize conversion after user review
   */
  async finalizeConversion(
    tempConversionId: string,
    decisions: import('../shared/types').ReviewDecision[]
  ): Promise<ConvertResult> {
    try {
      // Retrieve cached conversion
      const cached = conversionCache.get(tempConversionId);
      
      if (!cached) {
        throw new Error('Conversion not found or expired. Please try again.');
      }
      
      // Load contractors and addresses from database (needed for manual selections and export)
      const kontrahenci = dbInstance ? await dbInstance.getAllKontrahenci() : [];
      const adresy = dbInstance ? await dbInstance.getAllAdresy() : [];
      
      // Apply user decisions to transactions
      const updatedTransactions = this.applyReviewDecisions(cached.processedTransactions, decisions, kontrahenci);

      // Forget the cached answers the user overruled, so next month's statement
      // asks again instead of serving the same wrong apartment or contractor.
      this.forgetOverruledAnswers(updatedTransactions, decisions);
      
      // Now generate files with updated transactions
      const converter = bankOf(cached.converterId).create({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors: kontrahenci,
        addresses: adresy,
      });
      
      // Generate accounting file (using the account type chosen at conversion time)
      const csvOutput = converter.exportToCsv(updatedTransactions, cached.accountConfig);
      const txtPath = accountingOutputPath(cached.outputPath);
      writeFileWin1250(txtPath, csvOutput);
      saveToImpexFolder(txtPath, csvOutput);

      // Generate updated preview file with user review information
      const podgladPath = podgladOutputPath(cached.outputPath);
      
      // Start with cached preview and add user review summary
      let newPreviewOutput = cached.previewOutput;
      
      // Add user review summary at the end
      const reviewedTransactions = updatedTransactions.filter((t: any) => t.reviewedByUser);
      
      if (reviewedTransactions.length > 0) {
        newPreviewOutput += `\n\n`;
        newPreviewOutput += '='.repeat(80) + '\n';
        newPreviewOutput += '=== 👤 USER REVIEW SUMMARY ===\n';
        newPreviewOutput += '='.repeat(80) + '\n\n';
        
        // Separate into income and expenses
        const reviewedIncome = reviewedTransactions.filter((t: any) => t.transactionType === 'income');
        const reviewedExpenses = reviewedTransactions.filter((t: any) => t.transactionType === 'expense');
        
        newPreviewOutput += `Całkowita liczba przejrzanych transakcji: ${reviewedTransactions.length}\n`;
        newPreviewOutput += `  Wpłaty: ${reviewedIncome.length}\n`;
        newPreviewOutput += `  Wydatki: ${reviewedExpenses.length}\n\n`;
        
        // ========== INCOME SECTION ==========
        if (reviewedIncome.length > 0) {
          newPreviewOutput += '─'.repeat(80) + '\n';
          newPreviewOutput += '💰 WPŁATY (INCOME)\n';
          newPreviewOutput += '─'.repeat(80) + '\n\n';
          
          reviewedIncome.forEach((trn: any) => {
            const transactionIndex = updatedTransactions.indexOf(trn) + 1;
            newPreviewOutput += `Pozycja #${transactionIndex}:\n`;
            
            if (trn.reviewedByUser.action === 'accept') {
              newPreviewOutput += `  ✅ ZAAKCEPTOWANO\n`;
              if (trn.reviewedByUser.extractedFrom) {
                newPreviewOutput += `     Wyekstrahowano z: ${trn.reviewedByUser.extractedFrom}\n`;
              }
              newPreviewOutput += `     Numer mieszkania: ${trn.extracted.apartmentNumber}\n`;
            } else if (trn.reviewedByUser.action === 'reject') {
              newPreviewOutput += `  ❌ ODRZUCONO - NIEROZPOZNANE\n`;
              if (trn.reviewedByUser.originalValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalValue}\n`;
              }
              newPreviewOutput += `     Finalna wartość: NIEROZPOZNANE\n`;
            } else if (trn.reviewedByUser.action === 'clarify') {
              newPreviewOutput += `  🔍 DO WYJAŚNIENIA (konto ${CLARIFICATION_ACCOUNT})\n`;
              if (trn.reviewedByUser.originalValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalValue}\n`;
              }
              newPreviewOutput += `     Finalna wartość: ${trn.extracted.apartmentNumber}\n`;
            } else if (trn.reviewedByUser.action === 'manual') {
              newPreviewOutput += `  ✏️  WPISANO RĘCZNIE\n`;
              if (trn.reviewedByUser.originalValue !== undefined) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalValue || 'NIE ZNALEZIONO'}\n`;
              }
              newPreviewOutput += `     Ręcznie wpisano: ${trn.reviewedByUser.manualValue}\n`;
              newPreviewOutput += `     Finalna wartość: ${trn.extracted.apartmentNumber}\n`;
            }
            
            newPreviewOutput += `\n`;
          });
        }
        
        // ========== EXPENSES SECTION ==========
        if (reviewedExpenses.length > 0) {
          newPreviewOutput += '─'.repeat(80) + '\n';
          newPreviewOutput += '💸 WYDATKI (EXPENSES)\n';
          newPreviewOutput += '─'.repeat(80) + '\n\n';
          
          reviewedExpenses.forEach((trn: any) => {
            const transactionIndex = updatedTransactions.indexOf(trn) + 1;
            newPreviewOutput += `Pozycja #${transactionIndex}:\n`;
            
            if (trn.reviewedByUser.action === 'accept') {
              newPreviewOutput += `  ✅ ZAAKCEPTOWANO\n`;
              if (trn.matchedContractor?.contractor) {
                newPreviewOutput += `     Kontrahent: ${trn.matchedContractor.contractor.nazwa}\n`;
                newPreviewOutput += `     Konto: ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
              }
            } else if (trn.reviewedByUser.action === 'reject') {
              newPreviewOutput += `  ❌ ODRZUCONO - NIEROZPOZNANY KONTRAHENT\n`;
              if (trn.reviewedByUser.originalContractorValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalContractorValue.name || 'NIE ZNALEZIONO'}\n`;
              }
              newPreviewOutput += `     Finalna wartość: NIEROZPOZNANY\n`;
            } else if (trn.reviewedByUser.action === 'clarify') {
              newPreviewOutput += `  🔍 DO WYJAŚNIENIA (konto ${CLARIFICATION_ACCOUNT})\n`;
              if (trn.reviewedByUser.originalContractorValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalContractorValue.name || 'NIE ZNALEZIONO'}\n`;
              }
              if (trn.matchedContractor?.contractor) {
                newPreviewOutput += `     Konto kontrahenta: ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
              }
            } else if (trn.reviewedByUser.action === 'manual') {
              newPreviewOutput += `  ✏️  WYBRANO RĘCZNIE\n`;
              if (trn.reviewedByUser.originalContractorValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalContractorValue.name || 'NIE ZNALEZIONO'}\n`;
              }
              
              // Show the manually selected contractor
              if (trn.reviewedByUser.manualContractorId && trn.matchedContractor?.contractor) {
                newPreviewOutput += `     Ręcznie wybrano: ${trn.matchedContractor.contractor.nazwa}\n`;
                newPreviewOutput += `     Konto kontrahenta: ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
                newPreviewOutput += `     NIP: ${trn.matchedContractor.contractor.nip || 'N/A'}\n`;
              }
            }
            
            newPreviewOutput += `\n`;
          });
        }
      }
      
      fs.writeFileSync(podgladPath, newPreviewOutput, 'utf8');
      
      console.log(`✅ Generated preview file with user review info: ${podgladPath}`);
      console.log(`✅ Generated accounting file: ${txtPath}`);
      
      // Clean up cache
      conversionCache.remove(tempConversionId);
      
      return { 
        success: true, 
        outputPath: cached.outputPath,
        fileName: cached.fileName,
        bankName: cached.bankName,
        converterId: cached.converterId,
        inputPath: cached.inputPath,
        adresId: cached.adresId ?? null,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Drop the extraction-cache entry (income) or match-cache entry (expense) of
   * every row the user did not simply accept — rejected, sent to clarification,
   * or resolved by hand. Those caches answer before the matcher next time; a
   * corrected answer left in them would come back with the next statement.
   * Best-effort: a cache that cannot be written must not fail the finalize.
   */
  private forgetOverruledAnswers(
    transactions: any[],
    decisions: import('../shared/types').ReviewDecision[]
  ): void {
    const overruled = decisions
      .filter((d) => d.action !== 'accept')
      .map((d) => transactions[d.index])
      .filter((trn) => trn?.normalized);
    if (overruled.length === 0) return;

    try {
      const userData = app.getPath('userData');
      const extractionCache = new ExtractionCache(path.join(userData, 'extraction-cache.json'));
      // Opened without the contractor list: it only deletes, and must not judge
      // (or drop) the entries it was not asked about.
      const matchCache = new MatchCache(path.join(userData, 'match-cache.json'));
      let removed = 0;
      for (const trn of overruled) {
        const { descBase, descOpt } = trn.normalized;
        if (trn.transactionType === 'income') removed += extractionCache.delete(descBase, descOpt);
        else if (matchCache.delete(descBase, descOpt)) removed++;
      }
      extractionCache.flush();
      matchCache.flush();
      if (removed > 0) console.log(`🧹 Removed ${removed} cached answer(s) the user overruled`);
    } catch (error) {
      console.warn('Could not update the AI caches after review:', error);
    }
  }

  /**
   * Check if AI is configured and ready to use
   */
  isAIConfigured(): boolean {
    if (!this.aiConfig || !this.aiConfig.ai) {
      return false;
    }
    
    const provider = this.aiConfig.ai.default_provider;
    if (provider === 'anthropic') {
      return !!this.aiConfig.ai.anthropic_api_key && this.aiConfig.ai.anthropic_api_key.length > 0;
    } else if (provider === 'openai') {
      return !!this.aiConfig.ai.openai_api_key && this.aiConfig.ai.openai_api_key.length > 0;
    }
    
    return false;
  }
}

export default ConverterRegistry;
