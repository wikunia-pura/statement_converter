import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import DatabaseService from './database';
import ConverterRegistry from './converterRegistry';
import { IPC_CHANNELS } from '../shared/types';

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

  // Development mode: always load from Vite dev server
  // In production, the URL would be changed by electron-builder
  mainWindow.loadURL('http://localhost:3000');
  mainWindow.webContents.openDevTools();

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

  // History
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    return database.getAllHistory();
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    database.clearHistory();
    return true;
  });
}

app.whenReady().then(() => {
  database = new DatabaseService();
  converterRegistry = new ConverterRegistry();
  setupIpcHandlers();
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
