/**
 * Shared encoding utilities for reading files with proper Polish character support.
 * 
 * Handles detection and conversion of common encodings used in Polish bank statements:
 * - UTF-8 (with and without BOM)
 * - ISO-8859-2 (Latin-2, used by Santander XML)
 * - Windows-1250 (CP1250, used by PKO MT940)
 * - CP852 (DOS Latin-2, used by ING MT940)
 * - ISO-8859-1 (Latin-1, fallback)
 * 
 * Usage:
 *   import { readFileWithEncoding } from '../shared/encoding';
 *   const content = readFileWithEncoding(filePath);
 */

import * as fs from 'fs';
import * as iconv from 'iconv-lite';

/**
 * Read a file and decode it with the correct encoding.
 * Auto-detects encoding from BOM, XML declaration, or heuristics.
 * 
 * @param filePath - Path to the file
 * @param forceEncoding - Optional: force a specific encoding (skip auto-detection)
 * @returns Properly decoded string content
 */
export function readFileWithEncoding(filePath: string, forceEncoding?: string): string {
  const buffer = fs.readFileSync(filePath);
  return decodeBuffer(buffer, forceEncoding);
}

/**
 * Decode a Buffer with the correct encoding.
 * Auto-detects encoding from BOM, XML declaration, or heuristics.
 * 
 * @param buffer - Raw file content
 * @param forceEncoding - Optional: force a specific encoding (skip auto-detection)
 * @returns Properly decoded string content
 */
export function decodeBuffer(buffer: Buffer, forceEncoding?: string): string {
  if (forceEncoding) {
    return iconv.decode(buffer, normalizeEncodingName(forceEncoding));
  }

  const encoding = detectEncoding(buffer);
  console.log(`[Encoding] Detected encoding: ${encoding}`);
  return iconv.decode(buffer, encoding);
}

/**
 * Detect the encoding of a buffer.
 * Priority:
 * 1. UTF-8 BOM
 * 2. UTF-16 BOM
 * 3. XML encoding declaration
 * 4. Valid UTF-8 check
 * 5. Polish character heuristics (ISO-8859-2 vs Windows-1250)
 * 6. Fallback to Windows-1250
 */
export function detectEncoding(buffer: Buffer): string {
  // 1. Check for BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf-8';
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return 'utf-16le';
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return 'utf-16be';
  }

  // 2. Check for XML encoding declaration (read first ~200 bytes as ASCII to find it)
  const xmlEncoding = detectXmlEncoding(buffer);
  if (xmlEncoding) {
    return normalizeEncodingName(xmlEncoding);
  }

  // 3. Check if content is valid UTF-8
  if (isValidUtf8(buffer)) {
    // But only if it actually contains multi-byte sequences
    // (pure ASCII is valid UTF-8 but could be any single-byte encoding)
    if (hasMultiByteUtf8(buffer)) {
      return 'utf-8';
    }
  }

  // 4. Heuristic: detect Polish characters to distinguish ISO-8859-2 vs Windows-1250
  return detectPolishEncoding(buffer);
}

/**
 * Extract encoding from XML declaration (e.g., <?xml version="1.0" encoding="ISO-8859-2"?>)
 */
function detectXmlEncoding(buffer: Buffer): string | null {
  // Read first 200 bytes as ASCII to find the XML declaration
  const header = buffer.slice(0, Math.min(200, buffer.length)).toString('ascii');
  const match = header.match(/<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Check if a buffer is valid UTF-8 (has no invalid byte sequences)
 */
function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i];
    
    if (byte <= 0x7F) {
      // ASCII byte
      i++;
    } else if (byte >= 0xC2 && byte <= 0xDF) {
      // 2-byte sequence
      if (i + 1 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80) return false;
      i += 2;
    } else if (byte >= 0xE0 && byte <= 0xEF) {
      // 3-byte sequence
      if (i + 2 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80) return false;
      i += 3;
    } else if (byte >= 0xF0 && byte <= 0xF4) {
      // 4-byte sequence
      if (i + 3 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80 || (buffer[i + 3] & 0xC0) !== 0x80) return false;
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Check if buffer contains multi-byte UTF-8 sequences (not just pure ASCII)
 */
function hasMultiByteUtf8(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] > 0x7F) return true;
  }
  return false;
}

/**
 * Detect whether Polish text is ISO-8859-2 or Windows-1250.
 * 
 * Key differences for Polish characters:
 * - ISO-8859-2: Ą=0xA1, ą=0xB1, Ś=0xA6, ś=0xB6, Ź=0xAC, ź=0xBC
 * - Windows-1250: Ą=0xA5, ą=0xB9, Ś=0x8C, ś=0x9C, Ź=0x8F, ź=0x9F
 * 
 * Common characters (same in both): Ć=0xC6, ć=0xE6, Ę=0xCA, ę=0xEA,
 *   Ł=0xA3, ł=0xB3, Ń=0xD1, ń=0xF1, Ó=0xD3, ó=0xF3, Ż=0xAF, ż=0xBF
 * 
 * The user's bug: file read as latin1 → byte 0xA1 (ISO-8859-2 'Ą') 
 * becomes latin1 '¡', then if treated as Win1250 → 'ˇ', hence 'WODOCIˇGÓW'
 */
function detectPolishEncoding(buffer: Buffer): string {
  // Bytes that differ between ISO-8859-2 and Windows-1250
  // If we see bytes in 0x80-0x9F range, it's likely Windows-1250
  // (ISO-8859-2 doesn't use 0x80-0x9F for printable characters)
  let hasWin1250HighBytes = false;
  
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // 0x80-0x9F: used in Windows-1250 for Ś(0x8C), ś(0x9C), Ź(0x8F), ź(0x9F), etc.
    // ISO-8859-2 has control characters in this range
    if (byte >= 0x80 && byte <= 0x9F) {
      hasWin1250HighBytes = true;
      break;
    }
  }

  if (hasWin1250HighBytes) {
    return 'win1250';
  }

  // Score both encodings by counting recognized Polish characters
  const iso2Text = iconv.decode(buffer, 'iso-8859-2');
  const win1250Text = iconv.decode(buffer, 'win1250');

  const polishChars = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g;
  const iso2Score = (iso2Text.match(polishChars) || []).length;
  const win1250Score = (win1250Text.match(polishChars) || []).length;

  if (iso2Score > win1250Score) {
    return 'iso-8859-2';
  } else if (win1250Score > iso2Score) {
    return 'win1250';
  }

  // Default: ISO-8859-2 is more commonly used in Polish bank XMLs,
  // but Windows-1250 is more common overall. Use win1250 as safe default.
  return 'win1250';
}

/**
 * Normalize encoding name to one supported by iconv-lite
 */
function normalizeEncodingName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const encodingMap: Record<string, string> = {
    'utf8': 'utf-8',
    'utf16le': 'utf-16le',
    'utf16be': 'utf-16be',
    'iso88591': 'iso-8859-1',
    'iso88592': 'iso-8859-2',
    'latin1': 'iso-8859-1',
    'latin2': 'iso-8859-2',
    'win1250': 'win1250',
    'windows1250': 'win1250',
    'cp1250': 'win1250',
    'win1252': 'win1252',
    'windows1252': 'win1252',
    'cp1252': 'win1252',
    'cp852': 'cp852',
    'ibm852': 'cp852',
    'dos852': 'cp852',
  };

  return encodingMap[normalized] || name;
}
