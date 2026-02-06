import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels directly in preload to avoid module resolution issues
const IPC_CHANNELS = {
  GET_BANKS: 'db:get-banks',
  ADD_BANK: 'db:add-bank',
  UPDATE_BANK: 'db:update-bank',
  DELETE_BANK: 'db:delete-bank',
  GET_CONVERTERS: 'converters:get-all',
  SELECT_FILES: 'files:select',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_ALL: 'files:convert-all',
  OPEN_FILE: 'files:open',
  GET_SETTINGS: 'settings:get',
  SET_OUTPUT_FOLDER: 'settings:set-output-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
} as const;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Banks
  getBanks: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BANKS),
  addBank: (name: string, converterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_BANK, name, converterId),
  updateBank: (id: number, name: string, converterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_BANK, id, name, converterId),
  deleteBank: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_BANK, id),

  // Converters
  getConverters: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONVERTERS),

  // Files
  selectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILES),
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_OUTPUT_FOLDER),
  convertFile: (inputPath: string, bankId: number, fileName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_FILE, inputPath, bankId, fileName),
  openFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, filePath),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  setOutputFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_OUTPUT_FOLDER, folderPath),
  setDarkMode: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_DARK_MODE, enabled),
  setLanguage: (language: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_LANGUAGE, language),
  exportSettings: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SETTINGS),
  importSettings: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SETTINGS),

  // History
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
});
