/**
 * Financial statements ("sprawozdania finansowe") as the app stores and shows
 * them — coercion of stored rows, number formatting, matching a statement to a
 * community. Shared by the main process and the renderer.
 */

import {
  DokumentPobranie,
  PlanSprawozdanieMeta,
  Sprawozdanie,
  SprawozdanieLaczenie,
  SprawozdanieSekcja,
  SprawozdanieWiersz,
  SprawozdanieWstepTekst,
  SprawozdanieZapisane,
  ZebranieSprawozdanie,
} from './types';
import { foldText, nazwaNieruchomosci, normalizePobrania } from './plan-gospodarczy';
import { ukryteKwotyInterEj } from './inter-ej';

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

/**
 * What a version stores of its statement (`zebrania_wersje.sprawozdanie`): only
 * its own part. The figures are the linked library row's (`sprawozdanie_id`).
 */
export interface ZebranieSprawozdanieMeta {
  dodano: string;
  dodal: string;
  pobrania: DokumentPobranie[];
  wstep: SprawozdanieWstepTekst | null;
  laczenia: SprawozdanieLaczenie[];
  podkategorie: SprawozdanieLaczenie[];
}

/** Coerce a version's own part of its statement. */
export function normalizeSprawozdanieMeta(value: unknown): ZebranieSprawozdanieMeta {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    dodano: String(v.dodano ?? ''),
    dodal: String(v.dodal ?? ''),
    pobrania: normalizePobrania(v.pobrania) as DokumentPobranie[],
    wstep: normalizeWstepTekst(v.wstep),
    laczenia: normalizeLaczenia(v.laczenia),
    podkategorie: normalizeLaczenia(v.podkategorie),
  };
}

/** Coerce a Plany gospodarcze plan's own part of its statement (none stored = nothing regrouped). */
export function normalizePlanSprawozdanieMeta(value: unknown): PlanSprawozdanieMeta {
  const { pobrania, wstep, laczenia, podkategorie } = normalizeSprawozdanieMeta(value);
  return { pobrania, wstep, laczenia, podkategorie };
}

/** The library statement a Plany gospodarcze plan was drafted from: its community's, of the plan's period. */
export function sprawozdanieDlaPlanu<T extends Pick<SprawozdanieZapisane, 'nrWsp' | 'okresOd' | 'okresDo'>>(
  lista: T[],
  nrWsp: number,
  okres: { od: string; do: string },
): T | undefined {
  return lista.find((s) => s.nrWsp === nrWsp && s.okresOd === okres.od && s.okresDo === okres.do);
}

/** The stored mark of a statement unlinked by hand — see `ZebranieWersja.sprawozdanieOdlaczone`. */
export const SPRAWOZDANIE_ODLACZONE = { odlaczone: true } as const;

export function isSprawozdanieOdlaczone(stored: unknown): boolean {
  return !!stored && typeof stored === 'object' && (stored as Record<string, unknown>).odlaczone === true;
}

/**
 * A version's statement: its own part joined with the library row it links.
 * Null when it links none, or the row has no readable figures.
 */
export function zebranieSprawozdanie(
  stored: unknown,
  row: SprawozdanieZapisane | undefined,
): ZebranieSprawozdanie | null {
  if (!row?.dane) return null;
  return { ...normalizeSprawozdanieMeta(stored), dane: row.dane, plikNazwa: row.plikNazwa, sprawozdanieId: row.id };
}

/**
 * A version's statement as a backup carries it — whole, figures included (also
 * the copies of backups written before versions linked the library). Restore
 * finds or re-creates the library row from it.
 */
export function sprawozdanieZKopii(
  value: unknown,
): { dane: Sprawozdanie; plikNazwa: string; meta: ZebranieSprawozdanieMeta } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const dane = normalizeSprawozdanieDane(v.dane);
  if (!dane) return null;
  return { dane, plikNazwa: String(v.plikNazwa ?? ''), meta: normalizeSprawozdanieMeta(v) };
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

/* -------------------------------- Merged rows -------------------------------- */

/** Coerce stored merges: a merge of fewer than two named rows is no merge. */
export function normalizeLaczenia(value: unknown): SprawozdanieLaczenie[] {
  return (Array.isArray(value) ? value : [])
    .filter((l) => l && typeof l === 'object')
    .map((l) => {
      const r = l as Record<string, unknown>;
      const wiersze = (Array.isArray(r.wiersze) ? r.wiersze : []).map((w) => String(w ?? '')).filter(Boolean);
      return { sekcja: String(r.sekcja ?? ''), wiersze: [...new Set(wiersze)], nazwa: String(r.nazwa ?? '').trim() };
    })
    .filter((l) => l.sekcja && l.nazwa && l.wiersze.length >= 2);
}

/**
 * A row a merge must not take: the introduction reads it by its printed name
 * (the repair fund's opening balance), so a merge would skew its figures.
 * A subcategory keeps the name and may hold it.
 */
export function bezLaczenia(nazwa: string): boolean {
  return /^bilans otwarcia/.test(foldText(nazwa));
}

/**
 * Whether a merge still fits the statement: its section is there, and so is
 * every row it names, as an item row. A newer print that renamed or dropped a
 * row leaves the merge out — it is shown as out of date, never re-guessed.
 */
export function laczenieAktualne(spr: Sprawozdanie, l: SprawozdanieLaczenie): boolean {
  const sec = spr.sekcje.find((s) => s.tytul === l.sekcja);
  if (!sec) return false;
  return l.wiersze.every((n) => sec.wiersze.some((w) => !w.podsumowanie && w.nazwa === n));
}

/**
 * The statement with the merges applied: each merge's rows become one row at
 * the place of its first, named as given, summing every column (a column empty
 * in all of them stays empty). Summary rows are never touched — the
 * introduction reads them. A merge that is out of date, or names a row an
 * earlier merge took, is skipped.
 */
export function zastosujLaczenia(spr: Sprawozdanie, laczenia: SprawozdanieLaczenie[]): Sprawozdanie {
  if (laczenia.length === 0) return spr;
  const sekcje = spr.sekcje.map((sec) => {
    const own = laczenia.filter((l) => l.sekcja === sec.tytul && laczenieAktualne(spr, l));
    if (own.length === 0) return sec;
    const taken = new Set<string>();
    const merges = own.filter((l) => {
      if (l.wiersze.some((n) => taken.has(n))) return false;
      l.wiersze.forEach((n) => taken.add(n));
      return true;
    });
    const wiersze: SprawozdanieWiersz[] = [];
    const placed = new Set<SprawozdanieLaczenie>();
    for (const w of sec.wiersze) {
      const l = w.podsumowanie ? undefined : merges.find((m) => m.wiersze.includes(w.nazwa));
      if (!l) {
        wiersze.push(w);
        continue;
      }
      if (placed.has(l)) continue;
      placed.add(l);
      const parts = sec.wiersze.filter((x) => !x.podsumowanie && l.wiersze.includes(x.nazwa));
      wiersze.push({
        nazwa: l.nazwa,
        kwoty: sumaKolumn(sec, parts),
        podsumowanie: false,
        wyroznienie: false,
        polaczone: parts.map((x) => x.nazwa),
      });
    }
    return { ...sec, wiersze };
  });
  return { ...spr, sekcje };
}

/** Sum of the rows per column; a column empty in all of them stays empty. */
function sumaKolumn(sec: SprawozdanieSekcja, rows: SprawozdanieWiersz[]): (number | null)[] {
  return sec.kolumny.map((_, c) => {
    const vals = rows.map((x) => x.kwoty[c]).filter((k): k is number => k != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  });
}

/**
 * The statement with the subcategories applied: each one's rows move together
 * under a heading row at the place of the first of them — the heading carries
 * the name and the sums, the rows stay as they are. Same rules as a merge: item
 * rows of one section only, out-of-date or overlapping ones skipped.
 */
export function zastosujPodkategorie(spr: Sprawozdanie, podkategorie: SprawozdanieLaczenie[]): Sprawozdanie {
  if (podkategorie.length === 0) return spr;
  const sekcje = spr.sekcje.map((sec) => {
    const taken = new Set<string>();
    const own = podkategorie.filter((l) => {
      if (l.sekcja !== sec.tytul || !laczenieAktualne(spr, l) || l.wiersze.some((n) => taken.has(n))) return false;
      l.wiersze.forEach((n) => taken.add(n));
      return true;
    });
    if (own.length === 0) return sec;
    const wiersze: SprawozdanieWiersz[] = [];
    const placed = new Set<SprawozdanieLaczenie>();
    for (const w of sec.wiersze) {
      const l = w.podsumowanie ? undefined : own.find((m) => m.wiersze.includes(w.nazwa));
      if (!l) {
        wiersze.push(w);
        continue;
      }
      if (placed.has(l)) continue;
      placed.add(l);
      const parts = sec.wiersze.filter((x) => !x.podsumowanie && l.wiersze.includes(x.nazwa));
      wiersze.push({
        nazwa: l.nazwa,
        kwoty: sumaKolumn(sec, parts),
        podsumowanie: false,
        wyroznienie: false,
        podkategoria: 'naglowek',
      });
      wiersze.push(...parts.map((x) => ({ ...x, podkategoria: 'pozycja' as const })));
    }
    return { ...sec, wiersze };
  });
  return { ...spr, sekcje };
}

/**
 * A version's statement as its documents show it: the library's figures with
 * the version's merges, then its subcategories over the merged rows.
 */
export function sprawozdanieWersji(z: ZebranieSprawozdanie): Sprawozdanie {
  return zastosujPodkategorie(zastosujLaczenia(z.dane, z.laczenia), z.podkategorie);
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

/** How far before the meeting a statement's period may end and still be the one it presents. */
const AUTO_OKRES_MIESIECY = 12;

/**
 * The statement a meeting links by itself, when the choice is unambiguous: the
 * community's vDom number is known (never a match by name), and among its
 * statements whose period ended before the meeting — at most a year before —
 * exactly one has the latest end. Anything else is left to the user.
 */
export function sprawozdanieDlaZebrania(
  lista: SprawozdanieZapisane[],
  vdomNr: number | null,
  dataZebrania: string | null,
): SprawozdanieZapisane | null {
  const dzien = dataZebrania?.slice(0, 10) ?? '';
  if (vdomNr == null || !/^\d{4}-\d{2}-\d{2}$/.test(dzien)) return null;
  const [y, m, d] = dzien.split('-').map(Number);
  const od = new Date(Date.UTC(y, m - 1 - AUTO_OKRES_MIESIECY, d)).toISOString().slice(0, 10);
  const kandydaci = lista.filter((s) => s.nrWsp === vdomNr && s.okresDo < dzien && s.okresDo >= od);
  const najnowszy = kandydaci.reduce((max, s) => (s.okresDo > max ? s.okresDo : max), '');
  const trafione = kandydaci.filter((s) => s.okresDo === najnowszy);
  return trafione.length === 1 ? trafione[0] : null;
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
    .map((sec) => {
      const kept = sec.wiersze.filter((w) =>
        w.podsumowanie ? w.kwoty.some((k) => k != null) : w.podkategoria === 'naglowek' || hasValue(w),
      );
      // A subcategory's heading goes with its rows: kept while one of them is.
      const wiersze = kept.filter((w, i) => w.podkategoria !== 'naglowek' || kept[i + 1]?.podkategoria === 'pozycja');
      return { ...sec, wiersze };
    })
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
  /**
   * What the period came to, in plain sentences built from the figures. Not
   * printed: the paragraph starts empty and is written by the AI from these
   * facts (or by hand) — this is what the AI is told is true.
   */
  fakty: string;
  uwagi: string[];
}

const zl = (n: number) => `${formatKwota(n)} zł`;

function sekcja(spr: Sprawozdanie, re: RegExp): SprawozdanieSekcja | undefined {
  return spr.sekcje.find((s) => re.test(foldText(s.tytul)));
}

function wiersz(sec: SprawozdanieSekcja | undefined, re: RegExp): SprawozdanieWiersz | undefined {
  // A subcategory's heading is a name given at the meeting, not a row vDom printed.
  return sec?.wiersze.find((w) => w.podkategoria !== 'naglowek' && re.test(foldText(w.nazwa)));
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
    // INTER-EJ's fee is never named (shared/inter-ej) — not even as one of the biggest costs.
    const ukryte = ukryteKwotyInterEj(eks);
    const top = eks.wiersze
      // A subcategory counts as one item, by its heading.
      .filter((w, i) => !w.podsumowanie && w.podkategoria !== 'pozycja' && !ukryte.has(i) && (w.kwoty[eksK] ?? 0) > 0)
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

  return { kluczowe, fakty: zdania.join(' '), uwagi };
}
