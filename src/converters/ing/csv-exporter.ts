/**
 * The accounting file of an ING MT940 statement (see BaseCsvExporter) — and of a
 * Bank Pocztowy one, whose rows the parser leaves in ING's shape.
 */

import { INGTransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter<TRaw extends INGTransaction = INGTransaction> extends BaseCsvExporter<TRaw> {
  protected readonly dateLayout = 'YYMMDD';

  protected dateOf(raw: TRaw): string {
    return raw.valueDate;
  }

  protected incomeAmount(raw: TRaw): number {
    return raw.amount;
  }

  protected expenseAmount(raw: TRaw): number {
    return Math.abs(raw.amount);
  }

  protected title(raw: TRaw): string {
    return raw.details.description.join('');
  }
}
