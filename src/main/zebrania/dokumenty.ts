/**
 * The meeting documents built from a version's statement and plan — the
 * financial statement and the budget plan — as a PDF or an Excel workbook, in
 * INTER-EJ's letterhead (the dark band with the logo and the orange hairline
 * the mailings use).
 *
 * The PDF goes through Chromium (`renderHtmlToPdf`), so Polish text and the
 * vector logo print exactly as designed. It wears the mail's frame — a tinted
 * page, the document on a white card — so it is printed edge to edge: page
 * margins would come out as white strips around the tint. The top and bottom
 * gap of every page is a table head and foot Chromium repeats on each page,
 * and the page numbers are written onto the finished file (`stampPages`),
 * since Chromium's own footer lives in exactly those margins. The workbook writes the plan's totals
 * as formulas with their values cached: it opens showing the right numbers and
 * stays a live spreadsheet when someone changes a figure in Excel.
 */

import fs from 'fs';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  PlanGospodarczy,
  PlanKategoriaKosztu,
  Sprawozdanie,
  SprawozdanieSekcja,
  SprawozdanieWstepTekst,
} from '../../shared/types';
import {
  LOGO_ACCENT_COLOR,
  LOGO_BAND_COLOR,
  MAILING_LOGO_BASE64,
  MAILING_LOGO_SVG_DATA_URI,
  MAIL_BORDER_COLOR,
  MAIL_CARD_COLOR,
  MAIL_PAGE_COLOR,
  MAIL_TEXT_COLOR,
} from '../../shared/mailing-logo';
import { PLAN_KATEGORIA_NAZWA, nazwaNieruchomosci, okresyLabels, planSumy } from '../../shared/plan-gospodarczy';
import {
  bezZerowych,
  formatData,
  formatKwota,
  okresLabel,
  sprawozdanieWstep,
} from '../../shared/sprawozdanie';
import { renderHtmlToPdf } from '../mailing/pdf';
import { INTER_FONT_FACES } from './pdfFont';

export const COMPANY = 'INTER-EJ Zarządzanie i Administrowanie Nieruchomościami s.c.';
const SOFT = '#eef0f2';
const RULE = '#c9d0d5';
const MUTED = '#5b6670';

/** Context the documents need beyond the data itself. */
export interface DokumentKontekst {
  /** The meeting's date (ISO), for "przyjęto … na zebraniu w dniu …". */
  dataZebrania: string | null;
  /** The community's address ("Puławska 116"), printed in the letterhead. */
  adres: string;
}

/** What the statement's PDF carries besides the statement. */
export interface SprawozdanieOpcje {
  adres: string;
  /** Open with the introduction: headline figures, a summary, the points to note. */
  wstep: boolean;
  /** Its words as edited for the version; null = computed from the figures. */
  wstepTekst: SprawozdanieWstepTekst | null;
}

/* ================================== HTML ================================== */

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const num = (n: number | null | undefined) => esc(formatKwota(n));

/**
 * The document in the mail's frame: tinted page, white card, the letterhead
 * band at the top of the card — the logo on the left, the document and the
 * community it is for on the right.
 */
function shell(doc: { label: string; sub?: string; adres: string; stopka: string }, body: string): string {
  const adres = doc.adres.trim();
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
${INTER_FONT_FACES}
  html, body { background: ${MAIL_PAGE_COLOR}; }
  /* Only the weights embedded in ./pdfFont: 400, 600, 700. */
  body { margin: 0; padding: 0 12mm; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; font-size: 9pt;
         line-height: 1.45; color: ${MAIL_TEXT_COLOR}; -webkit-print-color-adjust: exact; }

  /* The frame. Its head and foot repeat on every page — Chromium repeats a
     table's head and foot groups — so every page gets the tinted gap above
     and below the card and the card's white edge inside it. A padding on the
     card would only pad its first and last page. */
  .sheet { width: 100%; border-collapse: separate; border-spacing: 0; }
  .sheet > thead td, .sheet > tfoot td { padding: 0; }
  .sheet .gap-top { height: 12mm; }
  .sheet .gap-bottom { height: 14mm; }
  .sheet .cap { height: 8mm; background: ${MAIL_CARD_COLOR}; border: 1px solid ${MAIL_BORDER_COLOR}; }
  .sheet thead .cap { border-bottom: none; border-radius: 6px 6px 0 0; }
  .sheet tfoot .cap { border-top: none; border-radius: 0 0 6px 6px; }
  .sheet td.card { padding: 0 10mm; vertical-align: top; background: ${MAIL_CARD_COLOR};
                   border-left: 1px solid ${MAIL_BORDER_COLOR}; border-right: 1px solid ${MAIL_BORDER_COLOR}; }

  /* The letterhead: flush with the card's top and sides on the first page,
     over the white edge the frame gives every page, as in the mail. */
  .band { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          margin: -8mm -10mm 0; padding: 18px 10mm 16px; border-radius: 6px 6px 0 0;
          background: ${LOGO_BAND_COLOR}; border-bottom: 3px solid ${LOGO_ACCENT_COLOR}; }
  .band img { height: 40px; display: block; }
  .band .right { text-align: right; color: #fff; }
  .band .label { font-size: 7.5pt; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; opacity: .75; }
  .band .label small { display: block; margin-top: 2px; font-size: 7.5pt; font-weight: 400; letter-spacing: .02em;
                       text-transform: none; }
  .band .adres { margin-top: 4px; font-size: 12pt; font-weight: 700; letter-spacing: -.01em; }

  .doc { padding-top: 8mm; }
  .head { margin-bottom: 6mm; }
  h1 { margin: 0; font-size: 18pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.2; }
  div.sub { margin-top: 3px; color: ${MUTED}; font-size: 10pt; }

  /* The statement's particulars in one ruled strip; the period, which a
     reader checks first, leads it and is set larger. */
  .facts-strip { display: flex; flex-wrap: wrap; margin-top: 4mm; padding: 2mm 0;
                 border-top: 1px solid ${RULE}; border-bottom: 1px solid ${RULE}; }
  .facts-strip > div { padding: 0 3.5mm; border-left: 1px solid #e3e7ea; white-space: nowrap; }
  .facts-strip > div:first-child { padding-left: 0; border-left: none; }
  .facts-strip span { display: block; color: ${MUTED}; font-size: 6.5pt; font-weight: 600; letter-spacing: .06em;
                      text-transform: uppercase; }
  .facts-strip b { display: block; margin-top: 1px; font-size: 8.5pt; font-weight: 600; font-variant-numeric: tabular-nums; }
  .facts-strip .okres span { color: ${LOGO_ACCENT_COLOR}; }
  .facts-strip .okres b { font-size: 9.5pt; font-weight: 700; color: ${LOGO_BAND_COLOR}; }

  h2 { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
       margin: 7mm 0 2.5mm; padding-left: 9px; border-left: 3px solid ${LOGO_ACCENT_COLOR};
       font-size: 11pt; font-weight: 700; line-height: 1.25; break-after: avoid; }
  h2 .total { font-size: 10pt; font-variant-numeric: tabular-nums; }
  h3 { margin: 5mm 0 2mm; font-size: 8.5pt; font-weight: 700; color: ${LOGO_BAND_COLOR};
       text-transform: uppercase; letter-spacing: .06em; break-after: avoid; }
  .doc table { width: 100%; border-collapse: collapse; }
  .doc thead { display: table-header-group; }
  .doc tr { break-inside: avoid; }
  .doc th { background: ${SOFT}; color: ${LOGO_BAND_COLOR}; font-weight: 600; font-size: 8pt;
            text-align: right; padding: 5px 8px; border-bottom: 1px solid ${RULE}; }
  .doc th.l, .doc td.l { text-align: left; }
  .doc td { padding: 4px 8px; border-bottom: 1px solid #edf0f2; vertical-align: top; }
  .doc td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .doc td.lp { width: 34px; color: ${MUTED}; }
  .doc td.sub { padding-left: 22px; color: ${MUTED}; }
  .doc tbody tr:nth-child(even) td { background: #fafbfc; }
  .doc tr.sum td { font-weight: 700; background: #f2f4f5; border-top: 1px solid #9aa5ad; }
  .doc tr.strong td { font-weight: 600; }
  .doc tr.group td { font-weight: 600; }
  .neg { color: #b42318; }
  .empty { color: ${MUTED}; font-style: italic; }
  .note { margin-top: 7mm; color: ${MAIL_TEXT_COLOR}; }
  .sign { margin-top: 12mm; display: flex; justify-content: flex-end; }
  .sign div { width: 260px; text-align: center; color: ${MUTED}; font-size: 9pt; }
  .sign .line { border-top: 1px dotted #7b858c; margin-top: 38px; padding-top: 4px; }
  .balance { margin-top: 6px; padding: 6px 10px; border-radius: 4px; background: #fff4e5;
             color: #7a4b00; font-size: 9pt; }

  /* The statement's introduction: headline figures, a summary, the points to note. */
  .intro { margin: 0 0 2mm; padding: 4mm 4.5mm; border: 1px solid #e3e7ea; border-radius: 6px;
           background: #f7f8fa; break-inside: avoid; }
  .kpis { display: flex; flex-wrap: wrap; gap: 2mm; margin-bottom: 4mm; }
  .kpi { flex: 1 1 30%; padding: 2.2mm 3mm; border-radius: 4px; background: #fff; border: 1px solid #e3e7ea; }
  .kpi span { display: block; color: ${MUTED}; font-size: 7pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .kpi b { display: block; margin-top: 2px; font-size: 11.5pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi.zle b { color: #b42318; }
  .kpi.dobrze b { color: #1f6b43; }
  .lead { margin: 0; line-height: 1.6; }
  .lead + .lead { margin-top: 2mm; }
  .notes { margin-top: 4mm; padding: 3mm 4mm; border-left: 3px solid ${LOGO_ACCENT_COLOR};
           background: #fff4e5; border-radius: 0 4px 4px 0; }
  .notes b { display: block; color: #7a4b00; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .notes ul { margin: 1.5mm 0 0 4mm; padding: 0; }
  .notes li { margin: 1mm 0; }
  .colophon { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #edf0f2; color: ${MUTED}; font-size: 7.5pt; }
</style>
</head>
<body>
<table class="sheet">
<thead><tr><td class="gap-top"></td></tr><tr><td class="cap"></td></tr></thead>
<tfoot><tr><td class="cap"></td></tr><tr><td class="gap-bottom"></td></tr></tfoot>
<tbody><tr><td class="card">
<div class="band"><img src="${MAILING_LOGO_SVG_DATA_URI}" alt="INTER-EJ"><div class="right">
<div class="label">${esc(doc.label)}${doc.sub ? `<small>${esc(doc.sub)}</small>` : ''}</div>
${adres ? `<div class="adres">${esc(adres)}</div>` : ''}
</div></div>
<div class="doc">
${body}
<div class="colophon">${esc(COMPANY)}${doc.stopka ? ` · ${esc(doc.stopka)}` : ''}</div>
</div>
</td></tr></tbody></table>
</body>
</html>`;
}

/** Edge to edge — the tint is the page; see the header comment. */
const DOC_PRINT = {
  pageSize: 'A4' as const,
  printBackground: true,
  margins: { marginType: 'custom' as const, top: 0, bottom: 0, left: 0, right: 0 },
};

/** Characters the PDF's built-in Helvetica can write. */
const WIN_ANSI = /^[\x20-\x7e\u00b7]*$/;

/**
 * "Strona 1 z 3" at the foot of every page, written onto the rendered file —
 * into the tinted gap the frame leaves there. `left` goes on the other side
 * when the built-in font can write it (no Polish letters).
 */
async function stampPages(filePath: string, left: string): Promise<void> {
  const pdf = await PDFDocument.load(fs.readFileSync(filePath));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const color = rgb(0x5b / 255, 0x66 / 255, 0x70 / 255);
  const mm = 72 / 25.4;
  const size = 7;
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const text = `Strona ${i + 1} z ${pages.length}`;
    page.drawText(text, { x: width - 12 * mm - font.widthOfTextAtSize(text, size), y: 5 * mm, size, font, color });
    if (left && WIN_ANSI.test(left)) page.drawText(left, { x: 12 * mm, y: 5 * mm, size, font, color });
  });
  fs.writeFileSync(filePath, await pdf.save());
}

/** Render a document in the frame above, then number its pages. */
export async function renderDocument(html: string, outPath: string, left: string, landscape = false): Promise<void> {
  await renderHtmlToPdf(html, outPath, { ...DOC_PRINT, landscape });
  await stampPages(outPath, left);
}

function sectionTable(sec: SprawozdanieSekcja): string {
  const head = `<tr><th class="l">Pozycja</th>${sec.kolumny.map((k) => `<th>${esc(k)}</th>`).join('')}</tr>`;
  const items = sec.wiersze.filter((w) => !w.podsumowanie);
  const sums = sec.wiersze.filter((w) => w.podsumowanie);
  const cells = (kwoty: (number | null)[]) =>
    kwoty.map((k) => `<td class="num${k != null && k < 0 ? ' neg' : ''}">${num(k)}</td>`).join('');
  const rows = items.length
    ? items.map((w) => `<tr><td class="l">${esc(w.nazwa)}</td>${cells(w.kwoty)}</tr>`).join('')
    : `<tr><td class="l empty" colspan="${sec.kolumny.length + 1}">Brak pozycji w tym okresie</td></tr>`;
  const sumRows = sums
    .map((w, i) => `<tr class="${i === 0 ? 'sum' : w.wyroznienie ? 'strong' : ''}"><td class="l">${esc(w.nazwa)}</td>${cells(w.kwoty)}</tr>`)
    .join('');
  return `<table><thead>${head}</thead><tbody>${rows}${sumRows}</tbody></table>`;
}

const zl = (n: number) => `${num(n)} zł`;

/** The document's particulars in one ruled strip; the first leads, set larger. */
function factsStrip(items: string[][]): string {
  return `<div class="facts-strip">${items
    .map(([k, v], i) => `<div${i === 0 ? ' class="okres"' : ''}><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('')}</div>`;
}

/** An edited introduction keeps its paragraphs and line breaks. */
function lead(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="lead">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function wstepHtml(spr: Sprawozdanie, tekst: SprawozdanieWstepTekst | null): string {
  // The figures are always the statement's; the words may have been edited.
  const w = { ...sprawozdanieWstep(spr), ...(tekst ?? {}) };
  if (!w.akapit && w.kluczowe.length === 0 && w.uwagi.length === 0) return '';
  const kpis = w.kluczowe
    .map((k) => `<div class="kpi ${k.ton}"><span>${esc(k.etykieta)}</span><b>${zl(k.kwota)}</b></div>`)
    .join('');
  const notes = w.uwagi.length
    ? `<div class="notes"><b>Ważne uwagi</b><ul>${w.uwagi.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="intro">${kpis ? `<div class="kpis">${kpis}</div>` : ''}${lead(w.akapit)}${notes}</div>`;
}

export function sprawozdanieHtml(pelne: Sprawozdanie, opcje: SprawozdanieOpcje): string {
  // The introduction reads the statement as printed; the tables leave the zeros out.
  const spr = bezZerowych(pelne);
  const meta = [
    ['Okres', okresLabel(spr.okresOd, spr.okresDo)],
    spr.nrWsp != null ? ['Nr wspólnoty', String(spr.nrWsp)] : null,
    spr.powierzchnia != null ? ['Powierzchnia', `${formatKwota(spr.powierzchnia)} m²`] : null,
    spr.powierzchniaCo != null ? ['Pow. CO', `${formatKwota(spr.powierzchniaCo)} m²`] : null,
    spr.sredniaLiczbaOsob != null ? ['Śr. liczba osób', formatKwota(spr.sredniaLiczbaOsob)] : null,
  ].filter((x): x is string[] => !!x);
  const sections = spr.sekcje
    .map((sec) => {
      const total = sec.kwotaNaglowka != null ? `<span class="total">${num(sec.kwotaNaglowka)}</span>` : '';
      const table = sec.kolumny.length > 0 ? sectionTable(sec) : '<p class="empty">Brak danych.</p>';
      return `<h2><span>${esc(sec.tytul)}</span>${total}</h2>${table}`;
    })
    .join('\n');
  const body = `<div class="head">
<h1>Sprawozdanie finansowe</h1>
<div class="sub">Wspólnota Mieszkaniowa ${esc(nazwaNieruchomosci(spr.nazwa))}</div>
${factsStrip(meta)}
</div>
${opcje.wstep ? wstepHtml(pelne, opcje.wstepTekst) : ''}
${sections}`;
  return shell({ label: 'Sprawozdanie finansowe', adres: opcje.adres, stopka: zrodloSprawozdania(spr) }, body);
}

function zrodloSprawozdania(spr: Sprawozdanie): string {
  return spr.wydruk
    ? `na podstawie sprawozdania z systemu vDom, wydruk ${spr.wydruk}`
    : 'na podstawie sprawozdania z systemu vDom';
}

function zaliczkaRows(lp: string, label: string, okresy: PlanGospodarczy['zaliczkaA'], kwoty: number[], rok: number): string {
  const labels = okresyLabels(okresy, rok);
  return (
    `<tr class="group"><td class="lp">${lp}</td><td class="l">${esc(label)}</td><td></td><td></td></tr>` +
    okresy
      .map(
        (o, i) =>
          `<tr><td class="lp"></td><td class="l sub">za okres ${esc(labels[i])} (${o.miesiace} mies.)</td>` +
          `<td class="num">${num(o.stawka)} zł</td><td class="num">${num(kwoty[i])}</td></tr>`,
      )
      .join('')
  );
}

export function planHtml(plan: PlanGospodarczy, ctx: DokumentKontekst): string {
  const s = planSumy(plan);
  const stan = formatData(plan.stanNaDzien);
  const prevYear = (plan.stanNaDzien || '').slice(0, 4) || String(plan.rok - 1);
  const row = (lp: string, label: string, m2: string, kwota: number | null, cls = '') =>
    `<tr class="${cls}"><td class="lp">${lp}</td><td class="l${cls === 'subrow' ? ' sub' : ''}">${esc(label)}</td>` +
    `<td class="num">${m2}</td><td class="num${kwota != null && kwota < 0 ? ' neg' : ''}">${kwota == null ? '' : num(kwota)}</td></tr>`;
  const m2 = (k: PlanKategoriaKosztu) => `${num(s.kosztM2[k])} zł`;

  const czescI = `
<h2><span>Część I — wpływy z zaliczki „A” na koszty zarządu nieruchomością wspólną</span></h2>
<table><thead><tr><th class="l">Lp.</th><th class="l">Rodzaj przychodów</th><th>W przeliczeniu na 1 m²</th><th>Planowane wpływy</th></tr></thead><tbody>
${row('1.', `Saldo zaliczki „A” na ${stan}`, '', plan.saldoA)}
${zaliczkaRows('2.', 'Zaliczka „A”:', plan.zaliczkaA, s.zaliczkaA, plan.rok)}
${row('3.', 'Przychód z nieruchomości wspólnej, w tym:', '', s.przychodyRazem, 'group')}
${row('', 'a) Reklamy', '', plan.przychody.reklamy, 'subrow')}
${row('', 'b) Pożytki z wynajmu pow. wspólnej', '', plan.przychody.pozytki, 'subrow')}
${row('', 'c) Inne', '', plan.przychody.inne, 'subrow')}
${row('4.', 'Dyspozycje dot. salda — przeksięgowanie z funduszu remontowego', '', s.przeksiegowanie)}
${row('5.', 'RAZEM: 1+2+3+4', '', s.wplywyA, 'sum')}
</tbody></table>

<h3>Koszty</h3>
<table><thead><tr><th class="l">Lp.</th><th class="l">Rodzaj kosztów</th><th>Koszt utrzymania 1 m² / mies.</th><th>Planowane koszty na ${plan.rok} r.</th></tr></thead><tbody>
${row('1.', PLAN_KATEGORIA_NAZWA.remonty, m2('remonty'), plan.koszty.remonty)}
${row('2.', PLAN_KATEGORIA_NAZWA.energia, m2('energia'), plan.koszty.energia)}
${row('3.', PLAN_KATEGORIA_NAZWA.porzadek, m2('porzadek'), plan.koszty.porzadek)}
${row('4.', PLAN_KATEGORIA_NAZWA.zarzadzanie, m2('zarzadzanie'), plan.koszty.zarzadzanie)}
${row('5.', 'Inne koszty, w tym:', '', plan.koszty.zarzad + plan.koszty.ubezpieczenie + plan.koszty.pozostale, 'group')}
${row('', `a) ${PLAN_KATEGORIA_NAZWA.zarzad}`, m2('zarzad'), plan.koszty.zarzad, 'subrow')}
${row('', `b) ${PLAN_KATEGORIA_NAZWA.ubezpieczenie}`, m2('ubezpieczenie'), plan.koszty.ubezpieczenie, 'subrow')}
${row('', `c) ${PLAN_KATEGORIA_NAZWA.pozostale}`, m2('pozostale'), plan.koszty.pozostale, 'subrow')}
${row('6.', 'RAZEM: 1+2+3+4+5', `${num(plan.powierzchnia > 0 ? s.kosztyA / 12 / plan.powierzchnia : 0)} zł`, s.kosztyA, 'sum')}
</tbody></table>
${Math.abs(s.roznicaA) >= 0.01 ? `<div class="balance">Wpływy i koszty części I różnią się o ${num(s.roznicaA)} zł.</div>` : ''}`;

  const remonty = plan.remontyFR.filter((r) => r.opis.trim() || r.kwota);
  const czescII = `
<h2><span>Część II — wpływy z zaliczki „B” na fundusz remontowy</span></h2>
<table><thead><tr><th class="l">Lp.</th><th class="l">Rodzaj przychodów</th><th>W przeliczeniu na 1 m²</th><th>Planowane wpływy</th></tr></thead><tbody>
${row('1.', `Saldo zaliczki „B” na ${stan}`, '', plan.saldoB)}
${zaliczkaRows('2.', 'Zaliczka „B”:', plan.zaliczkaB, s.zaliczkaB, plan.rok)}
${row('3.', 'Inne wpływy', '', plan.inneWplywyB)}
${row('4.', 'RAZEM: 1+2+3', '', s.wplywyB, 'sum')}
</tbody></table>

<h3>Koszty pokrywane z funduszu remontowego</h3>
<table><thead><tr><th class="l">Lp.</th><th class="l">Rodzaj kosztów</th><th></th><th>Planowane koszty</th></tr></thead><tbody>
${row('1.', 'Spłata kredytu + odsetki', '', plan.kredyt)}
${row('2.', `Saldo zaliczki „A” za ${prevYear} r.`, '', s.saldoAKoszt)}
${row('3.', 'Remonty, w tym:', '', s.remontyFR, 'group')}
${remonty.map((r) => row('', r.opis || '—', '', r.kwota, 'subrow')).join('')}
${row('4.', 'RAZEM: 1+2+3', '', s.kosztyB, 'sum')}
</tbody></table>`;

  const data = ctx.dataZebrania ? formatData(ctx.dataZebrania.slice(0, 10)) : '……………………';
  const body = `<div class="head">
<h1>Plan gospodarczy na ${plan.rok} rok</h1>
<div class="sub">Nieruchomość: ${esc(plan.nieruchomosc)}</div>
${factsStrip([
  ['Stan na dzień', stan],
  ['Powierzchnia całkowita', `${formatKwota(plan.powierzchnia)} m²`],
  ['Osoby fizyczne', `${formatKwota(s.osobyFizyczneM2)} m² · ${s.udzialOsobFizycznych}%`],
  ['M.St. Warszawa', `${formatKwota(plan.miastoM2)} m² · ${s.udzialMiasta}%`],
  ['Pożytki', `${formatKwota(plan.pozytkiM2)} m²`],
])}
</div>
${czescI}
${czescII}
<p class="note">Niniejszy plan przyjęto uchwałą nr ${esc(plan.uchwalaNr || '……')} Wspólnoty Mieszkaniowej na zebraniu w dniu ${esc(data)}.</p>
<div class="sign"><div><div class="line">Zarząd Wspólnoty Mieszkaniowej</div></div></div>`;
  return shell(
    {
      label: 'Plan gospodarczy',
      sub: `Załącznik nr 1 do Uchwały nr ${plan.uchwalaNr || '……'}`,
      adres: ctx.adres || plan.nieruchomosc,
      stopka: `Plan gospodarczy na ${plan.rok} rok`,
    },
    body,
  );
}

export async function sprawozdaniePdf(spr: Sprawozdanie, opcje: SprawozdanieOpcje, outPath: string): Promise<void> {
  await renderDocument(sprawozdanieHtml(spr, opcje), outPath, `INTER-EJ · ${zrodloSprawozdania(spr)}`);
}

export async function planPdf(plan: PlanGospodarczy, ctx: DokumentKontekst, outPath: string): Promise<void> {
  await renderDocument(planHtml(plan, ctx), outPath, `INTER-EJ · Plan gospodarczy na ${plan.rok} rok`);
}

/* ================================== Excel ================================== */

const XL_BAND = 'FF' + LOGO_BAND_COLOR.slice(1).toUpperCase();
const XL_ACCENT = 'FF' + LOGO_ACCENT_COLOR.slice(1).toUpperCase();
const XL_TEXT = 'FF' + MAIL_TEXT_COLOR.slice(1).toUpperCase();
const XL_MUTED = 'FF5B6670';
const XL_SOFT = 'FFEEF0F2';
const XL_SUM = 'FFF2F4F5';
const XL_ZEBRA = 'FFFAFBFC';
const XL_RULE = 'FFE3E7EA';
/** Calibri: a font every Excel has, so the sheet looks the same everywhere. */
const XL_FONT = 'Calibri';
const NUM_FMT = '#,##0.00;[Red]-#,##0.00';

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/**
 * The letterhead: a dark band across the used columns with the logo on the
 * left and, on the right, the document and the community it is for.
 */
function letterhead(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, columns: number, label: string, adres = ''): void {
  ws.getRow(1).height = 27;
  ws.getRow(2).height = 27;
  ws.getRow(3).height = 3;
  for (let c = 1; c <= columns; c++) {
    ws.getCell(1, c).fill = solid(XL_BAND);
    ws.getCell(2, c).fill = solid(XL_BAND);
    ws.getCell(3, c).fill = solid(XL_ACCENT);
  }
  const labelCell = ws.getCell(1, columns);
  labelCell.value = label.toUpperCase();
  labelCell.font = { name: XL_FONT, color: { argb: 'FFC9D0D5' }, bold: true, size: 9 };
  labelCell.alignment = { horizontal: 'right', vertical: 'bottom' };
  if (adres.trim()) {
    const adresCell = ws.getCell(2, columns);
    adresCell.value = adres.trim();
    adresCell.font = { name: XL_FONT, color: { argb: 'FFFFFFFF' }, bold: true, size: 13 };
    adresCell.alignment = { horizontal: 'right', vertical: 'top' };
  }
  const logo = wb.addImage({ base64: MAILING_LOGO_BASE64, extension: 'png' });
  // 879 × 351 artwork, shown at its 2.5 : 1 ratio across the band's two rows.
  ws.addImage(logo, { tl: { col: 0.12, row: 0.25 }, ext: { width: 112, height: 45 } });
}

function setNumber(cell: ExcelJS.Cell, value: number | null): void {
  cell.value = value;
  cell.numFmt = NUM_FMT;
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
}

/** A table's column heads; the text columns (the first, or the first two) are left-aligned. */
function headerRow(ws: ExcelJS.Worksheet, values: string[], textColumns = values.length === 4 ? 2 : 1): ExcelJS.Row {
  const row = ws.addRow(values);
  // A head that wraps ("Koszt utrzymania 1 m² / mies.") gets the second line it needs.
  row.height = values.some((v, i) => i > 0 && v.length > 30) ? 30 : 20;
  for (let c = 1; c <= values.length; c++) {
    const cell = row.getCell(c);
    cell.font = { name: XL_FONT, bold: true, color: { argb: XL_BAND }, size: 9 };
    cell.fill = solid(XL_SOFT);
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC9D0D5' } } };
    cell.alignment = { horizontal: c <= textColumns ? 'left' : 'right', vertical: 'middle', wrapText: true };
  }
  return row;
}

/** A section's title row, its total (if printed on it) in the last column. */
function sectionTitle(ws: ExcelJS.Worksheet, text: string, columns: number, total?: number | null): void {
  ws.addRow([]).height = 12;
  const row = ws.addRow([text]);
  row.height = 22;
  const cell = row.getCell(1);
  cell.font = { name: XL_FONT, bold: true, size: 12, color: { argb: XL_BAND } };
  cell.alignment = { vertical: 'middle', indent: 1 };
  cell.border = { left: { style: 'thick', color: { argb: XL_ACCENT } } };
  if (total != null) {
    const t = row.getCell(columns);
    setNumber(t, total);
    t.font = { name: XL_FONT, bold: true, size: 12, color: { argb: XL_BAND } };
  }
}

/** An item row: a hairline under every cell of the table's width, every other row tinted. */
function itemStyle(row: ExcelJS.Row, columns: number, zebra: boolean): void {
  row.height = 18;
  for (let c = 1; c <= columns; c++) {
    const cell = row.getCell(c);
    cell.border = { bottom: { style: 'hair', color: { argb: XL_RULE } } };
    if (zebra) cell.fill = solid(XL_ZEBRA);
    cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle' };
  }
}

function sumStyle(row: ExcelJS.Row, columns: number, top = true): void {
  row.height = 19;
  for (let c = 1; c <= columns; c++) {
    const cell = row.getCell(c);
    cell.font = { ...(cell.font ?? {}), bold: true };
    cell.fill = solid(XL_SUM);
    cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle' };
    if (top) cell.border = { top: { style: 'thin', color: { argb: 'FF9AA5AD' } } };
  }
}

/**
 * One typeface and size for every cell that set none — a cell left at
 * Excel's default (11 pt) between 9 pt heads and 10 pt rows looked random.
 */
function finish(ws: ExcelJS.Worksheet): void {
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: XL_FONT, size: 10, color: { argb: XL_TEXT }, ...(cell.font ?? {}) };
    }),
  );
}

function pageSetup(ws: ExcelJS.Worksheet): void {
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter.oddFooter = `&L&8${COMPANY}&R&8Strona &P z &N`;
  finish(ws);
}

/** "Label  value" in one cell: the label quiet, the value bold. */
function fakt(ws: ExcelJS.Worksheet, label: string, value: string, strong = false): void {
  const row = ws.addRow([]);
  row.height = 17;
  row.getCell(1).value = {
    richText: [
      { text: `${label}:  `, font: { name: XL_FONT, size: 10, color: { argb: XL_MUTED } } },
      {
        text: value,
        font: { name: XL_FONT, size: strong ? 11 : 10, bold: true, color: { argb: strong ? XL_BAND : XL_TEXT } },
      },
    ],
  };
}

export async function sprawozdanieXlsx(pelne: Sprawozdanie, adres: string, outPath: string): Promise<void> {
  // The same content as the PDF: categories that are all zeros are left out.
  const spr = bezZerowych(pelne);
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  const ws = wb.addWorksheet('Sprawozdanie', { views: [{ showGridLines: false }] });
  // Every table is as wide as the widest one, its amounts in the LAST columns:
  // the figures of all sections line up and every head ends at the same edge.
  const COLS = Math.max(3, ...spr.sekcje.map((s) => s.kolumny.length + 1));
  ws.getColumn(1).width = 46;
  for (let c = 2; c <= COLS; c++) ws.getColumn(c).width = 15;
  letterhead(wb, ws, COLS, 'Sprawozdanie finansowe', adres);

  ws.addRow([]).height = 14;
  const title = ws.addRow(['Sprawozdanie finansowe']);
  title.height = 26;
  title.getCell(1).font = { name: XL_FONT, bold: true, size: 18, color: { argb: XL_TEXT } };
  const sub = ws.addRow([`Wspólnota Mieszkaniowa ${nazwaNieruchomosci(spr.nazwa)}`]);
  sub.getCell(1).font = { name: XL_FONT, size: 11, color: { argb: XL_MUTED } };
  ws.addRow([]).height = 8;
  fakt(ws, 'Okres', okresLabel(spr.okresOd, spr.okresDo), true);
  if (spr.nrWsp != null) fakt(ws, 'Nr wspólnoty', String(spr.nrWsp));
  if (spr.powierzchnia != null) fakt(ws, 'Powierzchnia', `${formatKwota(spr.powierzchnia)} m²`);
  if (spr.powierzchniaCo != null) fakt(ws, 'Pow. CO', `${formatKwota(spr.powierzchniaCo)} m²`);
  if (spr.sredniaLiczbaOsob != null) fakt(ws, 'Śr. liczba osób', formatKwota(spr.sredniaLiczbaOsob));

  for (const sec of spr.sekcje) {
    sectionTitle(ws, sec.tytul, COLS, sec.kwotaNaglowka);
    if (sec.kolumny.length === 0) continue;
    const first = COLS - sec.kolumny.length + 1;
    headerRow(ws, ['Pozycja', ...Array<string>(first - 2).fill(''), ...sec.kolumny], 1);
    const items = sec.wiersze.filter((w) => !w.podsumowanie);
    if (items.length === 0) {
      const row = ws.addRow(['Brak pozycji w tym okresie']);
      row.getCell(1).font = { name: XL_FONT, italic: true, color: { argb: XL_MUTED } };
      itemStyle(row, COLS, false);
    }
    const line = (w: (typeof sec.wiersze)[number]) => {
      const row = ws.addRow([w.nazwa]);
      w.kwoty.forEach((k, i) => setNumber(row.getCell(first + i), k));
      return row;
    };
    items.forEach((w, i) => itemStyle(line(w), COLS, i % 2 === 1));
    sec.wiersze
      .filter((w) => w.podsumowanie)
      .forEach((w, i) => {
        const row = line(w);
        if (i === 0) sumStyle(row, COLS);
        else {
          itemStyle(row, COLS, false);
          if (w.wyroznienie) row.eachCell((cell) => (cell.font = { ...(cell.font ?? {}), bold: true }));
        }
      });
  }
  ws.addRow([]).height = 14;
  const src = ws.addRow([`Na podstawie sprawozdania z systemu vDom${spr.wydruk ? `, wydruk ${spr.wydruk}` : ''}.`]);
  src.getCell(1).font = { name: XL_FONT, italic: true, size: 8, color: { argb: XL_MUTED } };
  pageSetup(ws);
  await wb.xlsx.writeFile(outPath);
}

export async function planXlsx(plan: PlanGospodarczy, ctx: DokumentKontekst, outPath: string): Promise<void> {
  const s = planSumy(plan);
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  const ws = wb.addWorksheet(`Plan ${plan.rok}`, { views: [{ showGridLines: false }] });
  const COLS = 4;
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 54;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 24;
  letterhead(wb, ws, COLS, 'Plan gospodarczy', ctx.adres || plan.nieruchomosc);

  ws.addRow([]).height = 14;
  const att = ws.addRow(['', '', '', `Załącznik nr 1 do Uchwały nr ${plan.uchwalaNr}`]);
  att.getCell(4).alignment = { horizontal: 'right' };
  att.getCell(4).font = { name: XL_FONT, size: 9, color: { argb: XL_MUTED } };
  const title = ws.addRow([`Plan gospodarczy na ${plan.rok} rok`]);
  title.height = 26;
  title.getCell(1).font = { name: XL_FONT, bold: true, size: 18, color: { argb: XL_TEXT } };
  ws.addRow([`Nieruchomość: ${plan.nieruchomosc}`]).getCell(1).font = {
    name: XL_FONT,
    size: 11,
    color: { argb: XL_MUTED },
  };
  ws.addRow([]).height = 8;
  fakt(ws, 'Stan na dzień', formatData(plan.stanNaDzien), true);

  // The area every per-m² figure and advance is computed from — a small table
  // of its own, the shares beside the areas.
  sectionTitle(ws, 'Powierzchnie', COLS);
  headerRow(ws, ['', 'Rodzaj powierzchni', 'Udział', 'm²'], 2);
  const areaRow = ws.addRow(['', 'Powierzchnia użytkowa całkowita', '', plan.powierzchnia]);
  setNumber(areaRow.getCell(4), plan.powierzchnia);
  itemStyle(areaRow, COLS, false);
  areaRow.eachCell((cell) => (cell.font = { ...(cell.font ?? {}), bold: true }));
  const AREA = `$D$${areaRow.number}`;
  const miastoRow = ws.addRow(['', 'M.St. Warszawa', '', plan.miastoM2]);
  setNumber(miastoRow.getCell(4), plan.miastoM2);
  const fizRow = ws.addRow(['', 'w tym własność osób fizycznych', `${s.udzialOsobFizycznych}%`]);
  fizRow.getCell(4).value = { formula: `${AREA}-D${miastoRow.number}`, result: s.osobyFizyczneM2 };
  fizRow.getCell(4).numFmt = NUM_FMT;
  fizRow.getCell(4).alignment = { horizontal: 'right' };
  miastoRow.getCell(3).value = `${s.udzialMiasta}%`;
  for (const r of [miastoRow, fizRow]) r.getCell(3).alignment = { horizontal: 'right' };
  const pozRow = ws.addRow(['', 'Pożytki', '', plan.pozytkiM2]);
  setNumber(pozRow.getCell(4), plan.pozytkiM2);
  for (const r of [miastoRow, fizRow, pozRow]) itemStyle(r, COLS, false);

  const line = (lp: string, label: string, value: number | ExcelJS.CellFormulaValue | null, m2?: number | ExcelJS.CellFormulaValue | null, sub = false) => {
    const row = ws.addRow([lp, label]);
    if (sub) row.getCell(2).alignment = { indent: 2 };
    if (m2 !== undefined && m2 !== null) {
      row.getCell(3).value = m2;
      row.getCell(3).numFmt = NUM_FMT;
      row.getCell(3).alignment = { horizontal: 'right' };
    }
    if (value !== null) {
      row.getCell(4).value = value;
      row.getCell(4).numFmt = NUM_FMT;
      row.getCell(4).alignment = { horizontal: 'right' };
    }
    row.getCell(1).font = { name: XL_FONT, color: { argb: XL_MUTED } };
    itemStyle(row, COLS, false);
    return row;
  };
  const f = (formula: string, result: number): ExcelJS.CellFormulaValue => ({ formula, result });

  const zaliczkaBlock = (lp: string, label: string, okresy: PlanGospodarczy['zaliczkaA'], kwoty: number[]) => {
    line(lp, label, null).font = { bold: true };
    const labels = okresyLabels(okresy, plan.rok);
    return okresy.map((o, i) => {
      const r = line('', `za okres ${labels[i]} — miesięcy: ${o.miesiace}`, null, o.stawka, true);
      r.getCell(4).value = f(`C${r.number}*${o.miesiace}*${AREA}`, kwoty[i]);
      r.getCell(4).numFmt = NUM_FMT;
      return r.number;
    });
  };

  // Część I
  sectionTitle(ws, 'Część I — wpływy z zaliczki „A” na koszty zarządu nieruchomością wspólną', COLS);
  headerRow(ws, ['Lp.', 'Rodzaj przychodów', 'W przeliczeniu na 1 m²', 'Planowane wpływy']);
  const rSaldoA = line('1.', `Saldo zaliczki „A” na ${formatData(plan.stanNaDzien)}`, plan.saldoA).number;
  const zaRows = zaliczkaBlock('2.', 'Zaliczka „A”:', plan.zaliczkaA, s.zaliczkaA);
  const r3 = line('3.', 'Przychód z nieruchomości wspólnej, w tym:', null);
  const r3a = line('', 'a) Reklamy', plan.przychody.reklamy, undefined, true).number;
  line('', 'b) Pożytki z wynajmu pow. wspólnej', plan.przychody.pozytki, undefined, true);
  const r3c = line('', 'c) Inne', plan.przychody.inne, undefined, true).number;
  r3.getCell(4).value = f(`SUM(D${r3a}:D${r3c})`, s.przychodyRazem);
  r3.getCell(4).numFmt = NUM_FMT;
  r3.font = { bold: true };
  const r4 = line('4.', 'Dyspozycje dot. salda — przeksięgowanie z funduszu remontowego', f(`MAX(0,-D${rSaldoA})`, s.przeksiegowanie)).number;
  const razemA = line(
    '5.',
    'RAZEM: 1+2+3+4',
    f(`D${rSaldoA}+${zaRows.map((r) => `D${r}`).join('+')}+D${r3.number}+D${r4}`, s.wplywyA),
  );
  sumStyle(razemA, COLS);

  ws.addRow([]);
  headerRow(ws, ['Lp.', 'Rodzaj kosztów', 'Koszt utrzymania 1 m² / mies.', `Planowane koszty na ${plan.rok} r.`]);
  const costRow = (lp: string, k: PlanKategoriaKosztu, label: string, sub = false) => {
    const r = line(lp, label, plan.koszty[k], null, sub);
    r.getCell(3).value = f(`IF(${AREA}>0,D${r.number}/12/${AREA},0)`, s.kosztM2[k]);
    r.getCell(3).numFmt = NUM_FMT;
    return r.number;
  };
  const c1 = costRow('1.', 'remonty', PLAN_KATEGORIA_NAZWA.remonty);
  costRow('2.', 'energia', PLAN_KATEGORIA_NAZWA.energia);
  costRow('3.', 'porzadek', PLAN_KATEGORIA_NAZWA.porzadek);
  const c4 = costRow('4.', 'zarzadzanie', PLAN_KATEGORIA_NAZWA.zarzadzanie);
  const c5 = line('5.', 'Inne koszty, w tym:', null);
  const c5a = costRow('', 'zarzad', `a) ${PLAN_KATEGORIA_NAZWA.zarzad}`, true);
  costRow('', 'ubezpieczenie', `b) ${PLAN_KATEGORIA_NAZWA.ubezpieczenie}`, true);
  const c5c = costRow('', 'pozostale', `c) ${PLAN_KATEGORIA_NAZWA.pozostale}`, true);
  c5.getCell(4).value = f(
    `SUM(D${c5a}:D${c5c})`,
    plan.koszty.zarzad + plan.koszty.ubezpieczenie + plan.koszty.pozostale,
  );
  c5.getCell(4).numFmt = NUM_FMT;
  c5.font = { bold: true };
  const razemK = line('6.', 'RAZEM: 1+2+3+4+5', f(`SUM(D${c1}:D${c4})+D${c5.number}`, s.kosztyA));
  razemK.getCell(3).value = f(`IF(${AREA}>0,D${razemK.number}/12/${AREA},0)`, plan.powierzchnia > 0 ? s.kosztyA / 12 / plan.powierzchnia : 0);
  razemK.getCell(3).numFmt = NUM_FMT;
  sumStyle(razemK, COLS);

  // Część II
  sectionTitle(ws, 'Część II — wpływy z zaliczki „B” na fundusz remontowy', COLS);
  headerRow(ws, ['Lp.', 'Rodzaj przychodów', 'W przeliczeniu na 1 m²', 'Planowane wpływy']);
  const rSaldoB = line('1.', `Saldo zaliczki „B” na ${formatData(plan.stanNaDzien)}`, plan.saldoB).number;
  const zbRows = zaliczkaBlock('2.', 'Zaliczka „B”:', plan.zaliczkaB, s.zaliczkaB);
  const rInne = line('3.', 'Inne wpływy', plan.inneWplywyB).number;
  const razemB = line(
    '4.',
    'RAZEM: 1+2+3',
    f(`D${rSaldoB}+${zbRows.map((r) => `D${r}`).join('+')}+D${rInne}`, s.wplywyB),
  );
  sumStyle(razemB, COLS);

  ws.addRow([]);
  headerRow(ws, ['Lp.', 'Koszty pokrywane z funduszu remontowego', '', 'Planowane koszty']);
  const k1 = line('1.', 'Spłata kredytu + odsetki', plan.kredyt).number;
  const prevYear = (plan.stanNaDzien || '').slice(0, 4) || String(plan.rok - 1);
  const k2 = line('2.', `Saldo zaliczki „A” za ${prevYear} r.`, f(`D${r4}`, s.saldoAKoszt)).number;
  const k3 = line('3.', 'Remonty, w tym:', null);
  const remonty = plan.remontyFR.filter((r) => r.opis.trim() || r.kwota);
  const remRows = remonty.map((r) => line('', r.opis || '—', r.kwota, undefined, true).number);
  k3.getCell(4).value = remRows.length
    ? f(`SUM(D${remRows[0]}:D${remRows[remRows.length - 1]})`, s.remontyFR)
    : 0;
  k3.getCell(4).numFmt = NUM_FMT;
  k3.font = { bold: true };
  const razemKB = line('4.', 'RAZEM: 1+2+3', f(`D${k1}+D${k2}+D${k3.number}`, s.kosztyB));
  sumStyle(razemKB, COLS);

  ws.addRow([]);
  const data = ctx.dataZebrania ? formatData(ctx.dataZebrania.slice(0, 10)) : '……………………';
  const note = ws.addRow([
    '',
    `Niniejszy plan przyjęto uchwałą nr ${plan.uchwalaNr || '……'} Wspólnoty Mieszkaniowej na zebraniu w dniu ${data}.`,
  ]);
  note.getCell(2).alignment = { wrapText: true };
  ws.addRow([]);
  ws.addRow([]);
  const sign = ws.addRow(['', '', '', '…………………………………………']);
  sign.getCell(4).alignment = { horizontal: 'center' };
  const signLabel = ws.addRow(['', '', '', 'Zarząd Wspólnoty Mieszkaniowej']);
  signLabel.getCell(4).alignment = { horizontal: 'center' };
  signLabel.getCell(4).font = { size: 9, color: { argb: 'FF5B6670' } };

  pageSetup(ws);
  await wb.xlsx.writeFile(outPath);
}
