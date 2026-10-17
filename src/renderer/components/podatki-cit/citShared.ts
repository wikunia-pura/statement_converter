import {
  AdresIdentyfikacja,
  CitKategoria,
  PodatekAdres,
  PodatekCitDane,
  PodatekCitSprawozdanie,
} from '../../../shared/types';
import { ProblemCit8 } from '../../../shared/podatki-cit';
import { formatData } from '../../../shared/sprawozdanie';
import { nazwaUrzedu } from '../../../shared/pit-urzedy';
import { translations } from '../../translations';

export type T = (typeof translations)['pl'];

export const newRuleId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `r-${Date.now()}`;
};

export const kategoriaNazwy = (t: T): Record<CitKategoria, string> => ({
  przychod_opodatkowany: t.citKat_przychod_opodatkowany,
  przychod_zwolniony: t.citKat_przychod_zwolniony,
  koszt_wspolny: t.citKat_koszt_wspolny,
  koszt_opodatkowany: t.citKat_koszt_opodatkowany,
  koszt_zwolniony: t.citKat_koszt_zwolniony,
  niekoszt: t.citKat_niekoszt,
  pomin: t.citKat_pomin,
});

export function problemText(t: T, p: ProblemCit8, rok: number): string {
  switch (p.kod) {
    case 'nip':
      return t.citProblem_nip;
    case 'nazwa':
      return t.citProblem_nazwa;
    case 'urzad':
      return t.citProblem_urzad;
    case 'korekta':
      return t.citProblem_korekta;
    case 'ujemna':
      return t.citProblem_ujemna.replace('{poz}', p.pozycje.join(', '));
    case 'sprawozdanie':
      return t.citProblem_sprawozdanie.replace('{rok}', String(rok));
    case 'okres':
      return t.citProblem_okres
        .replace('{od}', formatData(p.od))
        .replace('{do}', formatData(p.do))
        .replace('{rok}', String(rok));
    case 'nieposortowane':
      return t.citProblem_nieposortowane.replace('{n}', String(p.ile));
    case 'niepotwierdzone':
      return t.citProblem_niepotwierdzone.replace('{n}', String(p.ile));
    case 'wzor':
      return t.citProblem_wzor.replace('{rok}', String(rok));
    case 'nipXml':
      return t.citProblem_nipXml;
    case 'kodUrzedu':
      return p.kodUrz ? t.citProblem_kodUrzedu.replace('{kod}', p.kodUrz) : t.citProblem_kodUrzeduBrak;
    case 'adres':
      return t.citProblem_adres.replace('{pola}', p.pola.map((k) => adresPole(t)[k].toLocaleLowerCase()).join(', '));
    case 'kodPocztowy':
      return t.citProblem_kodPocztowy;
  }
}

const adresPole = (t: T): Record<keyof PodatekAdres, string> => ({
  kraj: t.podKraj,
  wojewodztwo: t.podWojewodztwo,
  powiat: t.podPowiat,
  gmina: t.podGmina,
  ulica: t.podUlica,
  nrDomu: t.podNrDomu,
  nrLokalu: t.podNrLokalu,
  miejscowosc: t.podMiejscowosc,
  kodPocztowy: t.podKod,
});

/** The "filed with the tax office" tick, in the words of the shared tick slot. */
export const zlozoneLabels = (t: T) => ({
  done: t.citFiledDone,
  mark: t.citFiledMark,
  undo: t.citFiledUndo,
  doneBy: t.citFiledBy,
});

/**
 * The community's identification from Adresy laid over a return: the Adres is
 * the master, so every field it has filled wins, and what it lacks stays as the
 * return had it.
 */
export const zAdresu = (dane: PodatekCitDane, ident: AdresIdentyfikacja | undefined): PodatekCitDane => {
  if (!ident) return dane;
  return {
    ...dane,
    nip: ident.nip || dane.nip,
    nazwaPelna: ident.nazwaPelna || dane.nazwaPelna,
    siedziba: Object.values(ident.siedziba).some(Boolean) ? { ...ident.siedziba } : dane.siedziba,
    urzad: ident.urzadSkarbowy || nazwaUrzedu(ident.kodUrzedu) || dane.urzad,
    kodUrzedu: ident.kodUrzedu || dane.kodUrzedu,
    telefon: ident.telefon || dane.telefon,
  };
};

/**
 * A library statement as a return keeps it — a snapshot, so a later upload
 * never rewrites a filed return — with the vDom number it carries. Null when
 * the statement is gone from the library.
 */
export async function pobierzMigawke(
  id: number,
  kto: string,
): Promise<{ migawka: PodatekCitSprawozdanie; nrWsp: number | null } | null> {
  const row = await window.electronAPI.getSprawozdanie(id);
  if (!row?.dane) return null;
  return {
    migawka: { zrodloId: row.id, dane: row.dane, plikNazwa: row.plikNazwa, dodano: new Date().toISOString(), dodal: kto },
    nrWsp: row.nrWsp,
  };
}

/** A statement spanning exactly the calendar year — the only one a return can be drawn from. */
export const pelnyRok = (s: { okresOd: string; okresDo: string }, rok: number) =>
  s.okresOd === `${rok}-01-01` && s.okresDo === `${rok}-12-31`;
