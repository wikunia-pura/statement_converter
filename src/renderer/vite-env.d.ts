/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      // Banks
      getBanks: () => Promise<any[]>;
      addBank: (name: string, converterId: string) => Promise<any>;
      updateBank: (id: number, name: string, converterId: string) => Promise<boolean>;
      deleteBank: (id: number) => Promise<boolean>;
      
      // Converters
      getConverters: () => Promise<any[]>;
      
      // Files
      selectFiles: () => Promise<any[]>;
      selectOutputFolder: () => Promise<string | null>;
      convertFile: (inputPath: string, bankId: number, fileName: string) => Promise<any>;
      openFile: (filePath: string) => Promise<boolean>;
      
      // Settings
      getSettings: () => Promise<any>;
      setOutputFolder: (folderPath: string) => Promise<boolean>;
      
      // History
      getHistory: () => Promise<any[]>;
      clearHistory: () => Promise<boolean>;
    };
  }
}

export {};
