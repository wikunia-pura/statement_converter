import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
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
      return { available: false, message: 'Updates disabled in development mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { available: true, info: result?.updateInfo };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });
}

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // CRITICAL: Allow unsigned builds by setting environment variable
  process.env.ELECTRON_UPDATER_ALLOW_UNVERIFIED = '1';
  
  // Additional flags for development/unsigned builds
  (autoUpdater as any).forceDevUpdateConfig = true;
  (autoUpdater as any).allowDowngrade = true;

  // Enable detailed logging
  autoUpdater.logger = console;

  console.log('Auto-updater configuration:');
  console.log('- App version:', app.getVersion());
  console.log('- Is packaged:', app.isPackaged);
  console.log('- Feed URL will be:', 'https://github.com/wikunia-pura/statement_converter');

  // Check for updates on app start (only in production)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
  }

  // Listen for update events
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    console.log('Current version:', app.getVersion());
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available:', info);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    console.log('Download progress:', progressObj.percent);
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    console.error('Error stack:', err.stack);
    console.error('Error details:', JSON.stringify(err, null, 2));
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
