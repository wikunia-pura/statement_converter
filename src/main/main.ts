import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import DatabaseService from './database';
import ConverterRegistry, { setDatabaseInstance } from './converterRegistry';
import {
  IPC_CHANNELS,
  KontrahentTyp,
  DEFAULT_ACCOUNT_CONFIG,
  AccountConfig,
  countBackup,
  MailingSzablon,
  MailingSmtpConfig,
} from '../shared/types';
import { runAutoBackup, getBackupStatus, getBackupsDir, validateBackup } from './backupService';
import { conversionCache } from './conversionCache';
import * as authService from './authService';
import { extractPdfText } from '../shared/pdf-utils';
import { extractAccountNumbersFromFile } from '../shared/account-extractor-node';
import {
  DEFAULT_ZALICZKI_MODEL,
  ZALICZKI_MODELS,
  extractZaliczkiFromPdf,
} from './zaliczki/extractor';
import { cacheStats, clearCache } from './zaliczki/extractionCache';
import { buildWorkbookFromEdited, EditedFile } from './zaliczki/excelWriter';
import { extractNotaFromPdf } from './notySwiadczenia/extractor';
import { buildNotaWorkbook } from './notySwiadczenia/excelWriter';
import {
  analyzeFile as scalanieAnalyzeFile,
  mergeFiles as scalanieMergeFiles,
  MergeFileInput as ScalanieMergeFileInput,
} from './scalanieWplat/merger';
import {
  analyzeFile as homebankingAnalyzeFile,
  mergeGroups as homebankingMergeGroups,
  MergeFileInput as HomebankingMergeFileInput,
} from './homebanking/merger';
import { parseOdczytyFile, OdczytReading, OdczytySkipped } from './odczyty/parser';
import { writeOdczytyFiles, OdczytyOutputFile } from './odczyty/writer';
import {
  sendMailing,
  MailingSendRequest,
  getMailingFilesInfo,
  cleanupMailingFiles,
} from './mailing/service';
import { verifySmtp } from './mailing/sender';

// Log environment variable for testing
log.debug('[MAIN] TEST_AI_BILLING_ERROR =', process.env.TEST_AI_BILLING_ERROR);
log.debug('[MAIN] TEST_AI_GENERIC_ERROR =', process.env.TEST_AI_GENERIC_ERROR);

const DEV_SERVER_PORT = 3000;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

let mainWindow: BrowserWindow | null = null;
let database: DatabaseService;
let converterRegistry: ConverterRegistry;

/**
 * Check if error is a billing/quota error that should stop processing
 */
function isBillingError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  
  // Check for our custom billing error message
  if (errorMessage.includes('💸') || errorMessage.includes('Brak kasiory')) {
    return true;
  }
  
  // Check for quota/billing keywords
  if (errorMessage.toLowerCase().includes('quota') || 
      errorMessage.toLowerCase().includes('billing') ||
      errorMessage.toLowerCase().includes('payment required')) {
    return true;
  }
  
  // Check for API error status codes
  if (error.status === 402 || error.status === 429) return true;
  
  return false;
}

/**
 * Authentication failures (bad/revoked/malformed API key) are a configuration
 * problem, not a hiccup — they deserve their own message so nobody has to read
 * the log to learn that AI is off because the key is wrong.
 */
function isAuthError(error: any): boolean {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;
  const message = (error.message || '').toLowerCase();
  return (
    message.includes('authentication_error') ||
    message.includes('invalid x-api-key') ||
    message.includes('api key is invalid') ||
    message.includes('(401)') ||
    message.includes('(403)')
  );
}

const AI_FALLBACK_MESSAGE = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
const AI_AUTH_FALLBACK_MESSAGE =
  'Klucz API do AI jest nieprawidłowy lub wygasł — AI niedostępne. ' +
  'Przeprowadzono standardową konwersję.';

/**
 * Extract error message from any error type (Error instance, object with message, etc.)
 */
function getErrorMessage(error: any): string {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  return 'Unknown error';
}

/**
 * Generate timestamp string in format YYYYMMDD_HHMMSS
 */
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Sanitize address name for use in filename
 * Removes or replaces characters that are invalid in filenames
 */
function sanitizeForFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .replace(/^_|_$/g, '')         // Remove leading/trailing underscores
    .substring(0, 50);             // Limit length
}

/**
 * Generate output filename with address and timestamp
 * Format: {address}_{timestamp}.txt
 * Example: Aleja_Lotnikow_20_20260227_143025.txt
 */
async function generateOutputFileName(
  adresId: number | null | undefined,
  db: DatabaseService,
): Promise<string> {
  const timestamp = generateTimestamp();

  let addressPart = 'wyciag';
  if (adresId !== null && adresId !== undefined) {
    const adres = await db.getAdresById(adresId);
    if (adres) {
      addressPart = sanitizeForFilename(adres.nazwa);
    }
  } else {
    const allAddresses = await db.getAllAdresy();
    if (allAddresses.length > 0) {
      addressPart = sanitizeForFilename(allAddresses[0].nazwa);
    }
  }

  return `${addressPart}_${timestamp}.txt`;
}

/**
 * Resolve the accounting symbols for a conversion from the chosen KontoTyp id.
 * Falls back to the configured default type, then to the historical 131-1 / 204
 * behavior when no types exist.
 */
async function resolveAccountConfig(
  accountTypeId: number | null | undefined,
  db: DatabaseService,
): Promise<AccountConfig> {
  try {
    const types = await db.getKontoTypy();
    const chosen =
      (accountTypeId != null ? types.find(t => t.id === accountTypeId) : undefined) ||
      types.find(t => t.isDefault) ||
      types[0];
    if (chosen) {
      return {
        bankAccountSymbol: chosen.bankAccountSymbol || DEFAULT_ACCOUNT_CONFIG.bankAccountSymbol,
        apartmentPrefix: chosen.apartmentPrefix || DEFAULT_ACCOUNT_CONFIG.apartmentPrefix,
      };
    }
  } catch (e) {
    log.warn(`[CONVERT] resolveAccountConfig failed, using default: ${e}`);
  }
  return DEFAULT_ACCOUNT_CONFIG;
}

// Exit-time backup. Closing the window (or quitting) is intercepted exactly
// once: today's auto backup is refreshed with everything changed during the
// session, an in-app toast is shown while the window is still visible, and
// only then does the close/quit proceed. `backupOnExitDone` guards re-entry
// and lets the auto-updater's quit skip the whole dance.
let backupOnExitDone = false;

function runExitBackup(resume: () => void) {
  if (backupOnExitDone || !database) {
    backupOnExitDone = true;
    resume();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    backupOnExitDone = true;
    resume();
  };
  // Never block closing for long — if Supabase is slow/offline, give up.
  const failsafe = setTimeout(finish, 15000);

  runAutoBackup(database, { force: true })
    .then(info => {
      if (info && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup:auto-created', { ...info, trigger: 'quit' });
        // Keep the window up long enough for the toast to be seen.
        return new Promise<void>(resolve => setTimeout(resolve, 2500));
      }
    })
    .finally(() => {
      clearTimeout(failsafe);
      finish();
    });
}

function createWindow() {
  // A fresh window starts a fresh session — its close deserves its own backup.
  backupOnExitDone = false;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (event) => {
    // Intercept the X button too — on the app-quit path before-quit fires only
    // after the window is gone, too late for an in-app notification.
    if (backupOnExitDone) return;
    event.preventDefault();
    runExitBackup(() => mainWindow?.close());
  });

  // Load from dev server in development, from local files in production
  if (app.isPackaged) {
    // Production: load from local files
    // __dirname is dist/main/main, so we need to go up two levels
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  } else {
    // Development: load from Vite dev server
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
  // Database - Banks
  ipcMain.handle(IPC_CHANNELS.GET_BANKS, async () => {
    return await database.getAllBanks();
  });

  ipcMain.handle(
    IPC_CHANNELS.ADD_BANK,
    async (_, name: string, converterId: string, accountPrefixes?: string[]) => {
      return await database.addBank(name, converterId, accountPrefixes);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_BANK,
    async (_, id: number, name: string, converterId: string, accountPrefixes?: string[]) => {
      await database.updateBank(id, name, converterId, accountPrefixes);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.DELETE_BANK, async (_, id: number) => {
    await database.deleteBank(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ALL_BANKS, async () => {
    await database.deleteAllBanks();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_BANKS_TO_FILE, async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Banki',
        defaultPath: 'banki.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const banks = await database.getAllBanks();
      fs.writeFileSync(result.filePath, JSON.stringify(banks, null, 2), 'utf-8');
      return { success: true, count: banks.length, filePath: result.filePath };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_BANKS_FROM_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import Banki',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return { success: false, error: 'Nieprawidłowy format pliku' };
      }

      const banks = parsed.map((b: any, idx: number) => ({
        id: typeof b.id === 'number' ? b.id : idx + 1,
        name: String(b.name || ''),
        converterId: String(b.converterId || ''),
        accountPrefixes: Array.isArray(b.accountPrefixes) ? b.accountPrefixes : [],
        createdAt: b.createdAt || new Date().toISOString(),
      }));

      const { added, updated } = await database.importBanks(banks);
      return { success: true, count: banks.length, added, updated };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  // Database - Kontrahenci
  ipcMain.handle(IPC_CHANNELS.GET_KONTRAHENCI, async () => {
    return await database.getAllKontrahenci();
  });

  ipcMain.handle(IPC_CHANNELS.ADD_KONTRAHENT, async (_, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: string[]) => {
    return await database.addKontrahent(nazwa, kontoKontrahenta, nip, alternativeNames, typy as any);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_KONTRAHENT, async (_, id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: string[]) => {
    await database.updateKontrahent(id, nazwa, kontoKontrahenta, nip, alternativeNames, typy as any);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_KONTRAHENT, async (_, id: number) => {
    await database.deleteKontrahent(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ALL_KONTRAHENCI, async () => {
    await database.deleteAllKontrahenci();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
          { name: 'Plan kont', extensions: ['txt', 'pdf'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const filePath = result.filePaths[0];
      const content = filePath.toLowerCase().endsWith('.pdf')
        ? (await extractPdfText(filePath)).text
        : fs.readFileSync(filePath, 'utf-8');

      // Snapshot existing kontrahenci once — avoid an O(n²) round-trip per line on large Plan kont files.
      const bySymbol = new Map<string, any>();
      for (const k of await database.getAllKontrahenci()) {
        bySymbol.set(k.kontoKontrahenta, k);
      }

      // Parse the file
      const lines = content.split('\n');
      let added = 0;
      let updated = 0;
      let lastKontrahent: any = null;
      let wasNewlyAdded = false; // Track if lastKontrahent was just added
      let lastParsedNazwa: string | null = null; // Nazwa as written in the file (may rename an existing entry)
      let accumulatedNip: string | undefined = undefined;
      let accumulatedAltNames: string[] = [];
      let accumulatedTypy: KontrahentTyp[] = [];

      const finalizeLastKontrahent = async () => {
        if (!lastKontrahent) return;
        // A changed nazwa alone (same symbol, no NIP/ALT/TYP lines) must also be saved.
        const renamed = lastParsedNazwa !== null && lastParsedNazwa !== lastKontrahent.nazwa;
        if (accumulatedNip || accumulatedAltNames.length > 0 || accumulatedTypy.length > 0 || renamed) {
          const nazwa = lastParsedNazwa ?? lastKontrahent.nazwa;
          await database.updateKontrahent(
            lastKontrahent.id,
            nazwa,
            lastKontrahent.kontoKontrahenta,
            accumulatedNip,
            accumulatedAltNames,
            accumulatedTypy.length > 0 ? accumulatedTypy : undefined
          );
          lastKontrahent.nazwa = nazwa;
          if (accumulatedNip) lastKontrahent.nip = accumulatedNip;
          if (accumulatedAltNames.length > 0) lastKontrahent.alternativeNames = accumulatedAltNames;
          if (accumulatedTypy.length > 0) lastKontrahent.typy = accumulatedTypy;

          // Count as updated only if it wasn't just added (to avoid double counting)
          if (!wasNewlyAdded) {
            updated++;
          }
        }
      };
      
      for (const line of lines) {
        // Skip header lines and empty lines
        if (line.trim().length === 0 || line.includes('Plan kont') || line.includes('---') || line.includes('Symbol')) {
          continue;
        }
        
        // Skip page separator lines
        if (line.includes('JOLANTA GONTAREK') || line.includes('Strona') || line.includes('©vDom')) {
          continue;
        }
        
        // Check if it's a NIP line (including empty ones)
        const nipMatch = line.match(/^\s*NIP:\s*(.*)$/);
        if (nipMatch && lastKontrahent) {
          const nip = nipMatch[1].trim();
          // Set to value if non-empty, or undefined to clear if empty
          accumulatedNip = nip.length > 0 ? nip : undefined;
          continue;
        }
        
        // Check if it's an alternative names line
        const altMatch = line.match(/^\s*ALT:\s*(.+)$/);
        if (altMatch && lastKontrahent) {
          // Parse alternative names - they can be comma-separated in one line
          const altNamesRaw = altMatch[1].trim();
          if (altNamesRaw.length > 0) {
            // Split by comma and trim each name
            const names = altNamesRaw.split(',').map(n => n.trim()).filter(n => n.length > 0);
            accumulatedAltNames.push(...names);
          }
          continue;
        }
        
        // Check if it's a TYP line (may list several comma-separated roles)
        const typMatch = line.match(/^\s*TYP:\s*(.+)$/);
        if (typMatch && lastKontrahent) {
          const validTypy = typMatch[1]
            .split(',')
            .map(s => s.trim())
            .filter((v): v is KontrahentTyp =>
              v === 'Kontrahent' || v === 'Pozostałe przychody' || v === 'Pozostałe koszty');
          if (validTypy.length > 0) {
            accumulatedTypy = validTypy;
          }
          continue;
        }
        
        // Parse data line - Symbol and Nazwa are separated by spaces
        // Symbol is in format like "201-00001" and Nazwa follows, then multiple spaces before Z/N column
        // Example: "       201-00001    Miasto Stołeczne Warszawa                 Z   1   S"
        const match = line.match(/^\s*(\d{3}-\d+)\s+(.+?)\s{2,}[ZN]\s+/);
        if (match) {
          // Finalize previous kontrahent with accumulated data
          await finalizeLastKontrahent();
          accumulatedNip = undefined;
          accumulatedAltNames = [];
          accumulatedTypy = [];

          const symbol = match[1].trim();
          const nazwa = match[2].trim();
          lastParsedNazwa = nazwa;

          // Local snapshot lookup — populated once before the loop.
          const existing = bySymbol.get(symbol);

          if (!existing) {
            lastKontrahent = await database.addKontrahent(nazwa, symbol, undefined, []);
            bySymbol.set(symbol, lastKontrahent);
            added++;
            wasNewlyAdded = true;
          } else {
            // Update existing contractor - keep reference for NIP and ALT updates
            lastKontrahent = existing;
            wasNewlyAdded = false;
          }
        }
      }
      
      // Finalize last kontrahent in file
      await finalizeLastKontrahent();

      log.info(`[IMPORT] FileFunky import completed: added=${added}, updated=${updated}`);
      return { success: true, added, updated };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('[IMPORT] FileFunky import error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Import from DOM - updates existing entries by name, doesn't modify alternative names
  ipcMain.handle(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_DOM, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
          { name: 'Plan kont', extensions: ['txt', 'pdf'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const filePath = result.filePaths[0];
      const content = filePath.toLowerCase().endsWith('.pdf')
        ? (await extractPdfText(filePath)).text
        : fs.readFileSync(filePath, 'utf-8');

      // Snapshot existing kontrahenci once — avoid an O(n²) round-trip per line on large Plan kont files.
      const byNameLower = new Map<string, any>();
      for (const k of await database.getAllKontrahenci()) {
        byNameLower.set(k.nazwa.toLowerCase(), k);
      }

      // Parse the file
      const lines = content.split('\n');
      let added = 0;
      let updated = 0;
      let lastKontrahent: any = null;
      let lastNazwa: string | null = null;
      let lastSymbol: string | null = null;
      let accumulatedNip: string | undefined = undefined;

      const finalizeLastKontrahent = async () => {
        if (lastNazwa && lastSymbol) {
          // Match by nazwa (main name), not by symbol — local snapshot lookup.
          const existing = byNameLower.get(lastNazwa.toLowerCase());

          if (existing) {
            // Update existing: nazwa, kontoKontrahenta, nip can change
            // BUT keep existing alternativeNames
            await database.updateKontrahent(
              existing.id,
              lastNazwa,
              lastSymbol,
              accumulatedNip,
              existing.alternativeNames || []
            );
            updated++;
          } else {
            // Add new
            const created = await database.addKontrahent(lastNazwa, lastSymbol, accumulatedNip, []);
            byNameLower.set(lastNazwa.toLowerCase(), created);
            added++;
          }
        }
        lastNazwa = null;
        lastSymbol = null;
        accumulatedNip = undefined;
      };
      
      for (const line of lines) {
        // Skip header lines and empty lines
        if (line.trim().length === 0 || line.includes('Plan kont') || line.includes('---') || line.includes('Symbol')) {
          continue;
        }
        
        // Skip page separator lines
        if (line.includes('JOLANTA GONTAREK') || line.includes('Strona') || line.includes('©vDom')) {
          continue;
        }
        
        // Check if it's a NIP line (including empty ones)
        const nipMatch = line.match(/^\s*NIP:\s*(.*)$/);
        if (nipMatch && lastNazwa) {
          const nip = nipMatch[1].trim();
          // Set to value if non-empty, or undefined to clear if empty
          accumulatedNip = nip.length > 0 ? nip : undefined;
          continue;
        }
        
        // Skip alternative names lines - we don't import them in DOM mode
        const altMatch = line.match(/^\s*ALT:\s*(.+)$/);
        if (altMatch) {
          continue;
        }
        
        // Skip TYP lines - DOM import doesn't have this data
        const typMatch = line.match(/^\s*TYP:\s*(.+)$/);
        if (typMatch) {
          continue;
        }
        
        // Parse data line - Symbol and Nazwa are separated by spaces
        const match = line.match(/^\s*(\d{3}-\d+)\s+(.+?)\s{2,}[ZN]\s+/);
        if (match) {
          // Finalize previous kontrahent
          await finalizeLastKontrahent();

          lastSymbol = match[1].trim();
          lastNazwa = match[2].trim();
          accumulatedNip = undefined;
        }
      }

      // Finalize last kontrahent in file
      await finalizeLastKontrahent();
      
      return { success: true, added, updated };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_KONTRAHENCI_TO_FILE, async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Kontrahenci',
        defaultPath: 'kontrahenci.txt',
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const kontrahenci = await database.getAllKontrahenci();
      
      // Create text content in the same format as import expects
      const lines: string[] = [];
      lines.push('Plan kont - Kontrahenci');
      lines.push('-'.repeat(100));
      lines.push('  Symbol       Nazwa                                            RO  TS');
      lines.push('-'.repeat(100));
      
      for (const k of kontrahenci) {
        // Format: "  Symbol       Nazwa (padded to ~45 chars)  Z   1"
        const symbol = k.kontoKontrahenta.padEnd(12);
        const nazwa = k.nazwa.padEnd(45);
        lines.push(`  ${symbol} ${nazwa}  Z   1`);
        
        // Add NIP if present
        if (k.nip) {
          lines.push(`    NIP: ${k.nip}`);
        }
        
        // Add alternative names if present — one per line, so a name containing
        // a comma can't be split into two entries on re-import.
        if (k.alternativeNames && k.alternativeNames.length > 0) {
          for (const altName of k.alternativeNames) {
            lines.push(`    ALT: ${altName}`);
          }
        }

        // Always write typ(s) explicitly, so an import knows the roles even
        // when they were reset to the default single 'Kontrahent'.
        const typy = k.typy && k.typy.length > 0 ? k.typy : ['Kontrahent'];
        lines.push(`    TYP: ${typy.join(', ')}`);
      }
      
      const txtContent = lines.join('\n');
      
      fs.writeFileSync(result.filePath, txtContent, 'utf-8');
      
      return { success: true, count: kontrahenci.length, filePath: result.filePath };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  // Database - Adresy
  ipcMain.handle(IPC_CHANNELS.GET_ADRESY, async () => {
    return await database.getAllAdresy();
  });

  ipcMain.handle(
    IPC_CHANNELS.ADD_ADRES,
    async (
      _,
      nazwa: string,
      alternativeNames?: string[],
      swrkIdentifiers?: string[],
      bankId?: number | null,
      accountNumbers?: string[],
      apartmentMappings?: import('../shared/types').ApartmentMapping[],
      accountTypes?: Record<string, number>,
      zgnJednostkaId?: number | null,
    ) => {
      return await database.addAdres(nazwa, alternativeNames, swrkIdentifiers, bankId, accountNumbers, apartmentMappings, accountTypes, zgnJednostkaId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_ADRES,
    async (
      _,
      id: number,
      nazwa: string,
      alternativeNames?: string[],
      swrkIdentifiers?: string[],
      bankId?: number | null,
      accountNumbers?: string[],
      apartmentMappings?: import('../shared/types').ApartmentMapping[],
      accountTypes?: Record<string, number>,
      zgnJednostkaId?: number | null,
    ) => {
      await database.updateAdres(id, nazwa, alternativeNames, swrkIdentifiers, bankId, accountNumbers, apartmentMappings, accountTypes, zgnJednostkaId);
      return true;
    },
  );

  // ---------------------------- Konto typy ----------------------------

  ipcMain.handle(IPC_CHANNELS.GET_KONTO_TYPY, async () => {
    return await database.getKontoTypy();
  });

  ipcMain.handle(
    IPC_CHANNELS.ADD_KONTO_TYP,
    async (_, name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) => {
      return await database.addKontoTyp(name, bankAccountSymbol, apartmentPrefix, isDefault);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_KONTO_TYP,
    async (_, id: number, name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) => {
      await database.updateKontoTyp(id, name, bankAccountSymbol, apartmentPrefix, isDefault);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.DELETE_KONTO_TYP, async (_, id: number) => {
    await database.deleteKontoTyp(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_KONTO_TYPY_TO_FILE, async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Typy kont',
        defaultPath: 'typy-kont.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const kontoTypy = await database.getKontoTypy();
      fs.writeFileSync(result.filePath, JSON.stringify(kontoTypy, null, 2), 'utf-8');
      return { success: true, count: kontoTypy.length, filePath: result.filePath };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_KONTO_TYPY_FROM_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import Typy kont',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      if (!Array.isArray(parsed)) {
        return { success: false, error: 'Nieprawidłowy format pliku' };
      }

      const rows = parsed
        .filter((r: any) => r && typeof r.name === 'string' && r.name.trim().length > 0)
        .map((r: any) => ({
          id: typeof r.id === 'number' ? r.id : 0,
          name: String(r.name),
          bankAccountSymbol: String(r.bankAccountSymbol || DEFAULT_ACCOUNT_CONFIG.bankAccountSymbol),
          apartmentPrefix: String(r.apartmentPrefix || DEFAULT_ACCOUNT_CONFIG.apartmentPrefix),
          isDefault: Boolean(r.isDefault),
          createdAt: r.createdAt || new Date().toISOString(),
        }));

      const { added, updated } = await database.importKontoTypy(rows);
      return { success: true, added, updated };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ADRES, async (_, id: number) => {
    await database.deleteAdres(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ALL_ADRESY, async () => {
    await database.deleteAllAdresy();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_ADRESY_FROM_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const filePath = result.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf-8');

      // Cache banks once so we can resolve BANK: <name> → bankId without hammering the DB.
      const allBanks = await database.getAllBanks();
      const findBankIdByName = (name: string): number | null => {
        const trimmed = name.trim().toLowerCase();
        // Trim the DB side too — bank names can carry stray whitespace (e.g. "ING "),
        // and the exported file always holds the trimmed form.
        const match = allBanks.find(b => b.name.trim().toLowerCase() === trimmed);
        return match ? match.id : null;
      };
      // Konto typy resolved by name (ids differ between databases).
      const typIdByName = new Map(
        (await database.getKontoTypy()).map(kt => [kt.name.trim().toLowerCase(), kt.id]),
      );
      // City units resolved by name; a unit named in the file but missing here is
      // created on the spot, so importing addresses doesn't silently drop their
      // mailing recipients (the file carries the mailbox alongside the name).
      const zgnIdByName = new Map(
        (await database.getZgnJednostki()).map(j => [j.nazwa.trim().toLowerCase(), j.id]),
      );
      const resolveZgnId = async (nazwa: string, email: string): Promise<number | null> => {
        const key = nazwa.trim().toLowerCase();
        if (!key) return null;
        const known = zgnIdByName.get(key);
        if (known !== undefined) return known;
        if (!email.trim()) return null;
        const created = await database.addZgnJednostka(nazwa, email);
        zgnIdByName.set(key, created.id);
        return created.id;
      };

      // Snapshot existing addresses once (by exact nazwa) — avoid an O(n²) full-table
      // refetch per data line. Each addAdres invalidates the DB cache, so without this
      // snapshot every new address would trigger a fresh fetch on the next line.
      const adresByName = new Map<string, any>();
      for (const a of await database.getAllAdresy()) {
        adresByName.set(a.nazwa, a);
      }

      // Parse the file
      const lines = content.split('\n');
      let count = 0;
      // One adres failing (e.g. account-number conflict) must not abort the rest
      // of the file — errors are collected and reported per adres.
      const errors: string[] = [];
      let lastAdres: any = null;
      let accumulatedAltNames: string[] = [];
      let accumulatedSwrk: string[] = [];
      let accumulatedAccounts: string[] = [];
      let accumulatedBankId: number | null = null;
      let accumulatedBankSet = false;
      let accumulatedMappings: import('../shared/types').ApartmentMapping[] = [];
      let accumulatedAccountTypes: Record<string, number> = {};
      let accumulatedZgnId: number | null = null;
      // Only overwrite mappings/types/units when the file actually carries them,
      // so pre-MAP/TYP/ZGN exports don't wipe existing data on import.
      let sawMappings = false;
      let sawAccountTypes = false;
      let sawZgn = false;

      const finalizeLastAdres = async () => {
        if (
          lastAdres &&
          (accumulatedAltNames.length > 0 ||
            accumulatedSwrk.length > 0 ||
            accumulatedAccounts.length > 0 ||
            accumulatedBankSet ||
            sawMappings ||
            sawAccountTypes ||
            sawZgn)
        ) {
          try {
            await database.updateAdres(
              lastAdres.id,
              lastAdres.nazwa,
              accumulatedAltNames,
              accumulatedSwrk,
              accumulatedBankSet ? accumulatedBankId : undefined,
              accumulatedAccounts.length > 0 ? accumulatedAccounts : undefined,
              sawMappings ? accumulatedMappings : undefined,
              sawAccountTypes ? accumulatedAccountTypes : undefined,
              sawZgn ? accumulatedZgnId : undefined,
            );
            lastAdres.alternativeNames = accumulatedAltNames;
            lastAdres.swrkIdentifiers = accumulatedSwrk;
            if (accumulatedAccounts.length > 0) lastAdres.accountNumbers = accumulatedAccounts;
            if (accumulatedBankSet) lastAdres.bankId = accumulatedBankId;
            if (sawMappings) lastAdres.apartmentMappings = accumulatedMappings;
            if (sawAccountTypes) lastAdres.accountTypes = accumulatedAccountTypes;
            if (sawZgn) lastAdres.zgnJednostkaId = accumulatedZgnId;
          } catch (e) {
            errors.push(`${lastAdres.nazwa}: ${getErrorMessage(e)}`);
          }
        }
      };

      for (const line of lines) {
        // Skip header lines and empty lines
        if (line.trim().length === 0 || line.includes('Adresy') || line.includes('---')) {
          continue;
        }

        // Check if it's an alternative names line
        const altMatch = line.match(/^\s*ALT:\s*(.+)$/);
        if (altMatch && lastAdres) {
          const altName = altMatch[1].trim();
          if (altName.length > 0) {
            accumulatedAltNames.push(altName);
          }
          continue;
        }

        // Check if it's a SWRK identifier line
        const swrkMatch = line.match(/^\s*SWRK:\s*(.+)$/);
        if (swrkMatch && lastAdres) {
          const id = swrkMatch[1].trim();
          if (id.length > 0) {
            accumulatedSwrk.push(id);
          }
          continue;
        }

        // Check if it's an ACCT: <account-number> [| TYP: <type name>] line
        // (community bank account, optionally with its explicit account type).
        // Normalization happens at the DB layer when finalizeLastAdres calls updateAdres.
        const acctMatch = line.match(/^\s*ACCT:\s*([^|]+?)(?:\s*\|\s*TYP:\s*(.+))?$/);
        if (acctMatch && lastAdres) {
          const acc = acctMatch[1].trim();
          if (acc.length > 0) {
            accumulatedAccounts.push(acc);
            const typName = acctMatch[2]?.trim();
            if (typName) {
              sawAccountTypes = true;
              const typId = typIdByName.get(typName.toLowerCase());
              if (typId !== undefined) {
                accumulatedAccountTypes[acc] = typId;
              } else {
                errors.push(`${lastAdres.nazwa}: nieznany typ konta "${typName}" (konto ${acc})`);
              }
            }
          }
          continue;
        }

        // Check if it's a MAP: <matchText> => <apartment> [| <note>] line
        // (user-defined apartment-number rule).
        const mapMatch = line.match(/^\s*MAP:\s*(.+)=>\s*([^|]+?)(?:\s*\|\s*(.+))?$/);
        if (mapMatch && lastAdres) {
          sawMappings = true;
          const note = mapMatch[3]?.trim();
          accumulatedMappings.push({
            id: '', // DB layer assigns a stable id via sanitizeApartmentMappings
            matchText: mapMatch[1].trim(),
            apartmentNumber: mapMatch[2].trim(),
            ...(note ? { note } : {}),
          });
          continue;
        }

        // Check if it's a ZGN: <unit name> | <email> line (Mailing recipient).
        const zgnMatch = line.match(/^\s*ZGN:\s*([^|]+?)(?:\s*\|\s*(.+))?$/);
        if (zgnMatch && lastAdres) {
          sawZgn = true;
          accumulatedZgnId = await resolveZgnId(zgnMatch[1], zgnMatch[2] ?? '');
          if (accumulatedZgnId === null) {
            errors.push(
              `${lastAdres.nazwa}: nie udało się przypisać jednostki ZGN "${zgnMatch[1].trim()}" (brak e-maila w pliku)`,
            );
          }
          continue;
        }

        // Check if it's a BANK: <name> line (resolves to bank_id; unknown names ⇒ null/no link).
        const bankMatch = line.match(/^\s*BANK:\s*(.+)$/);
        if (bankMatch && lastAdres) {
          const bankName = bankMatch[1].trim();
          accumulatedBankSet = true;
          accumulatedBankId = bankName.length > 0 ? findBankIdByName(bankName) : null;
          continue;
        }

        // Parse data line - just nazwa (no symbol)
        const nazwa = line.trim();
        if (
          nazwa.length > 0 &&
          !nazwa.startsWith('ALT:') &&
          !nazwa.startsWith('SWRK:') &&
          !nazwa.startsWith('ACCT:') &&
          !nazwa.startsWith('BANK:') &&
          !nazwa.startsWith('MAP:') &&
          !nazwa.startsWith('ZGN:')
        ) {
          // Finalize previous adres with accumulated alt names + SWRK + accounts + bank + mappings
          await finalizeLastAdres();
          accumulatedAltNames = [];
          accumulatedSwrk = [];
          accumulatedAccounts = [];
          accumulatedBankId = null;
          accumulatedBankSet = false;
          accumulatedMappings = [];
          accumulatedAccountTypes = {};
          accumulatedZgnId = null;
          sawMappings = false;
          sawAccountTypes = false;
          sawZgn = false;

          // Check if not already exists (local snapshot lookup — populated once).
          const existing = adresByName.get(nazwa);

          if (!existing) {
            lastAdres = await database.addAdres(nazwa, [], []);
            adresByName.set(nazwa, lastAdres);
            count++;
          } else {
            lastAdres = existing;
          }
        }
      }

      // Finalize last adres in file
      await finalizeLastAdres();

      if (errors.length > 0) {
        log.warn(`[IMPORT] Adresy import finished with ${errors.length} error(s): ${errors.join('; ')}`);
      }
      return { success: true, count, errors };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_ADRESY_TO_FILE, async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Adresy',
        defaultPath: 'adresy.txt',
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const adresy = await database.getAllAdresy();
      // Banks/typy looked up by id so we can render BANK:/TYP: by name — names
      // survive a move to another database where the ids differ.
      const allBanks = await database.getAllBanks();
      const bankNameById = new Map(allBanks.map(b => [b.id, b.name]));
      const typNameById = new Map((await database.getKontoTypy()).map(kt => [kt.id, kt.name]));
      const zgnById = new Map((await database.getZgnJednostki()).map(j => [j.id, j]));

      // Create text content: simple list of nazwy with ALT: lines for alternative names
      const lines: string[] = [];
      lines.push('Adresy');
      lines.push('-'.repeat(50));

      for (const a of adresy) {
        // Main nazwa
        lines.push(a.nazwa);

        // Optional bank link
        if (a.bankId) {
          const bankName = bankNameById.get(a.bankId);
          if (bankName) {
            lines.push(`  BANK: ${bankName}`);
          }
        }

        // Add alternative names if present
        if (a.alternativeNames && a.alternativeNames.length > 0) {
          for (const altName of a.alternativeNames) {
            lines.push(`  ALT: ${altName}`);
          }
        }

        // Optional city-unit link (Mailing). Exported by name + mailbox so the
        // assignment survives a roundtrip between databases, where ids differ.
        if (a.zgnJednostkaId) {
          const jednostka = zgnById.get(a.zgnJednostkaId);
          if (jednostka) {
            lines.push(`  ZGN: ${jednostka.nazwa} | ${jednostka.email}`);
          }
        }

        // Add SWRK identifiers if present
        if (a.swrkIdentifiers && a.swrkIdentifiers.length > 0) {
          for (const id of a.swrkIdentifiers) {
            lines.push(`  SWRK: ${id}`);
          }
        }

        // Add community bank account numbers if present, each with its explicit
        // account-type (by name) when one is assigned.
        if (a.accountNumbers && a.accountNumbers.length > 0) {
          for (const acc of a.accountNumbers) {
            const typName = a.accountTypes?.[acc] !== undefined ? typNameById.get(a.accountTypes[acc]) : undefined;
            lines.push(typName ? `  ACCT: ${acc} | TYP: ${typName}` : `  ACCT: ${acc}`);
          }
        }

        // Add apartment-number mapping rules if present
        if (a.apartmentMappings && a.apartmentMappings.length > 0) {
          for (const m of a.apartmentMappings) {
            lines.push(
              m.note
                ? `  MAP: ${m.matchText} => ${m.apartmentNumber} | ${m.note}`
                : `  MAP: ${m.matchText} => ${m.apartmentNumber}`,
            );
          }
        }
      }
      
      const txtContent = lines.join('\n');
      
      fs.writeFileSync(result.filePath, txtContent, 'utf-8');
      
      return { success: true, count: adresy.length, filePath: result.filePath };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  // Converters
  ipcMain.handle(IPC_CHANNELS.GET_CONVERTERS, async () => {
    return converterRegistry.getAllConverters();
  });

  // File operations
  ipcMain.handle(IPC_CHANNELS.SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
    });

    if (!result.canceled) {
      return result.filePaths.map((filePath) => ({
        fileName: path.basename(filePath),
        filePath: filePath,
      }));
    }
    return [];
  });

  ipcMain.handle(IPC_CHANNELS.SELECT_OUTPUT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // PDF operations
  ipcMain.handle(IPC_CHANNELS.SELECT_PDF, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      return {
        fileName: path.basename(filePath),
        filePath,
      };
    }
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.EXTRACT_PDF_TEXT, async (_event, filePath: string) => {
    try {
      const result = await extractPdfText(filePath);
      return result;
    } catch (error) {
      console.error('Error extracting PDF text:', error);
      return null;
    }
  });

  // ---- Zaliczki (podsumowanie zaliczek miesięcznych) ----
  ipcMain.handle(IPC_CHANNELS.ZALICZKI_GET_MODELS, async () => {
    return { models: ZALICZKI_MODELS, default: DEFAULT_ZALICZKI_MODEL };
  });

  ipcMain.handle(IPC_CHANNELS.ZALICZKI_SELECT_PDFS, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(
    IPC_CHANNELS.ZALICZKI_EXTRACT_PDF,
    async (_event, filePath: string, model: string, force?: boolean) => {
      const apiKey = converterRegistry.getAnthropicApiKey();
      if (!apiKey) {
        return {
          error: 'Brak klucza Anthropic API — dodaj wpis anthropic_api_key w tabeli app_config (Supabase) lub lokalnie w config/ai-config.yml.',
        };
      }
      try {
        const extraction = await extractZaliczkiFromPdf(filePath, apiKey, model, {
          force: force === true,
          onProgress: (progress) =>
            mainWindow?.webContents.send('zaliczki:progress', progress),
        });
        return { data: extraction };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[ZALICZKI] extract failed:', message);
        return { error: message };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.ZALICZKI_CACHE_STATS, async () => cacheStats());

  ipcMain.handle(IPC_CHANNELS.ZALICZKI_CLEAR_CACHE, async () => {
    const removed = clearCache();
    log.info(`[ZALICZKI] Cache wyczyszczony: ${removed} wpisów`);
    return { removed };
  });

  ipcMain.handle(
    IPC_CHANNELS.ZALICZKI_GENERATE_XLSX,
    async (_event, files: EditedFile[], year: number) => {
      try {
        const buffer = await buildWorkbookFromEdited(files, year);
        const saveResult = await dialog.showSaveDialog(mainWindow!, {
          title: 'Zapisz podsumowanie',
          defaultPath: `Podsumowanie_zaliczek_${year}.xlsx`,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });
        if (saveResult.canceled || !saveResult.filePath) {
          return { canceled: true };
        }
        fs.writeFileSync(saveResult.filePath, buffer);
        return { success: true, filePath: saveResult.filePath };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[ZALICZKI] generate xlsx failed:', message);
        return { error: message };
      }
    },
  );

  // ---- Noty Świadczenia (correction notices) ----
  ipcMain.handle(IPC_CHANNELS.NOTY_SELECT_PDFS, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(IPC_CHANNELS.NOTY_SELECT_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTY_CONVERT,
    async (_event, filePath: string, outputDir: string | null) => {
      try {
        if (!fs.existsSync(filePath)) {
          return { error: 'Plik PDF nie istnieje lub został usunięty' };
        }
        const data = await extractNotaFromPdf(filePath);
        const buffer = await buildNotaWorkbook(data);

        const baseName = path.basename(filePath, path.extname(filePath));
        const defaultName = `${baseName}.xlsx`;

        let targetPath: string;
        if (outputDir) {
          targetPath = path.join(outputDir, defaultName);
        } else {
          const saveResult = await dialog.showSaveDialog(mainWindow!, {
            title: 'Zapisz notę jako Excel',
            defaultPath: defaultName,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
          });
          if (saveResult.canceled || !saveResult.filePath) {
            return { canceled: true };
          }
          targetPath = saveResult.filePath;
        }

        fs.writeFileSync(targetPath, buffer);
        return { success: true, filePath: targetPath };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[NOTY] convert failed:', message);
        return { error: message };
      }
    },
  );

  // ---- Scalanie wpłat (merge daily deposit files per community) ----
  ipcMain.handle(IPC_CHANNELS.SCALANIE_SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(IPC_CHANNELS.SCALANIE_SELECT_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.SCALANIE_ANALYZE_FILE, async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: 'Plik nie istnieje lub został usunięty' };
      }
      const analyzed = scalanieAnalyzeFile(filePath);
      return { data: analyzed };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[SCALANIE] analyze failed:', message);
      return { error: message };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SCALANIE_MERGE,
    async (_event, files: ScalanieMergeFileInput[], outputDir: string) => {
      try {
        if (!files || files.length === 0) {
          return { error: 'Brak plików do scalenia' };
        }
        if (!outputDir || !fs.existsSync(outputDir)) {
          return { error: 'Folder docelowy nie istnieje' };
        }
        const result = scalanieMergeFiles(files, outputDir);
        return { success: true, result };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[SCALANIE] merge failed:', message);
        return { error: message };
      }
    },
  );

  // ---- Homebanking (merge multi-day, multi-bank deposit files) ----
  ipcMain.handle(IPC_CHANNELS.HOMEBANKING_SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(IPC_CHANNELS.HOMEBANKING_SELECT_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.HOMEBANKING_ANALYZE_FILE, async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: 'Plik nie istnieje lub został usunięty' };
      }
      const banks = await database.getAllBanks();
      const adresy = await database.getAllAdresy();
      const analyzed = homebankingAnalyzeFile(filePath, banks, adresy);
      return { data: analyzed };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[HOMEBANKING] analyze failed:', message);
      return { error: message };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.HOMEBANKING_MERGE,
    async (
      _event,
      files: HomebankingMergeFileInput[],
      outputDir: string,
    ) => {
      try {
        if (!files || files.length === 0) {
          return { error: 'Brak plików do scalenia' };
        }
        if (!outputDir || !fs.existsSync(outputDir)) {
          return { error: 'Folder docelowy nie istnieje' };
        }
        const banks = await database.getAllBanks();
        const adresy = await database.getAllAdresy();
        const results = homebankingMergeGroups(files, outputDir, banks, adresy);
        return { success: true, results };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[HOMEBANKING] merge failed:', message);
        return { error: message };
      }
    },
  );

  // ---- Odczyty liczników (supplier workbooks → tab-separated IMPEX files) ----
  ipcMain.handle(IPC_CHANNELS.ODCZYTY_SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(IPC_CHANNELS.ODCZYTY_SELECT_OUTPUT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.ODCZYTY_GET_HISTORY, async () => {
    try {
      return await database.getOdczytyHistory();
    } catch (error: unknown) {
      log.error(
        '[ODCZYTY] history read failed:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.ODCZYTY_CLEAR_HISTORY, async () => {
    await database.clearOdczytyHistory();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ODCZYTY_ANALYZE_FILE, async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: 'Plik nie istnieje lub został usunięty' };
      }
      const parsed = parseOdczytyFile(filePath);
      return {
        data: {
          filePath,
          fileName: path.basename(filePath),
          supplier: parsed.supplier,
          supplierLabel: parsed.supplierLabel,
          communities: parsed.communities,
          latestDate: parsed.latestDate,
          readingCount: parsed.readings.length,
          skippedCount: parsed.skipped.length,
          skipped: parsed.skipped,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[ODCZYTY] analyze failed:', message);
      return { error: message };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ODCZYTY_CONVERT,
    async (_event, filePaths: string[], outputDirOverride: string | null) => {
      try {
        if (!filePaths || filePaths.length === 0) {
          return { error: 'Brak plików do konwersji' };
        }
        // The IMPEX folder is the module's home; the override only kicks in when
        // the user hasn't configured one yet and picked a folder in the dialog.
        const outputDir =
          outputDirOverride?.trim() || (database.getSetting('impexFolder') || '').trim();
        if (!outputDir) {
          return {
            error: 'Folder IMPEX nie jest skonfigurowany (Ustawienia → Folder IMPEX).',
          };
        }

        const readings: OdczytReading[] = [];
        const sources: {
          fileName: string;
          filePath: string;
          supplierLabel: string | null;
          readingCount: number;
          skippedCount: number;
          skipped: OdczytySkipped[];
          error?: string;
        }[] = [];

        for (const filePath of filePaths) {
          const fileName = path.basename(filePath);
          try {
            if (!fs.existsSync(filePath)) {
              throw new Error('Plik nie istnieje lub został usunięty');
            }
            const parsed = parseOdczytyFile(filePath);
            readings.push(...parsed.readings);
            sources.push({
              fileName,
              filePath,
              supplierLabel: parsed.supplierLabel,
              readingCount: parsed.readings.length,
              skippedCount: parsed.skipped.length,
              skipped: parsed.skipped,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`[ODCZYTY] parse failed for ${fileName}:`, message);
            sources.push({
              fileName,
              filePath,
              supplierLabel: null,
              readingCount: 0,
              skippedCount: 0,
              skipped: [],
              error: message,
            });
          }
        }

        if (readings.length === 0) {
          const firstError = sources.find((s) => s.error)?.error;
          return { error: firstError ?? 'Żaden z plików nie zawiera odczytów.' };
        }

        const files: OdczytyOutputFile[] = writeOdczytyFiles(readings, outputDir);
        log.info(
          `[ODCZYTY] wrote ${files.length} file(s) to ${outputDir} from ${filePaths.length} input file(s)`,
        );

        const skippedCount = sources.reduce((sum, s) => sum + s.skippedCount, 0);
        // One operation can mix suppliers; label it with all of them.
        const supplier =
          [...new Set(sources.map((s) => s.supplierLabel).filter(Boolean))].join(' + ') || '—';
        // History is a record, not the deliverable — a write failure here must
        // not turn a completed conversion into a reported error.
        try {
          await database.addOdczytyHistory({
            supplier,
            status: sources.some((s) => s.error) ? 'error' : 'success',
            errorMessage: sources.find((s) => s.error)?.error,
            outputDir,
            sources,
            outputs: files,
            readingCount: readings.length,
            skippedCount,
          });
        } catch (historyError: unknown) {
          log.error(
            '[ODCZYTY] history write failed:',
            historyError instanceof Error ? historyError.message : String(historyError),
          );
        }

        return {
          success: true,
          result: {
            outputDir,
            files,
            sources,
            readingCount: readings.length,
            skippedCount,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('[ODCZYTY] convert failed:', message);
        return { error: message };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONVERT_FILE,
    async (_, inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) => {
      try {
        // Validate input file exists
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = await database.getBankById(bankId);
        if (!bank) {
          throw new Error('Bank not found');
        }

        log.info(`[CONVERT] Processing file with bank: ${bank.name}, converterId: ${bank.converterId}`);

        const converter = converterRegistry.getConverter(bank.converterId);
        if (!converter) {
          const availableConverters = converterRegistry.getAllConverters().map(c => c.id).join(', ');
          log.error(`[CONVERT] Converter '${bank.converterId}' not found. Available: ${availableConverters}`);
          throw new Error(`Konwerter '${bank.converterId}' nie został znaleziony. Bank: '${bank.name}'. Dostępne konwertery: ${availableConverters}`);
        }

        const outputFolder = database.getSetting('outputFolder');
        if (!outputFolder) {
          throw new Error('Output folder not configured');
        }
        
        // Ensure output folder exists
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Generate output filename with address and timestamp
        const outputFileName = await generateOutputFileName(adresId, database);
        const finalOutputPath = path.join(outputFolder, outputFileName);

        const accountConfig = await resolveAccountConfig(accountTypeId, database);

        // Perform conversion
        const result = await converterRegistry.convert(
          bank.converterId,
          inputPath,
          finalOutputPath,
          false,
          adresId,
          fileName,
          bank.name,
          undefined,
          accountConfig
        );

        // Check if review is needed
        if (result.needsReview && result.reviewData) {
          return {
            needsReview: true,
            reviewData: result.reviewData,
          };
        }

        // Save to history (only if no review needed)
        await database.addConversionHistory({
          fileName,
          bankName: bank.name,
          converterName: converter.name,
          status: 'success',
          inputPath,
          outputPath: finalOutputPath,
        });

        return {
          success: true,
          outputPath: finalOutputPath,
        };
      } catch (error: unknown) {
        // Save error to history
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const bank = await database.getBankById(bankId);
        if (bank) {
          const converter = converterRegistry.getConverter(bank.converterId);
          await database.addConversionHistory({
            fileName,
            bankName: bank.name,
            converterName: converter?.name || 'Unknown',
            status: 'error',
            errorMessage,
            inputPath,
            outputPath: '',
          });
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  // Pull the community ("our") bank account number(s) out of a freshly-dropped
  // statement file. Used by the Converter to auto-pick the matching address.
  // Lightweight: reads only the file header / (for pko_biznes) the inner CSVs.
  // Best-effort — returns [] on any failure rather than throwing.
  ipcMain.handle(
    IPC_CHANNELS.DETECT_ACCOUNT_NUMBERS,
    async (_, inputPath: string, bankId?: number | null) => {
      try {
        let converterId: string | null = null;
        if (bankId) {
          const bank = await database.getBankById(bankId);
          converterId = bank?.converterId ?? null;
        }
        return extractAccountNumbersFromFile(inputPath, converterId);
      } catch (error) {
        log.warn('[detect-account-numbers] failed:', error);
        return [];
      }
    },
  );

  // Analyze file without AI to check confidence
  ipcMain.handle(
    'files:analyze',
    async (_, inputPath: string, bankId: number, adresId?: number | null) => {
      try {
        const bank = await database.getBankById(bankId);
        if (!bank) {
          throw new Error('Bank not found');
        }

        const settings = database.getSettings();
        const threshold = settings.aiConfidenceThreshold || 95;

        const summary = await converterRegistry.analyzeWithoutAI(
          bank.converterId,
          inputPath,
          threshold,
          adresId
        );

        return summary;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(errorMessage);
      }
    }
  );

  // Convert with AI enabled
  ipcMain.handle(
    IPC_CHANNELS.CONVERT_FILE_WITH_AI,
    async (event, inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) => {
      // Emit progress events back to the renderer that initiated this call.
      const onProgress = (e: any) => {
        try {
          event.sender.send('conversion:progress', { fileName, ...e });
        } catch {
          // ignore — renderer may have closed
        }
      };
      try {
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = await database.getBankById(bankId);
        if (!bank) {
          throw new Error('Bank not found');
        }

        log.info(`[CONVERT_AI] Processing file with bank: ${bank.name}, converterId: ${bank.converterId}`);

        const converter = converterRegistry.getConverter(bank.converterId);
        if (!converter) {
          const availableConverters = converterRegistry.getAllConverters().map(c => c.id).join(', ');
          log.error(`[CONVERT_AI] Converter '${bank.converterId}' not found. Available: ${availableConverters}`);
          throw new Error(`Konwerter '${bank.converterId}' nie został znaleziony. Bank: '${bank.name}'. Dostępne konwertery: ${availableConverters}`);
        }

        const outputFolder = database.getSetting('outputFolder');
        if (!outputFolder) {
          throw new Error('Output folder not configured');
        }
        
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Generate output filename with address and timestamp
        const outputFileName = await generateOutputFileName(adresId, database);
        const finalOutputPath = path.join(outputFolder, outputFileName);

        const accountConfig = await resolveAccountConfig(accountTypeId, database);

        try {
          // Perform conversion WITH AI
          const result = await converterRegistry.convert(
            bank.converterId,
            inputPath,
            finalOutputPath,
            true,
            adresId,
            fileName,
            bank.name,
            onProgress,
            accountConfig
          );

          // Check if review is needed
          if (result.needsReview && result.reviewData) {
            return {
              needsReview: true,
              reviewData: result.reviewData,
            };
          }

          await database.addConversionHistory({
            fileName,
            bankName: bank.name,
            converterName: converter.name,
            status: 'success',
            inputPath,
            outputPath: finalOutputPath,
          });

          return {
            success: true,
            outputPath: finalOutputPath,
          };
        } catch (aiError: unknown) {
          const aiErrorMessage = getErrorMessage(aiError);
          
          // Check if this is a billing/quota error - if so, don't fallback, just fail
          if (isBillingError(aiError)) {
            log.error('[AI Error - No Money]:', aiErrorMessage);
            throw aiError; // Re-throw to outer catch
          }
          
          // For other AI errors, log and fallback to standard conversion
          const authFailure = isAuthError(aiError);
          const fallbackMessage = authFailure ? AI_AUTH_FALLBACK_MESSAGE : AI_FALLBACK_MESSAGE;
          if (authFailure) {
            log.error('[AI Error - Invalid API key]:', aiErrorMessage);
          }
          log.warn('[AI Error - Falling back to standard conversion]:', aiErrorMessage);
          log.info('[Fallback] Attempting standard conversion without AI...');

          try {
            // Perform conversion WITHOUT AI (fallback)
            const fallbackResult = await converterRegistry.convert(
              bank.converterId,
              inputPath,
              finalOutputPath,
              false,  // useAI = false
              adresId,
              fileName,
              bank.name,
              onProgress,
              accountConfig
            );

            // Check if review is needed
            if (fallbackResult.needsReview && fallbackResult.reviewData) {
              return {
                needsReview: true,
                reviewData: fallbackResult.reviewData,
                warningMessage: fallbackMessage,
              };
            }

            await database.addConversionHistory({
              fileName,
              bankName: bank.name,
              converterName: converter.name,
              status: 'success',
              inputPath,
              outputPath: finalOutputPath,
            });

            return {
              success: true,
              outputPath: finalOutputPath,
              warningMessage: fallbackMessage,
            };
          } catch (fallbackError: unknown) {
            // If even standard conversion fails, throw original AI error
            log.error('[Fallback Failed]:', fallbackError);
            throw new Error(`AI failed: ${aiErrorMessage}. Standard conversion also failed.`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        const bank = await database.getBankById(bankId);
        if (bank) {
          const converter = converterRegistry.getConverter(bank.converterId);
          await database.addConversionHistory({
            fileName,
            bankName: bank.name,
            converterName: converter?.name || 'Unknown',
            status: 'error',
            errorMessage,
            inputPath,
            outputPath: '',
          });
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  // Finalize conversion after user review
  ipcMain.handle(
    IPC_CHANNELS.FINALIZE_CONVERSION,
    async (_, tempConversionId: string, decisions: import('../shared/types').ReviewDecision[]) => {
      try {
        const result = await converterRegistry.finalizeConversion(tempConversionId, decisions);
        
        // Add to history
        if (result.fileName && result.bankName && result.inputPath && result.outputPath) {
          const converter = converterRegistry.getConverter(result.converterId || '');
          await database.addConversionHistory({
            fileName: result.fileName,
            bankName: result.bankName,
            converterName: converter?.name || 'Unknown',
            status: 'success',
            inputPath: result.inputPath,
            outputPath: result.outputPath,
          });
        }
        
        return {
          success: true,
          outputPath: result.outputPath,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  // Re-run AI contractor matching for selected expenses of an open review.
  // Progress rides the same 'conversion:progress' channel the main conversion
  // uses, so the review screen can render the familiar bar.
  ipcMain.handle(
    IPC_CHANNELS.RERUN_EXPENSE_AI,
    async (event, tempConversionId: string, indices: number[], fileName: string) => {
      try {
        const result = await converterRegistry.rerunExpenseAI(
          tempConversionId,
          indices,
          ({ completed, total, inFlight }) => {
            try {
              event.sender.send('conversion:progress', {
                fileName,
                phase: 'expense-ai',
                label: inFlight > 0
                  ? `AI: wydatki — ${completed}/${total} batchy (w toku: ${inFlight})`
                  : `AI: wydatki — ${completed}/${total} batchy`,
                aiBatchesCompleted: completed,
                aiBatchesTotal: total,
                percent: total > 0 ? Math.round((completed / total) * 100) : 0,
              });
            } catch {
              // ignore — renderer may have closed
            }
          }
        );
        return { success: true, ...result };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('[RERUN-EXPENSE-AI] failed:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  // Keep a pending conversion alive while its review screen is open (sliding
  // expiration heartbeat). Returns whether the entry still exists.
  ipcMain.handle(
    IPC_CHANNELS.TOUCH_CONVERSION,
    async (_, tempConversionId: string) => {
      return conversionCache.touch(tempConversionId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async (_, filePath: string) => {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return false;
      }
      const result = await shell.openPath(filePath);
      // shell.openPath returns empty string on success, error message on failure
      return result === '';
    } catch {
      return false;
    }
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    // Booleans may be stored as native booleans (store defaults) or as strings
    // (written by setSetting via .toString()); accept both so e.g. the default
    // darkMode=true isn't silently read as false on a fresh install.
    const boolSetting = (key: string): boolean => {
      const v = database.getSetting(key) as unknown;
      return v === true || v === 'true';
    };
    return {
      outputFolder: database.getSetting('outputFolder') || '',
      impexFolder: database.getSetting('impexFolder') || '',
      swrkFolder: database.getSetting('swrkFolder') || '',
      darkMode: boolSetting('darkMode'),
      language: database.getSetting('language') || 'pl',
      skipUserApproval: boolSetting('skipUserApproval'),
      // Defaults to on, including for installs that predate this setting: only
      // an explicit false turns AI off.
      alwaysUseAI: (() => {
        const v = database.getSetting('alwaysUseAI') as unknown;
        return !(v === false || v === 'false');
      })(),
      contractorSortOrder: database.getSetting('contractorSortOrder') || 'name-asc',
      // Defaults to collapsed: an absent/undefined value (existing installs that
      // predate this setting) reads as collapsed; only an explicit false expands.
      sidebarCollapsed: (() => {
        const v = database.getSetting('sidebarCollapsed') as unknown;
        return !(v === false || v === 'false');
      })(),
      // Empty on installs that predate release notes, which is exactly right:
      // they get the "what's new" screen on their first launch after updating.
      lastSeenVersion: database.getSetting('lastSeenVersion') || '',
    };
  });

  ipcMain.handle(IPC_CHANNELS.SET_OUTPUT_FOLDER, async (_, folderPath: string) => {
    database.setSetting('outputFolder', folderPath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_IMPEX_FOLDER, async (_, folderPath: string) => {
    database.setSetting('impexFolder', folderPath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_SWRK_FOLDER, async (_, folderPath: string) => {
    database.setSetting('swrkFolder', folderPath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_DARK_MODE, async (_, enabled: boolean) => {
    database.setSetting('darkMode', enabled.toString());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_LANGUAGE, async (_, language: string) => {
    database.setSetting('language', language);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_SKIP_USER_APPROVAL, async (_, enabled: boolean) => {
    database.setSetting('skipUserApproval', enabled.toString());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_ALWAYS_USE_AI, async (_, enabled: boolean) => {
    database.setSetting('alwaysUseAI', enabled.toString());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_CONTRACTOR_SORT_ORDER, async (_, sortOrder: string) => {
    database.setSetting('contractorSortOrder', sortOrder);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_SIDEBAR_COLLAPSED, async (_, collapsed: boolean) => {
    database.setSetting('sidebarCollapsed', collapsed.toString());
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SET_LAST_SEEN_VERSION, async (_, version: string) => {
    database.setSetting('lastSeenVersion', version);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_SETTINGS, async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Eksportuj ustawienia',
      defaultPath: `statement-converter-settings-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!result.canceled && result.filePath) {
      const data = database.exportSettings();
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
      return { success: true, filePath: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_SETTINGS, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Importuj ustawienia',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
        database.importSettings(data);
        return { success: true };
      } catch (error) {
        return { success: false, error: 'Nieprawidłowy format pliku' };
      }
    }
    return { success: false };
  });

  // History
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    return await database.getAllHistory();
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    await database.clearHistory();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_HISTORY_TO_FILE, async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Historia',
        defaultPath: `historia-konwersji-${today}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const history = await database.getAllHistory();
      fs.writeFileSync(result.filePath, JSON.stringify(history, null, 2), 'utf-8');
      return { success: true, count: history.length, filePath: result.filePath };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_HISTORY_FROM_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import Historia',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      if (!Array.isArray(parsed)) {
        return { success: false, error: 'Nieprawidłowy format pliku' };
      }

      const rows = parsed
        .filter((h: any) => h && typeof h.fileName === 'string' && typeof h.convertedAt === 'string')
        .map((h: any) => ({
          id: typeof h.id === 'number' ? h.id : 0,
          fileName: String(h.fileName),
          bankName: String(h.bankName || ''),
          converterName: String(h.converterName || ''),
          status: h.status === 'error' ? ('error' as const) : ('success' as const),
          errorMessage: h.errorMessage ? String(h.errorMessage) : undefined,
          inputPath: String(h.inputPath || ''),
          outputPath: String(h.outputPath || ''),
          convertedAt: String(h.convertedAt),
        }));

      const { added, skipped } = await database.importHistory(rows);
      return { success: true, added, skipped };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Backup — full snapshot (Supabase tables + local settings) to a single JSON file
  ipcMain.handle(IPC_CHANNELS.BACKUP_EXPORT, async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Utwórz kopię zapasową',
        defaultPath: `filefunky-backup-${today}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false };
      }
      const backup = await database.exportFullBackup(app.getVersion());
      fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf-8');
      log.info(`[BACKUP] Manual backup written: ${result.filePath}`);
      return { success: true, filePath: result.filePath, counts: countBackup(backup) };
    } catch (error) {
      log.error('[BACKUP] Export failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_RESTORE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Przywróć z kopii zapasowej',
        defaultPath: getBackupsDir(),
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }
      const backup = validateBackup(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')));
      // Snapshot the current state before it's replaced, so a restore of the
      // wrong file is itself recoverable from the backups folder.
      const preRestore = await database.exportFullBackup(app.getVersion());
      const dir = getBackupsDir();
      fs.mkdirSync(dir, { recursive: true });
      const safetyPath = path.join(dir, `pre-restore-${Date.now()}.json`);
      fs.writeFileSync(safetyPath, JSON.stringify(preRestore, null, 2), 'utf-8');
      log.info(`[BACKUP] Pre-restore safety copy: ${safetyPath}`);

      await database.importFullBackup(backup);
      log.info(`[BACKUP] Restored from: ${result.filePaths[0]}`);
      return { success: true, counts: countBackup(backup), createdAt: backup.createdAt };
    } catch (error) {
      log.error('[BACKUP] Restore failed:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_GET_STATUS, () => {
    return getBackupStatus();
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_OPEN_FOLDER, () => {
    const dir = getBackupsDir();
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { success: true };
  });

  // App info
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  // Zoom controls
  ipcMain.handle('app:zoom-in', () => {
    if (mainWindow) {
      const currentZoom = mainWindow.webContents.getZoomLevel();
      mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
      return true;
    }
    return false;
  });

  ipcMain.handle('app:zoom-out', () => {
    if (mainWindow) {
      const currentZoom = mainWindow.webContents.getZoomLevel();
      mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
      return true;
    }
    return false;
  });

  ipcMain.handle('app:zoom-reset', () => {
    if (mainWindow) {
      mainWindow.webContents.setZoomLevel(0);
      return true;
    }
    return false;
  });

  // Auto-updater
  ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) {
      return { available: false, message: 'Aktualizacje wyłączone w trybie deweloperskim' };
    }
    
    return new Promise((resolve) => {
      // Timeout po 30 sekundach
      const timeout = setTimeout(() => {
        resolve({ available: false, error: 'Timeout - brak odpowiedzi z serwera' });
      }, 30000);

      // Nasłuchuj na dostępność aktualizacji
      const onUpdateAvailable = (info: any) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        log.info('Update check: Update available');
        resolve({ available: true, info });
      };

      const onUpdateNotAvailable = (info: any) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('error', onError);
        log.info('Update check: No update available');
        resolve({ 
          available: false, 
          message: `Masz najnowszą wersję (${info.version})` 
        });
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        log.error('Update check error:', error);
        resolve({ 
          available: false, 
          error: error.message 
        });
      };

      // Dodaj listenery
      autoUpdater.once('update-available', onUpdateAvailable);
      autoUpdater.once('update-not-available', onUpdateNotAvailable);
      autoUpdater.once('error', onError);

      // Rozpocznij sprawdzanie
      log.info('Manual update check initiated');
      autoUpdater.checkForUpdates().catch((error) => {
        clearTimeout(timeout);
        // Remove only THIS promise's own `once` handlers — not every listener.
        // removeAllListeners here also nuked the persistent listeners from
        // setupAutoUpdater, silently killing automatic update notifications for
        // the rest of the session after a single failed manual check.
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('error', onError);
        log.error('checkForUpdates failed:', error);
        resolve({ available: false, error: error.message });
      });
    });
  });

  ipcMain.handle('download-update', async () => {
    // macOS: notify-only flow — niepodpisana aplikacja nie przejdzie weryfikacji
    // podpisu w electron-updater, więc otwieramy stronę Release w przeglądarce.
    if (process.platform === 'darwin') {
      const url = 'https://github.com/wikunia-pura/statement_converter/releases/latest';
      log.info('macOS notify-only: opening release page', url);
      await shell.openExternal(url);
      return { success: true, openedRelease: true };
    }
    try {
      const downloadPath = await autoUpdater.downloadUpdate();
      const downloadsFolder = app.getPath('downloads');
      return {
        success: true,
        downloadPath: downloadsFolder,
        message: 'Update downloaded to Downloads folder'
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('open-downloads-folder', () => {
    const downloadsFolder = app.getPath('downloads');
    shell.openPath(downloadsFolder);
    return { success: true };
  });

  // Logs
  ipcMain.handle('open-logs-folder', () => {
    const logPath = log.transports.file.getFile().path;
    const logFolder = path.dirname(logPath);
    shell.showItemInFolder(logPath);
    return { success: true, logPath };
  });

  ipcMain.handle('get-log-path', () => {
    return { path: log.transports.file.getFile().path };
  });

  // ------------------- Mailing (zmiany stawek → jednostki) -------------------

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_ZGN, async () => {
    return await database.getZgnJednostki();
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_ADD_ZGN, async (_, nazwa: string, email: string) => {
    return await database.addZgnJednostka(nazwa, email);
  });

  ipcMain.handle(
    IPC_CHANNELS.MAILING_UPDATE_ZGN,
    async (_, id: number, nazwa: string, email: string) => {
      await database.updateZgnJednostka(id, nazwa, email);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.MAILING_DELETE_ZGN, async (_, id: number) => {
    await database.deleteZgnJednostka(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_POLA, async () => {
    return await database.getMailingPola();
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_ADD_POLE, async (_, nazwa: string, tekst: string) => {
    return await database.addMailingPole(nazwa, tekst);
  });

  ipcMain.handle(
    IPC_CHANNELS.MAILING_UPDATE_POLE,
    async (_, id: number, nazwa: string, tekst: string) => {
      await database.updateMailingPole(id, nazwa, tekst);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.MAILING_DELETE_POLE, async (_, id: number) => {
    await database.deleteMailingPole(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_SZABLONY, async () => {
    return await database.getMailingSzablony();
  });

  ipcMain.handle(
    IPC_CHANNELS.MAILING_ADD_SZABLON,
    async (_, data: Omit<MailingSzablon, 'id' | 'createdAt'>) => {
      return await database.addMailingSzablon(data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAILING_UPDATE_SZABLON,
    async (_, id: number, data: Omit<MailingSzablon, 'id' | 'createdAt'>) => {
      await database.updateMailingSzablon(id, data);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.MAILING_DELETE_SZABLON, async (_, id: number) => {
    await database.deleteMailingSzablon(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_SELECT_ATTACHMENTS, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => ({ fileName: path.basename(p), filePath: p }));
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_SEND, async (_, request: MailingSendRequest) => {
    try {
      const result = await sendMailing(
        {
          database,
          smtp: database.getMailingSmtp(),
          outputFolder: database.getSetting('outputFolder') || '',
          onProgress: (event) => mainWindow?.webContents.send('mailing:progress', event),
        },
        request,
      );
      if ('error' in result) return { error: result.error };
      return { success: true, results: result.results };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[MAILING] send failed:', message);
      return { error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_HISTORY, async () => {
    try {
      return await database.getMailingHistory();
    } catch (error: unknown) {
      log.error(
        '[MAILING] history read failed:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_CLEAR_HISTORY, async () => {
    await database.clearMailingHistory();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_FILES_INFO, async () => {
    try {
      return getMailingFilesInfo(database.getSetting('outputFolder') || '');
    } catch (error: unknown) {
      log.error(
        '[MAILING] files info failed:',
        error instanceof Error ? error.message : String(error),
      );
      return { dir: '', fileCount: 0, totalBytes: 0 };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_CLEANUP_FILES, async () => {
    try {
      const result = cleanupMailingFiles(database.getSetting('outputFolder') || '');
      return { success: true, ...result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('[MAILING] cleanup failed:', message);
      return { error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MAILING_GET_SMTP, async () => {
    // The password never crosses the bridge — the UI only needs to know that one
    // is stored, so it can show "zapisane" instead of an empty field.
    const { pass, ...config } = database.getMailingSmtp();
    return { ...config, passwordSet: pass.length > 0 };
  });

  ipcMain.handle(
    IPC_CHANNELS.MAILING_SET_SMTP,
    async (_, config: MailingSmtpConfig & { pass?: string }) => {
      database.setMailingSmtp(config);
      return true;
    },
  );

  ipcMain.handle(IPC_CHANNELS.MAILING_TEST_SMTP, async () => {
    return await verifySmtp(database.getMailingSmtp());
  });

  // Auth (Supabase)
  ipcMain.handle(IPC_CHANNELS.AUTH_SIGN_IN, async (_, email: string, password: string) => {
    const result = await authService.signIn(email, password);
    if (result.ok) {
      // A session is required to read app_config — retry the cloud AI key now.
      void loadCloudAIKey();
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SIGN_OUT, async () => {
    await authService.signOut();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_SESSION, async () => {
    return authService.getSession();
  });
}

function setupAutoUpdater() {
  // Configure logging to file
  log.transports.file.level = 'debug';
  autoUpdater.logger = log;
  
  // Configure auto-updater for manual download only
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false; // User will install manually

  // CRITICAL: Allow unsigned builds by setting environment variable
  process.env.ELECTRON_UPDATER_ALLOW_UNVERIFIED = '1';
  
  // Additional flags for development/unsigned builds
  (autoUpdater as any).forceDevUpdateConfig = true;
  (autoUpdater as any).allowDowngrade = true;

  log.info('=== Auto-updater configuration ===');
  log.info('App version:', app.getVersion());
  log.info('Is packaged:', app.isPackaged);
  log.info('Platform:', process.platform);
  log.info('Arch:', process.arch);
  log.info('Feed URL:', 'https://github.com/wikunia-pura/statement_converter');
  log.info('Log file location:', log.transports.file.getFile().path);

  // Check for updates on app start (only in production)
  if (app.isPackaged) {
    log.info('App is packaged, will check for updates in 3 seconds');
    setTimeout(() => {
      log.info('Starting auto-update check...');
      // macOS: niepodpisana aplikacja — używamy tylko checkForUpdates (bez Notify),
      // żeby uniknąć systemowej notyfikacji "kliknij aby zainstalować", która i tak by
      // odpaliła nieobsługiwany flow downloadUpdate. Renderer pokaże własny dialog.
      if (process.platform === 'darwin') {
        autoUpdater.checkForUpdates().catch((err) => {
          log.error('macOS startup update check failed:', err);
        });
      } else {
        autoUpdater.checkForUpdatesAndNotify();
      }
    }, 3000);
  } else {
    log.info('App is not packaged, skipping auto-update check');
  }

  // Listen for update events
  autoUpdater.on('checking-for-update', () => {
    log.info('=== Checking for updates ===');
    log.info('Current version:', app.getVersion());
  });

  autoUpdater.on('update-available', (info) => {
    log.info('=== Update available ===');
    log.info('New version:', info.version);
    log.info('Release date:', info.releaseDate);
    log.info('Download URL:', info.path || 'N/A');
    log.info('Full info:', JSON.stringify(info, null, 2));
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('=== Update not available ===');
    log.info('Current version is the latest:', info.version);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress:', Math.round(progressObj.percent) + '%', 
      'Speed:', Math.round(progressObj.bytesPerSecond / 1024) + ' KB/s');
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('=== Update downloaded successfully ===');
    log.info('Version:', info.version);
    const downloadsFolder = app.getPath('downloads');
    log.info('Downloads folder:', downloadsFolder);
    log.info('Platform:', process.platform);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', {
        ...info,
        downloadPath: downloadsFolder,
        platform: process.platform
      });
    }
    // Windows: automatyczna instalacja
    if (process.platform === 'win32') {
      log.info('Windows platform - will quit and install in 2 seconds');
      setTimeout(() => {
        log.info('Quitting and installing update now...');
        // Don't let the exit-time backup preventDefault this quit — the updater
        // relaunches the app and the startup backup covers the gap.
        backupOnExitDone = true;
        autoUpdater.quitAndInstall();
      }, 2000); // krótka pauza na wyświetlenie info
    } else {
      log.info('Non-Windows platform - manual installation required');
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('=== Update error ===');
    log.error('Error message:', err.message);
    log.error('Error stack:', err.stack);
    log.error('Error details:', JSON.stringify(err, null, 2));
    log.error('Platform:', process.platform);
    log.error('App version:', app.getVersion());
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err.message);
    }
  });
}

app.whenReady().then(() => {
  // Set dock icon for macOS in development mode
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = path.join(__dirname, '..', '..', '..', 'src', 'renderer', 'assets', 'icon-rounded.png');
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);
      app.dock.setIcon(image);
    }
  }

  database = new DatabaseService();
  setDatabaseInstance(database);  // Pass database instance to ConverterRegistry
  converterRegistry = new ConverterRegistry();
  
  // Log loaded converters for debugging
  const loadedConverters = converterRegistry.getAllConverters();
  log.info(`[MAIN] Loaded ${loadedConverters.length} converters: ${loadedConverters.map(c => c.id).join(', ')}`);
  
  setupIpcHandlers();
  setupAutoUpdater();
  createWindow();

  // Anthropic key lives in Supabase (app_config), not in the public binaries.
  // Try shortly after start (covers a restored session); sign-in retries too.
  setTimeout(() => {
    void loadCloudAIKey();
  }, 5000);

  // Startup auto backup — a safety net for days whose exit backup never ran:
  // it writes (and toasts) only when today's file is missing, i.e. on the
  // first open of the day or after a crash killed the previous session before
  // its exit backup. Delayed so the persisted Supabase session has time to
  // restore; without a session the reads fail and the backup is skipped (logged).
  setTimeout(async () => {
    const info = await runAutoBackup(database);
    if (info && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backup:auto-created', { ...info, trigger: 'startup' });
    }
  }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * Fetch the Anthropic key from the shared `app_config` table and hand it to
 * the converter registry. Needs a signed-in Supabase session; failures are
 * logged and retried on the next sign-in. A local ai-config.yml/env key
 * (dev override) short-circuits the fetch — unless the API rejects it, in
 * which case the cloud key takes over.
 */
async function loadCloudAIKey(): Promise<void> {
  try {
    const localKey = converterRegistry.getAnthropicApiKey();
    if (localKey) {
      // A revoked dev key used to shadow the cloud one for good: the failure
      // only surfaced mid-conversion as "AI unavailable". Verify it once here
      // and step aside when the API itself rejects it.
      if ((await isAnthropicKeyAccepted(localKey)) !== false) return;
      log.warn(
        '[AI Config] Local Anthropic key (ai-config.yml / env) rejected by the API ' +
          '— falling back to the cloud key from app_config'
      );
    }

    const key = await database.getAppConfigValue('anthropic_api_key');
    if (!key) {
      log.warn('[AI Config] No anthropic_api_key row in app_config — AI features disabled');
      return;
    }
    converterRegistry.setAnthropicApiKey(key, /* replace */ true);

    // Report a dead cloud key at startup instead of at the first conversion.
    const stored = converterRegistry.getAnthropicApiKey();
    if ((await isAnthropicKeyAccepted(stored)) === false) {
      log.error(
        '[AI Config] Anthropic key from app_config is rejected by the API (401/403) — ' +
          'AI stays disabled until the key is replaced in Supabase app_config'
      );
      return;
    }
    log.info('[AI Config] Anthropic key loaded from Supabase app_config');
  } catch (error) {
    log.warn(`[AI Config] Cloud key fetch failed: ${getErrorMessage(error)}`);
  }
}

/**
 * Cheap liveness check for an Anthropic key (a models list costs no tokens).
 * Returns null when the answer is unknowable — offline, DNS down, 5xx — so a
 * flaky network never discards a perfectly good key.
 */
async function isAnthropicKeyAccepted(key: string): Promise<boolean | null> {
  if (!key) return false;
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return false;
    return response.ok ? true : null;
  } catch {
    return null;
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    database.close();
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (backupOnExitDone || !database) return;
  event.preventDefault();
  runExitBackup(() => app.quit());
});

app.on('quit', () => {
  database.close();
});
