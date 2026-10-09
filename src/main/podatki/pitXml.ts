/**
 * The e-Deklaracje XML of a PIT-11 and of a PIT-4R — what the office sends to the Ministry of Finance (signed
 * with XAdES, see podpis/xades.ts). Bytes in, text out: no Electron here, so the files can be made and
 * validated against MF's schemas (scripts/pit-check.ts) without the app.
 *
 * The element order and the rules for which positions appear follow the schemas of PIT-11 (29) and PIT-4R (13)
 * and the files the office filed in 2025. Amounts: "TKwota2Nieujemna" has two decimals ("1234.50"), advances
 * ("TKwotaCNieujemna") are whole złoty ("77"). The text is built with no insignificant whitespace but the
 * indentation of the official files, so what is signed is exactly what is sent.
 */

import {
  OPIS_ZARZADU,
  PitOsoba,
  PitPit4R,
  PitWzor,
  nazwaOsoby,
  obliczOsobe,
  obliczPit4R,
  pitWzor,
  problemyOsoby,
  problemyPit4R,
  maBlad,
  PitDane,
} from '../../shared/podatki-pit';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Two decimals, a dot: "1234.50". */
export const kwota2 = (x: number): string => (Math.round(x * 100 + 1e-7) / 100).toFixed(2);

/** Whole złoty: "77". */
export const kwotaC = (x: number): string => String(Math.round(x));

interface Wezel {
  nazwa: string;
  tekst?: string;
  atr?: [string, string][];
  dzieci?: Wezel[];
}

const el = (nazwa: string, tekst: string, atr?: [string, string][]): Wezel => ({ nazwa, tekst, atr });
const gr = (nazwa: string, dzieci: Wezel[], atr?: [string, string][]): Wezel => ({ nazwa, dzieci, atr });

function wypisz(w: Wezel, poziom: number): string {
  const wciecie = '  '.repeat(poziom);
  const atr = (w.atr ?? []).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  if (w.dzieci) {
    return `${wciecie}<${w.nazwa}${atr}>\n${w.dzieci.map((d) => wypisz(d, poziom + 1)).join('')}${wciecie}</${w.nazwa}>\n`;
  }
  return `${wciecie}<${w.nazwa}${atr}>${esc(w.tekst ?? '')}</${w.nazwa}>\n`;
}

/** Names go to the form in capitals, with no doubled spaces — the way every filed file has them. */
const duze = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pl-PL');

function zlozXml(korzen: Wezel, korzenAtr: string): string {
  const tekst = wypisz(korzen, 0);
  const otwarcie = `<${korzen.nazwa}${korzenAtr}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${tekst.replace(/^<[^>]+>/, otwarcie)}`;
}

function naglowek(
  wzor: PitWzor['pit11'],
  kod: string,
  rodzajZobowiazania: string,
  pozCelu: string,
  cel: number,
  rok: number,
  urzad: string,
): Wezel {
  return gr('Naglowek', [
    el('KodFormularza', kod, [
      ['kodSystemowy', wzor.kodSystemowy],
      ['kodPodatku', 'PIT'],
      ['rodzajZobowiazania', rodzajZobowiazania],
      ['wersjaSchemy', wzor.wersjaSchemy],
    ]),
    el('WariantFormularza', String(wzor.wariant)),
    el('CelZlozenia', String(cel), [['poz', pozCelu]]),
    el('Rok', String(rok)),
    el('KodUrzedu', urzad),
  ]);
}

function zalacznikOrdZu(wzor: PitWzor['pit11'], przyczyna: string): Wezel {
  const z = (n: string) => `zzu:${n}`;
  return gr('Zalaczniki', [
    gr(z('Zalacznik_ORD-ZU'), [
      gr(z('Naglowek'), [
        el(z('KodFormularza'), 'ORD-ZU', [
          ['kodSystemowy', 'ORD-ZU (3)'],
          ['wersjaSchemy', wzor.ordZuWersja],
        ]),
        el(z('WariantFormularza'), '3'),
      ]),
      gr(z('PozycjeSzczegolowe'), [el(z('P_13'), przyczyna.replace(/\s+/g, ' ').trim())]),
    ]),
  ]);
}

export interface Pit11XmlWejscie {
  rok: number;
  platnik: { nip: string; nazwa: string };
  osoba: PitOsoba;
}

export interface Pit4RXmlWejscie {
  rok: number;
  platnik: { nip: string; nazwa: string };
  urzadPlatnika: string;
  pit4r: PitPit4R;
}

/** The PIT-11 of one person. Refuses — with the reasons — when something blocks the filing. */
export function pit11Xml(we: Pit11XmlWejscie): string {
  const { rok, platnik, osoba: o } = we;
  const problemy = problemyOsoby(o, rok);
  if (maBlad(problemy)) {
    throw new Error(
      `PIT-11 nie da się jeszcze wygenerować (${nazwaOsoby(o)}): ${problemy
        .filter((p) => p.poziom === 'blad')
        .map((p) => p.tekst)
        .join('; ')}`,
    );
  }
  const wzor = pitWzor(rok);
  if (!wzor) throw new Error(`Dla roku ${rok} nie ma wzoru PIT-11 w aplikacji.`);
  const w = wzor.pit11;
  const k = obliczOsobe(o);

  const identyfikator: Wezel[] = [];
  if (o.pesel) identyfikator.push(el('PESEL', o.pesel));
  else if (o.nip) identyfikator.push(el('NIP', o.nip));
  const osobaFizyczna = gr('OsobaFizyczna', [
    ...identyfikator,
    el('ImiePierwsze', duze(o.imie)),
    el('Nazwisko', duze(o.nazwisko)),
    el('DataUrodzenia', o.dataUrodzenia ?? ''),
    ...(o.nrId
      ? [
          el('NrId', o.nrId, [['poz', 'P_13']]),
          el('RodzajNrId', String(o.rodzajNrId), [['poz', 'P_14']]),
          el('KodKrajuWydania', o.krajWydania, [['poz', 'P_15A']]),
        ]
      : []),
  ]);

  const a = o.adres;
  const adres: Wezel[] = [el('KodKraju', 'PL', [['poz', 'P_19A']])];
  if (a.wojewodztwo) adres.push(el('Wojewodztwo', duze(a.wojewodztwo)));
  if (a.powiat) adres.push(el('Powiat', duze(a.powiat)));
  if (a.ulica) adres.push(el('Ulica', duze(a.ulica), [['poz', 'P_23']]));
  if (a.nrDomu) adres.push(el('NrDomu', a.nrDomu, [['poz', 'P_24']]));
  if (a.nrLokalu) adres.push(el('NrLokalu', a.nrLokalu, [['poz', 'P_25']]));
  adres.push(el('Miejscowosc', duze(a.miejscowosc), [['poz', 'P_26']]));
  if (a.kodPocztowy) adres.push(el('KodPocztowy', a.kodPocztowy, [['poz', 'P_27']]));

  const poz: Wezel[] = [el('P_11', '1')];
  if (k.etat) {
    poz.push(
      el('P_28', o.kosztyPodwyzszone ? '3' : '1'),
      el('P_29', kwota2(k.etat.przychod)),
      el('P_30', kwota2(k.etat.koszty)),
      el('P_31', kwota2(k.etat.dochod)),
      el('P_33', kwotaC(k.etat.zaliczka)),
    );
  }
  if (k.art13) {
    poz.push(
      el('P_54', kwota2(k.art13.przychod)),
      el('P_55', kwota2(k.art13.koszty)),
      el('P_56', kwota2(k.art13.dochod)),
      el('P_57', kwotaC(k.art13.zaliczka)),
    );
  }
  if (k.zlecenie) {
    poz.push(
      el('P_58', kwota2(k.zlecenie.przychod)),
      el('P_59', kwota2(k.zlecenie.koszty)),
      el('P_60', kwota2(k.zlecenie.dochod)),
      el('P_61', kwotaC(k.zlecenie.zaliczka)),
    );
  }
  // A person who is only on the board: the e-Formularz gets "inne źródła" as zeros, as in every file filed.
  if (k.zarzad !== null && !k.etat && !k.art13 && !k.zlecenie) {
    poz.push(el('P_90', '0.00'), el('P_92', '0.00'), el('P_94', '0'));
  }
  if (k.skladki !== null) poz.push(el('P_95', kwota2(k.skladki)));
  if (k.zarzad !== null) {
    poz.push(
      el('P_99', (o.zarzad?.opis || OPIS_ZARZADU).replace(/\s+/g, ' ').trim()),
      el('P_100', kwota2(k.zarzad)),
      el('P_105', kwota2(k.zarzad)),
    );
  }
  poz.push(el('P_121', '2'));
  if (k.zdrowotna !== null) poz.push(el('P_122', kwota2(k.zdrowotna)));

  const korzen = gr('Deklaracja', [
    naglowek(w, 'PIT-11', 'Z', 'P_7', o.cel, rok, o.urzad),
    gr('Podmiot1', [gr('OsobaNiefizyczna', [el('NIP', platnik.nip), el('PelnaNazwa', duze(platnik.nazwa))])], [
      ['rola', 'Płatnik/Składający'],
    ]),
    gr('Podmiot2', [osobaFizyczna, gr('AdresZamieszkania', adres, [['rodzajAdresu', 'RAD']])], [['rola', 'Podatnik']]),
    gr('PozycjeSzczegolowe', poz),
    el('Pouczenie', '1'),
    ...(o.cel === 2 ? [zalacznikOrdZu(w, o.przyczyna)] : []),
  ]);
  return zlozXml(korzen, ` xmlns="${w.ns}"${o.cel === 2 ? ` xmlns:zzu="${w.ordZuNs}"` : ''}`);
}

/** The year's PIT-4R of a community. */
export function pit4rXml(we: Pit4RXmlWejscie): string {
  const { rok, platnik, urzadPlatnika, pit4r: p } = we;
  const dane: PitDane = { nazwa: platnik.nazwa, urzadPlatnika, osoby: [], pit4r: p };
  const problemy = problemyPit4R(dane, rok).filter((x) => x.poziom === 'blad');
  if (problemy.length > 0) {
    throw new Error(`PIT-4R nie da się jeszcze wygenerować: ${problemy.map((x) => x.tekst).join('; ')}`);
  }
  const wzor = pitWzor(rok);
  if (!wzor) throw new Error(`Dla roku ${rok} nie ma wzoru PIT-4R w aplikacji.`);
  const w = wzor.pit4r;
  const k = obliczPit4R(p);

  const poz: Wezel[] = [];
  if (p.cel === 2) poz.push(el('P_7', String(p.rodzajKorekty)));

  const miesiace = (od: number, wartosci: number[], format: (x: number) => string, pomijajZera: boolean) => {
    wartosci.forEach((v, i) => {
      if (pomijajZera && v === 0) return;
      poz.push(el(`P_${od + i}`, format(v)));
    });
  };
  // Row 1 (employees): the counts and sums only when there is anything — poz. 10–15, 16–21, 22–27, 28–33.
  if (k.etatKwota.some((v) => v > 0) || k.etatLiczba.some((v) => v > 0)) {
    miesiace(10, k.etatLiczba.slice(0, 6), kwotaC, false);
    miesiace(16, k.etatKwota.slice(0, 6), kwotaC, false);
    miesiace(22, k.etatLiczba.slice(6), kwotaC, false);
    miesiace(28, k.etatKwota.slice(6), kwotaC, false);
  }
  if (k.art41.some((v) => v > 0)) miesiace(46, k.art41, kwotaC, false);
  if (k.inne.some((v) => v > 0)) miesiace(58, k.inne, kwotaC, false);
  miesiace(70, k.suma, kwotaC, false);
  miesiace(122, k.doPrzekazania, kwotaC, false);
  miesiace(146, k.doPrzekazania, kwotaC, false);
  // Part D: "1 tak" when the payer reduced the tax to pay (poz. 159–170), "2 nie" otherwise — as the PDF prints it.
  poz.push(el('P_158', k.pomniejszenie.some((v) => v > 0) ? '1' : '2'));
  if (k.pomniejszenie.some((v) => v > 0)) miesiace(159, k.pomniejszenie, kwota2, false);
  miesiace(171, k.doWplaty, kwota2, false);

  const korzen = gr('Deklaracja', [
    naglowek(w, 'PIT-4R', 'P', 'P_6', p.cel, rok, urzadPlatnika),
    gr('Podmiot1', [gr('OsobaNiefizyczna', [el('NIP', platnik.nip), el('PelnaNazwa', duze(platnik.nazwa))])], [['rola', 'Płatnik']]),
    gr('PozycjeSzczegolowe', poz),
    el('Pouczenia', '1'),
    ...(p.cel === 2 ? [zalacznikOrdZu(w, p.przyczyna)] : []),
  ]);
  return zlozXml(korzen, ` xmlns="${w.ns}"${p.cel === 2 ? ` xmlns:zzu="${w.ordZuNs}"` : ''}`);
}
