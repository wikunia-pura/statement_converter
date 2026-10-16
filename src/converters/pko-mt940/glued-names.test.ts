/**
 * A contractor name the bank glued to the text after it ("…WARSZAWAPLAC
 * BANKOWY"), through the whole PKO BP MT940 converter.
 *
 * Expenses are booked as 10.1.0 booked them — the contractor, automatically.
 * Incomes are left alone: a glued name never routes a payment to a "Pozostałe
 * przychody" entry, because a payment booked to the wrong account is the
 * costly mistake.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PKOBPMT940Converter } from './index';
import { Kontrahent } from '../../shared/types';

const contractor = (id: number, nazwa: string, konto: string, typ: Kontrahent['typy'][number]): Kontrahent =>
  ({ id, nazwa, kontoKontrahenta: konto, typy: [typ], alternativeNames: [] }) as unknown as Kontrahent;

const CONTRACTORS = [
  contractor(1, 'Miasto Stołeczne Warszawa', '201-00001', 'Kontrahent'),
  contractor(2, 'Odsetki od lokaty testowej', '750-1', 'Pozostałe przychody'),
];

const STATEMENT = [
  ':20:TEST01',
  ':25:/PL00123456780000000000000001',
  ':28C:1/2026',
  ':60F:C260101PLN1000,00',
  // Expense: the city's name glued to its street in one counterparty subfield.
  ':61:2601100110D250,00N641NONREF//1',
  ':86:641',
  '~00PRZELEW',
  '~20Oplata za odpady 01/2026',
  '~32MIASTO STOLECZNE WARSZAWAPLAC BANKOWY 2',
  // Income: an income entry's name glued to the next word of the title.
  ':61:2601120112C12,34N641NONREF//2',
  ':86:641',
  '~00PRZELEW',
  '~20ODSETKI OD LOKATY TESTOWEJNR 12',
  '~32BANK TESTOWY',
  ':62F:C260131PLN762,34',
  '-',
].join('\r\n');

describe('PKO BP MT940 — glued contractor names', () => {
  // The converter narrates its work on the console; keep the test output quiet.
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => vi.restoreAllMocks());

  it('an expense with a glued contractor name is booked to that contractor, unheld', async () => {
    const converter = new PKOBPMT940Converter({ aiProvider: 'none', contractors: CONTRACTORS, addresses: [] });
    const result = await converter.convert(STATEMENT);
    const expense = result.processed.find((t) => t.transactionType === 'expense')!;
    expect(expense.matchedContractor?.contractor?.nazwa).toBe('Miasto Stołeczne Warszawa');
    expect(expense.matchedContractor?.confidence).toBeGreaterThanOrEqual(85);
    expect(expense.extracted.holdReason ?? null).toBeNull();
    expect(expense.status).toBe('auto-approved');
  });

  it('an income with a glued "Pozostałe przychody" name is not routed to that entry', async () => {
    const converter = new PKOBPMT940Converter({ aiProvider: 'none', contractors: CONTRACTORS, addresses: [] });
    const result = await converter.convert(STATEMENT);
    const income = result.processed.find((t) => t.transactionType === 'income')!;
    expect(income.extracted.accountOverride ?? null).not.toBe('750-1');
    expect(income.extracted.apartmentNumber ?? null).not.toBe('750-1');
    expect(income.status).not.toBe('auto-approved');
  });
});
