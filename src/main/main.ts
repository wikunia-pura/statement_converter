import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import DatabaseService from './database';
import ConverterRegistry from './converterRegistry';
import { IPC_CHANNELS } from '../shared/types';

const DEV_SERVER_PORT = 3000;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

let mainWindow: BrowserWindow | null = null;
let database: DatabaseService;
let converterRegistry: ConverterRegistry;

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

  // Converters
  ipcMain.handle(IPC_CHANNELS.GET_CONVERTERS, async () => {
    return converterRegistry.getAllConverters();
  });

  // File operations
  ipcMain.handle(IPC_CHANNELS.SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Bank Statements', extensions: ['xml', 'txt', '940', 'mt940', 'csv', 'xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] },
      ],
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

  ipcMain.handle(
    IPC_CHANNELS.CONVERT_FILE,
    async (_, inputPath: string, bankId: number, fileName: string) => {
      try {
        // Validate input file exists
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = database.getBankById(bankId);
        if (!bank) {
          throw new Error('Bank not found');
        }

        const converter = converterRegistry.getConverter(bank.converterId);
        if (!converter) {
          throw new Error('Converter not found');
        }

        const outputFolder = database.getSetting('outputFolder');
        if (!outputFolder) {
          throw new Error('Output folder not configured');
        }
        
        // Ensure output folder exists
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Change extension to .txt
        const baseFileName = path.parse(fileName).name;
        const outputFileName = `${baseFileName}.txt`;
        const outputPath = path.join(outputFolder, outputFileName);

        // Check if file exists and inform user
        let finalOutputPath = outputPath;
        if (fs.existsSync(outputPath)) {
          const timestamp = Date.now();
          finalOutputPath = path.join(
            outputFolder,
            `${baseFileName}_${timestamp}.txt`
          );
        }

        // Perform conversion
        await converterRegistry.convert(bank.converterId, inputPath, finalOutputPath);

        // Save to history
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
          duplicateWarning: finalOutputPath !== outputPath,
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
    async (_, inputPath: string, bankId: number) => {
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
          threshold
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
    async (_, inputPath: string, bankId: number, fileName: string) => {
      try {
        if (!fs.existsSync(inputPath)) {
          throw new Error('Input file not found');
        }

        const bank = database.getBankById(bankId);
        if (!bank) {
          throw new Error('Bank not found');
        }

        const converter = converterRegistry.getConverter(bank.converterId);
        if (!converter) {
          throw new Error('Converter not found');
        }

        const outputFolder = database.getSetting('outputFolder');
        if (!outputFolder) {
          throw new Error('Output folder not configured');
        }
        
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }

        const baseFileName = path.parse(fileName).name;
        const outputFileName = `${baseFileName}.txt`;
        const outputPath = path.join(outputFolder, outputFileName);

        let finalOutputPath = outputPath;
        if (fs.existsSync(outputPath)) {
          const timestamp = Date.now();
          finalOutputPath = path.join(
            outputFolder,
            `${baseFileName}_${timestamp}.txt`
          );
        }

        // Perform conversion WITH AI
        await converterRegistry.convert(bank.converterId, inputPath, finalOutputPath, true);

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
          duplicateWarning: finalOutputPath !== outputPath,
        };
      } catch (error: unknown) {
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

  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async (_, filePath: string) => {
    await shell.openPath(filePath);
    return true;
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    return {
      outputFolder: database.getSetting('outputFolder') || '',
      darkMode: database.getSetting('darkMode') === 'true',
      language: database.getSetting('language') || 'pl',
    };
  });

  ipcMain.handle(IPC_CHANNELS.SET_OUTPUT_FOLDER, async (_, folderPath: string) => {
    database.setSetting('outputFolder', folderPath);
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
  converterRegistry = new ConverterRegistry();
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
