/**
 * The writing of an e-Deklaracje XML, shared by every form the app files with the Ministry of Finance (PIT-11,
 * PIT-4R, CIT-8): a small tree of elements printed with the indentation of the official files and no other
 * whitespace, so what is signed (podpis/xades.ts) is exactly what is sent. The forms themselves — which
 * positions appear, in which order — live in pitXml.ts and citXml.ts.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Two decimals, a dot: "1234.50" ("TKwota2Nieujemna"). */
export const kwota2 = (x: number): string => (Math.round(x * 100 + 1e-7) / 100).toFixed(2);

/** Whole złoty: "77" ("TKwotaCNieujemna"). */
export const kwotaC = (x: number): string => String(Math.round(x));

export interface Wezel {
  nazwa: string;
  tekst?: string;
  atr?: [string, string][];
  dzieci?: Wezel[];
}

export const el = (nazwa: string, tekst: string, atr?: [string, string][]): Wezel => ({ nazwa, tekst, atr });
export const gr = (nazwa: string, dzieci: Wezel[], atr?: [string, string][]): Wezel => ({ nazwa, dzieci, atr });

function wypisz(w: Wezel, poziom: number): string {
  const wciecie = '  '.repeat(poziom);
  const atr = (w.atr ?? []).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  if (w.dzieci) {
    return `${wciecie}<${w.nazwa}${atr}>\n${w.dzieci.map((d) => wypisz(d, poziom + 1)).join('')}${wciecie}</${w.nazwa}>\n`;
  }
  return `${wciecie}<${w.nazwa}${atr}>${esc(w.tekst ?? '')}</${w.nazwa}>\n`;
}

/** Names go to the form in capitals, with no doubled spaces — the way every filed file has them. */
export const duze = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pl-PL');

/** The whole document: the declaration, then `korzenAtr` (the namespaces) on its opening tag. */
export function zlozXml(korzen: Wezel, korzenAtr: string): string {
  const tekst = wypisz(korzen, 0);
  const otwarcie = `<${korzen.nazwa}${korzenAtr}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${tekst.replace(/^<[^>]+>/, otwarcie)}`;
}
