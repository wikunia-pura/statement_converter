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

/**
 * What a person decided about a send the app could not settle itself:
 *  • `nie_dotarla` / `dotarla` — an uncertain send (no answer to the POST): checked elsewhere (e-Urząd
 *    Skarbowy, the office) that the document did not reach the gateway, or that it did;
 *  • `porzucona` — a send stuck "in progress" (3xx) that is no longer waited for.
 * Kept on the send with who and when, so the list shows why it stopped blocking.
 */
export interface WysylkaRozstrzygniecie {
  at: string;
  by: string;
  jak: 'nie_dotarla' | 'dotarla' | 'porzucona';
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
  /** The document's purpose (1 = filing, 2 = correction) when it was sent; absent on older sends. */
  cel?: 1 | 2;
  /**
   * The outcome is unknown: the send is recorded before the POST and no answer came (a timeout, a dropped
   * connection, the app closed mid-send) — the gateway may have taken the document. Offered for a person to
   * settle (`rozstrzygnieta`); a production one blocks every further production send of the return until then.
   */
  niepewna?: boolean;
  rozstrzygnieta?: WysylkaRozstrzygniecie | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const JAK: WysylkaRozstrzygniecie['jak'][] = ['nie_dotarla', 'dotarla', 'porzucona'];

/** Stored sends made safe to read. */
export function normalizeWysylki(raw: unknown): EDeklaracjeWysylka[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && !!str((w as Record<string, unknown>).at))
    .map((w) => {
      const upo = w.upo && typeof w.upo === 'object' ? (w.upo as Record<string, unknown>) : null;
      const roz = w.rozstrzygnieta && typeof w.rozstrzygnieta === 'object' ? (w.rozstrzygnieta as Record<string, unknown>) : null;
      const jak = JAK.find((j) => j === roz?.jak);
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
        // Every field a read-modify-write must carry over: one left out here is wiped by the next save.
        ...(w.cel === 1 || w.cel === 2 ? { cel: w.cel } : {}),
        ...(w.niepewna === true ? { niepewna: true } : {}),
        ...(roz && jak && str(roz.at) ? { rozstrzygnieta: { at: str(roz.at), by: str(roz.by), jak } } : {}),
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

/**
 * How long the automat waits before asking about a send again, by the send's age: every 30 seconds while
 * the gateway usually answers, then less and less often — a send still processing after an hour is asked
 * about every quarter of an hour, after a day hourly — rather than every 30 seconds for three days.
 * By age, not by a count of tries: reading the CIT list kicks the automat, which would reset a count.
 */
export function odstepUpoMs(w: EDeklaracjeWysylka, teraz = Date.now()): number {
  const wiek = teraz - Date.parse(w.at);
  if (wiek < 5 * 60_000) return 30_000;
  if (wiek < 3600_000) return 2 * 60_000;
  if (wiek < 24 * 3600_000) return 15 * 60_000;
  return 3600_000;
}

/** The send whose UPO is still to come: taken by the gateway, no final answer yet, not given up on. */
export const czekaNaUpo = (w: EDeklaracjeWysylka): boolean =>
  w.refId !== null && !statusKoncowy(w.status) && w.rozstrzygnieta?.jak !== 'porzucona';

/**
 * How long a send may still be on its way: the gateway's own limit (a minute) and a margin. An uncertain
 * send younger than this may be in flight on the computer that made it — shown as "sending", not offered
 * for settling.
 */
export const WYSYLANIE_MS = 2 * 60_000;

/**
 * A send stuck "in progress" a person may stop waiting for: still waiting an hour after it went — past the
 * minutes the gateway usually takes — so a fresh one is not given up by a stray click.
 */
export const moznaPorzucic = (w: EDeklaracjeWysylka, teraz = Date.now()): boolean =>
  czekaNaUpo(w) && teraz - Date.parse(w.at) >= 3600_000;

/** An uncertain send nobody has settled yet. */
export const niepewnaOtwarta = (w: EDeklaracjeWysylka): boolean => w.niepewna === true && !w.rozstrzygnieta;

/** Possibly still in flight: uncertain, unsettled and younger than `WYSYLANIE_MS`. */
export const wTrakcieWysylania = (w: EDeklaracjeWysylka, teraz = Date.now()): boolean =>
  niepewnaOtwarta(w) && teraz - Date.parse(w.at) < WYSYLANIE_MS;

/** The document reached the gateway — by its answer (200), or by a person's word on an uncertain send. */
export const dotarla = (w: EDeklaracjeWysylka): boolean => w.status === 200 || w.rozstrzygnieta?.jak === 'dotarla';

/**
 * The purpose of the send at `i`: as recorded, else read from the history — before sends recorded it, a
 * filing with its UPO held every further filing back, so a production send after an accepted one was a
 * correction.
 */
export function celWysylki(wysylki: EDeklaracjeWysylka[], i: number): 1 | 2 {
  const w = wysylki[i];
  if (w.cel) return w.cel;
  return wysylki.slice(0, i).some((x) => x.srodowisko === 'prod' && dotarla(x)) ? 2 : 1;
}

/**
 * Why a production send of a document must not go out now. `korektaCzeka` and `korektaPrzyjeta` stand
 * aside once the person confirms that correction; the others never do:
 *  • `niepewna` — an earlier send that got no answer and nobody settled: it may have been filed;
 *  • `przyjeta` / `zlozone` / `czeka` — a filing (cel 1) after one filed, or one still processing;
 *  • `korektaCzeka` — a correction while an earlier send still waits for its UPO;
 *  • `korektaPrzyjeta` — a correction after an earlier correction that reached the gateway.
 */
export type BlokadaWysylki =
  | { kod: 'niepewna'; at: string }
  | { kod: 'przyjeta'; refId: string }
  | { kod: 'zlozone' }
  | { kod: 'czeka'; refId: string }
  | { kod: 'korektaCzeka'; refId: string }
  | { kod: 'korektaPrzyjeta'; refId: string };

export const blokadaDoPotwierdzenia = (b: BlokadaWysylki): boolean =>
  b.kod === 'korektaCzeka' || b.kod === 'korektaPrzyjeta';

/** Every reason a production send of a document of purpose `cel` is held back — empty when it may go. */
export function blokadyWysylkiProd(d: { cel: 1 | 2; wysylki: EDeklaracjeWysylka[]; zlozone: unknown }): BlokadaWysylki[] {
  const out: BlokadaWysylki[] = [];
  const prod = d.wysylki.map((w, i) => ({ w, i })).filter(({ w }) => w.srodowisko === 'prod');
  const nowsze = [...prod].reverse();
  const niepewna = prod.find(({ w }) => niepewnaOtwarta(w));
  if (niepewna) out.push({ kod: 'niepewna', at: niepewna.w.at });
  const czeka = nowsze.find(({ w }) => czekaNaUpo(w));
  if (d.cel !== 2) {
    const przyjeta = nowsze.find(({ w }) => dotarla(w));
    if (przyjeta) out.push({ kod: 'przyjeta', refId: przyjeta.w.refId ?? '—' });
    else if (d.zlozone) out.push({ kod: 'zlozone' });
    if (czeka) out.push({ kod: 'czeka', refId: czeka.w.refId! });
    return out;
  }
  if (czeka) out.push({ kod: 'korektaCzeka', refId: czeka.w.refId! });
  const korekta = nowsze.find(({ w, i }) => dotarla(w) && celWysylki(d.wysylki, i) === 2);
  if (korekta) out.push({ kod: 'korektaPrzyjeta', refId: korekta.w.refId ?? '—' });
  return out;
}

/** The reason in Polish — for the main process, whose answers reach the user as they are. */
export function opisBlokady(b: BlokadaWysylki): string {
  switch (b.kod) {
    case 'niepewna':
      return 'Nie wysłano: wcześniejsza wysyłka nie dostała odpowiedzi bramki i mogła dotrzeć — sprawdź ją i rozstrzygnij na liście wysyłek zeznania.';
    case 'przyjeta':
      return `Nie wysłano: to zeznanie ma już UPO (nr ${b.refId}). Zmianę złóż jako korektę.`;
    case 'zlozone':
      return 'Nie wysłano: zeznanie jest oznaczone jako złożone. Zmianę złóż jako korektę.';
    case 'czeka':
      return `Nie wysłano: poprzednia wysyłka (nr ${b.refId}) czeka jeszcze na UPO — sprawdź UPO.`;
    case 'korektaCzeka':
      return `Nie wysłano korekty: poprzednia wysyłka (nr ${b.refId}) czeka jeszcze na UPO, a ponownej wysyłki nie potwierdzono.`;
    case 'korektaPrzyjeta':
      return `Nie wysłano korekty: wcześniejsza korekta (nr ${b.refId}) już dotarła do bramki, a ponownej wysyłki nie potwierdzono.`;
  }
}

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
