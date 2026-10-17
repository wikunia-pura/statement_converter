/**
 * The accounting file of a PKO SA statement (see BaseCsvExporter).
 */

import { PKOSATransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<PKOSATransaction> {
  protected readonly dateLayout = 'YYYY-MM-DD';

  protected dateOf(raw: PKOSATransaction): string {
    return raw.dateFormatted;
  }

  protected incomeAmount(raw: PKOSATransaction): number {
    return raw.amountAbsolute;
  }

  protected expenseAmount(raw: PKOSATransaction): number {
    return raw.amountAbsolute;
  }

  protected title(raw: PKOSATransaction): string {
    return raw.description;
  }
}
