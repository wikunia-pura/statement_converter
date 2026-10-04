/**
 * Financial statements ("sprawozdania finansowe") as the app stores and shows
 * them — coercion of stored rows, number formatting, matching a statement to a
 * community. Shared by the main process and the renderer.
 */

import {
  DokumentPobranie,
  Sprawozdanie,
  SprawozdanieSekcja,
  SprawozdanieWiersz,
  SprawozdanieWstepTekst,
  SprawozdanieZapisane,
  ZebranieSprawozdanie,
} from './types';
import { foldText, nazwaNieruchomosci, normalizePobrania } from './plan-gospodarczy';

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Coerce a stored statement — a hand-edited backup must not take the module down. */
export function normalizeSprawozdanieDane(value: unknown): Sprawozdanie | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const sekcje: SprawozdanieSekcja[] = (Array.isArray(v.sekcje) ? v.sekcje : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const sec = s as Record<string, unknown>;
      const kolumny = Array.isArray(sec.kolumny) ? sec.kolumny.map(String) : [];
      return {
        tytul: String(sec.tytul ?? ''),
        kolumny,
        kwotaNaglowka: numOrNull(sec.kwotaNaglowka),
        wiersze: (Array.isArray(sec.wiersze) ? sec.wiersze : [])
          .filter((w) => w && typeof w === 'object')
          .map((w) => {
            const row = w as Record<string, unknown>;
            const kwoty = Array.isArray(row.kwoty) ? row.kwoty.map(numOrNull) : [];
            return {
              nazwa: String(row.nazwa ?? ''),
              kwoty: kolumny.map((_, i) => kwoty[i] ?? null),
              podsumowanie: row.podsumowanie === true,
              wyroznienie: row.wyroznienie === true,
            };
          }),
      };
    });
  return {
    nrWsp: numOrNull(v.nrWsp),
    nazwa: String(v.nazwa ?? ''),
    okresOd: String(v.okresOd ?? ''),
    okresDo: String(v.okresDo ?? ''),
    powierzchnia: numOrNull(v.powierzchnia),
    powierzchniaCo: numOrNull(v.powierzchniaCo),
    sredniaLiczbaOsob: numOrNull(v.sredniaLiczbaOsob),
    sekcje,
    wydruk: String(v.wydruk ?? ''),
  };
}

/** Coerce a version's attached statement; null when there is none. */
export function normalizeZebranieSprawozdanie(value: unknown): ZebranieSprawozdanie | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const dane = normalizeSprawozdanieDane(v.dane);
  if (!dane) return null;
  return {
    dane,
    plikNazwa: String(v.plikNazwa ?? ''),
    zrodloId: numOrNull(v.zrodloId),
    dodano: String(v.dodano ?? ''),
    dodal: String(v.dodal ?? ''),
    pobrania: normalizePobrania(v.pobrania) as DokumentPobranie[],
    wstep: normalizeWstepTekst(v.wstep),
  };
}

/** Coerce an edited introduction; null when there is none (the computed one applies). */
export function normalizeWstepTekst(value: unknown): SprawozdanieWstepTekst | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    akapit: String(v.akapit ?? '').trim(),
    uwagi: (Array.isArray(v.uwagi) ? v.uwagi : []).map((u) => String(u ?? '').trim()).filter(Boolean),
  };
}

/* -------------------------------- Formatting -------------------------------- */

// Grouping always: Polish style leaves four-digit numbers ungrouped ("6609,10"),
// which reads as a misprint in a column of "16 669,33"s.
const PLN = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions);

/** 12345.6 → "12 345,60" — how amounts are printed on every document. */
export function formatKwota(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  // Intl puts a narrow no-break space between thousands; documents use a plain one.
  return PLN.format(n).replace(/ | /g, ' ');
}

/** "2026-09-30" → "30.09.2026". */
export function formatData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** "01.01.2026 – 30.09.2026". */
export function okresLabel(od: string, doDnia: string): string {
  return `${formatData(od)} – ${formatData(doDnia)}`;
}

/* -------------------------------- Matching -------------------------------- */

/** The part of a name that tells communities apart: "Gotarda 8", folded. */
function rdzenNazwy(nazwa: string): string {
  return foldText(nazwaNieruchomosci(nazwa))
    .replace(/^(wm|ul\.?|al\.?|aleja)\s+/, '')
    .replace(/\s+/g, '');
}

/**
 * Library statements that belong to a community: by its vDom number when one
 * is remembered, otherwise by name ("WM Gotarda 8" ↔ "Wspólnota Mieszkaniowa
 * Gotarda 8"). Newest period first.
 */
export function sprawozdaniaDlaWspolnoty(
  lista: SprawozdanieZapisane[],
  vdomNr: number | null,
  nazwy: string[],
): SprawozdanieZapisane[] {
  let hits: SprawozdanieZapisane[];
  if (vdomNr != null) {
    hits = lista.filter((s) => s.nrWsp === vdomNr);
  } else {
    const names = nazwy.map(rdzenNazwy).filter(Boolean);
    hits = lista.filter((s) => names.includes(rdzenNazwy(s.nazwa)));
  }
  return [...hits].sort((a, b) => b.okresDo.localeCompare(a.okresDo) || b.importedAt.localeCompare(a.importedAt));
}

/* ------------------------------ For the documents ------------------------------ */

const isZero = (k: number | null | undefined) => k == null || Math.abs(k) < 0.005;
const hasValue = (w: SprawozdanieWiersz) => w.kwoty.some((k) => !isZero(k));

/**
 * The statement as it goes into a document: item rows that are all zero are
 * left out, and so is a section with nothing but zeros left — "Informacja o
 * kredytach" of a community without a loan prints only an empty "Razem".
 */
export function bezZerowych(spr: Sprawozdanie): Sprawozdanie {
  const sekcje = spr.sekcje
    .map((sec) => ({
      ...sec,
      wiersze: sec.wiersze.filter((w) => (w.podsumowanie ? w.kwoty.some((k) => k != null) : hasValue(w))),
    }))
    .filter((sec) => !isZero(sec.kwotaNaglowka) || sec.wiersze.some(hasValue));
  return { ...spr, sekcje };
}

/** One headline figure of the introduction. */
export interface WstepPozycja {
  etykieta: string;
  kwota: number;
  /** How the figure reads: a loss or a negative balance is 'zle', a surplus 'dobrze'. */
  ton: 'neutralny' | 'dobrze' | 'zle';
}

/**
 * The introduction to a statement: its headline figures, a paragraph saying
 * what the period came to, and the points worth a reader's attention. Built
 * from the printed figures only — every number in it is one vDom printed, or
 * a difference of two of them, so it can go to the owners as it is.
 */
export interface SprawozdanieWstep {
  kluczowe: WstepPozycja[];
  akapit: string;
  uwagi: string[];
}

const zl = (n: number) => `${formatKwota(n)} zł`;

function sekcja(spr: Sprawozdanie, re: RegExp): SprawozdanieSekcja | undefined {
  return spr.sekcje.find((s) => re.test(foldText(s.tytul)));
}

function wiersz(sec: SprawozdanieSekcja | undefined, re: RegExp): SprawozdanieWiersz | undefined {
  return sec?.wiersze.find((w) => re.test(foldText(w.nazwa)));
}

function kolumna(sec: SprawozdanieSekcja | undefined, re: RegExp): number {
  return sec ? sec.kolumny.findIndex((k) => re.test(foldText(k))) : -1;
}

const kwotaW = (w: SprawozdanieWiersz | undefined, col: number): number | null =>
  w && col >= 0 ? w.kwoty[col] ?? null : null;

const pierwsza = (w: SprawozdanieWiersz | undefined): number | null =>
  w?.kwoty.find((k) => k != null) ?? null;

/**
 * A result row ("Wynik finansowy roku bieżącego (strata) 1.090,74"): vDom
 * prints the amount unsigned and says in words, or by its column, which way
 * it went. Positive = surplus, negative = loss.
 */
function wynik(w: SprawozdanieWiersz | undefined, kosztCol: number): number | null {
  const amount = pierwsza(w);
  if (!w || amount == null) return null;
  const name = foldText(w.nazwa);
  const abs = Math.abs(amount);
  if (/strat/.test(name)) return -abs;
  if (/zysk|nadwyzk/.test(name)) return abs;
  const col = w.kwoty.findIndex((k) => k != null);
  return col === kosztCol ? -abs : amount;
}

function lista(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} oraz ${items[items.length - 1]}`;
}

export function sprawozdanieWstep(spr: Sprawozdanie): SprawozdanieWstep {
  const kluczowe: WstepPozycja[] = [];
  const zdania: string[] = [];
  const uwagi: string[] = [];
  const okres = `od ${formatData(spr.okresOd)} do ${formatData(spr.okresDo)}`;
  const naDzien = formatData(spr.okresDo);

  // Running costs: income against costs, and what the period came to.
  const eks = sekcja(spr, /koszty eksploatacji/);
  const eksP = kolumna(eks, /przych/);
  const eksK = kolumna(eks, /koszt/);
  const eksRazem = wiersz(eks, /^razem/);
  const przychody = kwotaW(eksRazem, eksP);
  const koszty = kwotaW(eksRazem, eksK);
  const wynikBiezacy = wynik(wiersz(eks, /wynik finansowy roku biez/), eksK);
  const wynikNarast = wynik(wiersz(eks, /wynik finansowy narast/), eksK);
  if (przychody != null && koszty != null) {
    kluczowe.push({ etykieta: 'Przychody eksploatacyjne', kwota: przychody, ton: 'neutralny' });
    kluczowe.push({ etykieta: 'Koszty eksploatacji', kwota: koszty, ton: 'neutralny' });
    const roznica = wynikBiezacy ?? przychody - koszty;
    let zdanie = `W okresie ${okres} przychody na pokrycie kosztów eksploatacji wyniosły ${zl(przychody)}, a koszty eksploatacji ${zl(koszty)}`;
    if (isZero(roznica)) zdanie += ' — przychody i koszty się zbilansowały.';
    else if (roznica < 0) zdanie += `, co oznacza stratę w wysokości ${zl(-roznica)}.`;
    else zdanie += `, co oznacza nadwyżkę w wysokości ${zl(roznica)}.`;
    zdania.push(zdanie);
    if (!isZero(roznica)) {
      kluczowe.push({ etykieta: roznica < 0 ? 'Wynik okresu — strata' : 'Wynik okresu — nadwyżka', kwota: Math.abs(roznica), ton: roznica < 0 ? 'zle' : 'dobrze' });
    }
    if (roznica < -0.005) uwagi.push(`Koszty eksploatacji przewyższyły przychody o ${zl(-roznica)}.`);
    if (wynikNarast != null && wynikNarast < -0.005 && Math.abs(wynikNarast - roznica) >= 0.01) {
      uwagi.push(`Narastający wynik finansowy to strata ${zl(-wynikNarast)}.`);
    }
  }
  if (eks && eksK >= 0) {
    const top = eks.wiersze
      .filter((w) => !w.podsumowanie && (w.kwoty[eksK] ?? 0) > 0)
      .sort((a, b) => (b.kwoty[eksK] ?? 0) - (a.kwoty[eksK] ?? 0))
      .slice(0, 3);
    if (top.length > 0) {
      zdania.push(
        `${top.length > 1 ? 'Największe pozycje kosztowe to' : 'Największa pozycja kosztowa to'} ${lista(
          top.map((w) => `${w.nazwa.trim()} (${zl(w.kwoty[eksK] ?? 0)})`),
        )}.`,
      );
    }
  }

  // The repair fund: where it stands, and what came in and went out.
  const fr = sekcja(spr, /fundusz remontowy/);
  const frP = kolumna(fr, /przych/);
  const frK = kolumna(fr, /koszt/);
  const frStan = pierwsza(wiersz(fr, /^stan na dzien/));
  const frRazem = wiersz(fr, /^razem/);
  const frOtwarcie = kwotaW(wiersz(fr, /^bilans otwarcia/), frP) ?? 0;
  const frRazemP = kwotaW(frRazem, frP);
  const frWplywy = frRazemP != null ? frRazemP - frOtwarcie : null;
  const frWydatki = kwotaW(frRazem, frK);
  if (frStan != null) {
    kluczowe.push({ etykieta: 'Fundusz remontowy', kwota: frStan, ton: frStan < 0 ? 'zle' : 'neutralny' });
    let zdanie = `Stan funduszu remontowego na dzień ${naDzien} wynosi ${zl(frStan)}`;
    if (frWplywy != null && frWydatki != null) {
      zdanie += ` (wpływy w okresie: ${zl(frWplywy)}, wydatki: ${zl(frWydatki)})`;
    }
    zdania.push(`${zdanie}.`);
    if (frStan < 0) uwagi.push(`Fundusz remontowy ma ujemne saldo: ${zl(frStan)}.`);
    if (frWplywy != null && frWydatki != null && frWydatki - frWplywy >= 0.01) {
      uwagi.push(
        `Wydatki z funduszu remontowego w tym okresie (${zl(frWydatki)}) były wyższe niż jego wpływy (${zl(frWplywy)}).`,
      );
    }
  }

  // Loans — only when one is outstanding. vDom can print a repayment with no
  // opening balance as a negative "Stan"; that is no debt to tell owners about,
  // and the table still shows it as printed.
  const kr = sekcja(spr, /kredyt/);
  const krRazem = wiersz(kr, /^razem/);
  const krStan = kwotaW(krRazem, kolumna(kr, /^stan/));
  const krSplata = kwotaW(krRazem, kolumna(kr, /splac/));
  if (krStan != null && krStan >= 0.01) {
    kluczowe.push({ etykieta: 'Kredyt do spłaty', kwota: krStan, ton: 'neutralny' });
    zdania.push(
      `Do spłaty pozostaje ${zl(krStan)} kredytu${
        krSplata != null && krSplata >= 0.01 ? ` (w tym okresie spłacono ${zl(krSplata)})` : ''
      }.`,
    );
  }

  // Utilities: the settlement should come to zero.
  const sw = sekcja(spr, /swiadczen/);
  const swSaldo = kwotaW(wiersz(sw, /^lacznie/), kolumna(sw, /saldo/));
  if (swSaldo != null && !isZero(swSaldo)) {
    uwagi.push(`Saldo rozliczenia kosztów świadczeń na koniec okresu wynosi ${zl(swSaldo)}.`);
  }

  // Cash at the end of the period.
  const sp = sekcja(spr, /srodki pieniezne/);
  const srodki = sp ? sp.kwotaNaglowka ?? pierwsza(wiersz(sp, /^razem/)) : null;
  if (srodki != null) {
    kluczowe.push({ etykieta: 'Środki pieniężne', kwota: srodki, ton: srodki < 0 ? 'zle' : 'neutralny' });
    zdania.push(`Na rachunkach wspólnoty na koniec okresu znajdowało się łącznie ${zl(srodki)}.`);
    if (srodki < 0) uwagi.push(`Stan środków pieniężnych jest ujemny: ${zl(srodki)}.`);
  }

  return { kluczowe, akapit: zdania.join(' '), uwagi };
}
