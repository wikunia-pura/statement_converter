/**
 * Regression harness for lettered apartment numbers (17A vs 17).
 *
 * The bug this guards against moved real money: a payment for apartment 17A was
 * recognized as apartment 17 with 95% confidence, so it never surfaced for review
 * and was booked to 204-000017 — a different owner's account. The letter was lost
 * because every apartment capture group in the matcher ended at the digits.
 *
 * Two things are checked, because fixing only the first would not have prevented
 * the loss:
 *
 *   1. Cases — the letter survives where it should, is *not* invented where a
 *      stray letter merely sits nearby, and a lettered apartment never resolves to
 *      an account symbol unless one was stated explicitly.
 *   2. Statement files — the whole pipeline over the real MT940 files, asserting
 *      what actually reaches k_ma in the accounting output. This is the layer that
 *      would have caught the original bug: the matcher is only half the story, the
 *      exporter decides where the money goes.
 *
 *   npx tsx scripts/lokal-litera-eval.ts
 *   npx tsx scripts/lokal-litera-eval.ts --verbose   # print every transaction
 *
 * Exit code is non-zero when any check fails, so this works as a gate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AddressMatcher } from '../src/shared/address-matcher';
import {
  composeApartmentAccount,
  isAccountSymbol,
  isLetteredApartment,
  letteredApartmentInText,
  needsExplicitAccount,
  resolveApartmentAccount,
} from '../src/shared/apartment-account';
import { PKOBPMT940Parser } from '../src/converters/pko-mt940/parser';
import { RegexExtractor } from '../src/converters/pko-mt940/regex-extractor';
import { CsvExporter } from '../src/converters/pko-mt940/csv-exporter';
import { readFileWithEncoding } from '../src/shared/encoding';
import { Adres } from '../src/shared/types';

const VERBOSE = process.argv.includes('--verbose');
const PREFIX = '204';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}`);
  if (!ok) console.log(`      oczekiwano ${JSON.stringify(expected)}, otrzymano ${JSON.stringify(actual)}`);
}

// ── 1. Matcher + account resolution ────────────────────────────────────────

const bogunki: Adres[] = [{ id: 1, nazwa: 'Bogunki 5', createdAt: '' }];
const bachmacka: Adres[] = [{ id: 2, nazwa: 'Bachmacka 6A', createdAt: '' }];
const withRules: Adres[] = [
  {
    id: 1,
    nazwa: 'Bogunki 5',
    createdAt: '',
    apartmentMappings: [
      { id: 'r1', matchText: 'CEZARY GUZ', apartmentNumber: '17A', kontoLokalu: '204-00017A' },
      { id: 'r2', matchText: 'JAN BEZKONTA', apartmentNumber: '18B' },
      { id: 'r3', matchText: 'ANNA ZWYKLA', apartmentNumber: '25' },
    ],
  },
];

interface Case {
  name: string;
  addresses: Adres[];
  description: string;
  counterparty: string;
  apartment: string | null;
  account: string | null;
  /** Whether the row must be held back for the user instead of booked silently. */
  heldBack: boolean;
}

const CASES: Case[] = [
  {
    name: 'litera sklejona z numerem (~20 i ~33 zgodne)',
    addresses: bogunki,
    description: 'BOGUNKI 5M17A',
    counterparty: 'CEZARY GUZ 02-692 WARSZAWAUL.BOGUNKI 5 M.17A',
    apartment: '17A',
    account: null,
    heldBack: true,
  },
  {
    name: 'litera zapisana małą literą → wielka',
    addresses: bogunki,
    description: 'czynsz lokal 17a',
    counterparty: 'JAN K',
    apartment: '17A',
    account: null,
    heldBack: true,
  },
  {
    name: 'luźne "A" po spacji to nie lokal 27A',
    addresses: bogunki,
    description: 'OPLATA ESPLOATACYJNA, BOGUNKI 5/27 A, WARSZAWA, MAREK SOSINSKI , ID 01211427',
    counterparty: 'MAREK SOSINSKI 02-692 WARSZAWA UL. BOGUNKI 5 M.27',
    apartment: '27',
    account: '204-000027',
    heldBack: false,
  },
  {
    name: 'zwykły numer księguje się jak dotąd',
    addresses: bogunki,
    description: 'Czynsz',
    counterparty: 'JUSTYNA GASIOROWSKA BOGUNKI 5/21, 02-692 WARSZAWA',
    apartment: '21',
    account: '204-000021',
    heldBack: false,
  },
  {
    name: 'data VII/2026r. nie jest lokalem z literą',
    addresses: bogunki,
    description:
      'Anna Wyka. W-wa ul. Bogunki 5 m 22 oplata eksploatacyjna za m-c VII/2026r.w tym fundusz remontowy. doplata za IV.V.VI/2026r.',
    counterparty: 'WYKA ANNA WYKA PIOTR KONIECZNA 20 05-506 MAGDALENKA',
    apartment: '22',
    account: '204-000022',
    heldBack: false,
  },
  {
    name: 'budynek z literą: 6A/12 → budynek 6A, lokal 12',
    addresses: bachmacka,
    description: 'CZYNSZ UL. BACHMACKA 6A/12 JAN KOWALSKI',
    counterparty: 'JAN KOWALSKI',
    apartment: '12',
    account: '204-000012',
    heldBack: false,
  },
  {
    name: 'budynek z literą w formie "6A M.12"',
    addresses: bachmacka,
    description: 'CZYNSZ UL. BACHMACKA 6A M.12 JAN KOWALSKI',
    counterparty: 'JAN KOWALSKI',
    apartment: '12',
    account: '204-000012',
    heldBack: false,
  },
  {
    name: 'reguła z kontem lokalu księguje 17A',
    addresses: withRules,
    description: 'BOGUNKI 5M17A',
    counterparty: 'CEZARY GUZ 02-692 WARSZAWA',
    apartment: '17A',
    account: '204-00017A',
    heldBack: true, // rules always show up for acceptance
  },
  {
    name: 'reguła bez konta nie księguje lokalu z literą',
    addresses: withRules,
    description: 'CZYNSZ',
    counterparty: 'JAN BEZKONTA',
    apartment: '18B',
    account: null,
    heldBack: true,
  },
  {
    name: 'reguła bez konta dla zwykłego numeru działa jak dotąd',
    addresses: withRules,
    description: 'CZYNSZ',
    counterparty: 'ANNA ZWYKLA',
    apartment: '25',
    account: '204-000025',
    heldBack: true, // rules always show up for acceptance
  },
];

console.log('\n1. Matcher i wyznaczanie konta');
for (const c of CASES) {
  const matcher = new AddressMatcher(c.addresses);
  const combined = `${c.description} ${c.counterparty}`;
  const r = matcher.match(combined, c.counterparty);
  const account = resolveApartmentAccount(r.apartmentNumber, r.accountOverride, PREFIX);
  const heldBack = r.confidence.overall < 70 || r.matchedByManualMapping;

  console.log(`\n  ${c.name}`);
  check('numer lokalu', r.apartmentNumber, c.apartment);
  check('konto', account, c.account);
  check('wstrzymane do decyzji', heldBack, c.heldBack);
}

// ── 2. Account helper edge cases ───────────────────────────────────────────

console.log('\n2. Symbole kont');
check('ZGN → konto zerowe', resolveApartmentAccount('ZGN', null, PREFIX), '204-000000');
check('konto wyjaśnień przechodzi bez zmian', resolveApartmentAccount('235-1', null, PREFIX), '235-1');
check('konto kontrahenta przechodzi bez zmian', resolveApartmentAccount('201-000091', null, PREFIX), '201-000091');
check('17A bez konta → brak księgowania', resolveApartmentAccount('17A', null, PREFIX), null);
check('17A z kontem → konto z reguły', resolveApartmentAccount('17A', '204-00017A', PREFIX), '204-00017A');
check('niepoprawne nadpisanie blokuje księgowanie', resolveApartmentAccount('17', 'bzdura', PREFIX), null);
check('śmieciowy numer nie trafia do k_ma', resolveApartmentAccount('17AB', null, PREFIX), null);
check('inny prefiks', resolveApartmentAccount('21', null, '205'), '205-000021');
check('17A to lokal z literą', isLetteredApartment('17A'), true);
check('235-1 to nie lokal z literą', isLetteredApartment('235-1'), false);
check('składanie z prefiksu', composeApartmentAccount('204', '00017A'), '204-00017A');
check('składanie toleruje wklejony prefiks', composeApartmentAccount('204', '204-00017A'), '204-00017A');
check('składanie odrzuca pustą resztę', composeApartmentAccount('204', '   '), null);
check('204-00017A to poprawny symbol', isAccountSymbol('204-00017A'), true);
check('17A to nie symbol konta', isAccountSymbol('17A'), false);

// ── 2b. Cross-check on the text, independent of any extractor ──────────────
//
// This is the layer that catches an AI (or cache) answer of "17" for text that
// says "17A" — the exact shape of the original bug, arriving from a source that
// carries no letter-awareness of its own.

console.log('\n2b. Kontrola po tekście (niezależna od ekstraktora)');
check('litera widoczna w opisie', letteredApartmentInText('UL.BOGUNKI 5 M.17A'), '17A');
check('litera po ukośniku', letteredApartmentInText('BOGUNKI 5/17a'), '17A');
check('data VII/2026r. to nie lokal', letteredApartmentInText('za m-c VII/2026r.'), null);
check('luźne "A" nie jest literą lokalu', letteredApartmentInText('BOGUNKI 5/27 A, WARSZAWA'), null);
check(
  'AI zwraca 17 dla opisu z 17A → wstrzymane',
  needsExplicitAccount('17', null, 'BOGUNKI 5M17A CEZARY GUZ UL.BOGUNKI 5 M.17A'),
  true,
);
check(
  'AI zwraca 17A → wstrzymane',
  needsExplicitAccount('17A', null, 'BOGUNKI 5M17A'),
  true,
);
check(
  'podane konto odpowiada na pytanie',
  needsExplicitAccount('17A', '204-00017A', 'BOGUNKI 5M17A'),
  false,
);
check(
  'zwykła wpłata nie jest wstrzymywana',
  needsExplicitAccount('21', null, 'JUSTYNA GASIOROWSKA BOGUNKI 5/21, 02-692 WARSZAWA'),
  false,
);

// ── 3. Whole pipeline over the real statement files ────────────────────────

const DIR = path.join(__dirname, '..', 'test-data', 'Wierzbno');
const FILES = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(f => /^pko_MT940_.*\.TXT$/i.test(f)).sort()
  : [];

console.log('\n3. Cały przebieg na plikach MT940');
if (FILES.length === 0) {
  console.log('  (pominięto — brak plików w test-data/Wierzbno)');
} else {
  for (const file of FILES) {
    const content = readFileWithEncoding(path.join(DIR, file));
    const stmt = new PKOBPMT940Parser().parse(content);
    const extractor = new RegexExtractor(bogunki);

    const processed = stmt.transactions.map(t => ({
      original: t,
      extracted: extractor.extract(t),
      transactionType: t.debitCredit === 'C' ? 'income' : 'expense',
      status: 'auto-approved',
    }));

    const exporter = new CsvExporter({ bankAccountSymbol: '131-1', apartmentPrefix: PREFIX });
    const output = exporter.export(processed as any);

    const income = processed.filter(p => p.transactionType === 'income');
    const lettered = income.filter(p => isLetteredApartment(p.extracted.apartmentNumber || ''));
    const bookedTo17 = output.split('\n').filter(l => l.includes('204-000017'));

    console.log(`\n  ${file} — ${stmt.transactions.length} transakcji, ${income.length} wpłat`);
    check('rozpoznane lokale z literą', lettered.map(p => p.extracted.apartmentNumber), ['17A']);
    check('żadna wpłata nie trafiła na 204-000017', bookedTo17.length, 0);
    check(
      'lokal z literą wylądował w NIEROZPOZNANYCH',
      lettered.every(p => resolveApartmentAccount(p.extracted.apartmentNumber, p.extracted.accountOverride, PREFIX) === null),
      true,
    );

    if (VERBOSE) {
      for (const p of income) {
        const account = resolveApartmentAccount(p.extracted.apartmentNumber, p.extracted.accountOverride, PREFIX);
        console.log(
          `      ${String(p.extracted.apartmentNumber ?? '—').padEnd(6)} ${String(account ?? 'NIEROZPOZNANE').padEnd(12)} ${p.original.details.description.join('').slice(0, 50)}`,
        );
      }
    }
  }
}

console.log(`\n${failures === 0 ? '✓ wszystkie sprawdzenia przeszły' : `✗ nieudanych sprawdzeń: ${failures}`}\n`);
process.exit(failures === 0 ? 0 : 1);
