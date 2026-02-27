/**
 * In-memory cache for pending conversions awaiting user review
 */

import { TransactionForReview } from '../shared/types';
import { ProcessedTransaction } from '../converters/pko-mt940/types';
import { ProcessedTransaction as SantanderProcessedTransaction } from '../converters/santander-xml/types';

interface CachedConversion {
  id: string;
  fileName: string;
  bankName: string;
  converterId: string;
  inputPath: string;
  outputPath: string;
  processedTransactions: ProcessedTransaction[] | SantanderProcessedTransaction[];
  previewOutput: string;
  createdAt: Date;
}

class ConversionCache {
  private cache: Map<string, CachedConversion> = new Map();
  private readonly CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Generate unique ID for conversion
   */
  generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Store conversion data
   */
  store(
    fileName: string,
    bankName: string,
    converterId: string,
    inputPath: string,
    outputPath: string,
    processedTransactions: ProcessedTransaction[] | SantanderProcessedTransaction[],
    previewOutput: string
  ): string {
    const id = this.generateId();
    
    this.cache.set(id, {
      id,
      fileName,
      bankName,
      converterId,
      inputPath,
      outputPath,
      processedTransactions,
      previewOutput,
      createdAt: new Date(),
    });

    // Clean up expired entries
    this.cleanupExpired();

    return id;
  }

  /**
   * Retrieve conversion data
   */
  get(id: string): CachedConversion | null {
    const cached = this.cache.get(id);
    
    if (!cached) {
      return null;
    }

    // Check if expired
    const age = Date.now() - cached.createdAt.getTime();
    if (age > this.CACHE_EXPIRY_MS) {
      this.cache.delete(id);
      return null;
    }

    return cached;
  }

  /**
   * Remove conversion from cache
   */
  remove(id: string): boolean {
    return this.cache.delete(id);
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    
    for (const [id, cached] of this.cache.entries()) {
      const age = now - cached.createdAt.getTime();
      if (age > this.CACHE_EXPIRY_MS) {
        this.cache.delete(id);
      }
    }
  }

  /**
   * Get cache size (for debugging)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear all cache (for testing)
   */
  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const conversionCache = new ConversionCache();
