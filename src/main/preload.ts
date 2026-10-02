import { contextBridge, ipcRenderer } from 'electron';

// Define IPC channels directly in preload to avoid module resolution issues
const IPC_CHANNELS = {
  GET_BANKS: 'db:get-banks',
  ADD_BANK: 'db:add-bank',
  UPDATE_BANK: 'db:update-bank',
  DELETE_BANK: 'db:delete-bank',
  DELETE_ALL_BANKS: 'db:delete-all-banks',
  IMPORT_BANKS_FROM_FILE: 'db:import-banks-from-file',
  EXPORT_BANKS_TO_FILE: 'db:export-banks-to-file',
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
  GET_KONTO_TYPY: 'db:get-konto-typy',
  ADD_KONTO_TYP: 'db:add-konto-typ',
  UPDATE_KONTO_TYP: 'db:update-konto-typ',
  DELETE_KONTO_TYP: 'db:delete-konto-typ',
  IMPORT_KONTO_TYPY_FROM_FILE: 'db:import-konto-typy-from-file',
  EXPORT_KONTO_TYPY_TO_FILE: 'db:export-konto-typy-to-file',
  GET_CONVERTERS: 'converters:get-all',
  SELECT_FILES: 'files:select',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_ALL: 'files:convert-all',
  ANALYZE_FILE: 'files:analyze',
  DETECT_ACCOUNT_NUMBERS: 'files:detect-account-numbers',
  CONVERT_FILE_WITH_AI: 'files:convert-with-ai',
  FINALIZE_CONVERSION: 'files:finalize-conversion',
  RERUN_EXPENSE_AI: 'files:rerun-expense-ai',
  TOUCH_CONVERSION: 'files:touch-conversion',
  SELECT_PDF: 'files:select-pdf',
  EXTRACT_PDF_TEXT: 'files:extract-pdf-text',
  OPEN_FILE: 'files:open',
  GET_SETTINGS: 'settings:get',
  SET_OUTPUT_FOLDER: 'settings:set-output-folder',
  SET_IMPEX_FOLDER: 'settings:set-impex-folder',
  SET_SWRK_FOLDER: 'settings:set-swrk-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  SET_SKIP_USER_APPROVAL: 'settings:set-skip-user-approval',
  SET_ALWAYS_USE_AI: 'settings:set-always-use-ai',
  SET_CONTRACTOR_SORT_ORDER: 'settings:set-contractor-sort-order',
  SET_SIDEBAR_COLLAPSED: 'settings:set-sidebar-collapsed',
  SET_BOOKINGS_COLLAPSED: 'settings:set-bookings-collapsed',
  SET_CALENDAR_HOVER_CARD: 'settings:set-calendar-hover-card',
  GET_NOTIFICATION_PREFS: 'notifications:get-prefs',
  SET_NOTIFICATION_PREF: 'notifications:set-pref',
  SET_LAST_SEEN_VERSION: 'settings:set-last-seen-version',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
  IMPORT_HISTORY_FROM_FILE: 'history:import-from-file',
  EXPORT_HISTORY_TO_FILE: 'history:export-to-file',
  SET_HISTORY_BOOKED_IN_DOM: 'history:set-booked-in-dom',
  BACKUP_EXPORT: 'backup:export',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_GET_STATUS: 'backup:get-status',
  BACKUP_OPEN_FOLDER: 'backup:open-folder',
  GET_APP_VERSION: 'app:get-version',
  ZALICZKI_SELECT_PDFS: 'zaliczki:select-pdfs',
  ZALICZKI_EXTRACT_PDF: 'zaliczki:extract-pdf',
  ZALICZKI_GENERATE_XLSX: 'zaliczki:generate-xlsx',
  ZALICZKI_GET_MODELS: 'zaliczki:get-models',
  ZALICZKI_CACHE_STATS: 'zaliczki:cache-stats',
  ZALICZKI_CLEAR_CACHE: 'zaliczki:clear-cache',
  NOTY_SELECT_PDFS: 'noty:select-pdfs',
  NOTY_SELECT_OUTPUT_DIR: 'noty:select-output-dir',
  NOTY_CONVERT: 'noty:convert',
  SCALANIE_SELECT_FILES: 'scalanie:select-files',
  SCALANIE_ANALYZE_FILE: 'scalanie:analyze-file',
  SCALANIE_SELECT_OUTPUT_DIR: 'scalanie:select-output-dir',
  SCALANIE_MERGE: 'scalanie:merge',
  HOMEBANKING_SELECT_FILES: 'homebanking:select-files',
  HOMEBANKING_ANALYZE_FILE: 'homebanking:analyze-file',
  HOMEBANKING_SELECT_OUTPUT_DIR: 'homebanking:select-output-dir',
  HOMEBANKING_MERGE: 'homebanking:merge',
  ODCZYTY_SELECT_FILES: 'odczyty:select-files',
  ODCZYTY_ANALYZE_FILE: 'odczyty:analyze-file',
  ODCZYTY_SELECT_OUTPUT_DIR: 'odczyty:select-output-dir',
  ODCZYTY_CONVERT: 'odczyty:convert',
  ODCZYTY_GET_HISTORY: 'odczyty:get-history',
  ODCZYTY_CLEAR_HISTORY: 'odczyty:clear-history',
  MAILING_GET_ZGN: 'mailing:get-zgn',
  MAILING_ADD_ZGN: 'mailing:add-zgn',
  MAILING_UPDATE_ZGN: 'mailing:update-zgn',
  MAILING_DELETE_ZGN: 'mailing:delete-zgn',
  MAILING_GET_POLA: 'mailing:get-pola',
  MAILING_ADD_POLE: 'mailing:add-pole',
  MAILING_UPDATE_POLE: 'mailing:update-pole',
  MAILING_DELETE_POLE: 'mailing:delete-pole',
  MAILING_GET_SZABLONY: 'mailing:get-szablony',
  MAILING_ADD_SZABLON: 'mailing:add-szablon',
  MAILING_UPDATE_SZABLON: 'mailing:update-szablon',
  MAILING_DELETE_SZABLON: 'mailing:delete-szablon',
  MAILING_SELECT_ATTACHMENTS: 'mailing:select-attachments',
  MAILING_SEND: 'mailing:send',
  MAILING_GET_HISTORY: 'mailing:get-history',
  MAILING_CLEAR_HISTORY: 'mailing:clear-history',
  MAILING_GET_FILES_INFO: 'mailing:get-files-info',
  MAILING_CLEANUP_FILES: 'mailing:cleanup-files',
  MAILING_GET_SMTP: 'mailing:get-smtp',
  MAILING_SET_SMTP: 'mailing:set-smtp',
  MAILING_TEST_SMTP: 'mailing:test-smtp',
  GET_APP_USERS: 'kalendarz:get-app-users',
  SET_APP_USER_NAME: 'users:set-name',
  SET_APP_USER_COLOR: 'users:set-color',
  GET_SPOTKANIA_TYPY: 'kalendarz:get-typy',
  ADD_SPOTKANIE_TYP: 'kalendarz:add-typ',
  UPDATE_SPOTKANIE_TYP: 'kalendarz:update-typ',
  DELETE_SPOTKANIE_TYP: 'kalendarz:delete-typ',
  GET_SPOTKANIA_LOKALIZACJE: 'kalendarz:get-lokalizacje',
  ADD_SPOTKANIE_LOKALIZACJA: 'kalendarz:add-lokalizacja',
  UPDATE_SPOTKANIE_LOKALIZACJA: 'kalendarz:update-lokalizacja',
  DELETE_SPOTKANIE_LOKALIZACJA: 'kalendarz:delete-lokalizacja',
  GET_SPOTKANIA: 'kalendarz:get-spotkania',
  ADD_SPOTKANIE: 'kalendarz:add-spotkanie',
  UPDATE_SPOTKANIE: 'kalendarz:update-spotkanie',
  DELETE_SPOTKANIE: 'kalendarz:delete-spotkanie',
  ACK_SPOTKANIE_TERMIN: 'kalendarz:ack-termin',
  SET_SPOTKANIE_TERMIN_STATUS: 'kalendarz:set-termin-status',
  SET_SPOTKANIE_DOKUMENTY: 'kalendarz:set-dokumenty',
  GET_SPOTKANIA_MAILINGI: 'kalendarz:get-mailingi',
  GET_ZADANIA: 'zadania:get',
  ADD_ZADANIE: 'zadania:add',
  UPDATE_ZADANIE: 'zadania:update',
  MOVE_ZADANIE: 'zadania:move',
  DELETE_ZADANIE: 'zadania:delete',
  ZADANIA_PICK_ATTACHMENT: 'zadania:pick-attachment',
  ZADANIA_UPLOAD_ATTACHMENT: 'zadania:upload-attachment',
  ZADANIA_DOWNLOAD_ATTACHMENT: 'zadania:download-attachment',
  ZADANIA_DISCARD_ATTACHMENTS: 'zadania:discard-attachments',
  GET_ZADANIE_KOMENTARZE: 'zadania:get-komentarze',
  GET_ZADANIA_NOTATKI: 'zadania:get-notatki',
  ADD_ZADANIE_NOTATKA: 'zadania:add-notatka',
  DELETE_ZADANIE_NOTATKA: 'zadania:delete-notatka',
  UPDATE_ZADANIE_NOTATKA: 'zadania:update-notatka',
  GET_ZADANIA_KOMENTARZE_PODSUMOWANIE: 'zadania:get-komentarze-podsumowanie',
  ADD_ZADANIE_KOMENTARZ: 'zadania:add-komentarz',
  DELETE_ZADANIE_KOMENTARZ: 'zadania:delete-komentarz',
  GET_KS_PRIORYTETY: 'ksiegowania:get-priorytety',
  ADD_KS_PRIORYTET: 'ksiegowania:add-priorytet',
  SET_KS_PRIORYTET_NOTATKA: 'ksiegowania:set-priorytet-notatka',
  REMOVE_KS_PRIORYTET: 'ksiegowania:remove-priorytet',
  REORDER_KS_PRIORYTETY: 'ksiegowania:reorder-priorytety',
  GET_KS_UWAGI: 'ksiegowania:get-uwagi',
  ADD_KS_UWAGA: 'ksiegowania:add-uwaga',
  UPDATE_KS_UWAGA: 'ksiegowania:update-uwaga',
  SET_KS_UWAGA_RESOLVED: 'ksiegowania:set-uwaga-resolved',
  DELETE_KS_UWAGA: 'ksiegowania:delete-uwaga',
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',
  AUTH_CONSUME_EXPIRY_NOTICE: 'auth:consume-expiry-notice',
} as const;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Banks
  getBanks: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BANKS),
  addBank: (name: string, converterId: string, accountPrefixes?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_BANK, name, converterId, accountPrefixes),
  updateBank: (id: number, name: string, converterId: string, accountPrefixes?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_BANK, id, name, converterId, accountPrefixes),
  deleteBank: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_BANK, id),
  deleteAllBanks: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ALL_BANKS),
  importBanksFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_BANKS_FROM_FILE),
  exportBanksToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_BANKS_TO_FILE),

  // Kontrahenci
  getKontrahenci: () => ipcRenderer.invoke(IPC_CHANNELS.GET_KONTRAHENCI),
  addKontrahent: (nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_KONTRAHENT, nazwa, kontoKontrahenta, nip, alternativeNames, typy),
  updateKontrahent: (id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_KONTRAHENT, id, nazwa, kontoKontrahenta, nip, alternativeNames, typy),
  deleteKontrahent: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_KONTRAHENT, id),
  deleteAllKontrahenci: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ALL_KONTRAHENCI),
  importKontrahenciFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_FILE),
  importKontrahenciFromDOM: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_KONTRAHENCI_FROM_DOM),
  exportKontrahenciToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_KONTRAHENCI_TO_FILE),

  // Adresy
  getAdresy: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ADRESY),
  addAdres: (
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: import('../shared/types').ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.ADD_ADRES,
      nazwa,
      alternativeNames,
      swrkIdentifiers,
      bankId,
      accountNumbers,
      apartmentMappings,
      accountTypes,
      zgnJednostkaId,
    ),
  updateAdres: (
    id: number,
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: import('../shared/types').ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.UPDATE_ADRES,
      id,
      nazwa,
      alternativeNames,
      swrkIdentifiers,
      bankId,
      accountNumbers,
      apartmentMappings,
      accountTypes,
      zgnJednostkaId,
    ),
  deleteAdres: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ADRES, id),
  deleteAllAdresy: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ALL_ADRESY),
  importAdresyFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_ADRESY_FROM_FILE),
  exportAdresyToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ADRESY_TO_FILE),

  // Konto typy
  getKontoTypy: () => ipcRenderer.invoke(IPC_CHANNELS.GET_KONTO_TYPY),
  addKontoTyp: (name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_KONTO_TYP, name, bankAccountSymbol, apartmentPrefix, isDefault),
  updateKontoTyp: (id: number, name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_KONTO_TYP, id, name, bankAccountSymbol, apartmentPrefix, isDefault),
  deleteKontoTyp: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_KONTO_TYP, id),
  importKontoTypyFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_KONTO_TYPY_FROM_FILE),
  exportKontoTypyToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_KONTO_TYPY_TO_FILE),

  // Converters
  getConverters: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONVERTERS),

  // Files
  selectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILES),
  selectPdf: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_PDF),
  extractPdfText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_PDF_TEXT, filePath),
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_OUTPUT_FOLDER),
  convertFile: (inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_FILE, inputPath, bankId, fileName, adresId, accountTypeId),
  analyzeFile: (inputPath: string, bankId: number, adresId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_FILE, inputPath, bankId, adresId),
  detectAccountNumbers: (inputPath: string, bankId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.DETECT_ACCOUNT_NUMBERS, inputPath, bankId),
  convertFileWithAI: (inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_FILE_WITH_AI, inputPath, bankId, fileName, adresId, accountTypeId),
  finalizeConversion: (tempConversionId: string, decisions: any[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.FINALIZE_CONVERSION, tempConversionId, decisions),
  rerunExpenseAI: (tempConversionId: string, indices: number[], fileName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RERUN_EXPENSE_AI, tempConversionId, indices, fileName),
  touchConversion: (tempConversionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TOUCH_CONVERSION, tempConversionId),
  openFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, filePath),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  setOutputFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_OUTPUT_FOLDER, folderPath),
  setImpexFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_IMPEX_FOLDER, folderPath),
  setSwrkFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SWRK_FOLDER, folderPath),
  setDarkMode: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_DARK_MODE, enabled),
  setLanguage: (language: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_LANGUAGE, language),
  setSkipUserApproval: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SKIP_USER_APPROVAL, enabled),
  setAlwaysUseAI: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_ALWAYS_USE_AI, enabled),
  setContractorSortOrder: (sortOrder: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_CONTRACTOR_SORT_ORDER, sortOrder),
  setSidebarCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SIDEBAR_COLLAPSED, collapsed),
  setBookingsCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_BOOKINGS_COLLAPSED, collapsed),
  setCalendarHoverCard: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_CALENDAR_HOVER_CARD, enabled),
  getNotificationPrefs: () => ipcRenderer.invoke(IPC_CHANNELS.GET_NOTIFICATION_PREFS),
  setNotificationPref: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_NOTIFICATION_PREF, id, enabled),
  setLastSeenVersion: (version: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_LAST_SEEN_VERSION, version),
  exportSettings: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SETTINGS),
  importSettings: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SETTINGS),

  // History
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
  importHistoryFromFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_HISTORY_FROM_FILE),
  exportHistoryToFile: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_HISTORY_TO_FILE),
  setHistoryBookedInDom: (ids: number[], booked: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_HISTORY_BOOKED_IN_DOM, ids, booked),

  // Backup
  backupExport: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_EXPORT),
  backupRestore: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE),
  backupGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_GET_STATUS),
  backupOpenFolder: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_OPEN_FOLDER),

  // Zaliczki
  zaliczkiGetModels: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_GET_MODELS),
  zaliczkiSelectPdfs: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_SELECT_PDFS),
  zaliczkiExtractPdf: (filePath: string, model: string, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_EXTRACT_PDF, filePath, model, force),
  zaliczkiGenerateXlsx: (files: unknown[], year: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_GENERATE_XLSX, files, year),
  zaliczkiCacheStats: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_CACHE_STATS),
  zaliczkiClearCache: () => ipcRenderer.invoke(IPC_CHANNELS.ZALICZKI_CLEAR_CACHE),
  onZaliczkiProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on('zaliczki:progress', listener);
    return () => ipcRenderer.off('zaliczki:progress', listener);
  },

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

  // Homebanking
  homebankingSelectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.HOMEBANKING_SELECT_FILES),
  homebankingAnalyzeFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOMEBANKING_ANALYZE_FILE, filePath),
  homebankingSelectOutputDir: () =>
    ipcRenderer.invoke(IPC_CHANNELS.HOMEBANKING_SELECT_OUTPUT_DIR),
  homebankingMerge: (files: unknown[], outputDir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.HOMEBANKING_MERGE, files, outputDir),

  // Odczyty liczników
  odczytySelectFiles: () => ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_SELECT_FILES),
  odczytyAnalyzeFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_ANALYZE_FILE, filePath),
  odczytySelectOutputDir: () =>
    ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_SELECT_OUTPUT_DIR),
  odczytyConvert: (filePaths: string[], outputDir: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_CONVERT, filePaths, outputDir),
  odczytyGetHistory: () => ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_GET_HISTORY),
  odczytyClearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.ODCZYTY_CLEAR_HISTORY),

  // Mailing
  mailingGetZgn: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_ZGN),
  mailingAddZgn: (nazwa: string, email: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_ADD_ZGN, nazwa, email),
  mailingUpdateZgn: (id: number, nazwa: string, email: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_UPDATE_ZGN, id, nazwa, email),
  mailingDeleteZgn: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.MAILING_DELETE_ZGN, id),
  mailingGetPola: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_POLA),
  mailingAddPole: (nazwa: string, tekst: string, jednostka: string, typWartosci: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_ADD_POLE, nazwa, tekst, jednostka, typWartosci),
  mailingUpdatePole: (
    id: number,
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: string,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.MAILING_UPDATE_POLE,
      id,
      nazwa,
      tekst,
      jednostka,
      typWartosci,
    ),
  mailingDeletePole: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.MAILING_DELETE_POLE, id),
  mailingGetSzablony: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_SZABLONY),
  mailingAddSzablon: (data: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_ADD_SZABLON, data),
  mailingUpdateSzablon: (id: number, data: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_UPDATE_SZABLON, id, data),
  mailingDeleteSzablon: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.MAILING_DELETE_SZABLON, id),
  mailingSelectAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_SELECT_ATTACHMENTS),
  mailingSend: (request: unknown) => ipcRenderer.invoke(IPC_CHANNELS.MAILING_SEND, request),
  mailingGetHistory: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_HISTORY),
  mailingClearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_CLEAR_HISTORY),
  mailingGetFilesInfo: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_FILES_INFO),
  mailingCleanupFiles: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_CLEANUP_FILES),
  mailingGetSmtp: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_GET_SMTP),
  mailingSetSmtp: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.MAILING_SET_SMTP, config),
  mailingTestSmtp: () => ipcRenderer.invoke(IPC_CHANNELS.MAILING_TEST_SMTP),
  onMailingProgress: (callback: (progress: any) => void) => {
    const listener = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('mailing:progress', listener);
    return () => ipcRenderer.off('mailing:progress', listener);
  },

  // Kalendarz
  getAppUsers: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_USERS),
  setAppUserName: (id: string, firstName: string, lastName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_APP_USER_NAME, id, firstName, lastName),
  setAppUserColor: (id: string, color: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_APP_USER_COLOR, id, color),
  getSpotkaniaTypy: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SPOTKANIA_TYPY),
  addSpotkanieTyp: (
    nazwa: string,
    kolor: string,
    opis: string,
    dniNaDokumenty?: number | null,
  ) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_SPOTKANIE_TYP, nazwa, kolor, opis, dniNaDokumenty ?? null),
  updateSpotkanieTyp: (
    id: number,
    nazwa: string,
    kolor: string,
    opis: string,
    dniNaDokumenty?: number | null,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.UPDATE_SPOTKANIE_TYP,
      id,
      nazwa,
      kolor,
      opis,
      dniNaDokumenty ?? null,
    ),
  deleteSpotkanieTyp: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_SPOTKANIE_TYP, id),
  getSpotkania: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SPOTKANIA),
  addSpotkanie: (input: import('../shared/types').SpotkanieInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_SPOTKANIE, input),
  updateSpotkanie: (id: number, input: import('../shared/types').SpotkanieInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SPOTKANIE, id, input),
  deleteSpotkanie: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SPOTKANIE, id),
  ackSpotkanieTermin: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.ACK_SPOTKANIE_TERMIN, id),
  setSpotkanieTerminStatus: (id: number, status: 'potwierdzony' | 'wstepny') =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SPOTKANIE_TERMIN_STATUS, id, status),
  setSpotkanieDokumenty: (id: number, sent: boolean, opis: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SPOTKANIE_DOKUMENTY, id, sent, opis),
  getSpotkaniaMailingi: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SPOTKANIA_MAILINGI),
  getZadania: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ZADANIA),
  addZadanie: (input: import('../shared/types').ZadanieInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_ZADANIE, input),
  updateZadanie: (id: number, input: import('../shared/types').ZadanieInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ZADANIE, id, input),
  moveZadanie: (
    id: number,
    status: import('../shared/types').ZadanieStatus,
    orderedIds: number[],
  ) => ipcRenderer.invoke(IPC_CHANNELS.MOVE_ZADANIE, id, status, orderedIds),
  deleteZadanie: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ZADANIE, id),
  zadaniaPickAttachment: () => ipcRenderer.invoke(IPC_CHANNELS.ZADANIA_PICK_ATTACHMENT),
  zadaniaUploadAttachment: (token: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZADANIA_UPLOAD_ATTACHMENT, token),
  zadaniaDownloadAttachment: (zalacznik: { sciezka: string; nazwa: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZADANIA_DOWNLOAD_ATTACHMENT, zalacznik),
  zadaniaDiscardAttachments: (paths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.ZADANIA_DISCARD_ATTACHMENTS, paths),
  /** A notification about Księgowania (priority, note) was clicked — open the dashboard. */
  onOpenKsiegowania: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('ksiegowania:open', listener);
    return () => ipcRenderer.off('ksiegowania:open', listener);
  },
  getZadaniaKomentarzePodsumowanie: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_ZADANIA_KOMENTARZE_PODSUMOWANIE),
  getZadaniaNotatki: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ZADANIA_NOTATKI),
  addZadanieNotatka: (tresc: string) => ipcRenderer.invoke(IPC_CHANNELS.ADD_ZADANIE_NOTATKA, tresc),
  updateZadanieNotatka: (id: number, tresc: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ZADANIE_NOTATKA, id, tresc),
  deleteZadanieNotatka: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ZADANIE_NOTATKA, id),
  getZadanieKomentarze: (zadanieId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_ZADANIE_KOMENTARZE, zadanieId),
  addZadanieKomentarz: (input: import('../shared/types').ZadanieKomentarzInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_ZADANIE_KOMENTARZ, input),
  deleteZadanieKomentarz: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_ZADANIE_KOMENTARZ, id),
  /**
   * A system notification about a task was clicked — open the board, on that
   * task when the notification was about one.
   */
  onOpenZadania: (callback: (zadanieId?: number) => void) => {
    const listener = (_event: unknown, zadanieId?: number) =>
      callback(typeof zadanieId === 'number' ? zadanieId : undefined);
    ipcRenderer.on('zadania:open', listener);
    return () => ipcRenderer.off('zadania:open', listener);
  },

  // Księgowania: priorities with a note, and notes on a community
  getKsiegowaniaPriorytety: () => ipcRenderer.invoke(IPC_CHANNELS.GET_KS_PRIORYTETY),
  addKsiegowaniePriorytet: (monthKey: string, adresId: number | null, adresNazwa: string, notatka: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_KS_PRIORYTET, monthKey, adresId, adresNazwa, notatka),
  setKsiegowaniePriorytetNotatka: (id: number, notatka: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_KS_PRIORYTET_NOTATKA, id, notatka),
  removeKsiegowaniePriorytet: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_KS_PRIORYTET, id),
  reorderKsiegowaniaPriorytety: (monthKey: string, orderedIds: number[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.REORDER_KS_PRIORYTETY, monthKey, orderedIds),
  getKsiegowaniaUwagi: () => ipcRenderer.invoke(IPC_CHANNELS.GET_KS_UWAGI),
  addKsiegowanieUwaga: (adresId: number | null, adresNazwa: string, tresc: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_KS_UWAGA, adresId, adresNazwa, tresc),
  updateKsiegowanieUwaga: (id: number, tresc: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_KS_UWAGA, id, tresc),
  setKsiegowanieUwagaResolved: (id: number, resolved: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_KS_UWAGA_RESOLVED, id, resolved),
  deleteKsiegowanieUwaga: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_KS_UWAGA, id),
  getSpotkaniaLokalizacje: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SPOTKANIA_LOKALIZACJE),
  addSpotkanieLokalizacja: (nazwa: string, adres: string, opis: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_SPOTKANIE_LOKALIZACJA, nazwa, adres, opis),
  updateSpotkanieLokalizacja: (id: number, nazwa: string, adres: string, opis: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SPOTKANIE_LOKALIZACJA, id, nazwa, adres, opis),
  deleteSpotkanieLokalizacja: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_SPOTKANIE_LOKALIZACJA, id),

  // App info
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),

  // Zoom controls
  zoomIn: () => ipcRenderer.invoke('app:zoom-in'),
  zoomOut: () => ipcRenderer.invoke('app:zoom-out'),
  zoomReset: () => ipcRenderer.invoke('app:zoom-reset'),

  // Auth (Supabase)
  authSignIn: (email: string, password: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_IN, email, password),
  authSignOut: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_OUT),
  authGetSession: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_SESSION),
  authConsumeExpiryNotice: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_CONSUME_EXPIRY_NOTICE),
  onSessionExpired: (callback: (info: { message: string }) => void) => {
    const listener = (_event: unknown, info: { message: string }) => callback(info);
    ipcRenderer.on('auth:session-expired', listener);
    return () => ipcRenderer.off('auth:session-expired', listener);
  },

  platform: process.platform,

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.off('update-available', listener);
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.off('update-downloaded', listener);
  },
  onUpdateError: (callback: (error: string) => void) => {
    const listener = (_event: unknown, error: string) => callback(error);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.off('update-error', listener);
  },
  onDownloadProgress: (callback: (progress: any) => void) => {
    const listener = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.off('download-progress', listener);
  },
  onConversionProgress: (callback: (progress: any) => void) => {
    const listener = (_event: unknown, progress: any) => callback(progress);
    ipcRenderer.on('conversion:progress', listener);
    return () => ipcRenderer.off('conversion:progress', listener);
  },
  onBackupCreated: (callback: (info: any) => void) => {
    const listener = (_event: unknown, info: any) => callback(info);
    ipcRenderer.on('backup:auto-created', listener);
    return () => ipcRenderer.off('backup:auto-created', listener);
  },
});
