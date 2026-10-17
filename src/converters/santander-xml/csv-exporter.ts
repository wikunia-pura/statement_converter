/**
 * The accounting file of a Santander XML statement (see BaseCsvExporter).
 * The title is the base description (descBase).
 */

import { XmlTransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<XmlTransaction> {
  protected readonly dateLayout = 'DD/MM/YYYY';

  protected dateOf(raw: XmlTransaction): string {
    return raw.exeDate;
  }

  protected incomeAmount(raw: XmlTransaction): number {
    return raw.value;
  }

  protected expenseAmount(raw: XmlTransaction): number {
    return Math.abs(raw.value);
  }

  protected title(raw: XmlTransaction): string {
    return raw.descBase;
  }
}
