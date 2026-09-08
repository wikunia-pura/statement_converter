/**
 * Regression harness for apartment numbers the matcher can silently get wrong:
 * a lost letter (17A vs 17), address codes glued onto the number by a bank that
 * writes fixed-width fields with no separator (M.202-620 vs M.2 02-620), and a
 * number cut in two by the payer's bank wrapping the title (lok1 0 vs lok10).
 *
 * All three land in the same place — a plausible-looking number, high confidence,
 * no warning — so all three belong to the same gate. All three are also checked
 * against the *text*, independent of whatever number regex, AI, or the cache
 * actually produced: a correct-looking answer for an ambiguous reading (an AI
 * guessing "lok1 0" is apartment 10, and being right) is not a verified one, so
 * it must hold the row exactly like a wrong guess would.
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
 *      an account symbol unless one was stated explicitly. The same section covers
 *      rules that name several apartments of one payer: those must resolve to no
 *      apartment at all, so nothing is booked until the user picks one.
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
  apartmentGapInText,
  composeApartmentAccount,
  isAccountSymbol,
  isLetteredApartment,
  letteredApartmentInText,
  needsExplicitAccount,
  resolveApartmentAccount,
} from '../src/shared/apartment-account';
import {
  buildApartmentMapping,
  formatApartmentMappingLine,
  hasApartmentChoice,
  mappingTargets,
  parseApartmentMappingLine,
} from '../src/shared/apartment-mapping';
import { PKOBPMT940Parser } from '../src/converters/pko-mt940/parser';
import { RegexExtractor } from '../src/converters/pko-mt940/regex-extractor';
import { CsvExporter } from '../src/converters/pko-mt940/csv-exporter';
import { PocztowyMT940Parser } from '../src/converters/pocztowy/parser';
import { RegexExtractor as INGRegexExtractor } from '../src/converters/ing/regex-extractor';
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
/** The BOŚ camt.052 community, whose payer names arrive with the postal code glued on. */
const pulawska: Adres[] = [{ id: 4, nazwa: 'Puławska 116', createdAt: '' }];
/** The Bank Pocztowy community, whose payers' titles arrive cut into fixed-width lines. */
const kwiatowa: Adres[] = [{ id: 5, nazwa: 'Kwiatowa 24A', createdAt: '' }];
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

/** Rules whose phrase points at several apartments of the same payer. */
const withMultiRules: Adres[] = [
  {
    id: 3,
    nazwa: 'Bogunki 5',
    createdAt: '',
    apartmentMappings: [
      {
        id: 'm1',
        matchText: 'MARIA WIELOLOKALOWA',
        apartmentNumber: '25',
        additionalApartments: [
          { apartmentNumber: '31' },
          { apartmentNumber: '17A', kontoLokalu: '204-00017A' },
        ],
      },
      {
        id: 'm2',
        matchText: 'PIOTR JEDEN',
        apartmentNumber: '12',
        // Same apartment twice plus a blank row: still a one-apartment rule.
        additionalApartments: [{ apartmentNumber: '12' }, { apartmentNumber: '  ' }],
      },
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
  /** Apartments the user must choose between; empty unless the rule names several. */
  choices?: string[];
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
  {
    // The multi-apartment case: the rule knows the payer, not which of her three
    // apartments this transfer is for. Booking any of them would be a guess with
    // somebody's money, so no number is returned and nothing is booked — the
    // apartments come back as choices for the acceptance screen instead.
    name: 'reguła z kilkoma lokalami nie księguje żadnego z nich',
    addresses: withMultiRules,
    description: 'OPLATA EKSPLOATACYJNA',
    counterparty: 'MARIA WIELOLOKALOWA 02-692 WARSZAWA',
    apartment: null,
    account: null,
    heldBack: true,
    choices: ['25', '31', '17A'],
  },
  {
    name: 'powtórzony lokal w regule to nadal jeden lokal (księguje się sam)',
    addresses: withMultiRules,
    description: 'CZYNSZ',
    counterparty: 'PIOTR JEDEN',
    apartment: '12',
    account: '204-000012',
    heldBack: true, // rules always show up for acceptance
    choices: [],
  },

  // ── Address codes glued onto the apartment number ────────────────────────
  //
  // The bank writes name, street, postal code and city into one field of fixed
  // width, so "M.2" and "02-620" arrive as "M.202-620". Read greedily that is
  // apartment 202 at 95% confidence, and 8 of 10 payers in a single statement
  // were booked to a stranger's lokal that way. The postal code's dash sits at a
  // fixed offset, so the split back is forced, not guessed.
  {
    name: 'sklejony kod pocztowy: M.202-620 to lokal 2, nie 202',
    addresses: pulawska,
    description: 'OPŁATA ZA CZYNSZ',
    counterparty:
      'JOANNA WOJCIECHOWSKA  GABINET STMATOLOGICZNYUL. PUŁAWSKA 116  M.202-620 WARSZAWA',
    apartment: '2',
    account: '204-000002',
    heldBack: false,
  },
  {
    // The split is anchored on the dash, so it does not depend on how many
    // apartments the building has — a three-digit lokal survives it intact.
    name: 'sklejony kod pocztowy nie zależy od wielkości budynku (lokal 702)',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'JAN WIELKI UL. PUŁAWSKA 116 M.70202-620 WARSZAWA',
    apartment: '702',
    account: '204-000702',
    heldBack: false,
  },
  {
    name: 'sklejony kod pocztowy po ukośniku: 116/1802-620 to lokal 18',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'Krzysztof DrzewiczPuławska 116/1802-620 Warszawa',
    apartment: '18',
    account: '204-000018',
    heldBack: false,
  },
  {
    // Non-Warsaw code: the pattern is NN-NNN, not 0N-NNN.
    name: 'kod pocztowy spoza Warszawy: M.8322-300 to lokal 83',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'ALEKSANDRA JANECZEKUL.PCK 25 M.8322-300 KRASNYSTAW',
    apartment: '83',
    account: '204-000083',
    heldBack: false,
  },
  {
    // A NIP's dashes contain a false postal code ("521-332-10-09" → "21-332"),
    // which shreds the text unless the NIP is taken out first.
    name: 'NIP w tekście nie rozwala odczytu lokalu',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty:
      'Wspólnota Mieszkaniowa Puławska 116|ul. Puławska 116/10 02-620 Warszawa|NIP 521-332-10-09',
    apartment: '10',
    account: '204-000010',
    heldBack: false,
  },
  {
    // The mirror image of the glued case: a code sitting loose behind the
    // building number used to be read as apartment 02, i.e. lokal 2.
    name: 'sam kod pocztowy za numerem budynku to nie lokal',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'Wspólnota Mieszkaniowa||Puławska 116 02-620 Warszawa',
    apartment: null,
    account: null,
    heldBack: false,
  },
  {
    // Glue we cannot split: the number runs into a word. Held back rather than
    // booked — the account still resolves, but nobody books at 40% confidence.
    name: 'nierozłożona sklejka z literami wstrzymuje wpłatę',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'JAN NOWAK UL. PUŁAWSKA 116 M.26WARSZAWA',
    apartment: '26',
    account: '204-000026',
    heldBack: true,
  },
  {
    // A postal code written without its dash leaves no anchor to split on, so
    // the number swallows it. Width alone gives it away.
    name: 'numer lokalu za szeroki, by był prawdziwy, wstrzymuje wpłatę',
    addresses: pulawska,
    description: 'CZYNSZ',
    counterparty: 'JAN NOWAK UL. PUŁAWSKA 116 M.2602620 WARSZAWA',
    apartment: '2602620',
    account: '204-2602620',
    heldBack: true,
  },

  // ── A number cut in two by the payer's bank ──────────────────────────────
  //
  // The sender's bank writes the title into fixed-width lines and they come back
  // joined with a space, so "lok10" arrives as "lok1 0" and "114/12" as "114/1 2".
  // Read as written, that is apartment 1 at 95% confidence — the wrong owner's
  // account, with no warning. The guard does not repair the number (the cut
  // position is the sender's and cannot be told from a genuine space); it holds
  // the row so the user sees "lok1 0" and decides.
  {
    name: 'rozcięty numer za "lok": lok1 0 to nie na pewno lokal 1 → wstrzymane',
    addresses: kwiatowa,
    description: 'fundusz remontowy Kwiatowa 24A lok1 0 lipiec',
    counterparty: 'TOMASZ ORŁÓW KWIATOWA 24A/10 02-539 W',
    apartment: '1',
    account: '204-000001',
    heldBack: true,
  },
  {
    name: 'rozcięty numer po ukośniku: 114/1 2 → wstrzymane',
    addresses: kwiatowa,
    description: 'Fundusz remontowy, id. lokalu 114/1 2, sierpień 2026',
    counterparty: 'KUSTRA JÓZEF',
    apartment: '1',
    account: '204-000001',
    heldBack: true,
  },
  {
    // The exact case that slipped through the first version of this guard: the
    // payer's own clean address ("24A/12") resolves the apartment correctly
    // through a path that has nothing to do with the broken description — so the
    // *final* number is right — but the description still shows the cut-in-two
    // shape, and that is what must hold the row, not whether the number it
    // produced was lucky. (This is also what an AI reading "lok1 0" as apartment
    // 10 looks like: a correct-looking answer from an ambiguous title.)
    name: 'numer poprawnie rozpoznany (12) z INNEGO źródła nadal wstrzymany, bo opis pokazuje rozcięcie',
    addresses: kwiatowa,
    description: 'Fundusz remontowy, id. lokalu 114/1 2, sierpień 2026',
    counterparty: 'KUSTRA JÓZEF ul. KWIATOWA 24A/12 02-539',
    apartment: '12',
    account: '204-000012',
    heldBack: true,
  },
  {
    // The digits that legitimately follow an apartment number in a title are a
    // date, an amount or a year — none of them may hold every such payment.
    name: 'data po numerze lokalu nie jest ogonem (m. 5 08.2026)',
    addresses: kwiatowa,
    description: 'czynsz m. 5 08.2026',
    counterparty: 'JAN K',
    apartment: '5',
    account: '204-000005',
    heldBack: false,
  },
  {
    name: 'rok po numerze lokalu nie jest ogonem (lokal 3 2026)',
    addresses: kwiatowa,
    description: 'czynsz lokal 3 2026',
    counterparty: 'JAN K',
    apartment: '3',
    account: '204-000003',
    heldBack: false,
  },
  {
    name: 'numer referencyjny po lokalu nie jest ogonem (za szeroki w całości)',
    addresses: kwiatowa,
    description: 'czynsz m. 12 260826109199',
    counterparty: 'JAN K',
    apartment: '12',
    account: '204-000012',
    heldBack: false,
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
  check('lokale do wyboru', r.apartmentChoices.map(target => target.apartmentNumber), c.choices ?? []);
  // A rule with a choice must never be sent to the AI to have the missing number
  // invented — that gate is the overall confidence, so it stays high on purpose.
  if ((c.choices?.length ?? 0) > 1) {
    check('nie idzie do AI (pewność ≥ 90)', r.confidence.overall >= 90, true);
  }
}

// ── 1b. Picking one of a rule's apartments ─────────────────────────────────
//
// The acceptance screen offers exactly the rule's apartments and books the one
// the user clicks, with the account the rule gives for it.

console.log('\n1b. Wybór lokalu z reguły');
{
  const targets = mappingTargets(withMultiRules[0].apartmentMappings![0]);
  check('reguła oferuje trzy lokale', targets.map(t => t.apartmentNumber), ['25', '31', '17A']);
  check('reguła z kilkoma lokalami wymaga wyboru', hasApartmentChoice(withMultiRules[0].apartmentMappings![0]), true);
  check('reguła z jednym lokalem nie wymaga wyboru', hasApartmentChoice(withMultiRules[0].apartmentMappings![1]), false);
  check(
    'wybór lokalu 31 → konto domyślne',
    resolveApartmentAccount(targets[1].apartmentNumber, targets[1].kontoLokalu ?? null, PREFIX),
    '204-000031',
  );
  check(
    'wybór lokalu 17A → konto z reguły',
    resolveApartmentAccount(targets[2].apartmentNumber, targets[2].kontoLokalu ?? null, PREFIX),
    '204-00017A',
  );

  // Storage shape: one apartment stays exactly what it always was, so old readers
  // and old exports keep working.
  const single = buildApartmentMapping({ id: 'x', matchText: 'A B' }, [{ apartmentNumber: '25' }]);
  check('jeden lokal → bez additionalApartments', single, {
    id: 'x',
    matchText: 'A B',
    apartmentNumber: '25',
  });
  const many = buildApartmentMapping({ id: 'y', matchText: 'A B', note: 'dwa lokale' }, [
    { apartmentNumber: ' 25 ' },
    { apartmentNumber: '25' },
    { apartmentNumber: '31', kontoLokalu: '17A' },
    { apartmentNumber: '' },
  ]);
  check('lista lokali: trim, dedup, konto tylko jako symbol', many, {
    id: 'y',
    matchText: 'A B',
    apartmentNumber: '25',
    additionalApartments: [{ apartmentNumber: '31' }],
    note: 'dwa lokale',
  });
  check('reguła bez lokalu nie powstaje', buildApartmentMapping({ id: 'z', matchText: 'A B' }, []), null);
}

// ── 1c. Eksport i import adresów do TXT ────────────────────────────────────
//
// The address book travels between installs as a TXT file, so a rule has to
// survive the round trip — including a rule written by a build that had never
// heard of a second apartment.

console.log('\n1c. Format MAP: w eksporcie adresów');
{
  const roundTrip = (mapping: any) => parseApartmentMappingLine(formatApartmentMappingLine(mapping));
  const single = { id: 'a', matchText: 'ANNA ZWYKLA', apartmentNumber: '25', note: 'wpłaca z konta w AT' };
  check('jeden lokal — postać linii', formatApartmentMappingLine(single as any),
    'MAP: ANNA ZWYKLA => 25 | wpłaca z konta w AT');
  check('jeden lokal — powrót z pliku', roundTrip(single), { ...single, id: '' });

  const withKonto = { id: 'b', matchText: 'CEZARY GUZ', apartmentNumber: '17A', kontoLokalu: '204-00017A' };
  check('lokal z kontem — postać linii', formatApartmentMappingLine(withKonto as any),
    'MAP: CEZARY GUZ => 17A | KONTO: 204-00017A');
  check('lokal z kontem — powrót z pliku', roundTrip(withKonto), { ...withKonto, id: '' });

  const multi = {
    id: 'c',
    matchText: 'MARIA WIELOLOKALOWA',
    apartmentNumber: '25',
    kontoLokalu: '204-000025',
    additionalApartments: [{ apartmentNumber: '31' }, { apartmentNumber: '17A', kontoLokalu: '204-00017A' }],
    note: 'trzy lokale',
  };
  check('kilka lokali — postać linii', formatApartmentMappingLine(multi as any),
    'MAP: MARIA WIELOLOKALOWA => 25=204-000025; 31; 17A=204-00017A | trzy lokale');
  check('kilka lokali — powrót z pliku', roundTrip(multi), { ...multi, id: '' });

  // Older files: the note used to sit in the slot the account now uses, and it
  // must still come back as a note rather than as an account.
  check('stary plik — notatka w miejscu konta', parseApartmentMappingLine('  MAP: JAN K => 12 | wpłaca z Austrii'),
    { id: '', matchText: 'JAN K', apartmentNumber: '12', note: 'wpłaca z Austrii' });
  check('linia bez lokalu jest odrzucana', parseApartmentMappingLine('MAP: JAN K => '), null);
  check('linia, która nie jest regułą', parseApartmentMappingLine('  ACCT: 12345'), null);
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

// The gap guard is the same kind of cross-check as the letter one, but it does
// not take the recognized apartment number at all: whatever number regex, AI
// or a known address elsewhere in the text landed on, the description alone
// still shows the cut — including when that number happens to be right.
check('luka po "lok1 0"', apartmentGapInText('Kwiatowa 24A lok1 0 lipiec'), { head: '1', tail: '0' });
check('luka po "114/1 2"', apartmentGapInText('id. lokalu 114/1 2, sierpień'), { head: '1', tail: '2' });
check('kilka spacji między połówkami', apartmentGapInText('lok1  0 lipiec'), { head: '1', tail: '0' });
check('numer bez luki jest czysty', apartmentGapInText('Kwiatowa 24A lok10 lipiec'), null);
check('data to nie luka', apartmentGapInText('m. 5 08.2026'), null);
check('kwota to nie luka', apartmentGapInText('lokal 3 150,00 PLN'), null);
check('rok to nie luka', apartmentGapInText('lok 5 2026'), null);
check('kod pocztowy za budynkiem to nie luka', apartmentGapInText('Piaskowa lok 10 00-950'), null);
check('za szeroki w całości to nie luka', apartmentGapInText('m. 12 260826109199'), null);
check('litera kończy numer', apartmentGapInText('lok 5A 3'), null);
check(
  'luka wykrywana niezależnie od tego, że finalny numer (12) rozpoznano gdzie indziej w tekście',
  apartmentGapInText('id. lokalu 114/1 2, sierpień 2026 KUSTRA JÓZEF ul. KWIATOWA 24A/12 02-539'),
  { head: '1', tail: '2' },
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

// ── 4. Reguła z kilkoma lokalami na prawdziwym pliku ───────────────────────
//
// The matcher is only half the story — the exporter decides where the money
// goes. So: take a real payer out of a real statement, give them a rule with two
// apartments, and check both ends. Nothing may be booked before the user picks,
// and the picked apartment's account must be exactly what lands in the file.

console.log('\n4. Reguła wielolokalowa na prawdziwym pliku');
if (FILES.length === 0) {
  console.log('  (pominięto — brak plików w test-data/Wierzbno)');
} else {
  const content = readFileWithEncoding(path.join(DIR, FILES[0]));
  const stmt = new PKOBPMT940Parser().parse(content);
  const incomeRaw = stmt.transactions.filter(t => t.debitCredit === 'C');
  // A payer whose name the plain matcher resolves on its own — so any change in
  // the outcome below can only come from the rule.
  const payer = incomeRaw.find(t => (t.details.counterpartyName || '').trim().length > 6)!;
  const phrase = payer.details.counterpartyName.trim().split(/\s+/).slice(0, 2).join(' ');

  const withPayerRule: Adres[] = [
    {
      id: 9,
      nazwa: 'Bogunki 5',
      createdAt: '',
      apartmentMappings: [
        {
          id: 'p1',
          matchText: phrase,
          apartmentNumber: '31',
          additionalApartments: [{ apartmentNumber: '44' }],
        },
      ],
    },
  ];

  const extractor = new RegexExtractor(withPayerRule);
  const extracted = extractor.extract(payer);
  console.log(`\n  płatnik „${phrase}" z regułą na lokale 31 i 44`);
  check('reguła zadziałała', extracted.matchedByManualMapping, true);
  check('bez wybranego lokalu nie ma numeru', extracted.apartmentNumber, null);
  check('bez wybranego lokalu nie ma konta',
    resolveApartmentAccount(extracted.apartmentNumber, extracted.accountOverride, PREFIX), null);

  const exportWith = (extractedData: any) => {
    const processed = [{
      original: payer,
      extracted: extractedData,
      transactionType: 'income',
      status: 'auto-approved',
    }];
    const exporter = new CsvExporter({ bankAccountSymbol: '131-1', apartmentPrefix: PREFIX });
    return exporter.export(processed as any);
  };

  const untouched = exportWith(extracted);
  check('nietknięta wpłata nie trafia na żadne konto lokalu',
    /204-0000(31|44)/.test(untouched), false);

  // What ConverterRegistry does with the pick: apartment number for the record,
  // account symbol for the booking.
  const picked = { ...extracted, apartmentNumber: '44', accountOverride: '204-000044' };
  const afterPick = exportWith(picked);
  check('po wyborze lokal 44 ląduje na 204-000044', afterPick.includes('204-000044'), true);
  check('drugi lokal reguły nie pojawia się w pliku', afterPick.includes('204-000031'), false);
}

// ── 5. Titles cut in two, on the real Bank Pocztowy files ──────────────────
//
// The fundusz-remontowy statements are where the cut lands inside the lokal
// number. The extractor returns null for a held-back row — that is what sends it
// to the user instead of the books — so "null" here is the pass condition.
//
// Kustra's transactions are the case the first version of this guard missed:
// the counterparty's own address ("24A/12") resolves the apartment correctly
// through a path that has nothing to do with the broken description, so the
// regex extractor used to return a confident, right-looking "12" for them.
// They must be held back anyway, because the description still shows the cut
// — the guard runs on the text, not on whether the number it produced was right.

const POCZTOWY_FILES = ['08M_2026 (1).mt940', '07M_2026 (1).mt940']
  .map(f => path.join(__dirname, '..', 'test-data', f))
  .filter(f => fs.existsSync(f));

// Exact count of transactions whose text shows the cut-in-two shape, per file.
// 08M: Orłów's 3 monthly wpłaty ("lok1 0") plus one of Kustra's two ("114/1 2");
// Kustra's other row ("114/1 ,") ends cleanly — no digit follows the space, so
// there is nothing to detect (the same reason apartmentGlueInText reports a
// number it can't find as clean, not suspicious). 07M has only that one Kustra
// row; Orłów does not appear in it at all.
const EXPECTED_GAP_COUNT: Record<string, number> = {
  '08M_2026 (1).mt940': 4,
  '07M_2026 (1).mt940': 1,
};

console.log('\n5. Rozcięte tytuły na plikach Bank Pocztowy');
if (POCZTOWY_FILES.length === 0) {
  console.log('  (pominięto — brak plików 0xM_2026 (1).mt940 w test-data)');
} else {
  for (const file of POCZTOWY_FILES) {
    const stmt = new PocztowyMT940Parser().parse(fs.readFileSync(file));
    const extractor = new INGRegexExtractor(kwiatowa);
    const income = stmt.transactions
      .filter(t => t.debitCredit === 'C')
      .map(t => {
        const combined = `${t.details.description.join('')} ${t.details.counterpartyName}`;
        return { original: t, extracted: extractor.extract(t), hasGap: apartmentGapInText(combined) !== null };
      });

    const gapButNotHeldBack = income.filter(p => p.hasGap && p.extracted !== null);
    const basename = path.basename(file);

    console.log(`\n  ${basename} — ${income.length} wpłat`);
    check(
      'żadna wpłata nie została zaksięgowana automatycznie na lokal 1',
      income.filter(p => p.extracted?.apartmentNumber === '1').length,
      0,
    );
    check(
      'liczba wpłat z rozciętym numerem w opisie zgadza się z oczekiwaną',
      income.filter(p => p.hasGap).length,
      EXPECTED_GAP_COUNT[basename] ?? 0,
    );
    check(
      'każda wpłata z rozciętym numerem jest wstrzymana, niezależnie od tego, jaki numer wyszedł (łapie i Orłowa, i Kustrę mimo poprawnego adresu kontrahenta)',
      gapButNotHeldBack.length,
      0,
    );

    if (VERBOSE) {
      for (const p of income) {
        console.log(
          `      ${String(p.extracted?.apartmentNumber ?? 'WSTRZYMANE').padEnd(10)} ${p.original.details.description.join('').slice(0, 55).padEnd(55)} | ${p.original.details.counterpartyName.slice(0, 30)}`,
        );
      }
    }
  }
}

console.log(`\n${failures === 0 ? '✓ wszystkie sprawdzenia przeszły' : `✗ nieudanych sprawdzeń: ${failures}`}\n`);
process.exit(failures === 0 ? 0 : 1);
