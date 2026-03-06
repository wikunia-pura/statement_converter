/**
 * PDF Search Logic - browser-safe (no Node.js dependencies)
 * 
 * Used in the renderer process to search for transactions in extracted PDF text.
 */

export interface PdfSearchMatch {
  /** The matched block of text (multi-line context) */
  matchedText: string;
  /** Score 0-100 indicating match quality */
  score: number;
  /** Line index in the PDF where the match starts */
  startLineIndex: number;
  /** Number of context lines included */
  contextLines: number;
  /** Offset of the best-scoring line within the context block (0-based) */
  bestLineOffset: number;
  /** How many lines around the best match actually scored > 0 (the "core" block) */
  coreLineStart: number;
  coreLineEnd: number;
}

/**
 * Intelligently search for a transaction in PDF text.
 * 
 * Uses multiple strategies:
 * 1. Amount matching (exact PLN amount)
 * 2. Counterparty name fragments
 * 3. Description keywords
 * 4. Account number matching
 * 
 * Returns the best matching block of text with surrounding context.
 */
export function searchTransactionInPdf(
  pdfLines: string[],
  transaction: {
    amount: number;
    description: string;
    counterparty: string;
    date?: string;
  },
  contextSize: number = 5
): PdfSearchMatch | null {
  if (pdfLines.length === 0) return null;
  
  // Normalize amount for searching (e.g., "900,00" or "900.00")
  const amountStr = transaction.amount.toFixed(2);
  const amountComma = amountStr.replace('.', ',');
  const amountDot = amountStr;
  
  // Extract meaningful search tokens from description and counterparty
  const descTokens = extractSearchTokens(transaction.description);
  const counterpartyTokens = extractSearchTokens(transaction.counterparty);
  
  // Extract account number if present in counterparty (26-digit IBAN or partial)
  const accountMatch = transaction.counterparty.match(/\d{10,26}/);
  const accountNumber = accountMatch ? accountMatch[0] : null;
  
  // Score each line
  const lineScores: { lineIndex: number; score: number }[] = [];
  
  for (let i = 0; i < pdfLines.length; i++) {
    let score = 0;
    const line = pdfLines[i];
    const lineLower = line.toLowerCase();
    
    // Check surrounding context (±5 lines) for matches
    const contextStart = Math.max(0, i - contextSize);
    const contextEnd = Math.min(pdfLines.length - 1, i + contextSize);
    const contextBlock = pdfLines.slice(contextStart, contextEnd + 1).join(' ').toLowerCase();
    
    // Amount match (strong signal)
    if (line.includes(amountComma) || line.includes(amountDot)) {
      score += 40;
    } else if (contextBlock.includes(amountComma) || contextBlock.includes(amountDot)) {
      score += 20;
    }
    
    // Description token matches
    for (const token of descTokens) {
      if (lineLower.includes(token.toLowerCase())) {
        score += 15;
      } else if (contextBlock.includes(token.toLowerCase())) {
        score += 5;
      }
    }
    
    // Counterparty token matches
    for (const token of counterpartyTokens) {
      if (lineLower.includes(token.toLowerCase())) {
        score += 15;
      } else if (contextBlock.includes(token.toLowerCase())) {
        score += 5;
      }
    }
    
    // Account number match (very strong signal)
    if (accountNumber && (line.includes(accountNumber) || contextBlock.includes(accountNumber))) {
      score += 30;
    }
    
    // Date match
    if (transaction.date) {
      const dateVariants = generateDateVariants(transaction.date);
      for (const dateStr of dateVariants) {
        if (line.includes(dateStr) || contextBlock.includes(dateStr)) {
          score += 10;
          break;
        }
      }
    }
    
    if (score > 0) {
      lineScores.push({ lineIndex: i, score });
    }
  }
  
  if (lineScores.length === 0) return null;
  
  // Sort by score descending
  lineScores.sort((a, b) => b.score - a.score);
  
  // Take the best match
  const best = lineScores[0];
  
  // Build context block around the best match
  const startIdx = Math.max(0, best.lineIndex - contextSize);
  const endIdx = Math.min(pdfLines.length - 1, best.lineIndex + contextSize);
  const matchedText = pdfLines.slice(startIdx, endIdx + 1).join('\n');
  
  // Find the "core" block — consecutive lines around the best match that also scored > 0
  const scoredSet = new Set(lineScores.filter(ls => ls.score > 0).map(ls => ls.lineIndex));
  let coreStart = best.lineIndex;
  let coreEnd = best.lineIndex;
  // Expand core backward
  while (coreStart > startIdx && scoredSet.has(coreStart - 1)) coreStart--;
  // Expand core forward
  while (coreEnd < endIdx && scoredSet.has(coreEnd + 1)) coreEnd++;
  // Also include ±1 line around core for readability
  coreStart = Math.max(startIdx, coreStart - 1);
  coreEnd = Math.min(endIdx, coreEnd + 1);
  
  // Normalize score to 0-100
  const normalizedScore = Math.min(100, best.score);
  
  return {
    matchedText,
    score: normalizedScore,
    startLineIndex: startIdx,
    contextLines: endIdx - startIdx + 1,
    bestLineOffset: best.lineIndex - startIdx,
    coreLineStart: coreStart - startIdx,
    coreLineEnd: coreEnd - startIdx,
  };
}

/**
 * Extract meaningful search tokens from a text string.
 * Filters out common words and short tokens.
 */
function extractSearchTokens(text: string): string[] {
  if (!text) return [];
  
  // Remove special characters, normalize
  const cleaned = text
    .replace(/[˙�]/g, '')  // Remove MT940 empty field markers
    .replace(/[^\p{L}\p{N}\s/.-]/gu, ' ')  // Keep letters, numbers, whitespace, slash, dot, dash
    .trim();
  
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3);
  
  // Filter out common Polish stopwords and generic banking terms
  const stopwords = new Set([
    'za', 'dla', 'od', 'do', 'na', 'ze', 'po', 'tym', 'tyn',
    'ul.', 'ulica', 'al.', 'ale', 'aleja', 'aleje',
    'nr', 'numer', 'lok', 'lok.', 'lokal',
    'przelew', 'wpłata', 'oplata', 'opłata',
    'warszawa', 'wwa', 'polska',
    'm-c', 'miesiąc', 'miesiac',
    'the', 'and', 'for',
  ]);
  
  // Return unique meaningful tokens (keep names, numbers, important words)
  const tokens: string[] = [];
  for (const word of words) {
    if (!stopwords.has(word.toLowerCase()) && word.length >= 3) {
      tokens.push(word);
      if (tokens.length >= 8) break; // Limit to avoid noise
    }
  }
  
  return tokens;
}

/**
 * Generate date format variants for searching in PDF
 */
function generateDateVariants(date: string): string[] {
  // Input might be "2026-02-03" or "260203" (MT940 format)
  const variants: string[] = [];
  
  if (date.includes('-')) {
    // ISO format: 2026-02-03
    const [year, month, day] = date.split('-');
    variants.push(`${day}.${month}.${year}`);   // 03.02.2026
    variants.push(`${day}-${month}-${year}`);   // 03-02-2026
    variants.push(`${day}/${month}/${year}`);   // 03/02/2026
    variants.push(`${day}.${month}.${year.slice(2)}`); // 03.02.26
  } else if (date.length === 6) {
    // MT940 format: YYMMDD like 260203
    const yy = date.substring(0, 2);
    const mm = date.substring(2, 4);
    const dd = date.substring(4, 6);
    variants.push(`${dd}.${mm}.20${yy}`);   // 03.02.2026
    variants.push(`${dd}.${mm}.${yy}`);      // 03.02.26
    variants.push(`${dd}-${mm}-20${yy}`);   // 03-02-2026
  }
  
  return variants;
}
