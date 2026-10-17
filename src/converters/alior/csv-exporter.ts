/**
 * The accounting file of a Alior Bank MT940 statement (see BaseCsvExporter).
 */

import { AliorTransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';
import { shortTitle } from '../shared/export-text';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<AliorTransaction> {
  protected readonly dateLayout = 'YYMMDD';

  protected dateOf(raw: AliorTransaction): string {
    return raw.valueDate;
  }

  protected incomeAmount(raw: AliorTransaction): number {
    return raw.amount;
  }

  protected expenseAmount(raw: AliorTransaction): number {
    return Math.abs(raw.amount);
  }

  protected title(raw: AliorTransaction): string {
    return shortTitle(raw.details.description.join(''));
  }
}
