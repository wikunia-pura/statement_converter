import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
import { Bank, ConversionHistory } from '../shared/types';

interface StoreSchema {
  banks: Bank[];
  history: ConversionHistory[];
  settings: {
    outputFolder: string;
  };
  nextBankId: number;
  nextHistoryId: number;
}

class DatabaseService {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        banks: [],
        history: [],
        settings: {
          outputFolder: path.join(app.getPath('documents'), 'StatementConverter'),
        },
        nextBankId: 1,
        nextHistoryId: 1,
      },
    });
  }

  // Banks operations
  getAllBanks(): Bank[] {
    const banks = this.store.get('banks', []);
    return banks.sort((a, b) => a.name.localeCompare(b.name));
  }

  addBank(name: string, converterId: string): Bank {
    const banks = this.store.get('banks', []);
    const id = this.store.get('nextBankId', 1);
    
    const newBank: Bank = {
      id,
      name,
      converterId,
      createdAt: new Date().toISOString(),
    };
    
    banks.push(newBank);
    this.store.set('banks', banks);
    this.store.set('nextBankId', id + 1);
    
    return newBank;
  }

  updateBank(id: number, name: string, converterId: string): void {
    const banks = this.store.get('banks', []);
    const index = banks.findIndex(b => b.id === id);
    
    if (index !== -1) {
      banks[index] = { ...banks[index], name, converterId };
      this.store.set('banks', banks);
    }
  }

  deleteBank(id: number): void {
    const banks = this.store.get('banks', []);
    this.store.set('banks', banks.filter(b => b.id !== id));
  }

  getBankById(id: number): Bank | undefined {
    const banks = this.store.get('banks', []);
    return banks.find(b => b.id === id);
  }

  // Conversion history operations
  addConversionHistory(data: {
    fileName: string;
    bankName: string;
    converterName: string;
    status: 'success' | 'error';
    errorMessage?: string;
    inputPath: string;
    outputPath: string;
  }): void {
    const history = this.store.get('history', []);
    const id = this.store.get('nextHistoryId', 1);
    
    const newEntry: ConversionHistory = {
      id,
      fileName: data.fileName,
      bankName: data.bankName,
      converterName: data.converterName,
      status: data.status,
      errorMessage: data.errorMessage,
      inputPath: data.inputPath,
      outputPath: data.outputPath,
      convertedAt: new Date().toISOString(),
    };
    
    history.unshift(newEntry); // Add to beginning for most recent first
    this.store.set('history', history);
    this.store.set('nextHistoryId', id + 1);
  }

  getAllHistory(): ConversionHistory[] {
    return this.store.get('history', []);
  }

  clearHistory(): void {
    this.store.set('history', []);
  }

  // Settings operations
  getSetting(key: string): string | undefined {
    const settings = this.store.get('settings');
    return (settings as any)[key];
  }

  setSetting(key: string, value: string): void {
    const settings = this.store.get('settings');
    this.store.set('settings', { ...settings, [key]: value });
  }

  close(): void {
    // electron-store doesn't need explicit closing
  }
}

export default DatabaseService;
