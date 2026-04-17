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

      // Collect entries from every <Rpt>. Currency is read from each <Amt Ccy="..."/>.
      const transactions: BosTransaction[] = [];
      let currency = 'PLN';
      for (const rpt of rptNodes) {
        const entries = this.parseEntries(rpt.ntry);
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
      };
    } catch (error) {
      throw new Error(`Failed to parse BOŚ XML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseEntries(ntryNode: any): BosTransaction[] {
    if (!ntryNode) return [];

    const entries = Array.isArray(ntryNode) ? ntryNode : [ntryNode];

    return entries.map((ntry: any) => {
      const amtNode = ntry.amt;
      let amount = 0;
      let currency = 'PLN';
      if (amtNode) {
        if (typeof amtNode === 'object' && '_' in amtNode) {
          amount = parseFloat(amtNode._);
          currency = amtNode.$?.ccy || 'PLN';
        } else {
          amount = parseFloat(String(amtNode));
        }
      }

      const creditDebitIndicator = this.get(ntry, 'cdtdbtind') as 'CRDT' | 'DBIT';
      const status = this.get(ntry, 'sts');
      const bookingDate = this.toDateOnly(this.get(ntry, 'bookgdt', 'dttm'));
      const valueDate = this.toDateOnly(this.get(ntry, 'valdt', 'dttm'));
      // BOŚ always emits <Prtry><Cd>UNDEFINED</Cd></Prtry>; keep it for parity with BNP shape.
      const txCode = this.get(ntry, 'bktxcd', 'prtry', 'cd');

      const txDtls = ntry.ntrydtls?.txdtls || {};

      const refs = txDtls.refs || {};
      const instrId = this.get(refs, 'instrid') || this.get(refs, 'txid');
      const endToEndId = this.get(refs, 'endtoendid');

      // Counterparty: Dbtr for CRDT (incoming), Cdtr for DBIT (outgoing).
      // BOŚ does not use <PstlAdr> — the name already contains the address string.
      const rltdPties = txDtls.rltdpties || {};
      let counterpartyName = '';
      let counterpartyAccount = '';

      if (creditDebitIndicator === 'CRDT') {
        const dbtr = rltdPties.dbtr || {};
        counterpartyName = this.get(dbtr, 'nm');
        const dbtrAcct = rltdPties.dbtracct?.id?.othr?.id || '';
        counterpartyAccount = typeof dbtrAcct === 'object' ? '' : String(dbtrAcct);
      } else {
        const cdtr = rltdPties.cdtr || {};
        counterpartyName = this.get(cdtr, 'nm');
        const cdtrAcct = rltdPties.cdtracct?.id?.othr?.id || '';
        counterpartyAccount = typeof cdtrAcct === 'object' ? '' : String(cdtrAcct);
      }

      const description = this.get(txDtls, 'rmtinf', 'ustrd');

      return {
        amount,
        currency,
        creditDebitIndicator,
        status,
        bookingDate,
        valueDate,
        txCode,
        instrId,
        endToEndId,
        counterpartyName,
        counterpartyAddress: '',
        counterpartyCountry: '',
        counterpartyAccount,
        description,
      };
    });
  }

  /**
   * Filter transactions.
   * Bank-fee heuristic for BOŚ: DBIT with BOŚ itself as counterparty
   * (no separate transaction code is available — BkTxCd is always "UNDEFINED").
   */
  filterTransactions(
    transactions: BosTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
    } = {}
  ): BosTransaction[] {
    return transactions.filter((trn) => {
      if (options.skipNegative && trn.creditDebitIndicator === 'DBIT') {
        return false;
      }

      if (options.skipBankFees) {
        if (
          trn.creditDebitIndicator === 'DBIT' &&
          /bank\s+ochrony\s+środowiska/i.test(trn.counterpartyName)
        ) {
          return false;
        }
      }

      return true;
    });
  }
}
