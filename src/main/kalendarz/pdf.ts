/**
 * "Kalendarz → Pobierz PDF": a month — or any period — of meetings as a
 * printable document in the same frame as the meeting documents
 * (`zebrania/dokumenty.ts`) — a tinted page, the document on a white card under
 * INTER-EJ's letterhead band. Each month of the period comes first as a
 * wall-planner grid on a card of its own (days outside the period greyed out),
 * then every meeting in full (place, community, people, description) as one
 * agenda table.
 *
 * The grid and the agenda are tied together by a number: each meeting gets one,
 * in date order, shown on its chip in the grid and on its row below. Both are
 * links inside the PDF — a chip jumps to its row, the row's number back to the
 * month — which Chromium writes from ordinary `#id` anchors.
 *
 * Nothing in the grid is cut off: a meeting's title wraps inside its day cell,
 * and a week row grows to hold every meeting of its days. The rows have a
 * minimum height that fills the first page of a quiet month; a busy month
 * simply carries its later weeks onto the next page, under a repeated weekday
 * header — a week is never split between pages.
 *
 * Landscape A4, because seven columns of meeting titles need the width.
 * Rendered through Chromium with scripts off, and both parts are real tables,
 * because table rows are what Chromium splits across pages most reliably.
 */

import { KalendarzPdfRequest, Spotkanie, SpotkanieLokalizacja, SpotkanieTyp } from '../../shared/types';
import {
  DEFAULT_TYP_COLOR,
  buildMonthGrid,
  formatDayLabel,
  formatStamp,
  formatTime,
  formatTimeRange,
  groupByDay,
  isTerminWstepny,
  lastDayOfMonth,
  lokalizacjaOf,
  monthLabel,
  monthsInRange,
  normalizeHexColor,
  sortSpotkania,
  toDayKey,
  typOf,
  weekdayLabels,
} from '../../shared/calendar';
import { personLabel } from '../../shared/app-users';
import {
  LOGO_ACCENT_COLOR,
  LOGO_BAND_COLOR,
  MAILING_LOGO_SVG_DATA_URI,
  MAIL_BORDER_COLOR,
  MAIL_CARD_COLOR,
  MAIL_PAGE_COLOR,
  MAIL_TEXT_COLOR,
} from '../../shared/mailing-logo';
import { COMPANY, esc, renderDocument } from '../zebrania/dokumenty';

/** The document is Polish, like every other document the office prints. */
const LOCALE = 'pl-PL';
const MUTED = '#5b6670';
const RULE = '#c9d0d5';
const SOFT = '#eef0f2';

/**
 * The least the week rows take together, in millimetres: what a landscape page
 * leaves under the frame's gaps, the letterhead, the title and the legend. Only
 * a minimum — a row with more meetings than fit grows past its share.
 */
const GRID_MIN_MM = 120;

const STAN_LABEL: Record<KalendarzPdfRequest['stan'], string> = {
  all: '',
  changed: 'zmieniony termin',
  tentative: 'termin wstępny',
  nodocs: 'dokumenty niewysłane',
  overdue: 'wysyłka po terminie',
};

export interface KalendarzPdfData {
  request: KalendarzPdfRequest;
  spotkania: Spotkanie[];
  typy: SpotkanieTyp[];
  lokalizacje: SpotkanieLokalizacja[];
  /** Who downloaded it — printed under the title. */
  autor: string;
}

/** A type's colour as a translucent fill, for the chip behind its text. */
function tint(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

function filtryOpis(data: KalendarzPdfData): string[] {
  const { request, typy } = data;
  const out: string[] = [];
  if (request.typId !== null) {
    const typ = typy.find((t) => t.id === request.typId);
    out.push(`typ: ${typ?.nazwa ?? '—'}`);
  }
  if (request.stan !== 'all') out.push(STAN_LABEL[request.stan]);
  if (request.szukaj.trim()) out.push(`wyszukiwanie: „${request.szukaj.trim()}”`);
  return out;
}

/**
 * One card in the frame: the tinted gaps above and below it repeat on every
 * page (a table head and foot), the letterhead band opens it. `miesiac` goes in
 * the band only where the card has no title of its own saying it.
 */
function sheet(label: string, miesiac: string, body: string, stopka: string, cls = ''): string {
  return `<table class="sheet${cls ? ` ${cls}` : ''}"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot>
<tbody><tr><td class="card">
<div class="band"><img src="${MAILING_LOGO_SVG_DATA_URI}" alt="INTER-EJ"><div>
<div class="label">${esc(label)}</div>
${miesiac ? `<div class="miesiac">${esc(miesiac)}</div>` : ''}
</div></div>
<div class="doc">
${body}
<div class="colophon">${esc(COMPANY)} · ${esc(stopka)}</div>
</div>
</td></tr></tbody></table>`;
}

function shell(body: string): string {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { background: ${MAIL_PAGE_COLOR}; }
  body { margin: 0; padding: 0 11mm; font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 9pt;
         line-height: 1.35; color: ${MAIL_TEXT_COLOR}; -webkit-print-color-adjust: exact; }

  /* ---- The frame, as in the meeting documents ---- */
  .sheet { width: 100%; border-collapse: collapse; }
  .sheet + .sheet { break-before: page; }
  .sheet > thead > tr > td { height: 10mm; padding: 0; }
  .sheet > tfoot > tr > td { height: 13mm; padding: 0; }
  .card { padding: 0; vertical-align: top; background: ${MAIL_CARD_COLOR}; border: 1px solid ${MAIL_BORDER_COLOR}; }
  .band { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 14px 22px; background: ${LOGO_BAND_COLOR}; border-bottom: 3px solid ${LOGO_ACCENT_COLOR}; }
  .band img { height: 38px; display: block; }
  .band .label { color: #fff; text-align: right; font-size: 8pt; letter-spacing: .14em;
                 text-transform: uppercase; opacity: .9; }
  .band .miesiac { margin-top: 4px; color: #fff; text-align: right; font-size: 13pt; font-weight: 650; }
  .doc { padding: 4px 24px 18px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; padding: 10px 0 7px; }
  h1 { margin: 0; font-size: 16pt; font-weight: 650; letter-spacing: -.01em; }
  .meta { color: ${MUTED}; font-size: 8.5pt; text-align: right; }
  .meta b { color: ${MAIL_TEXT_COLOR}; font-weight: 600; }
  .colophon { margin-top: 14px; padding-top: 7px; border-top: 1px solid #edf0f2; color: ${MUTED}; font-size: 7.5pt; }

  /* ---- The month ---- */
  table.month { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .month thead { display: table-header-group; }
  .month tr { break-inside: avoid; }
  .month th { padding: 4px 6px; background: ${SOFT}; color: ${LOGO_BAND_COLOR}; font-size: 7.5pt;
              font-weight: 600; text-align: left; text-transform: uppercase; letter-spacing: .06em;
              border: 1px solid ${RULE}; }
  .month td { padding: 2px 3px 4px; vertical-align: top; border: 1px solid ${RULE}; background: #fff; }
  .month td.we { background: #f7f8f9; }
  .month td.out { background: #fbfbfc; }
  .month td.out .day { color: #b5bcc2; }
  .day { font-size: 8pt; font-weight: 600; margin: 0 2px 1px; }
  /* The whole title, wrapped — never cut. */
  a { color: inherit; text-decoration: none; }
  .chip { display: block; margin-top: 1mm; padding: 0.6mm 3px 0.7mm; border-left: 2.5px solid var(--c); background: var(--bg);
          border-radius: 2px; font-size: 7pt; line-height: 1.25; overflow-wrap: anywhere; break-inside: avoid; }
  .chip.tent { border: 1px dashed var(--c); border-left: 2.5px solid var(--c); }
  .chip .n { font-weight: 700; color: ${LOGO_BAND_COLOR}; }
  .chip .t { color: ${MUTED}; font-variant-numeric: tabular-nums; }
  .legend { display: flex; flex-wrap: wrap; gap: 3px 14px; margin-top: 7px; font-size: 7.5pt; color: ${MUTED}; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 10px; height: 10px; border-radius: 2px; border-left: 3px solid var(--c); background: var(--bg); }
  .legend i.dash { border: 1px dashed ${MUTED}; border-left: 3px solid ${MUTED}; background: none; }
  .empty { margin-top: 8px; color: ${MUTED}; font-style: italic; }

  /* ---- The meetings in full ---- */
  h2 { margin: 12px 0 8px; padding-left: 9px; border-left: 3px solid ${LOGO_ACCENT_COLOR};
       font-size: 11pt; font-weight: 650; }
  table.agenda { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }
  .agenda thead { display: table-header-group; }
  .agenda tr { break-inside: avoid; }
  .agenda th { padding: 5px 8px; background: ${SOFT}; color: ${LOGO_BAND_COLOR}; font-size: 8pt; font-weight: 600;
               text-align: left; border-bottom: 1px solid ${RULE}; }
  .agenda td { padding: 5px 8px; vertical-align: top; border-bottom: 1px solid #edf0f2; overflow-wrap: anywhere; }
  .agenda tr.dzien td { padding: 9px 8px 4px; border-bottom: 1px solid ${RULE}; color: ${LOGO_BAND_COLOR};
                        font-size: 8.5pt; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
  .agenda tr.m td:first-child { border-left: 3px solid var(--c); }
  .agenda .n { display: inline-block; min-width: 17px; padding: 0 4px; border-radius: 8px; background: var(--c);
               color: #fff; font-size: 7.5pt; font-weight: 700; text-align: center; }
  .agenda .time { display: block; margin-top: 3px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .agenda .name { font-size: 9.5pt; font-weight: 650; }
  .agenda .typ { display: block; color: ${MUTED}; font-size: 8pt; }
  .agenda .sub { color: ${MUTED}; }
  .agenda .lbl { color: ${MUTED}; }
  .tag { display: inline-block; margin-top: 2px; padding: 0 5px; border-radius: 3px; background: #fff4e5;
         color: #7a4b00; font-size: 7.5pt; }
  .opis { white-space: pre-wrap; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** "4 października 2026" */
function formatDzien(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** True when the period is exactly one calendar month. */
function jedenMiesiac(od: string, doDnia: string): boolean {
  return od.endsWith('-01') && doDnia === lastDayOfMonth(od.slice(0, 7));
}

/** "Październik 2026" for a whole month, otherwise "4 października – 15 listopada 2026". */
export function okresLabel(od: string, doDnia: string): string {
  if (jedenMiesiac(od, doDnia)) return monthLabel(od.slice(0, 7), LOCALE);
  if (od === doDnia) return formatDzien(od);
  return `${formatDzien(od)} – ${formatDzien(doDnia)}`;
}

export function kalendarzHtml(data: KalendarzPdfData): string {
  const { request, typy, lokalizacje } = data;
  const { okresOd: od, okresDo: doDnia } = request;
  const wanted = new Set(request.spotkanieIds);
  const meetings = sortSpotkania(
    data.spotkania.filter((s) => {
      const day = toDayKey(s.startsAt);
      return wanted.has(s.id) && day >= od && day <= doDnia;
    }),
    LOCALE,
  );
  const numer = new Map(meetings.map((s, i) => [s.id, i + 1]));
  const byDay = groupByDay(meetings, LOCALE);
  const colorOf = (s: Spotkanie) => normalizeHexColor(typOf(s, typy)?.kolor ?? DEFAULT_TYP_COLOR);
  const vars = (hex: string) => `--c:${hex};--bg:${tint(hex, '24')}`;
  const months = monthsInRange(od, doDnia);
  const single = jedenMiesiac(od, doDnia);
  const okres = okresLabel(od, doDnia);
  const multiYear = od.slice(0, 4) !== doDnia.slice(0, 4);
  const stopka = `Kalendarz spotkań — ${single ? okres.toLowerCase() : okres}`;
  const filtry = filtryOpis(data);

  /* ---------------------------------- Grid --------------------------------- */
  const chip = (s: Spotkanie) =>
    `<a class="chip${isTerminWstepny(s) ? ' tent' : ''}" href="#m-${numer.get(s.id)}" style="${vars(colorOf(s))}">` +
    `<span class="n">${numer.get(s.id)}</span> ` +
    `<span class="t">${esc(formatTime(s.startsAt, LOCALE))}</span> ` +
    `${esc(s.nazwa)}</a>`;

  const legendOf = (list: Spotkanie[]) =>
    [
      ...typy
        .filter((t) => list.some((s) => s.typId === t.id))
        .map((t) => `<span><i style="${vars(normalizeHexColor(t.kolor))}"></i>${esc(t.nazwa)}</span>`),
      list.some((s) => typOf(s, typy) === null)
        ? `<span><i style="${vars(DEFAULT_TYP_COLOR)}"></i>bez typu</span>`
        : '',
      list.some(isTerminWstepny) ? '<span><i class="dash"></i>termin wstępny</span>' : '',
    ].join('');

  const monthSheet = (monthKey: string, index: number) => {
    const cells = buildMonthGrid(monthKey);
    const weeks = Math.max(1, Math.ceil(cells.length / 7));
    const rowMm = (GRID_MIN_MM / weeks).toFixed(2);
    const inMonth = meetings.filter((s) => toDayKey(s.startsAt).startsWith(`${monthKey}-`));

    const weekRows: string[] = [];
    for (let w = 0; w < weeks; w++) {
      const tds = cells.slice(w * 7, w * 7 + 7).map((cell) => {
        // A day of the neighbouring month, or outside the period, is greyed and empty.
        const inRange = cell.inMonth && cell.dayKey >= od && cell.dayKey <= doDnia;
        const list = inRange ? byDay.get(cell.dayKey) ?? [] : [];
        const cls = [inRange ? '' : 'out', cell.isWeekend ? 'we' : ''].filter(Boolean).join(' ');
        return (
          `<td${cls ? ` class="${cls}"` : ''}>` +
          `<div class="day">${cell.dayOfMonth}</div>` +
          list.map(chip).join('') +
          `</td>`
        );
      });
      // A cell's height is a minimum in a table: the row grows with its meetings.
      weekRows.push(`<tr style="height:${rowMm}mm">${tds.join('')}</tr>`);
    }
    const grid =
      `<table class="month" id="miesiac-${monthKey}"><thead><tr>` +
      weekdayLabels(LOCALE)
        .map((w) => `<th>${esc(w)}</th>`)
        .join('') +
      `</tr></thead><tbody>${weekRows.join('')}</tbody></table>`;

    // The first card says what the whole document is; the others only their month.
    const meta = (
      index === 0
        ? [
            single ? `Spotkań: <b>${meetings.length}</b>` : `Okres: <b>${esc(okres)}</b>`,
            single ? '' : `Spotkań w okresie: <b>${meetings.length}</b> · w tym miesiącu: <b>${inMonth.length}</b>`,
            filtry.length ? `Filtr: <b>${esc(filtry.join(', '))}</b>` : '',
            `Wygenerowano ${esc(formatStamp(new Date().toISOString(), LOCALE))}${data.autor ? ` · ${esc(data.autor)}` : ''}`,
          ]
        : [`Spotkań w tym miesiącu: <b>${inMonth.length}</b>`]
    )
      .filter(Boolean)
      .join('<br>');
    const legend = legendOf(inMonth);
    const empty =
      index === 0 && meetings.length === 0
        ? filtry.length
          ? 'Żadne spotkanie w tym okresie nie pasuje do filtra.'
          : 'W tym okresie nie ma żadnego spotkania.'
        : '';

    return sheet(
      'Kalendarz spotkań',
      single ? '' : okres,
      `<div class="head"><h1>${esc(monthLabel(monthKey, LOCALE))}</h1><div class="meta">${meta}</div></div>
${grid}
${legend ? `<div class="legend">${legend}</div>` : ''}
${empty ? `<p class="empty">${esc(empty)}</p>` : ''}`,
      stopka,
    );
  };

  /* -------------------------------- Agenda --------------------------------- */
  const line = (label: string, value: string) =>
    value ? `<div><span class="lbl">${esc(label)}:</span> ${value}</div>` : '';

  const agendaRow = (s: Spotkanie) => {
    const typ = typOf(s, typy);
    const lok = lokalizacjaOf(s, lokalizacje);
    const miejsce = lok
      ? esc(lok.nazwa) + (lok.adres ? ` <span class="sub">(${esc(lok.adres)})</span>` : '')
      : esc(s.lokalizacjaNazwa);
    const zarzad = s.zarzad.map((z) => esc(z.imieNazwisko || z.email)).join(', ');
    const uczestnicy = s.uczestnicy.map((u) => esc(personLabel(u))).join(', ');
    const gdzie = line('Wspólnota', esc(s.adresNazwa)) + line('Miejsce', miejsce);
    const kto = line('ZGN', esc(s.zgnNazwa)) + line('Zarząd', zarzad) + line('Uczestnicy', uczestnicy);
    const nr = numer.get(s.id);
    const backTo = `#miesiac-${toDayKey(s.startsAt).slice(0, 7)}`;
    return (
      `<tr class="m" style="${vars(colorOf(s))}">` +
      `<td id="m-${nr}"><a class="n" href="${backTo}" title="Wróć do kalendarza">${nr}</a>` +
      `<span class="time">${esc(formatTimeRange(s, LOCALE))}</span></td>` +
      `<td><div class="name">${esc(s.nazwa)}</div>` +
      (typ ? `<span class="typ">${esc(typ.nazwa)}</span>` : '') +
      (isTerminWstepny(s) ? '<span class="tag">termin wstępny</span>' : '') +
      `</td>` +
      `<td>${gdzie || '<span class="sub">—</span>'}</td>` +
      `<td>${kto || '<span class="sub">—</span>'}</td>` +
      `<td>${s.opis.trim() ? `<span class="opis">${esc(s.opis.trim())}</span>` : '<span class="sub">—</span>'}</td>` +
      `</tr>`
    );
  };

  // A period across New Year needs the year on each day, or January reads as this one's.
  const dayHeading = (day: string) =>
    multiYear ? `${formatDayLabel(day, LOCALE)} ${day.slice(0, 4)}` : formatDayLabel(day, LOCALE);

  const agenda =
    `<h2>Szczegóły spotkań</h2>` +
    `<table class="agenda"><colgroup><col style="width:13%"><col style="width:21%"><col style="width:21%">` +
    `<col style="width:20%"><col style="width:25%"></colgroup>` +
    `<thead><tr><th>Nr / godzina</th><th>Spotkanie</th><th>Wspólnota / miejsce</th><th>Osoby</th><th>Opis</th></tr></thead><tbody>` +
    [...byDay.keys()]
      .sort()
      .map(
        (day) =>
          `<tr class="dzien"><td colspan="5">${esc(dayHeading(day))}</td></tr>` +
          (byDay.get(day) ?? []).map(agendaRow).join(''),
      )
      .join('') +
    `</tbody></table>`;

  /* -------------------------------- The page -------------------------------- */
  const kalendarz = months.map(monthSheet).join('\n');
  const szczegoly = meetings.length ? sheet('Kalendarz spotkań', okres, agenda, stopka) : '';
  return shell(kalendarz + szczegoly);
}

export async function kalendarzPdf(data: KalendarzPdfData, outPath: string): Promise<void> {
  // No left-hand footer text: the stamp's built-in font has no Polish letters,
  // and the card's own colophon already says what the document is.
  await renderDocument(kalendarzHtml(data), outPath, '', true);
}

/** "Kalendarz spotkań - październik 2026.pdf", or the period's two dates. */
export function kalendarzPdfName(od: string, doDnia: string): string {
  if (jedenMiesiac(od, doDnia)) return `Kalendarz spotkań - ${monthLabel(od.slice(0, 7), LOCALE).toLowerCase()}.pdf`;
  return `Kalendarz spotkań - ${od === doDnia ? od : `${od} do ${doDnia}`}.pdf`;
}
