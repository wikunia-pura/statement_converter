/**
 * The e-Deklaracje gateway of the Ministry of Finance — which one the app talks to, and what its answers mean.
 * Pure: the SOAP client (main/podatki/eDeklaracjeBramka.ts) and the screens read the same rules.
 *
 * Two gateways with one interface: the test one takes signed documents and answers like the real one (refId,
 * UPO) but files nothing; the production one files with the tax office. Test is the default everywhere — the
 * switch lives in Settings → Administracja and is machine-local.
 */

export type EDeklaracjeSrodowisko = 'test' | 'prod';

/** The service address each WSDL names (with its trailing slash). */
export const BRAMKA_URL: Record<EDeklaracjeSrodowisko, string> = {
  test: 'https://test-bramka.edeklaracje.gov.pl/uslugi/dokumenty/',
  prod: 'https://bramka.e-deklaracje.mf.gov.pl/uslugi/dokumenty/',
};

/** Anything but an explicit 'prod' is the test gateway. */
export const normalizeSrodowisko = (v: unknown): EDeklaracjeSrodowisko => (v === 'prod' ? 'prod' : 'test');

/**
 * Where a sent document is, from the gateway's status code (MF's "kody statusów"):
 *  • 200 — processed, the UPO is there: filed (or, on the test gateway, would have been);
 *  • 3xx — still being processed (300 "brak dokumentu" included: a fresh refId may not be registered yet);
 *  • 100–102 — the transmission itself failed: send again (or ask for the UPO again);
 *  • 4xx — refused for good (schema, signature, no power of attorney, duplicate…).
 * The texts are the gateway's own `statusOpis`, kept verbatim — only the bucket is decided here.
 */
export type EtapWysylki = 'przyjeta' | 'w_toku' | 'blad_transmisji' | 'odrzucona';

export function etapStatusu(status: number): EtapWysylki {
  if (status === 200) return 'przyjeta';
  if (status >= 300 && status < 400) return 'w_toku';
  if (status >= 400) return 'odrzucona';
  return 'blad_transmisji';
}

/** A status that will not change any more — no point asking for the UPO again. */
export const statusKoncowy = (status: number | null): boolean =>
  status !== null && (etapStatusu(status) === 'przyjeta' || etapStatusu(status) === 'odrzucona');

/** The UPO of a send, once the gateway gave one. */
export interface WysylkaUpo {
  at: string;
  /** File name of the UPO saved next to the return. */
  plik: string;
  /** The UPO itself (XML, a few kB) — kept so it can be downloaded again, on any computer. */
  tresc: string;
}

/** One sending of a signed document to the gateway — kept on the return, oldest first. */
export interface EDeklaracjeWysylka {
  at: string;
  by: string;
  srodowisko: EDeklaracjeSrodowisko;
  /** The signed file that was sent. */
  plik: string;
  /** The gateway's reference number; null when it did not take the document at all. */
  refId: string | null;
  /** The last status the gateway gave (send, then each UPO request); null = no answer (network). */
  status: number | null;
  opis: string;
  /** When the status was last asked for. */
  sprawdzono: string | null;
  upo: WysylkaUpo | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Stored sends made safe to read. */
export function normalizeWysylki(raw: unknown): EDeklaracjeWysylka[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && !!str((w as Record<string, unknown>).at))
    .map((w) => {
      const upo = w.upo && typeof w.upo === 'object' ? (w.upo as Record<string, unknown>) : null;
      return {
        at: str(w.at),
        by: str(w.by),
        srodowisko: normalizeSrodowisko(w.srodowisko),
        plik: str(w.plik),
        refId: str(w.refId) || null,
        status: typeof w.status === 'number' && Number.isFinite(w.status) ? w.status : null,
        opis: str(w.opis),
        sprawdzono: str(w.sprawdzono) || null,
        upo: upo && str(upo.plik) ? { at: str(upo.at), plik: str(upo.plik), tresc: str(upo.tresc) } : null,
      };
    });
}

/**
 * How long the automat keeps asking about a send: the gateway answers in minutes; a send still "in progress"
 * after three days is left to the "Sprawdź UPO" button rather than polled forever.
 */
export const AUTOMAT_UPO_DNI = 3;

export const swiezaWysylka = (w: EDeklaracjeWysylka, teraz = Date.now()): boolean =>
  teraz - Date.parse(w.at) < AUTOMAT_UPO_DNI * 24 * 3600 * 1000;

/** The send whose UPO is still to come: taken by the gateway, no final answer yet. */
export const czekaNaUpo = (w: EDeklaracjeWysylka): boolean => w.refId !== null && !statusKoncowy(w.status);

/** The newest send to the given gateway, if any. */
export const ostatniaWysylka = (
  wysylki: EDeklaracjeWysylka[],
  srodowisko?: EDeklaracjeSrodowisko,
): EDeklaracjeWysylka | null => {
  for (let i = wysylki.length - 1; i >= 0; i -= 1) {
    if (!srodowisko || wysylki[i].srodowisko === srodowisko) return wysylki[i];
  }
  return null;
};

/** Filed for real: a production send the gateway processed (UPO). */
export const przyjetaProdukcyjnie = (wysylki: EDeklaracjeWysylka[]): EDeklaracjeWysylka | null =>
  [...wysylki].reverse().find((w) => w.srodowisko === 'prod' && w.status === 200) ?? null;
