/**
 * Sending ZUS documents straight to ZUS — EWD (Elektroniczna Wymiana Dokumentów), the channel Płatnik itself
 * uses: which service the app talks to, what a send is and what its answer means. Pure: the client
 * (main/podatki/zusEwd.ts), the handlers and the screens read the same rules.
 *
 * Two services with one interface: the test one (pt2.zus.pl, ZUS's "makieta") takes signed documents and
 * answers like the real one but files nothing; the production one files with ZUS. Test is the default — the
 * switch lives in Settings → Administracja and is machine-local, apart from the e-Deklaracje one.
 *
 * One send carries one document of the month list (a DRA set or one registration) as one KEDU, signed with a
 * qualified certificate (CAdES-B in an ASiC-S container), encrypted to ZUS's certificate. ZUS answers the send
 * with the przesyłka's id; its confirmation ("poświadczenie przedłożenia") comes later and says whether the
 * documents were taken (KOD_PRZYJECIA) — the app asks for it until it is there.
 */

import type { WysylkaRozstrzygniecie } from './e-deklaracje';

export type ZusSrodowisko = 'test' | 'prod';

/** The service address of each environment (the WSDL's own, `…/NawsUslugi.svc`). */
export const EWD_URL: Record<ZusSrodowisko, string> = {
  test: 'https://www.pt2.zus.pl/SDWI_AWS2/NawsUslugi.svc',
  prod: 'https://www.ewd2.warszawa.zus.pl/SDWI_AWS2/NawsUslugi.svc',
};

/** Anything but an explicit 'prod' is the test service. */
export const normalizeZusSrodowisko = (v: unknown): ZusSrodowisko => (v === 'prod' ? 'prod' : 'test');

/** One error ZUS found in the documents (BLEDY/BLAD of the confirmation). */
export interface ZusBladPotwierdzenia {
  rodzaj: string;
  opis: string;
}

/** ZUS's confirmation of a przesyłka, as read from it. */
export interface ZusPotwierdzenie {
  /** When the app received it. */
  at: string;
  /** ZUS's id of the confirmation itself. */
  id: string;
  /** KOD_PRZYJECIA: the documents were taken. */
  przyjeta: boolean;
  /** STATUS_PRZETW, verbatim. */
  status: string;
  bledy: ZusBladPotwierdzenia[];
  /**
   * PODPISUJACY/JEST_UPOWAZNIENIE: whether the signer may act for the payer — 'same' (the payer itself), 'true'
   * (a power of attorney ZUS knows), 'false' (none), 'omit' (not checked). Verbatim; '' when absent.
   */
  upowaznienie: string;
  /** Who ZUS read as the signer (NAZWISKO_PODPIS IMIE_PODPIS, or NAZWA_PODPIS). */
  podpisal: string;
  /** DATA_REJ: when ZUS registered the przesyłka. */
  zarejestrowano: string;
  /** File name of the saved confirmation (the container as ZUS sent it), in the month's folder. */
  plik: string;
  /** The confirmation XML (a few kB) — kept so it can be read on any computer. */
  tresc: string;
  /** The container as ZUS sent it (ZUS's signature over the XML), base64 — the receipt, saved again on demand. */
  kontener: string;
}

/** One send of one document to EWD — a row of `podatki_zus_wysylki`. */
export interface ZusWysylka {
  id: number;
  nip: string;
  okres: string;
  /** The document as the month list names it (`r:…`, `z:…`, `w:…`, `c:…`). */
  dokument: string;
  /** The set's identifier (01 filing, 02+ correction); null for a registration. */
  identyfikator: number | null;
  /** "DRA 2026-09 — WM LIPOWA 8", as the summary showed it. */
  nazwa: string;
  srodowisko: ZusSrodowisko;
  at: string;
  by: string;
  /** The KEDU file that went, saved in the month's folder. */
  plik: string;
  /** The certificate's holder who signed it. */
  podpisal: string;
  /** ZUS's id of the przesyłka; null when ZUS did not take it (or no answer came). */
  idPrzesylki: string | null;
  /** The last word about it — ZUS's, or why it did not go. */
  opis: string;
  /** When the confirmation was last asked for. */
  sprawdzono: string | null;
  potwierdzenie: ZusPotwierdzenie | null;
  /**
   * The outcome is unknown: the send is recorded before the POST and no answer came (a timeout, a dropped
   * connection, the app closed mid-send) — ZUS may have taken it. For a person to settle.
   */
  niepewna: boolean;
  rozstrzygnieta: WysylkaRozstrzygniecie | null;
}

/** The key a send is held by: the document, and for a set its identifier — a correction is another document. */
export const kluczWysylki = (dokument: string, identyfikator: number | null): string =>
  identyfikator ? `${dokument}#${identyfikator}` : dokument;

/** An uncertain send nobody has settled yet. */
export const niepewnaOtwarta = (w: ZusWysylka): boolean => w.niepewna && !w.rozstrzygnieta;

/** How long a send may still be on its way (ZUS answers a POST in seconds; the client gives up after a minute). */
export const WYSYLANIE_MS = 2 * 60_000;

/** Possibly still in flight: uncertain, unsettled and younger than `WYSYLANIE_MS`. */
export const wTrakcieWysylania = (w: ZusWysylka, teraz = Date.now()): boolean =>
  niepewnaOtwarta(w) && teraz - Date.parse(w.at) < WYSYLANIE_MS;

/** Taken by ZUS, its confirmation still to come, not given up on. */
export const czekaNaPotwierdzenie = (w: ZusWysylka): boolean =>
  w.idPrzesylki !== null && !w.potwierdzenie && w.rozstrzygnieta?.jak !== 'porzucona';

/**
 * A production send that holds its document back from another: one that may have reached ZUS (uncertain) or
 * is waiting for its confirmation. Stored as the row's `aktywna` — a unique index on the key keeps two of them
 * from existing at once, even when two computers send the same document in the same second.
 */
export const blokujeDokument = (w: ZusWysylka): boolean =>
  w.srodowisko === 'prod' && (niepewnaOtwarta(w) || czekaNaPotwierdzenie(w));

/** The documents reached ZUS and were taken — by its confirmation, or by a person's word on an uncertain send. */
export const przyjetaPrzezZus = (w: ZusWysylka): boolean => w.potwierdzenie?.przyjeta === true || w.rozstrzygnieta?.jak === 'dotarla';

/**
 * How long the automat keeps asking about a send: ZUS confirms within minutes to hours; one with no
 * confirmation after a week is left to "Sprawdź potwierdzenia".
 */
export const AUTOMAT_DNI = 7;

export const swiezaWysylka = (w: ZusWysylka, teraz = Date.now()): boolean => teraz - Date.parse(w.at) < AUTOMAT_DNI * 24 * 3600_000;

/** When to ask again, by the send's age: every minute at first, then less and less often. */
export function odstepMs(w: ZusWysylka, teraz = Date.now()): number {
  const wiek = teraz - Date.parse(w.at);
  if (wiek < 10 * 60_000) return 60_000;
  if (wiek < 2 * 3600_000) return 5 * 60_000;
  if (wiek < 24 * 3600_000) return 30 * 60_000;
  return 2 * 3600_000;
}

/**
 * A send still waiting a person may stop waiting for: on production a day after it went, past the hours ZUS
 * usually takes; on the test server at once — its makieta need not confirm everything, and nothing is filed.
 */
export const moznaPorzucic = (w: ZusWysylka, teraz = Date.now()): boolean =>
  czekaNaPotwierdzenie(w) && (w.srodowisko === 'test' || teraz - Date.parse(w.at) >= 24 * 3600_000);

/** Where a send is, for its badge. */
export type EtapZusWysylki =
  | 'wysylanie'
  | 'niepewna'
  | 'nie_wyslano'
  | 'czeka'
  | 'przyjeta'
  | 'odrzucona'
  | 'nie_dotarla'
  | 'dotarla'
  | 'porzucona';

export function etapZusWysylki(w: ZusWysylka, teraz = Date.now()): EtapZusWysylki {
  if (w.rozstrzygnieta) return w.rozstrzygnieta.jak;
  if (w.potwierdzenie) return w.potwierdzenie.przyjeta ? 'przyjeta' : 'odrzucona';
  if (w.niepewna) return wTrakcieWysylania(w, teraz) ? 'wysylanie' : 'niepewna';
  return w.idPrzesylki ? 'czeka' : 'nie_wyslano';
}

/** The newest send of a document (by its key), if any — of the given environment, or of either. */
export function ostatniaWysylka(wysylki: ZusWysylka[], klucz: string, srodowisko?: ZusSrodowisko): ZusWysylka | null {
  let out: ZusWysylka | null = null;
  for (const w of wysylki) {
    if (kluczWysylki(w.dokument, w.identyfikator) !== klucz) continue;
    if (srodowisko && w.srodowisko !== srodowisko) continue;
    if (!out || w.at > out.at || (w.at === out.at && w.id > out.id)) out = w;
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const JAK: WysylkaRozstrzygniecie['jak'][] = ['nie_dotarla', 'dotarla', 'porzucona'];

export function normalizePotwierdzenie(raw: unknown): ZusPotwierdzenie | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!str(p.at)) return null;
  return {
    at: str(p.at),
    id: str(p.id),
    przyjeta: p.przyjeta === true,
    status: str(p.status),
    bledy: Array.isArray(p.bledy)
      ? p.bledy
          .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
          .map((b) => ({ rodzaj: str(b.rodzaj), opis: str(b.opis) }))
      : [],
    upowaznienie: str(p.upowaznienie),
    podpisal: str(p.podpisal),
    zarejestrowano: str(p.zarejestrowano),
    plik: str(p.plik),
    tresc: str(p.tresc),
    kontener: str(p.kontener),
  };
}

/** The `dane` of a stored send made safe to read. Every field a read-modify-write must carry over is here. */
export function normalizeDaneWysylki(raw: unknown): Omit<ZusWysylka, 'id' | 'nip' | 'okres' | 'dokument' | 'srodowisko' | 'at'> {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const roz = d.rozstrzygnieta && typeof d.rozstrzygnieta === 'object' ? (d.rozstrzygnieta as Record<string, unknown>) : null;
  const jak = JAK.find((j) => j === roz?.jak);
  return {
    identyfikator: typeof d.identyfikator === 'number' && Number.isInteger(d.identyfikator) ? d.identyfikator : null,
    nazwa: str(d.nazwa),
    by: str(d.by),
    plik: str(d.plik),
    podpisal: str(d.podpisal),
    idPrzesylki: str(d.idPrzesylki) || null,
    opis: str(d.opis),
    sprawdzono: str(d.sprawdzono) || null,
    potwierdzenie: normalizePotwierdzenie(d.potwierdzenie),
    niepewna: d.niepewna === true,
    rozstrzygnieta: roz && jak && str(roz.at) ? { at: str(roz.at), by: str(roz.by), jak } : null,
  };
}
