/**
 * The writing of an e-Deklaracje XML, shared by every form the app files with the Ministry of Finance (PIT-11,
 * PIT-4R, CIT-8): a small tree of elements printed with the indentation of the official files and no other
 * whitespace, so what is signed (podpis/xades.ts) is exactly what is sent. The forms themselves — which
 * positions appear, in which order — live in pitXml.ts and citXml.ts.
 */

/**
 * Text for an element or an attribute. The C0 control characters XML 1.0 forbids (all but tab, LF, CR) are
 * dropped: one pasted into a name would make the file unparseable — after the card has signed it.
 */
const esc = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Every amount position of the forms filed here (CIT-8, PIT-11, PIT-4R) is a non-negative type. A negative
 * one is refused here, before the signing: the forms' own checks (`problemyCIT8Xml`) name the position first.
 */
const nieujemna = (grosze: number, x: number): void => {
  if (grosze < 0) {
    throw new Error(`Kwota ${x.toFixed(2)} zł jest ujemna, a pola kwot e-Deklaracji przyjmują tylko kwoty nieujemne.`);
  }
};

/** Two decimals, a dot: "1234.50" ("TKwota2Nieujemna"). */
export const kwota2 = (x: number): string => {
  const grosze = Math.round(x * 100 + 1e-7);
  nieujemna(grosze, x);
  return (grosze / 100).toFixed(2);
};

/** Whole złoty: "77" ("TKwotaCNieujemna"). */
export const kwotaC = (x: number): string => {
  const zl = Math.round(x);
  nieujemna(zl, x);
  return String(zl);
};

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
