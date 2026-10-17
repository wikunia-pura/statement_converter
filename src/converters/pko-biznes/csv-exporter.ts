/**
 * The accounting file of a PKO BP Biznes (iPKO biznes) statement (see BaseCsvExporter).
 */

import { PKOBiznesTransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';
import { shortTitle } from '../shared/export-text';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<PKOBiznesTransaction> {
  protected readonly dateLayout = 'YYYYMMDD';

  protected dateOf(raw: PKOBiznesTransaction): string {
    return raw.date;
  }

  protected incomeAmount(raw: PKOBiznesTransaction): number {
    return raw.amount;
  }

  protected expenseAmount(raw: PKOBiznesTransaction): number {
    return Math.abs(raw.amount);
  }

  protected title(raw: PKOBiznesTransaction): string {
    return shortTitle(raw.description);
  }
}
