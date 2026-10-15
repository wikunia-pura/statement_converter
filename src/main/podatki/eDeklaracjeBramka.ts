/**
 * The e-Deklaracje gateway (SOAP 1.1, GateService) — sending a signed document and asking for its UPO. Any
 * form the app files goes through here: the CIT-8 now, the PIT-11 / PIT-4R next. No Electron: the caller
 * hands in the `fetch` to use (main.ts passes Electron's `net.fetch`, so the system proxy applies), and
 * scripts/edeklaracje-check.ts drives it with canned answers.
 *
 * Only `sendDocument` (a document carrying its own XAdES signature) and `requestUPO` are used. The answers
 * are read without caring for the namespace prefix the server picks; a SOAP fault or an HTTP error becomes an
 * Error naming what the server said.
 */

import { BRAMKA_URL, EDeklaracjeSrodowisko } from '../../shared/e-deklaracje';

const NS = 'https://bramka.e-deklaracje.mf.gov.pl/xsd';
const LIMIT_MS = 60_000;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface OdpowiedzBramki {
  status: number;
  opis: string;
}

/**
 * A failed call whose request certainly did not get into the gateway: the connection never opened (no
 * network, no DNS, refused, a TLS failure) or the gateway answered with a SOAP fault. Every other failure of
 * a `sendDocument` — a timeout, a connection dropped mid-way, an answer that cannot be read — leaves it
 * unknown whether the document was taken, and the caller must treat it so.
 */
export class BramkaNiePrzyjela extends Error {}

/** Chromium's (`net::ERR_…`) and Node's codes of a connection that never carried the request. */
const PRZED_POLACZENIEM =
  /ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE|ADDRESS_INVALID|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NETWORK_ACCESS_DENIED|CERT_|SSL_)|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/;

const bezPolaczenia = (error: unknown): boolean => {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const tekst = `${error instanceof Error ? error.message : String(error)} ${String(cause?.code ?? '')} ${String(cause?.message ?? '')}`;
  return PRZED_POLACZENIEM.test(tekst);
};

/** Text of a SOAP field; the C0 controls XML 1.0 forbids (all but tab, LF, CR) are dropped. */
const esc = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const odEsc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** The SOAP envelope of one call. */
export function koperta(operacja: 'sendDocument' | 'requestUPO', pola: [string, string][]): string {
  const tresc = pola.map(([k, v]) => `<ns:${k}>${esc(v)}</ns:${k}>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ns="${NS}"><soapenv:Body><ns:${operacja}>${tresc}</ns:${operacja}></soapenv:Body></soapenv:Envelope>`
  );
}

/** The text of the first element of that local name, whatever its prefix; null when absent. */
export function pole(xml: string, nazwa: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${nazwa}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nazwa}>`).exec(xml);
  if (m) return odEsc(m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'));
  return new RegExp(`<(?:[\\w.-]+:)?${nazwa}(?:\\s[^>]*)?/>`).test(xml) ? '' : null;
}

/** Status and description of an answer; a fault or an answer without a status is an error. */
export function odczytajOdpowiedz(xml: string, http: number): OdpowiedzBramki {
  const fault = pole(xml, 'faultstring');
  if (fault !== null) throw new BramkaNiePrzyjela(`Bramka e-Deklaracji odrzuciła żądanie: ${fault.trim() || `HTTP ${http}`}`);
  const status = pole(xml, 'status');
  if (status === null || !/^\d+$/.test(status.trim())) {
    throw new Error(`Bramka e-Deklaracji odpowiedziała nieoczekiwanie (HTTP ${http}).`);
  }
  return { status: Number(status.trim()), opis: (pole(xml, 'statusOpis') ?? '').trim() };
}

async function wywolaj(
  fetchFn: FetchLike,
  srodowisko: EDeklaracjeSrodowisko,
  operacja: 'sendDocument' | 'requestUPO',
  pola: [string, string][],
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMIT_MS);
  try {
    const res = await fetchFn(BRAMKA_URL[srodowisko], {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"urn:${operacja}"` },
      body: koperta(operacja, pola),
      signal: ctrl.signal,
    });
    const text = await res.text();
    // A SOAP fault comes with HTTP 500 — its text says more than the code.
    if (!res.ok && pole(text, 'faultstring') === null) {
      throw new Error(`Bramka e-Deklaracji nie odpowiedziała poprawnie (HTTP ${res.status}).`);
    }
    return text;
  } catch (error: unknown) {
    if (ctrl.signal.aborted) throw new Error('Bramka e-Deklaracji nie odpowiedziała w ciągu minuty.');
    if (error instanceof Error && error.message.startsWith('Bramka')) throw error;
    const tekst = `Nie udało się połączyć z bramką e-Deklaracji: ${error instanceof Error ? error.message : String(error)}`;
    throw bezPolaczenia(error) ? new BramkaNiePrzyjela(tekst) : new Error(tekst);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a document that carries its own XAdES signature. `refId` is null when the gateway did not take it. */
export async function wyslijDokument(
  fetchFn: FetchLike,
  srodowisko: EDeklaracjeSrodowisko,
  podpisanyXml: string,
): Promise<OdpowiedzBramki & { refId: string | null }> {
  const document = Buffer.from(podpisanyXml, 'utf8').toString('base64');
  const xml = await wywolaj(fetchFn, srodowisko, 'sendDocument', [['document', document]]);
  const odp = odczytajOdpowiedz(xml, 200);
  return { ...odp, refId: (pole(xml, 'refId') ?? '').trim() || null };
}

/** Asks for the UPO of a sent document: the status, and the UPO itself (XML text) once there is one. */
export async function pobierzUpo(
  fetchFn: FetchLike,
  srodowisko: EDeklaracjeSrodowisko,
  refId: string,
): Promise<OdpowiedzBramki & { upo: string | null }> {
  const xml = await wywolaj(fetchFn, srodowisko, 'requestUPO', [
    ['refId', refId],
    ['language', 'pl'],
  ]);
  const odp = odczytajOdpowiedz(xml, 200);
  const upo = pole(xml, 'upo');
  return { ...odp, upo: upo && upo.trim() ? upo.trim() : null };
}
