/**
 * The accounting file of every bank, pinned byte for byte.
 *
 * Each bank's exporter gets the same bookings — recognised and unrecognised
 * income, apartments with and without an account of their own, matched and
 * unmatched expenses, titles that need cleaning — in that bank's own
 * transaction shape, and its output is compared with the stored snapshot. A
 * refactor of the exporters must leave every snapshot as it is; a deliberate
 * change to the file format shows up here as a reviewed snapshot update.
 */
import { describe, expect, it } from 'vitest';
import { CsvExporter as PkoMt940Exporter } from '../pko-mt940/csv-exporter';
import { CsvExporter as AliorExporter } from '../alior/csv-exporter';
import { CsvExporter as IngExporter } from '../ing/csv-exporter';
import { CsvExporter as PkoBiznesExporter } from '../pko-biznes/csv-exporter';
import { CsvExporter as PkoSaExporter } from '../pko-sa/csv-exporter';
import { CsvExporter as BnpExporter } from '../bnp-xml/csv-exporter';
import { CsvExporter as SantanderExporter } from '../santander-xml/csv-exporter';
import type { Kontrahent } from '../../shared/types';

/** One booking, independent of the bank. */
interface Booking {
  /** ISO day. */
  day: string;
  /** Positive; the direction is `type`. */
  amount: number;
  type: 'income' | 'expense';
  title: string;
  apartment?: string | null;
  accountOverride?: string | null;
  needsAccount?: boolean;
  /** An expense's contractor account; null = matched to nothing (a rejected match). */
  contractorAccount?: string | null;
}

const contractor = (konto: string): Kontrahent =>
  ({ id: 1, nazwa: `Kontrahent ${konto}`, kontoKontrahenta: konto }) as unknown as Kontrahent;

const LONG_TITLE =
  'Opłata za lokal nr 12 — czynsz + fundusz remontowy (09/2026) ZAKŁAD #77 @ ул. Шевченка №5\tdługi tytuł przelewu';

const BOOKINGS: Booking[] = [
  { day: '2026-09-01', amount: 512.4, type: 'income', title: 'CZYNSZ LOKAL 12 JAN KOWALSKI', apartment: '12' },
  { day: '2026-09-02', amount: 1.005, type: 'income', title: 'wpłata  bez   lokalu', apartment: null },
  { day: '2026-09-03', amount: 1234.5, type: 'income', title: 'Lokal 17A', apartment: '17A' },
  { day: '2026-09-03', amount: 300, type: 'income', title: 'Lokal 17A z kontem', apartment: '17A', accountOverride: '204-0017A' },
  { day: '2026-09-04', amount: 99.99, type: 'income', title: 'needsAccount bez konta', apartment: '5', needsAccount: true },
  { day: '2026-09-04', amount: 100, type: 'income', title: 'needsAccount z kontem', apartment: '5', needsAccount: true, accountOverride: '205-1' },
  { day: '2026-09-05', amount: 45.1, type: 'income', title: LONG_TITLE, apartment: '3' },
  { day: '2026-08-31', amount: 7, type: 'income', title: 'Ostatni dzień sierpnia', apartment: '120' },
  { day: '2026-09-10', amount: 250, type: 'expense', title: 'ENERGA faktura 123456', contractorAccount: '220-2' },
  { day: '2026-09-11', amount: 1999.95, type: 'expense', title: 'Firma sprzątająca', contractorAccount: '201-00123' },
  { day: '2026-09-12', amount: 12.3, type: 'expense', title: 'odrzucony kontrahent', contractorAccount: null },
  { day: '2026-09-13', amount: 0.5, type: 'expense', title: LONG_TITLE },
  { day: '2026-10-01', amount: 80, type: 'expense', title: 'Opłata październikowa', contractorAccount: '850-2' },
];

const [Y, M, D] = [0, 1, 2];
const parts = (day: string) => day.split('-');

function row(b: Booking, original: unknown) {
  return {
    original,
    transactionType: b.type,
    status: 'auto-approved',
    extracted: {
      apartmentNumber: b.apartment ?? null,
      accountOverride: b.accountOverride ?? null,
      needsAccount: b.needsAccount ?? false,
      streetName: null,
      buildingNumber: null,
      fullAddress: null,
      tenantName: null,
      confidence: { address: 0, apartment: 0, tenantName: 0, overall: 0 },
      extractionMethod: 'regex',
      warnings: [],
    },
    matchedContractor:
      b.type === 'expense' && b.contractorAccount !== undefined
        ? {
            contractor: b.contractorAccount ? contractor(b.contractorAccount) : null,
            confidence: b.contractorAccount ? 95 : 0,
            matchedIn: b.contractorAccount ? 'desc-base' : 'none',
          }
        : undefined,
  };
}

/** Each bank's transaction shape, as its parser leaves it. */
const SHAPES = {
  // MT940 (PKO BP, Alior, ING — and Bank Pocztowy through ING's exporter): YYMMDD, amount as on the statement.
  mt940: (b: Booking) => {
    const p = parts(b.day);
    return {
      valueDate: `${p[Y].slice(2)}${p[M]}${p[D]}`,
      amount: b.type === 'expense' ? -b.amount : b.amount,
      details: { description: [b.title.slice(0, 20), b.title.slice(20)] },
    };
  },
  pkoBiznes: (b: Booking) => {
    const p = parts(b.day);
    return { date: `${p[Y]}${p[M]}${p[D]}`, amount: b.type === 'expense' ? -b.amount : b.amount, description: b.title };
  },
  pkoSa: (b: Booking) => ({ dateFormatted: b.day, amountAbsolute: b.amount, description: b.title }),
  // camt (BNP Paribas, and BOŚ through BNP's exporter): the amount is unsigned, the direction is separate.
  bnp: (b: Booking) => ({ bookingDate: b.day, amount: b.amount, description: b.title }),
  santander: (b: Booking) => {
    const p = parts(b.day);
    return {
      exeDate: `${p[D]}/${p[M]}/${p[Y]}`,
      value: b.type === 'expense' ? -b.amount : b.amount,
      descBase: b.title,
      descOpt: 'opcjonalny',
    };
  },
};

type Shape = keyof typeof SHAPES;

interface AnyExporter {
  export(transactions: never[]): string;
}

const EXPORTERS: Array<{ bank: string; shape: Shape; create: (options?: object) => AnyExporter }> = [
  { bank: 'pko-mt940', shape: 'mt940', create: (o) => new PkoMt940Exporter(o) },
  { bank: 'alior', shape: 'mt940', create: (o) => new AliorExporter(o) },
  { bank: 'ing', shape: 'mt940', create: (o) => new IngExporter(o) },
  { bank: 'pko-biznes', shape: 'pkoBiznes', create: (o) => new PkoBiznesExporter(o) },
  { bank: 'pko-sa', shape: 'pkoSa', create: (o) => new PkoSaExporter(o) },
  { bank: 'bnp-xml', shape: 'bnp', create: (o) => new BnpExporter(o) },
  { bank: 'santander-xml', shape: 'santander', create: (o) => new SantanderExporter(o) },
];

const rowsFor = (shape: Shape, bookings: Booking[] = BOOKINGS) =>
  bookings.map((b) => row(b, SHAPES[shape](b))) as never[];

describe.each(EXPORTERS)('accounting file: $bank', ({ shape, create }) => {
  it('with the defaults the app uses', () => {
    expect(create({ separator: '\t', dateFormat: 'D.MM.YYYY', decimalSeparator: ',' }).export(rowsFor(shape))).toMatchSnapshot();
  });

  it('with another account type', () => {
    expect(create({ bankAccountSymbol: '142-2', apartmentPrefix: '205' }).export(rowsFor(shape))).toMatchSnapshot();
  });

  it('with the other formatting options', () => {
    expect(create({ separator: ';', dateFormat: 'DD/MM/YYYY', decimalSeparator: '.' }).export(rowsFor(shape))).toMatchSnapshot();
    expect(create({ dateFormat: 'YYYY-MM-DD' }).export(rowsFor(shape))).toMatchSnapshot();
  });

  it('with only expenses, and with nothing at all', () => {
    expect(create().export(rowsFor(shape, BOOKINGS.filter((b) => b.type === 'expense')))).toMatchSnapshot();
    expect(create().export([])).toMatchSnapshot();
  });
});
