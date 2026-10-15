/**
 * BNP Paribas XML Parser
 * Parses ISO 20022 CAMT.053.001.02 bank statements into structured data.
 *
 * The XML uses namespace `urn:iso:std:iso:20022:tech:xsd:camt.053.001.02`.
 * xml2js with `normalizeTags: true` lowercases all tag names and with
 * `tagNameProcessors: [stripPrefix]` strips namespace prefixes.
 */

import { parseStringPromise, processors } from 'xml2js';
import { BnpStatement, BnpTransaction } from './types';
import { DroppedStatementLine } from '../../shared/types';
import { asArray, entryExcerpt, isReversalEntry, readAmount, readEntryDetails, splitByAccount } from '../shared/camt';

export class BnpXmlParser {
  /**
   * Clean XML content — remove BOM, leading garbage before first `<`.
   */
  private cleanXmlContent(xmlContent: string): string {
    let cleaned = xmlContent.replace(/^\uFEFF/, '');
    cleaned = cleaned.replace(/^\uFFFE/, '');
    cleaned = cleaned.replace(/^\xEF\xBB\xBF/, '');

    const xmlStart = cleaned.indexOf('<');
    if (xmlStart > 0) {
      cleaned = cleaned.substring(xmlStart);
    } else if (xmlStart < 0) {
      throw new Error('No XML content found in file');
    }

    return cleaned.trim();
  }

  /**
   * Safely get a nested value from a parsed XML object.
   * Returns '' if any step is missing.
   */
  private get(obj: any, ...path: string[]): string {
    let current = obj;
    for (const key of path) {
      if (current == null || typeof current !== 'object') return '';
      current = current[key];
    }
    if (current == null) return '';
    if (typeof current === 'object') {
      // xml2js may wrap text in _ when attributes are present
      if ('_' in current) return String(current._);
      return '';
    }
    return String(current);
  }

  /**
   * Parse XML file content → BnpStatement
   */
  async parse(xmlContent: string): Promise<BnpStatement> {
    try {
      const cleanedContent = this.cleanXmlContent(xmlContent);

      const result = await parseStringPromise(cleanedContent, {
        explicitArray: false,
        trim: true,
        normalizeTags: true,
        tagNameProcessors: [processors.stripPrefix],
        attrkey: '$',
      });

      // Navigate to Stmt
      const doc = result.document;
      if (!doc) throw new Error('Missing <Document> root element');

      const bkToCstmrStmt = doc.bktocstmrstmt;
      if (!bkToCstmrStmt) throw new Error('Missing <BkToCstmrStmt> element');

      // A file may carry several <Stmt> (xml2js then gives an array, which used
      // to read as zero transactions). Account info comes from the first; the
      // entries from every statement of that same account. A statement for
      // another account is not merged in — its entries go to `dropped` (see
      // splitByAccount).
      const allStmts = asArray(bkToCstmrStmt.stmt);
      if (allStmts.length === 0) throw new Error('Missing <Stmt> element');
      const stmt = allStmts[0];
      const dropped: DroppedStatementLine[] = [];
      const stmts = splitByAccount(allStmts, dropped);

      const grpHdr = bkToCstmrStmt.grphdr || {};

      // Account info
      const acct = stmt.acct || {};
      const iban = this.get(acct, 'id', 'iban');
      const ccy = this.get(acct, 'ccy');
      const acctName = this.get(acct, 'nm');
      const owner = acct.ownr || {};
      const ownerName = this.get(owner, 'nm');
      const ownerAddr = owner.pstladr || {};
      const ownerAddressLines: string[] = [];
      if (ownerAddr.adrline) {
        const lines = Array.isArray(ownerAddr.adrline) ? ownerAddr.adrline : [ownerAddr.adrline];
        lines.forEach((l: any) => ownerAddressLines.push(String(l)));
      }

      // Period
      const frTodt = stmt.frtodt || {};
      const periodStart = this.get(frTodt, 'frdttm');
      const periodEnd = this.get(frTodt, 'todttm');

      // Balances (for the log): opening of the first statement, closing of the last.
      let openingBalance = 0;
      let closingBalance = 0;
      stmts.forEach((s: any, i: number) => {
        for (const bal of asArray(s.bal)) {
          const code = this.get(bal, 'tp', 'cdorprtry', 'cd');
          const amtVal = readAmount(bal.amt).amount ?? 0;
          if (code === 'OPBD' && i === 0) openingBalance = amtVal;
          if (code === 'CLBD' && i === stmts.length - 1) closingBalance = amtVal;
        }
      });

      // Transactions
      const transactions = stmts.flatMap((s: any) => this.parseEntries(s.ntry, dropped));

      return {
        messageId: this.get(grpHdr, 'msgid'),
        creationDateTime: this.get(grpHdr, 'credttm'),
        statementId: this.get(stmt, 'id'),
        periodStart,
        periodEnd,
        iban,
        currency: ccy,
        accountName: acctName,
        ownerName,
        ownerAddress: ownerAddressLines,
        openingBalance,
        closingBalance,
        transactions,
        dropped,
      };
    } catch (error) {
      throw new Error(`Failed to parse BNP XML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse <Ntry> elements into BnpTransaction[]. An entry whose amount or
   * direction cannot be read is recorded in `dropped`, never booked as 0,00 or
   * guessed onto a side.
   */
  private parseEntries(ntryNode: any, dropped: DroppedStatementLine[]): BnpTransaction[] {
    const transactions: BnpTransaction[] = [];

    for (const ntry of asArray(ntryNode)) {
      const { amount, currency, text: amountText } = readAmount(ntry.amt);
      const indicator = this.get(ntry, 'cdtdbtind');
      const status = this.get(ntry, 'sts');
      const bookingDate = this.get(ntry, 'bookgdt', 'dt');
      const valueDate = this.get(ntry, 'valdt', 'dt');
      const txCode = this.get(ntry, 'bktxcd', 'domn', 'cd');

      if (indicator !== 'CRDT' && indicator !== 'DBIT') {
        dropped.push({ excerpt: entryExcerpt(bookingDate, indicator, amountText), reason: 'direction' });
        continue;
      }
      if (amount === null) {
        dropped.push({ excerpt: entryExcerpt(bookingDate, indicator, amountText), reason: 'amount' });
        continue;
      }

      // Related parties (Dbtr for CRDT, Cdtr for DBIT) and remittance info, read
      // from every <TxDtls> of the entry — see readEntryDetails.
      const details = readEntryDetails(ntry, indicator);

      transactions.push({
        amount,
        currency,
        creditDebitIndicator: indicator,
        status,
        bookingDate,
        valueDate,
        txCode,
        instrId: details.instrId,
        endToEndId: details.endToEndId,
        counterpartyName: details.counterpartyName,
        counterpartyAddress: details.counterpartyAddress,
        counterpartyCountry: details.counterpartyCountry,
        counterpartyAccount: details.counterpartyAccount,
        description: details.description,
        ...(details.batchCounterparties ? { batchCounterparties: true } : {}),
        ...(isReversalEntry(ntry) ? { reversal: true } : {}),
      });
    }

    return transactions;
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: BnpTransaction[],
    options: {
      skipNegative?: boolean;
    } = {}
  ): BnpTransaction[] {
    return transactions.filter((trn) => {
      // Skip expenses (DBIT) if requested
      if (options.skipNegative && trn.creditDebitIndicator === 'DBIT') {
        return false;
      }

      return true;
    });
  }
}
