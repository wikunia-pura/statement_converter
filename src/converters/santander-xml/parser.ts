/**
 * Santander XML Parser
 * Parses bank statement XML into structured data
 */

import { parseStringPromise } from 'xml2js';
import { XmlStatement, XmlTransaction } from './types';

export class SantanderXmlParser {
  /**
   * Parse XML file content
   */
  async parse(xmlContent: string): Promise<XmlStatement> {
    try {
      const result = await parseStringPromise(xmlContent, {
        explicitArray: false,
        trim: true,
        normalizeTags: true,
        attrkey: 'attributes',
      });

      const statement = result.statement;

      return {
        bankName: statement['bank-unit']?.['bank-name'] || '',
        iban: statement.account?.iban || '',
        stmtNo: statement.stmt?.['stmt-no'] || '',
        beginDate: statement.stmt?.begin || '',
        endDate: statement.stmt?.end || '',
        beginValue: parseFloat(statement.stmt?.['begin-value'] || '0'),
        endValue: parseFloat(statement.stmt?.['end-value'] || '0'),
        transactions: this.parseTransactions(statement.transactions),
      };
    } catch (error) {
      throw new Error(`Failed to parse XML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse transactions array from XML
   */
  private parseTransactions(transactionsNode: any): XmlTransaction[] {
    if (!transactionsNode || !transactionsNode.trn) {
      return [];
    }

    const trnArray = Array.isArray(transactionsNode.trn)
      ? transactionsNode.trn
      : [transactionsNode.trn];

    return trnArray.map((trn: any) => ({
      trnCode: trn['trn-code'] || '',
      exeDate: trn['exe-date'] || '',
      creatDate: trn['creat-date'] || '',
      value: parseFloat(trn.value || '0'),
      accValue: parseFloat(trn['acc-value'] || '0'),
      realValue: parseFloat(trn['real-value'] || '0'),
      descBase: trn['desc-base'] || '',
      descOpt: trn['desc-opt'] || '',
    }));
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: XmlTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
      onlyPositive?: boolean;
    } = {}
  ): XmlTransaction[] {
    return transactions.filter((trn) => {
      // Skip negative amounts (expenses)
      if (options.skipNegative && trn.value < 0) {
        return false;
      }

      // Only positive amounts (income)
      if (options.onlyPositive && trn.value <= 0) {
        return false;
      }

      // Skip bank fees (X_06 code)
      if (options.skipBankFees && trn.trnCode === 'X_06') {
        return false;
      }

      return true;
    });
  }
}
