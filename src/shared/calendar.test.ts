import { describe, it, expect } from 'vitest';
import {
  defaultTerminWysylki,
  isMaterialyOverdue,
  partsToIso,
  terminWysylkiDeadline,
  toDayKey,
  toParts,
} from './calendar';
import { Spotkanie, SpotkanieTyp } from './types';

// vitest.config.ts runs the tests in Europe/Warsaw. Fail loudly if that did not
// take, instead of passing every day-boundary assertion vacuously in UTC.
describe('test environment', () => {
  it('runs in Europe/Warsaw (CEST in July, CET in January)', () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });
});

describe('partsToIso / toDayKey', () => {
  it('local midnight stays on its own day — the slice(0, 10) bug', () => {
    const iso = partsToIso('2026-07-01', '00:00');
    expect(iso).toBe('2026-06-30T22:00:00.000Z');
    expect(toDayKey(iso!)).toBe('2026-07-01');
    // What the old `iso.slice(0, 10)` printed: the day before.
    expect(iso!.slice(0, 10)).toBe('2026-06-30');
  });

  it.each([
    ['2026-01-01', '00:00'],
    ['2026-07-01', '00:00'],
    ['2026-12-31', '23:59'],
    // Spring forward (29 March 2026, 02:00 → 03:00): both sides of the gap.
    ['2026-03-29', '00:30'],
    ['2026-03-29', '01:59'],
    ['2026-03-29', '03:00'],
    // Fall back (25 October 2026, 03:00 → 02:00): before, inside and after the repeated hour.
    ['2026-10-25', '00:30'],
    ['2026-10-25', '02:30'],
    ['2026-10-25', '03:30'],
  ])('%s %s round-trips through the stored instant', (date, time) => {
    const iso = partsToIso(date, time);
    expect(iso).not.toBeNull();
    expect(toParts(iso)).toEqual({ date, time });
    expect(toDayKey(iso!)).toBe(date);
  });

  it('an hour that does not exist (inside the spring gap) still lands on its day', () => {
    const iso = partsToIso('2026-03-29', '02:30');
    expect(iso).not.toBeNull();
    expect(toDayKey(iso!)).toBe('2026-03-29');
  });

  it('a missing or malformed time reads as midnight; a bad date is refused', () => {
    expect(partsToIso('2026-05-04', '')).toBe(partsToIso('2026-05-04', '00:00'));
    expect(partsToIso('2026-05-04', '9:00')).toBe(partsToIso('2026-05-04', '00:00'));
    expect(partsToIso('', '10:00')).toBeNull();
    expect(partsToIso('04.05.2026', '10:00')).toBeNull();
    expect(partsToIso('2026-13-01', '10:00')).toBeNull();
  });

  it('toDayKey: a bare day key is already a day; garbage is empty', () => {
    expect(toDayKey('2026-03-29')).toBe('2026-03-29');
    expect(toDayKey(new Date(2026, 2, 29, 23, 59))).toBe('2026-03-29');
    expect(toDayKey('not a date')).toBe('');
    expect(toParts(null)).toEqual({ date: '', time: '' });
  });
});

/* ------------------------------ Materials deadline ----------------------------- */

const TYP: SpotkanieTyp = {
  id: 1,
  nazwa: 'Zebranie roczne',
  kolor: '#5b5ff6',
  opis: '',
  dniNaDokumenty: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function spotkanie(startsAt: string, extra: Partial<Spotkanie> = {}): Spotkanie {
  return {
    id: 1,
    nazwa: 'Zebranie — Testowa 1',
    typId: TYP.id,
    adresId: null,
    adresNazwa: 'Testowa 1',
    lokalizacjaId: null,
    lokalizacjaNazwa: '',
    startsAt,
    endsAt: null,
    opis: '',
    uczestnicy: [],
    terminStatus: 'potwierdzony',
    terminZmienionyAt: null,
    terminZmienionyZ: null,
    terminZmienionyBy: null,
    terminZmianaOdczytanaAt: null,
    terminZmianaOdczytanaBy: null,
    terminWysylki: null,
    zgnJednostkaId: null,
    zgnPelnomocnikId: null,
    zgnNazwa: '',
    zarzad: [],
    materialyStatus: 'potrzebne',
    materialyZmienioneAt: null,
    materialyZmienioneBy: null,
    createdBy: 'jan.kowalski@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('materials deadline (calendar days)', () => {
  it('counts calendar days back from the meeting day and ends at 23:59:59.999 local, across DST', () => {
    // 31 March is after the spring switch, 24 March before it: still exactly 7 days.
    const s = spotkanie(partsToIso('2026-03-31', '10:00')!);
    expect(defaultTerminWysylki(s.startsAt, TYP)).toBe('2026-03-24');
    const deadline = terminWysylkiDeadline(s, [TYP])!;
    expect(toDayKey(deadline)).toBe('2026-03-24');
    expect([deadline.getHours(), deadline.getMinutes(), deadline.getSeconds()]).toEqual([
      23, 59, 59,
    ]);
  });

  it('a meeting just after midnight counts from its local day, not the UTC one', () => {
    // 1 April 00:30 local is 31 March in UTC; the notice still runs from 1 April.
    expect(defaultTerminWysylki(partsToIso('2026-04-01', '00:30'), TYP)).toBe('2026-03-25');
  });

  it('a day set on the meeting wins over the kind’s notice period', () => {
    const s = spotkanie(partsToIso('2026-03-31', '10:00')!, { terminWysylki: '2026-03-20' });
    expect(toDayKey(terminWysylkiDeadline(s, [TYP])!)).toBe('2026-03-20');
  });

  it('a kind without a notice period has no deadline at all', () => {
    const bez = { ...TYP, dniNaDokumenty: null };
    const s = spotkanie(partsToIso('2026-03-31', '10:00')!);
    expect(defaultTerminWysylki(s.startsAt, bez)).toBeNull();
    expect(terminWysylkiDeadline(s, [bez])).toBeNull();
    expect(isMaterialyOverdue(s, [bez], new Date(2027, 0, 1))).toBe(false);
  });

  it('overdue from the deadline’s last millisecond on, and never once sent or not needed', () => {
    const s = spotkanie(partsToIso('2026-10-30', '18:00')!);
    const deadline = terminWysylkiDeadline(s, [TYP])!;
    expect(toDayKey(deadline)).toBe('2026-10-23');
    expect(isMaterialyOverdue(s, [TYP], new Date(deadline.getTime() - 1))).toBe(false);
    expect(isMaterialyOverdue(s, [TYP], deadline)).toBe(true);
    expect(isMaterialyOverdue({ ...s, materialyStatus: 'wyslane' }, [TYP], deadline)).toBe(false);
    expect(isMaterialyOverdue({ ...s, materialyStatus: 'brak' }, [TYP], deadline)).toBe(false);
  });
});
