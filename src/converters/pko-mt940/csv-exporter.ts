/**
 * The accounting file of a PKO BP MT940 statement (see BaseCsvExporter).
 */

import { MT940Transaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<MT940Transaction> {
  protected readonly dateLayout = 'YYMMDD';

  protected dateOf(raw: MT940Transaction): string {
    return raw.valueDate;
  }

  protected incomeAmount(raw: MT940Transaction): number {
    return raw.amount;
  }

  protected expenseAmount(raw: MT940Transaction): number {
    return Math.abs(raw.amount);
  }

  protected title(raw: MT940Transaction): string {
    return raw.details.description.join('');
  }
}
