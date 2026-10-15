/**
 * BOŚ Bank XML Parser
 * Parses ISO 20022 CAMT.052.001.04 (Account Report) bank statements.
 *
 * Differences from BNP's CAMT.053:
 *   - Root envelope: <BkToCstmrAcctRpt> with multiple <Rpt> elements (one <Ntry> each),
 *     vs. BNP's single <BkToCstmrStmt>/<Stmt> with many <Ntry>.
 *   - Dates: <BookgDt><DtTm> (ISO datetime) — BNP uses <BookgDt><Dt> (date-only).
 *   - No <Bal> opening/closing balance nodes.
 *   - Counterparty has only <Nm> (name is already concatenated with address);
 *     no structured <PstlAdr>.
 *   - <BkTxCd> uses <Prtry> (always "UNDEFINED") instead of <Domn>.
 */

import { parseStringPromise, processors } from 'xml2js';
import { BosStatement, BosTransaction } from './types';
import { DroppedStatementLine } from '../../shared/types';
import { asArray, entryExcerpt, isReversalEntry, readAmount, readEntryDetails, splitByAccount } from '../shared/camt';

export class BosXmlParser {
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

  private get(obj: any, ...path: string[]): string {
    let current = obj;
    for (const key of path) {
      if (current == null || typeof current !== 'object') return '';
      current = current[key];
    }
    if (current == null) return '';
    if (typeof current === 'object') {
      if ('_' in current) return String(current._);
      return '';
    }
    return String(current);
  }

  /** Convert ISO datetime "2026-02-02T00:00:00.000+01:00" → "2026-02-02". */
  private toDateOnly(dateTime: string): string {
    if (!dateTime) return '';
    const t = dateTime.indexOf('T');
    return t > 0 ? dateTime.substring(0, t) : dateTime;
  }

  async parse(xmlContent: string): Promise<BosStatement> {
    try {
      const cleanedContent = this.cleanXmlContent(xmlContent);

      const result = await parseStringPromise(cleanedContent, {
        explicitArray: false,
        trim: true,
        normalizeTags: true,
        tagNameProcessors: [processors.stripPrefix],
        attrkey: '$',
      });

      const doc = result.document;
      if (!doc) throw new Error('Missing <Document> root element');

      const acctRpt = doc.bktocstmracctrpt;
      if (!acctRpt) throw new Error('Missing <BkToCstmrAcctRpt> element');

      const grpHdr = acctRpt.grphdr || {};

      const rptNodes = acctRpt.rpt
        ? (Array.isArray(acctRpt.rpt) ? acctRpt.rpt : [acctRpt.rpt])
        : [];
      if (rptNodes.length === 0) {
        throw new Error('Missing <Rpt> elements');
      }

      // Account info + period taken from first <Rpt>.
      const firstRpt = rptNodes[0];
      const acct = firstRpt.acct || {};
      const iban = this.get(acct, 'id', 'iban');
      const frTodt = firstRpt.frtodt || {};
      const periodStart = this.toDateOnly(this.get(frTodt, 'frdttm'));
      const periodEnd = this.toDateOnly(this.get(frTodt, 'todttm'));

      // Collect entries from every <Rpt> of the first one's account — a report for
      // another account is not merged in, its entries go to `dropped` (see
      // splitByAccount). Currency is read from each <Amt Ccy="..."/>.
      const transactions: BosTransaction[] = [];
      const dropped: DroppedStatementLine[] = [];
      let currency = 'PLN';
      for (const rpt of splitByAccount(rptNodes, dropped)) {
        const entries = this.parseEntries(rpt.ntry, dropped);
        for (const entry of entries) {
          if (entry.currency) currency = entry.currency;
          transactions.push(entry);
        }
      }

      return {
        messageId: this.get(grpHdr, 'msgid'),
        creationDateTime: this.get(grpHdr, 'credttm'),
        iban,
        currency,
        periodStart,
        periodEnd,
        transactions,
        dropped,
      };
    } catch (error) {
      throw new Error(`Failed to parse BOŚ XML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse the <Ntry> elements of one <Rpt>. An entry whose amount or direction
   * cannot be read is recorded in `dropped`, never booked as 0,00 or guessed onto
   * a side.
   */
  private parseEntries(ntryNode: any, dropped: DroppedStatementLine[]): BosTransaction[] {
    const transactions: BosTransaction[] = [];

    for (const ntry of asArray(ntryNode)) {
      const { amount, currency, text: amountText } = readAmount(ntry.amt);
      const indicator = this.get(ntry, 'cdtdbtind');
      const status = this.get(ntry, 'sts');
      const bookingDate = this.toDateOnly(this.get(ntry, 'bookgdt', 'dttm'));
      const valueDate = this.toDateOnly(this.get(ntry, 'valdt', 'dttm'));
      // BOŚ always emits <Prtry><Cd>UNDEFINED</Cd></Prtry>; keep it for parity with BNP shape.
      const txCode = this.get(ntry, 'bktxcd', 'prtry', 'cd');

      if (indicator !== 'CRDT' && indicator !== 'DBIT') {
        dropped.push({ excerpt: entryExcerpt(bookingDate, indicator, amountText), reason: 'direction' });
        continue;
      }
      if (amount === null) {
        dropped.push({ excerpt: entryExcerpt(bookingDate, indicator, amountText), reason: 'amount' });
        continue;
      }

      // Counterparty: Dbtr for CRDT (incoming), Cdtr for DBIT (outgoing), read from
      // every <TxDtls> (see readEntryDetails). BOŚ does not use <PstlAdr> — the
      // name already contains the address string.
      const details = readEntryDetails(ntry, indicator, { txIdAsInstrId: true });

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
        counterpartyAddress: '',
        counterpartyCountry: '',
        counterpartyAccount: details.counterpartyAccount,
        description: details.description,
        ...(details.batchCounterparties ? { batchCounterparties: true } : {}),
        ...(isReversalEntry(ntry) ? { reversal: true } : {}),
      });
    }

    return transactions;
  }

  /**
   * Filter transactions.
   */
  filterTransactions(
    transactions: BosTransaction[],
    options: {
      skipNegative?: boolean;
    } = {}
  ): BosTransaction[] {
    return transactions.filter((trn) => {
      if (options.skipNegative && trn.creditDebitIndicator === 'DBIT') {
        return false;
      }

      return true;
    });
  }
}
