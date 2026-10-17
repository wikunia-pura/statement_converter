/**
 * The accounting file of a BNP Paribas camt statement (see BaseCsvExporter) —
 * and of a BOŚ one, whose rows are BNP's.
 *
 * The camt amount is unsigned (the direction is a separate field).
 */

import { BnpTransaction } from './types';
import { BaseCsvExporter } from '../shared/base-csv-exporter';

export type { CsvExportOptions } from '../shared/base-csv-exporter';

export class CsvExporter extends BaseCsvExporter<BnpTransaction> {
  protected readonly dateLayout = 'YYYY-MM-DD';

  protected dateOf(raw: BnpTransaction): string {
    return raw.bookingDate;
  }

  protected incomeAmount(raw: BnpTransaction): number {
    return raw.amount;
  }

  protected expenseAmount(raw: BnpTransaction): number {
    return raw.amount;
  }

  protected title(raw: BnpTransaction): string {
    return raw.description;
  }
}
