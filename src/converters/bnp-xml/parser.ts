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

      const stmt = bkToCstmrStmt.stmt;
      if (!stmt) throw new Error('Missing <Stmt> element');

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

      // Balances
      let openingBalance = 0;
      let closingBalance = 0;
      const balNodes = stmt.bal ? (Array.isArray(stmt.bal) ? stmt.bal : [stmt.bal]) : [];
      for (const bal of balNodes) {
        const code = this.get(bal, 'tp', 'cdorprtry', 'cd');
        const amtNode = bal.amt;
        const amtVal = amtNode ? (typeof amtNode === 'object' && '_' in amtNode ? parseFloat(amtNode._) : parseFloat(String(amtNode))) : 0;
        if (code === 'OPBD') openingBalance = amtVal;
        if (code === 'CLBD') closingBalance = amtVal;
      }

      // Transactions
      const transactions = this.parseEntries(stmt.ntry);

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
      };
    } catch (error) {
      throw new Error(`Failed to parse BNP XML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse <Ntry> elements into BnpTransaction[]
   */
  private parseEntries(ntryNode: any): BnpTransaction[] {
    if (!ntryNode) return [];

    const entries = Array.isArray(ntryNode) ? ntryNode : [ntryNode];

    return entries.map((ntry: any) => {
      // Amount
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
      const bookingDate = this.get(ntry, 'bookgdt', 'dt');
      const valueDate = this.get(ntry, 'valdt', 'dt');
      const txCode = this.get(ntry, 'bktxcd', 'domn', 'cd');

      // Transaction details
      const txDtls = ntry.ntrydtls?.txdtls || {};

      // References
      const refs = txDtls.refs || {};
      const instrId = this.get(refs, 'instrid');
      const endToEndId = this.get(refs, 'endtoendid');

      // Related parties — for CRDT the counterparty is in Dbtr, for DBIT in Cdtr
      const rltdPties = txDtls.rltdpties || {};
      let counterpartyName = '';
      let counterpartyAddress = '';
      let counterpartyCountry = '';
      let counterpartyAccount = '';

      if (creditDebitIndicator === 'CRDT') {
        // Money coming in → the sender (debtor) is the counterparty
        const dbtr = rltdPties.dbtr || {};
        counterpartyName = this.get(dbtr, 'nm');
        const pstlAdr = dbtr.pstladr || {};
        counterpartyCountry = this.get(pstlAdr, 'ctry');
        const addrLines = pstlAdr.adrline
          ? (Array.isArray(pstlAdr.adrline) ? pstlAdr.adrline : [pstlAdr.adrline])
          : [];
        counterpartyAddress = addrLines.map(String).join(' ').trim();

        const dbtrAcct = rltdPties.dbtracct?.id?.othr?.id || '';
        counterpartyAccount = typeof dbtrAcct === 'object' ? '' : String(dbtrAcct);
      } else {
        // Money going out → the recipient (creditor) is the counterparty
        const cdtr = rltdPties.cdtr || {};
        counterpartyName = this.get(cdtr, 'nm');
        const pstlAdr = cdtr.pstladr || {};
        counterpartyCountry = this.get(pstlAdr, 'ctry');
        const addrLines = pstlAdr.adrline
          ? (Array.isArray(pstlAdr.adrline) ? pstlAdr.adrline : [pstlAdr.adrline])
          : [];
        counterpartyAddress = addrLines.map(String).join(' ').trim();

        const cdtrAcct = rltdPties.cdtracct?.id?.othr?.id || '';
        counterpartyAccount = typeof cdtrAcct === 'object' ? '' : String(cdtrAcct);
      }

      // Description (remittance info)
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
        counterpartyAddress,
        counterpartyCountry,
        counterpartyAccount,
        description,
      };
    });
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: BnpTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
    } = {}
  ): BnpTransaction[] {
    return transactions.filter((trn) => {
      // Skip expenses (DBIT) if requested
      if (options.skipNegative && trn.creditDebitIndicator === 'DBIT') {
        return false;
      }

      // Skip bank fees — code 244 with empty description or very small amounts with no counterparty
      if (options.skipBankFees) {
        if (trn.txCode === '244' && !trn.description && !trn.counterpartyName) {
          return false;
        }
      }

      return true;
    });
  }
}
