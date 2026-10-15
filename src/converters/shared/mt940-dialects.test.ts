/**
 * The four MT940 parsers read one statement alike.
 *
 * The same five operations are written in each bank's dialect — PKO BP (`~XX`
 * lines, `N…NONREF//` after the amount), ING (two `:86:`, `S` + type after the
 * amount), Alior (`<XX` inline, `{ … -}` block) and Pocztowy (empty `:86:` tag
 * line, `<XX` continuation lines, nothing after the amount) — and every parser
 * must book the same dates, sides and amounts, keep each description with its
 * own amount across an empty `:86:`, and drop the same unreadable line.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PKOBPMT940Parser } from '../pko-mt940/parser';
import { INGMT940Parser } from '../ing/parser';
import { AliorMT940Parser } from '../alior/parser';
import { PocztowyMT940Parser } from '../pocztowy/parser';

interface Op {
  /** `:61:` up to and including the amount, as every dialect writes it. */
  head: string;
  /** Description, or '' for an operation whose `:86:` is empty. */
  opis: string;
}

const OPS: Op[] = [
  { head: '2601050105C1500,00', opis: 'Czynsz lokal 1 Testowa 1' },
  // Funds code after the mark, and an empty :86: — the shift case.
  { head: '2601060106DN230,45', opis: '' },
  // Storno of a credit: the money leaves the account.
  { head: '2601070107RC100,00', opis: 'Zwrot nadplaty lokal 2' },
  // Not an MT940 amount: dropped, never booked as 0,00.
  { head: '2601080108D1.000,00', opis: 'Faktura FV/1/2026' },
  { head: '2601090109C0,99', opis: 'Odsetki' },
];

const HEADER = [
  ':20:TEST01',
  ':25:/PL00123456780000000000000001',
  ':28C:1/2026',
  ':60F:C260101PLN1000,00',
];
const FOOTER = [
  ':62F:C260131PLN2170,54',
  ':86:NAME ACCOUNT OWNER:WSPOLNOTA MIESZKANIOWA TESTOWA 1',
];

function pko(): string {
  const body = OPS.flatMap((op, i) => [
    `:61:${op.head}N641NONREF//${i + 1}`,
    op.opis ? ':86:641' : ':86:',
    ...(op.opis ? ['~00PRZELEW', `~20${op.opis}`] : []),
  ]);
  return [...HEADER, ...body, ...FOOTER, '-'].join('\r\n');
}

function ing(): string {
  const body = OPS.flatMap((op, i) => [
    `:61:${op.head}S020REF${i + 1}`,
    ':86:020',
    // ING's detailed :86: — absent for the operation without a description.
    ...(op.opis ? [`:86:020~00PRZELEW~20${op.opis}`] : []),
  ]);
  return [...HEADER, ...body, ...FOOTER, '-'].join('\r\n');
}

function alior(): string {
  const body = OPS.flatMap((op, i) => [
    `:61:${op.head}NTRFNONREF//${i + 1}`,
    op.opis ? `:86:0510<00PRZELEW<20${op.opis}` : ':86:',
  ]);
  return ['{', ...HEADER, ...body, ...FOOTER, '-}'].join('\r\n');
}

function pocztowy(): string {
  const body = OPS.flatMap((op, i) => [
    `:61:${op.head}`,
    ':86:',
    `<0020260105000${i + 1}`,
    `<10${i + 1}`,
    ...(op.opis ? [`<20${op.opis}`] : []),
  ]);
  return ['{1:F01TESTPLPW}{2:I940TESTPLPW}{4:', ...HEADER, ...body, ...FOOTER, '-}'].join('\r\n');
}

interface Parsed {
  transactions: {
    valueDate: string;
    entryDate: string;
    debitCredit: 'D' | 'C';
    reversal?: boolean;
    amount: number;
    details: { description: string[] };
  }[];
  dropped?: { reason: string; excerpt: string }[];
  openingBalance: { amount: number };
  closingBalance: { amount: number };
}

const PARSERS: [string, () => Parsed][] = [
  ['PKO BP', () => new PKOBPMT940Parser().parse(pko())],
  ['ING', () => new INGMT940Parser().parse(ing())],
  ['Alior', () => new AliorMT940Parser().parse(alior())],
  ['Pocztowy', () => new PocztowyMT940Parser().parse(pocztowy())],
];

const EXPECTED = [
  {
    valueDate: '260105',
    entryDate: '0105',
    side: 'C',
    reversal: false,
    amount: 1500,
    description: ['Czynsz lokal 1 Testowa 1'],
  },
  {
    valueDate: '260106',
    entryDate: '0106',
    side: 'D',
    reversal: false,
    amount: 230.45,
    description: [],
  },
  {
    valueDate: '260107',
    entryDate: '0107',
    side: 'D',
    reversal: true,
    amount: 100,
    description: ['Zwrot nadplaty lokal 2'],
  },
  {
    valueDate: '260109',
    entryDate: '0109',
    side: 'C',
    reversal: false,
    amount: 0.99,
    description: ['Odsetki'],
  },
];

describe('MT940 dialects agree on one statement', () => {
  // ING logs the line it cannot read; the assertions below check it was dropped.
  const quiet = vi.spyOn(console, 'error');
  beforeAll(() => {
    quiet.mockImplementation(() => {});
  });
  afterAll(() => {
    quiet.mockRestore();
  });

  it.each(PARSERS)(
    '%s books the same operations, each with its own description',
    (_name, parse) => {
      const st = parse();
      const got = st.transactions.map((t) => ({
        valueDate: t.valueDate,
        entryDate: t.entryDate,
        side: t.debitCredit,
        reversal: !!t.reversal,
        amount: t.amount,
        description: t.details.description,
      }));
      expect(got).toEqual(EXPECTED);
    }
  );

  it.each(PARSERS)('%s drops the unreadable amount as "amount", never as 0,00', (_name, parse) => {
    const st = parse();
    const dropped = st.dropped ?? [];
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('amount');
    expect(dropped[0].excerpt.startsWith('2601080108D1.000,00')).toBe(true);
    expect(st.transactions.some((t) => t.amount === 0)).toBe(false);
  });

  it.each(PARSERS)('%s reads the statement balances', (_name, parse) => {
    const st = parse();
    expect(st.openingBalance.amount).toBe(1000);
    expect(st.closingBalance.amount).toBe(2170.54);
  });

  it('all four produce identical bookings', () => {
    const shapes = PARSERS.map(([, parse]) =>
      parse().transactions.map((t) => [
        t.valueDate,
        t.entryDate,
        t.debitCredit,
        !!t.reversal,
        t.amount,
      ])
    );
    for (const s of shapes.slice(1)) expect(s).toEqual(shapes[0]);
  });
});
