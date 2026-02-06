import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';

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

  // History
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
});
