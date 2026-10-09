/**
 * What a community is for the tax office — NIP, REGON, full name, seat, office —
 * kept on its Adresy record, and the one-time fill of those fields from the
 * property-tax declarations the app already holds. Pure: the database applies
 * what this works out.
 */

import {
  Adres,
  AdresIdentyfikacja,
  AdresyZasilenieResult,
  PodatekAdres,
  PodatekNieruchomosci,
} from './types';
import { czyAdresPusty, czysc, normalizeAdres, pustyAdres, tylkoCyfry } from './podatki';
import { foldText } from './plan-gospodarczy';

export const pustaIdentyfikacja = (): AdresIdentyfikacja => ({
  nip: '',
  regon: '',
  nazwaPelna: '',
  siedziba: pustyAdres(),
  urzadSkarbowy: '',
  telefon: '',
  email: '',
});

/** Stored or typed data made safe to keep: every field present, digits where digits belong. */
export function normalizeIdentyfikacja(raw: unknown): AdresIdentyfikacja {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    nip: tylkoCyfry(r.nip),
    regon: tylkoCyfry(r.regon),
    nazwaPelna: czysc(r.nazwaPelna),
    siedziba: normalizeAdres(r.siedziba),
    urzadSkarbowy: czysc(r.urzadSkarbowy),
    telefon: czysc(r.telefon),
    email: czysc(r.email),
  };
}

/**
 * What tells two spellings of a community's name apart from a different
 * community: "WSPÓLNOTA MIESZKANIOWA AL.LOTNIKÓW 20" and "Al. Lotników 20" both
 * come to "lotnikow20". Prefixes, dots, spaces and case do not count.
 */
export function kluczNazwy(nazwa: string): string {
  return foldText(nazwa)
    .replace(/^wspolnota mieszkaniowa\s*/, '')
    .replace(/^(wm|ulica|ul|aleja|aleje|al|plac|pl|osiedle|os)\b\.?\s*/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** One address's fill: the patch to store, or null when the DN-1 had nothing new for it. */
export interface ZasilenieAdresu {
  adresId: number;
  identyfikacja: AdresIdentyfikacja;
}

/**
 * Fill the empty fields of each address from the newest DN-1 of the community
 * it matches by name. A field somebody already filled is never overwritten —
 * the app does this once, and from then on the data is kept by hand.
 * A DN-1 that fits no address, or several, is reported and left out.
 */
export function zasilZDn1(
  adresy: Adres[],
  dn1: PodatekNieruchomosci[],
): { patche: ZasilenieAdresu[]; wynik: AdresyZasilenieResult } {
  // The newest declaration per NIP carries the freshest data.
  const najnowsze = new Map<string, PodatekNieruchomosci>();
  for (const r of dn1) {
    const have = najnowsze.get(r.nip);
    if (!have || r.rok > have.rok) najnowsze.set(r.nip, r);
  }

  const klucze = (a: Adres) =>
    [a.nazwa, ...(a.alternativeNames ?? [])].map(kluczNazwy).filter(Boolean);

  const patche = new Map<number, AdresIdentyfikacja>();
  const dotkniete = new Set<number>();
  const bezDopasowania: string[] = [];
  const niejednoznaczne: string[] = [];

  for (const rek of najnowsze.values()) {
    const nazwa = rek.dane.nazwaPelna || rek.nip;
    const klucz = kluczNazwy(rek.dane.nazwaPelna);
    const trafione = klucz ? adresy.filter((a) => klucze(a).includes(klucz)) : [];
    if (trafione.length === 0) {
      bezDopasowania.push(nazwa);
      continue;
    }
    if (trafione.length > 1) {
      niejednoznaczne.push(nazwa);
      continue;
    }
    const adres = trafione[0];
    dotkniete.add(adres.id);
    const obecna = normalizeIdentyfikacja(patche.get(adres.id) ?? adres.identyfikacja);
    const d = rek.dane;
    const siedziba: PodatekAdres = czyAdresPusty(obecna.siedziba) ? normalizeAdres(d.siedziba) : obecna.siedziba;
    const nowa: AdresIdentyfikacja = {
      nip: obecna.nip || tylkoCyfry(rek.nip),
      regon: obecna.regon || tylkoCyfry(d.regon),
      nazwaPelna: obecna.nazwaPelna || czysc(d.nazwaPelna),
      siedziba,
      urzadSkarbowy: obecna.urzadSkarbowy,
      telefon: obecna.telefon || czysc(d.telefon),
      email: obecna.email || czysc(d.email),
    };
    if (JSON.stringify(nowa) !== JSON.stringify(obecna)) patche.set(adres.id, nowa);
  }

  return {
    patche: [...patche].map(([adresId, identyfikacja]) => ({ adresId, identyfikacja })),
    wynik: {
      zasilone: patche.size,
      bezZmian: dotkniete.size - patche.size,
      bezDopasowania,
      niejednoznaczne,
    },
  };
}

/**
 * One row of the property-tax list: a community of Adresy with its declaration
 * for the year (or none yet), or a declaration whose community is not in Adresy.
 */
export interface WierszDn1 {
  adres: Adres | null;
  rek: PodatekNieruchomosci | null;
}

/**
 * Every community of Adresy paired with its declaration of the year — by the
 * NIP kept on the address, else by name (only when exactly one declaration
 * fits) — then the declarations no address claimed, so none disappears.
 */
export function wierszeDn1(adresy: Adres[], deklaracje: PodatekNieruchomosci[]): WierszDn1[] {
  const wolne = new Set(deklaracje.map((r) => r.id));
  const poNipie = new Map<string, PodatekNieruchomosci>();
  for (const r of deklaracje) if (!poNipie.has(r.nip)) poNipie.set(r.nip, r);

  const przypisane = new Map<number, PodatekNieruchomosci>();
  const zajete = new Set<number>();
  // NIP first, for all addresses: a name match must not take a declaration another address owns by NIP.
  for (const a of adresy) {
    const nip = tylkoCyfry(a.identyfikacja?.nip);
    const rek = nip ? poNipie.get(nip) : undefined;
    if (rek && !zajete.has(rek.id)) {
      przypisane.set(a.id, rek);
      zajete.add(rek.id);
    }
  }
  for (const a of adresy) {
    if (przypisane.has(a.id)) continue;
    const klucze = [a.nazwa, a.identyfikacja?.nazwaPelna ?? '', ...(a.alternativeNames ?? [])]
      .map(kluczNazwy)
      .filter(Boolean);
    const trafione = deklaracje.filter(
      (r) => !zajete.has(r.id) && klucze.includes(kluczNazwy(r.dane.nazwaPelna)),
    );
    if (trafione.length === 1) {
      przypisane.set(a.id, trafione[0]);
      zajete.add(trafione[0].id);
    }
  }

  const out: WierszDn1[] = adresy.map((a) => ({ adres: a, rek: przypisane.get(a.id) ?? null }));
  for (const r of deklaracje) if (wolne.has(r.id) && !zajete.has(r.id)) out.push({ adres: null, rek: r });
  return out;
}
