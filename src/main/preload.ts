import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels directly in preload to avoid module resolution issues
const IPC_CHANNELS = {
  GET_BANKS: 'db:get-banks',
  ADD_BANK: 'db:add-bank',
  UPDATE_BANK: 'db:update-bank',
  DELETE_BANK: 'db:delete-bank',
  GET_KONTRAHENCI: 'db:get-kontrahenci',
  ADD_KONTRAHENT: 'db:add-kontrahent',
  UPDATE_KONTRAHENT: 'db:update-kontrahent',
  DELETE_KONTRAHENT: 'db:delete-kontrahent',
  DELETE_ALL_KONTRAHENCI: 'db:delete-all-kontrahenci',
  IMPORT_KONTRAHENCI_FROM_FILE: 'db:import-kontrahenci-from-file',
  IMPORT_KONTRAHENCI_FROM_DOM: 'db:import-kontrahenci-from-dom',
  EXPORT_KONTRAHENCI_TO_FILE: 'db:export-kontrahenci-to-file',
  GET_ADRESY: 'db:get-adresy',
  ADD_ADRES: 'db:add-adres',
  UPDATE_ADRES: 'db:update-adres',
  DELETE_ADRES: 'db:delete-adres',
  DELETE_ALL_ADRESY: 'db:delete-all-adresy',
  IMPORT_ADRESY_FROM_FILE: 'db:import-adresy-from-file',
  EXPORT_ADRESY_TO_FILE: 'db:export-adresy-to-file',
  GET_CONVERTERS: 'converters:get-all',
  SELECT_FILES: 'files:select',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_ALL: 'files:convert-all',
  ANALYZE_FILE: 'files:analyze',
  CONVERT_FILE_WITH_AI: 'files:convert-with-ai',
  FINALIZE_CONVERSION: 'files:finalize-conversion',
  SELECT_PDF: 'files:select-pdf',
  EXTRACT_PDF_TEXT: 'files:extract-pdf-text',
  OPEN_FILE: 'files:open',
  GET_SETTINGS: 'settings:get',
  SET_OUTPUT_FOLDER: 'settings:set-output-folder',
  SET_IMPEX_FOLDER: 'settings:set-impex-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  SET_SKIP_USER_APPROVAL: 'settings:set-skip-user-approval',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
  GET_APP_VERSION: 'app:get-version',
  ZALICZKI_SELECT_PDFS: 'zaliczki:select-pdfs',
  ZALICZKI_EXTRACT_PDF: 'zaliczki:extract-pdf',
  ZALICZKI_GENERATE_XLSX: 'zaliczki:generate-xlsx',
  ZALICZKI_GET_MODELS: 'zaliczki:get-models',
  NOTY_SELECT_PDFS: 'noty:select-pdfs',
  NOTY_SELECT_OUTPUT_DIR: 'noty:select-output-dir',
  NOTY_CONVERT: 'noty:convert',
  SCALANIE_SELECT_FILES: 'scalanie:select-files',
  SCALANIE_ANALYZE_FILE: 'scalanie:analyze-file',
  SCALANIE_SELECT_OUTPUT_DIR: 'scalanie:select-output-dir',
  SCALANIE_MERGE: 'scalanie:merge',
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

  // Kontrahenci
  getKontrahenci: () => ipcRenderer.invoke(IPC_CHANNELS.GET_KONTRAHENCI),
  addKontrahent: (nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_KONTRAHENT, nazwa, kontoKontrahenta, nip, alternativeNames, typ),
  updateKontrahent: (id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_KONTRAHENT, id, nazwa, kontoKontrahenta, nip, alternativeNames, typ),
  deleteKontrahent: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_KONTRAHENT, id),
  deleteAllKontrahenci: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ALL_KONTRAHENCI),
  importKontrahenciFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_FILE),
  importKontrahenciFromDOM: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_DOM),
  exportKontrahenciToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_KONTRAHENCI_TO_FILE),

  // Adresy
  getAdresy: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ADRESY),
  addAdres: (nazwa: string, alternativeNames?: string[], swrkIdentifiers?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_ADRES, nazwa, alternativeNames, swrkIdentifiers),
  updateAdres: (
    id: number,
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.UPDATE_ADRES,
      id,
      nazwa,
      alternativeNames,
      swrkIdentifiers,
    ),
  deleteAdres: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ADRES, id),
  deleteAllAdresy: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ALL_ADRESY),
  importAdresyFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_ADRESY_FROM_FILE),
  exportAdresyToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ADRESY_TO_FILE),

  // Converters
  getConverters: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONVERTERS),

  // Files
  selectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILES),
  selectPdf: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_PDF),
  extractPdfText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_PDF_TEXT, filePath),
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_OUTPUT_FOLDER),
  convertFile: (inputPath: string, bankId: number, fileName: string, adresId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_FILE, inputPath, bankId, fileName, adresId),
  analyzeFile: (inputPath: string, bankId: number, adresId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_FILE, inputPath, bankId, adresId),
  convertFileWithAI: (inputPath: string, bankId: number, fileName: string, adresId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_FILE_WITH_AI, inputPath, bankId, fileName, adresId),
  finalizeConversion: (tempConversionId: string, decisions: any[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.FINALIZE_CONVERSION, tempConversionId, decisions),
  openFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, filePath),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  setOutputFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_OUTPUT_FOLDER, folderPath),
  setImpexFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_IMPEX_FOLDER, folderPath),
  setDarkMode: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_DARK_MODE, enabled),
  setLanguage: (language: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_LANGUAGE, language),
  setSkipUserApproval: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SKIP_USER_APPROVAL, enabled),
  exportSettings: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SETTINGS),
  importSettings: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SETTINGS),

  // History
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),

  // Zaliczki
  zaliczkiGetModels: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_GET_MODELS),
  zaliczkiSelectPdfs: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_SELECT_PDFS),
  zaliczkiExtractPdf: (filePath: string, model: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_EXTRACT_PDF, filePath, model),
  zaliczkiGenerateXlsx: (files: unknown[], year: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_GENERATE_XLSX, files, year),

  // Noty Świadczenia
  notySelectPdfs: () => ipcRenderer.invoke(IPC_CHANNELS.NOTY_SELECT_PDFS),
  notySelectOutputDir: () => ipcRenderer.invoke(IPC_CHANNELS.NOTY_SELECT_OUTPUT_DIR),
  notyConvert: (filePath: string, outputDir: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTY_CONVERT, filePath, outputDir),

  // Scalanie wpłat
  scalanieSelectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SCALANIE_SELECT_FILES),
  scalanieAnalyzeFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCALANIE_ANALYZE_FILE, filePath),
  scalanieSelectOutputDir: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SCALANIE_SELECT_OUTPUT_DIR),
  scalanieMerge: (files: unknown[], outputDir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCALANIE_MERGE, files, outputDir),

  // App info
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),

  // Zoom controls
  zoomIn: () => ipcRenderer.invoke('app:zoom-in'),
  zoomOut: () => ipcRenderer.invoke('app:zoom-out'),
  zoomReset: () => ipcRenderer.invoke('app:zoom-reset'),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update-available', (_event, info) => callback(info));
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
  },
  onUpdateError: (callback: (error: string) => void) => {
    ipcRenderer.on('update-error', (_event, error) => callback(error));
  },
  onDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('download-progress', (_event, progress) => callback(progress));
  },
});
