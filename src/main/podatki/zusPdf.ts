/**
 * The printout of a month's ZUS settlement — for the community's board and the binder: who was insured, the
 * contributions of each (as the RCA has them), the DRA's totals, what to transfer, by when and where. A plain
 * page of our own in the app's font, landscape A4; it says on itself that it is not a ZUS form — what goes to
 * ZUS is the KEDU file, imported into Płatnik.
 *
 * Bytes in, bytes out: no Electron here, so the file can be made (and looked at) without the app.
 */

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ARIMO_TTF_BASE64 } from './dn1Font';
import {
  ZusPlatnikDane,
  ZusRozliczenieDane,
  ZusWynik,
  dniOkresu,
  kluczPozycji,
  kodPelny,
  nazwaUbezpieczonego,
  terminRozliczenia,
} from '../../shared/podatki-zus';
import { ZUS_SWIADCZENIA_PRZERWY } from '../../shared/zus-slowniki';

export interface ZestawienieWejscie {
  nip: string;
  platnik: ZusPlatnikDane;
  okres: string;
  identyfikator: number;
  dane: ZusRozliczenieDane;
  wynik: ZusWynik;
  /** "23.10.2026 14:05" — when the printout was made. */
  wydrukowano: string;
}

const MIESIACE = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const okresSlownie = (okres: string) => `${MIESIACE[Number(okres.slice(5, 7)) - 1]} ${okres.slice(0, 4)}`;
const zl = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
const dataPl = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const rachunekCzytelny = (nr: string) => (nr.length === 26 ? `${nr.slice(0, 2)} ${nr.slice(2).replace(/(\d{4})/g, '$1 ').trim()}` : nr);

const SZARY = rgb(0.42, 0.45, 0.5);
const LINIA = rgb(0.82, 0.84, 0.87);
const TLO = rgb(0.95, 0.96, 0.97);
const CZARNY = rgb(0.1, 0.11, 0.13);

const SZEROKOSC = 842;
const WYSOKOSC = 595;
const MARGINES = 36;

interface Kolumna {
  naglowek: string;
  szer: number;
  prawo?: boolean;
}

/** Writes text that must fit `max` points, shrinking down to 6 pt and only then cutting with an ellipsis. */
function tekstW(page: PDFPage, font: PDFFont, t: string, x: number, y: number, rozmiar: number, max: number, kolor = CZARNY, prawo = false) {
  let r = rozmiar;
  while (r > 6 && font.widthOfTextAtSize(t, r) > max) r -= 0.5;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(s, r) > max) s = `${s.slice(0, -2)}…`;
  const w = font.widthOfTextAtSize(s, r);
  page.drawText(s, { x: prawo ? x + max - w : x, y, size: r, font, color: kolor });
}

export async function zestawieniePdf(w: ZestawienieWejscie): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(Buffer.from(ARIMO_TTF_BASE64, 'base64'), { subset: true });
  doc.setTitle(`Rozliczenie ZUS ${w.okres} — ${w.platnik.nazwaSkrocona}`);
  doc.setProducer('FileFunky');

  let page = doc.addPage([SZEROKOSC, WYSOKOSC]);
  let y = WYSOKOSC - MARGINES;
  const nowaStrona = () => {
    page = doc.addPage([SZEROKOSC, WYSOKOSC]);
    y = WYSOKOSC - MARGINES;
  };
  const miejsce = (potrzeba: number) => {
    if (y - potrzeba < MARGINES + 24) nowaStrona();
  };

  // Header.
  const korekta = w.identyfikator > 1;
  tekstW(page, font, `Rozliczenie składek ZUS za ${okresSlownie(w.okres)}`, MARGINES, y - 16, 17, 520);
  tekstW(page, font, `DRA i RCA, identyfikator ${String(w.identyfikator).padStart(2, '0')}${korekta ? ' — korekta' : ''}`, MARGINES, y - 32, 9.5, 520, SZARY);
  tekstW(page, font, w.platnik.nazwaSkrocona, SZEROKOSC - MARGINES - 280, y - 14, 11, 280, CZARNY, true);
  tekstW(page, font, `NIP ${w.nip}${w.platnik.regon ? ` · REGON ${w.platnik.regon}` : ''}`, SZEROKOSC - MARGINES - 280, y - 28, 9, 280, SZARY, true);
  y -= 50;
  page.drawLine({ start: { x: MARGINES, y }, end: { x: SZEROKOSC - MARGINES, y }, thickness: 0.8, color: LINIA });
  y -= 18;

  // Summary tiles.
  const d = w.wynik.dra;
  const termin = terminRozliczenia(w.okres, w.platnik.terminDra);
  const kafle: [string, string][] = [
    ['Ubezpieczenia społeczne', `${zl(d.spoleczne)} zł`],
    ['Ubezpieczenie zdrowotne', `${zl(d.zdrowotna)} zł`],
    ['Fundusz Pracy / FGŚP', `${zl(d.fp + d.fgsp)} zł`],
    ['Do zapłaty', `${zl(d.doZaplaty)} zł`],
    ['Termin', dataPl(termin)],
  ];
  const szerKafla = (SZEROKOSC - 2 * MARGINES - 4 * 10) / 5;
  kafle.forEach(([etykieta, wartosc], i) => {
    const x = MARGINES + i * (szerKafla + 10);
    page.drawRectangle({ x, y: y - 44, width: szerKafla, height: 48, color: i === 3 ? rgb(0.93, 0.96, 1) : TLO, borderColor: LINIA, borderWidth: 0.6 });
    tekstW(page, font, etykieta, x + 10, y - 12, 8, szerKafla - 20, SZARY);
    tekstW(page, font, wartosc, x + 10, y - 33, 14, szerKafla - 20);
  });
  y -= 58;
  if (w.platnik.rachunek) {
    tekstW(page, font, `Rachunek składkowy (NRS): ${rachunekCzytelny(w.platnik.rachunek)}`, MARGINES, y - 4, 9.5, 600);
    y -= 16;
  }
  tekstW(
    page,
    font,
    `Liczba ubezpieczonych: ${d.liczbaUbezpieczonych} · stopa składki wypadkowej: ${(w.platnik.stopaWypadkowa ?? 0).toFixed(2).replace('.', ',')}%`,
    MARGINES,
    y - 4,
    9,
    600,
    SZARY,
  );
  y -= 24;

  // The RCA table.
  const kolumny: Kolumna[] = [
    { naglowek: 'Ubezpieczony', szer: 150 },
    { naglowek: 'Kod tytułu', szer: 58 },
    { naglowek: 'Podstawa', szer: 62, prawo: true },
    { naglowek: 'Emeryt. ub./pł.', szer: 88, prawo: true },
    { naglowek: 'Rentowe ub./pł.', szer: 84, prawo: true },
    { naglowek: 'Chorobowe', szer: 54, prawo: true },
    { naglowek: 'Wypadkowe', szer: 54, prawo: true },
    { naglowek: 'Razem społ.', szer: 62, prawo: true },
    { naglowek: 'Podst. zdrow.', szer: 62, prawo: true },
    { naglowek: 'Zdrowotna', szer: 56, prawo: true },
  ];
  const naglowekTabeli = () => {
    page.drawRectangle({ x: MARGINES, y: y - 16, width: SZEROKOSC - 2 * MARGINES, height: 18, color: TLO });
    let x = MARGINES + 6;
    for (const k of kolumny) {
      tekstW(page, font, k.naglowek, x, y - 11, 7.5, k.szer - 6, SZARY, k.prawo);
      x += k.szer;
    }
    y -= 20;
  };
  naglowekTabeli();
  for (const p of w.wynik.pozycje) {
    if (y - 16 < MARGINES + 24) {
      nowaStrona();
      naglowekTabeli();
    }
    const s = p.skladki;
    const komorki = [
      nazwaUbezpieczonego(p.osoba),
      kodPelny(p.tytul),
      zl(s.podstawaER || s.podstawaZdr),
      `${zl(s.emU)} / ${zl(s.emP)}`,
      `${zl(s.renU)} / ${zl(s.renP)}`,
      zl(s.chU),
      zl(s.wypP),
      zl(s.razem),
      zl(s.podstawaZdr),
      zl(s.zdrowotna),
    ];
    let x = MARGINES + 6;
    komorki.forEach((c, i) => {
      tekstW(page, font, c, x, y - 10, 8.5, kolumny[i].szer - 6, CZARNY, kolumny[i].prawo);
      x += kolumny[i].szer;
    });
    y -= 16;
    page.drawLine({ start: { x: MARGINES, y: y + 3 }, end: { x: SZEROKOSC - MARGINES, y: y + 3 }, thickness: 0.4, color: LINIA });
  }
  // Totals as the DRA has them.
  miejsce(20);
  const iv = d.iv;
  const sumy = ['Razem (DRA)', '', '', `${zl(iv[4])} / ${zl(iv[7])}`, `${zl(iv[5])} / ${zl(iv[8])}`, zl(iv[22]), zl(iv[26]), zl(iv[37]), '', zl(d.zdrowotna)];
  let x = MARGINES + 6;
  sumy.forEach((c, i) => {
    tekstW(page, font, c, x, y - 11, 9, kolumny[i].szer - 6, CZARNY, kolumny[i].prawo);
    x += kolumny[i].szer;
  });
  y -= 30;

  // RSA lines.
  const osoby = new Map(w.wynik.pozycje.map((p) => [kluczPozycji(p.pozycja), p]));
  const rsa = w.dane.rsa.filter((r) => osoby.has(kluczPozycji(r)));
  if (rsa.length > 0) {
    miejsce(40);
    tekstW(page, font, 'Przerwy w opłacaniu składek i świadczenia (RSA)', MARGINES, y - 4, 10.5, 600);
    y -= 20;
    for (const r of rsa) {
      miejsce(16);
      const p = osoby.get(kluczPozycji(r))!;
      const opis = ZUS_SWIADCZENIA_PRZERWY.find(([k]) => k === r.kod)?.[1] ?? '';
      const dni = r.dni ?? (r.od && r.do ? dniOkresu(r.od, r.do) : null);
      const okres = r.od && r.do ? `${dataPl(r.od)}–${dataPl(r.do)}` : '';
      tekstW(page, font, nazwaUbezpieczonego(p.osoba), MARGINES + 6, y - 10, 8.5, 150);
      tekstW(page, font, `${r.kod} ${opis}`, MARGINES + 160, y - 10, 8.5, 380);
      tekstW(page, font, `${okres}${dni !== null ? ` (${dni} dni)` : ''}`, MARGINES + 548, y - 10, 8.5, 150);
      if (r.kwota !== null) tekstW(page, font, `${zl(r.kwota)} zł`, MARGINES + 700, y - 10, 8.5, SZEROKOSC - 2 * MARGINES - 706, CZARNY, true);
      y -= 15;
    }
  }

  // Footer on every page.
  const strony = doc.getPages();
  strony.forEach((s, i) => {
    tekstW(
      s,
      font,
      `Wydruk pomocniczy, nie jest formularzem ZUS — dokumenty przekazuje się do ZUS plikiem KEDU z Płatnika / ePłatnika. Wydrukowano ${w.wydrukowano}.`,
      MARGINES,
      MARGINES - 8,
      7.5,
      SZEROKOSC - 2 * MARGINES - 60,
      SZARY,
    );
    tekstW(s, font, `${i + 1} / ${strony.length}`, SZEROKOSC - MARGINES - 50, MARGINES - 8, 7.5, 50, SZARY, true);
  });
  return doc.save();
}
