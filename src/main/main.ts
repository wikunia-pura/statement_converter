import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import DatabaseService from './database';
import ConverterRegistry, { setDatabaseInstance } from './converterRegistry';
import { IPC_CHANNELS, KontrahentTyp } from '../shared/types';
import { extractPdfText } from '../shared/pdf-utils';

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
function generateOutputFileName(adresId: number | null | undefined, db: DatabaseService): string {
  const timestamp = generateTimestamp();
  
  // Get address name if adresId provided
  let addressPart = 'wyciag';
  if (adresId !== null && adresId !== undefined) {
    const adres = db.getAdresById(adresId);
    if (adres) {
      addressPart = sanitizeForFilename(adres.nazwa);
    }
  } else {
    // Try to get first/default address
    const allAddresses = db.getAllAdresy();
    if (allAddresses.length > 0) {
      addressPart = sanitizeForFilename(allAddresses[0].nazwa);
    }
  }
  
  return `${addressPart}_${timestamp}.txt`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
    return database.getAllBanks();
  });

  ipcMain.handle(IPC_CHANNELS.ADD_BANK, async (_, name: string, converterId: string) => {
    return database.addBank(name, converterId);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_BANK, async (_, id: number, name: string, converterId: string) => {
    database.updateBank(id, name, converterId);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_BANK, async (_, id: number) => {
    database.deleteBank(id);
    return true;
  });

  // Database - Kontrahenci
  ipcMain.handle(IPC_CHANNELS.GET_KONTRAHENCI, async () => {
    return database.getAllKontrahenci();
  });

  ipcMain.handle(IPC_CHANNELS.ADD_KONTRAHENT, async (_, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: string) => {
    return database.addKontrahent(nazwa, kontoKontrahenta, nip, alternativeNames, typ as any);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_KONTRAHENT, async (_, id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: string) => {
    database.updateKontrahent(id, nazwa, kontoKontrahenta, nip, alternativeNames, typ as any);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_KONTRAHENT, async (_, id: number) => {
    database.deleteKontrahent(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ALL_KONTRAHENCI, async () => {
    database.deleteAllKontrahenci();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_FILE, async () => {
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
      
      // Parse the file
      const lines = content.split('\n');
      let added = 0;
      let updated = 0;
      let lastKontrahent: any = null;
      let wasNewlyAdded = false; // Track if lastKontrahent was just added
      let accumulatedNip: string | undefined = undefined;
      let accumulatedAltNames: string[] = [];
      let accumulatedTyp: string | undefined = undefined;
      
      const finalizeLastKontrahent = () => {
        if (lastKontrahent && (accumulatedNip || accumulatedAltNames.length > 0 || accumulatedTyp)) {
          database.updateKontrahent(
            lastKontrahent.id, 
            lastKontrahent.nazwa, 
            lastKontrahent.kontoKontrahenta, 
            accumulatedNip, 
            accumulatedAltNames,
            accumulatedTyp as KontrahentTyp
          );
          if (accumulatedNip) lastKontrahent.nip = accumulatedNip;
          if (accumulatedAltNames.length > 0) lastKontrahent.alternativeNames = accumulatedAltNames;
          if (accumulatedTyp) lastKontrahent.typ = accumulatedTyp;
          
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
        
        // Check if it's a TYP line
        const typMatch = line.match(/^\s*TYP:\s*(.+)$/);
        if (typMatch && lastKontrahent) {
          const typValue = typMatch[1].trim();
          if (typValue === 'Pozostałe przychody' || typValue === 'Pozostałe koszty') {
            accumulatedTyp = typValue;
          }
          continue;
        }
        
        // Parse data line - Symbol and Nazwa are separated by spaces
        // Symbol is in format like "201-00001" and Nazwa follows, then multiple spaces before Z/N column
        // Example: "       201-00001    Miasto Stołeczne Warszawa                 Z   1   S"
        const match = line.match(/^\s*(\d{3}-\d+)\s+(.+?)\s{2,}[ZN]\s+/);
        if (match) {
          // Finalize previous kontrahent with accumulated data
          finalizeLastKontrahent();
          accumulatedNip = undefined;
          accumulatedAltNames = [];
          accumulatedTyp = undefined;
          
          const symbol = match[1].trim();
          const nazwa = match[2].trim();
          
          // Check if already exists
          const existing = database.getAllKontrahenci().find(
            k => k.kontoKontrahenta === symbol
          );
          
          if (!existing) {
            lastKontrahent = database.addKontrahent(nazwa, symbol, undefined, []);
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
      finalizeLastKontrahent();
      
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
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const filePath = result.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Parse the file
      const lines = content.split('\n');
      let added = 0;
      let updated = 0;
      let lastKontrahent: any = null;
      let lastNazwa: string | null = null;
      let lastSymbol: string | null = null;
      let accumulatedNip: string | undefined = undefined;
      
      const finalizeLastKontrahent = () => {
        if (lastNazwa && lastSymbol) {
          // Match by nazwa (main name), not by symbol
          const existing = database.getAllKontrahenci().find(
            k => k.nazwa.toLowerCase() === lastNazwa!.toLowerCase()
          );
          
          if (existing) {
            // Update existing: nazwa, kontoKontrahenta, nip can change
            // BUT keep existing alternativeNames
            database.updateKontrahent(
              existing.id,
              lastNazwa,
              lastSymbol,
              accumulatedNip,
              existing.alternativeNames || []
            );
            updated++;
          } else {
            // Add new
            database.addKontrahent(lastNazwa, lastSymbol, accumulatedNip, []);
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
          finalizeLastKontrahent();
          
          lastSymbol = match[1].trim();
          lastNazwa = match[2].trim();
          accumulatedNip = undefined;
        }
      }
      
      // Finalize last kontrahent in file
      finalizeLastKontrahent();
      
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

      const kontrahenci = database.getAllKontrahenci();
      
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
        
        // Add alternative names if present
        if (k.alternativeNames && k.alternativeNames.length > 0) {
          lines.push(`    ALT: ${k.alternativeNames.join(', ')}`);
        }
        
        // Add typ if not default
        if (k.typ && k.typ !== 'Kontrahent') {
          lines.push(`    TYP: ${k.typ}`);
        }
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
    return database.getAllAdresy();
  });

  ipcMain.handle(IPC_CHANNELS.ADD_ADRES, async (_, nazwa: string, alternativeNames?: string[]) => {
    return database.addAdres(nazwa, alternativeNames);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_ADRES, async (_, id: number, nazwa: string, alternativeNames?: string[]) => {
    database.updateAdres(id, nazwa, alternativeNames);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ADRES, async (_, id: number) => {
    database.deleteAdres(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ALL_ADRESY, async () => {
    database.deleteAllAdresy();
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
      
      // Parse the file
      const lines = content.split('\n');
      let count = 0;
      let lastAdres: any = null;
      let accumulatedAltNames: string[] = [];
      
      const finalizeLastAdres = () => {
        if (lastAdres && accumulatedAltNames.length > 0) {
          database.updateAdres(lastAdres.id, lastAdres.nazwa, accumulatedAltNames);
          lastAdres.alternativeNames = accumulatedAltNames;
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
          // Accumulate alternative name
          const altName = altMatch[1].trim();
          if (altName.length > 0) {
            accumulatedAltNames.push(altName);
          }
          continue;
        }
        
        // Parse data line - just nazwa (no symbol)
        const nazwa = line.trim();
        if (nazwa.length > 0 && !nazwa.startsWith('ALT:')) {
          // Finalize previous adres with accumulated alt names
          finalizeLastAdres();
          accumulatedAltNames = [];
          
          // Check if not already exists
          const existing = database.getAllAdresy().find(
            a => a.nazwa === nazwa
          );
          
          if (!existing) {
            lastAdres = database.addAdres(nazwa, []);
            count++;
          } else {
            lastAdres = null;
          }
        }
      }
      
      // Finalize last adres in file
      finalizeLastAdres();
      
      return { success: true, count };
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

      const adresy = database.getAllAdresy();
      
      // Create text content: simple list of nazwy with ALT: lines for alternative names
      const lines: string[] = [];
      lines.push('Adresy');
      lines.push('-'.repeat(50));
      
      for (const a of adresy) {
        // Main nazwa
        lines.push(a.nazwa);
        
        // Add alternative names if present
        if (a.alternativeNames && a.alternativeNames.length > 0) {
          for (const altName of a.alternativeNames) {
            lines.push(`  ALT: ${altName}`);
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

  ipcMain.handle(
    IPC_CHANNELS.CONVERT_FILE,
    async (_, inputPath: string, bankId: number, fileName: string, adresId?: number | null) => {
      try {
        // Validate input file exists
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = database.getBankById(bankId);
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
        const outputFileName = generateOutputFileName(adresId, database);
        const finalOutputPath = path.join(outputFolder, outputFileName);

        // Perform conversion
        const result = await converterRegistry.convert(
          bank.converterId, 
          inputPath, 
          finalOutputPath, 
          false, 
          adresId,
          fileName,
          bank.name
        );

        // Check if review is needed
        if (result.needsReview && result.reviewData) {
          return {
            needsReview: true,
            reviewData: result.reviewData,
          };
        }

        // Save to history (only if no review needed)
        database.addConversionHistory({
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
        const bank = database.getBankById(bankId);
        if (bank) {
          const converter = converterRegistry.getConverter(bank.converterId);
          database.addConversionHistory({
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

  // Analyze file without AI to check confidence
  ipcMain.handle(
    'files:analyze',
    async (_, inputPath: string, bankId: number, adresId?: number | null) => {
      try {
        const bank = database.getBankById(bankId);
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
    async (_, inputPath: string, bankId: number, fileName: string, adresId?: number | null) => {
      try {
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = database.getBankById(bankId);
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
        const outputFileName = generateOutputFileName(adresId, database);
        const finalOutputPath = path.join(outputFolder, outputFileName);

        try {
          // Perform conversion WITH AI
          const result = await converterRegistry.convert(
            bank.converterId, 
            inputPath, 
            finalOutputPath, 
            true, 
            adresId,
            fileName,
            bank.name
          );

          // Check if review is needed
          if (result.needsReview && result.reviewData) {
            return {
              needsReview: true,
              reviewData: result.reviewData,
            };
          }

          database.addConversionHistory({
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
              bank.name
            );

            // Check if review is needed
            if (fallbackResult.needsReview && fallbackResult.reviewData) {
              return {
                needsReview: true,
                reviewData: fallbackResult.reviewData,
                warningMessage: 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.',
              };
            }

            database.addConversionHistory({
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
              warningMessage: 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.',
            };
          } catch (fallbackError: unknown) {
            // If even standard conversion fails, throw original AI error
            log.error('[Fallback Failed]:', fallbackError);
            throw new Error(`AI failed: ${aiErrorMessage}. Standard conversion also failed.`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        const bank = database.getBankById(bankId);
        if (bank) {
          const converter = converterRegistry.getConverter(bank.converterId);
          database.addConversionHistory({
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
          database.addConversionHistory({
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
    return {
      outputFolder: database.getSetting('outputFolder') || '',
      impexFolder: database.getSetting('impexFolder') || '',
      darkMode: database.getSetting('darkMode') === 'true',
      language: database.getSetting('language') || 'pl',
      skipUserApproval: database.getSetting('skipUserApproval') === 'true',
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
    return database.getAllHistory();
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    database.clearHistory();
    return true;
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
        autoUpdater.removeAllListeners('update-available');
        autoUpdater.removeAllListeners('update-not-available');
        autoUpdater.removeAllListeners('error');
        log.error('checkForUpdates failed:', error);
        resolve({ available: false, error: error.message });
      });
    });
  });

  ipcMain.handle('download-update', async () => {
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
      autoUpdater.checkForUpdatesAndNotify();
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    database.close();
    app.quit();
  }
});

app.on('before-quit', () => {
  database.close();
});
