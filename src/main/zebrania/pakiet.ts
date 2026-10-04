/**
 * "Pakiet PDF" — one version's materials in one file: a cover that sums them
 * up (the meeting, what the file holds and on which pages, the statement's and
 * the plan's headline figures), then the parts asked for, each exactly as its
 * own download prints it. That is what goes to the board, the owners or anyone
 * else — each gets the parts they need.
 *
 * Every part is rendered on its own and the files are joined with pdf-lib, so
 * none of them is re-typeset for the package; the pages are numbered once,
 * across the whole file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { ZebraniePakietRequest } from '../../shared/types';
import type DatabaseService from '../database';
import { buildKalendarzContext, formatPolishDate, missingFieldValues } from '../../shared/mailing-template';
import { wersjaLabel, zawiadomienieOf, zebranieDane } from '../../shared/zebrania';
import { nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { okresLabel } from '../../shared/sprawozdanie';
import { Skrot, planSkrot, sprawozdanieSkrot } from '../../shared/zebranie-podsumowanie';
import { LOGO_ACCENT_COLOR, LOGO_BAND_COLOR } from '../../shared/mailing-logo';
import { renderLetterPdf, uniquePath } from '../mailing/service';
import {
  esc,
  factsStrip,
  nazwaPliku,
  planHtml,
  renderDocumentRaw,
  shell,
  sprawozdanieHtml,
  stampPages,
} from './dokumenty';

/** One part of the package, as listed on the cover. */
interface Czesc {
  tytul: string;
  opis: string;
  plik: string;
}

const COVER_CSS = `
  .toc { list-style: none; margin: 0; padding: 0; }
  .toc li { display: flex; align-items: center; gap: 4mm; margin-bottom: 2mm; padding: 3mm 4mm;
            border: 1px solid #e3e7ea; border-radius: 6px; background: #fff; break-inside: avoid; }
  .toc .nr { display: flex; align-items: center; justify-content: center; flex: 0 0 7mm; height: 7mm;
             border-radius: 50%; background: ${LOGO_BAND_COLOR}; color: #fff; font-weight: 700; font-size: 9pt; }
  .toc .what { flex: 1 1 auto; min-width: 0; }
  .toc .what b { display: block; font-size: 10pt; }
  .toc .what span { display: block; margin-top: 1px; color: #5b6670; font-size: 8.5pt; }
  .toc .pages { flex: 0 0 auto; color: ${LOGO_BAND_COLOR}; font-weight: 600; font-variant-numeric: tabular-nums;
                white-space: nowrap; }
  .skrot { margin-top: 1mm; padding: 4mm 4.5mm; border: 1px solid #e3e7ea; border-radius: 6px;
           background: #f7f8fa; break-inside: avoid; }
  .skrot .kpis { margin-bottom: 0; }
  .skrot .notes { margin-top: 3mm; }
  .skrot-sub { margin: -1mm 0 2.5mm 12px; color: #5b6670; font-size: 8.5pt; }
  .cover-foot { margin-top: 6mm; color: #5b6670; font-size: 8.5pt; }
  .cover-foot b { color: ${LOGO_ACCENT_COLOR}; }
`;

function skrotHtml(skrot: Skrot): string {
  const kpis = skrot.liczby
    .map((l) => `<div class="kpi ${l.ton}"><span>${esc(l.etykieta)}</span><b>${esc(l.wartosc)}</b></div>`)
    .join('');
  const notes = skrot.uwagi.length
    ? `<div class="notes"><b>Ważne uwagi</b><ul>${skrot.uwagi.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="skrot"><div class="kpis">${kpis}</div>${notes}</div>`;
}

const strony = (od: number, liczba: number) => (liczba > 1 ? `str. ${od}–${od + liczba - 1}` : `str. ${od}`);

/**
 * Write the package of one version to Downloads; the path of the file.
 * Refuses a part the version does not have, and a notice with a blank field
 * (the blank would go out as it is — the notice's own download refuses it too).
 */
export async function eksportujPakiet(
  deps: { database: DatabaseService; downloadsDir: string },
  req: ZebraniePakietRequest,
): Promise<string> {
  const { database } = deps;
  const wersja = await database.getZebranieWersja(req.wersjaId);
  if (!wersja) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
  const zebranie = await database.getZebranie(wersja.zebranieId);
  if (!zebranie) throw new Error('Tego zebrania już nie ma — mogło zostać usunięte.');
  const [spotkania, lokalizacje] = await Promise.all([
    database.getSpotkania(),
    database.getSpotkaniaLokalizacje(),
  ]);
  const dane = zebranieDane(zebranie, spotkania, lokalizacje);
  const kalendarz = buildKalendarzContext(dane);

  const material = req.zawiadomienie ? zawiadomienieOf(wersja) : undefined;
  if (req.zawiadomienie && !material) {
    throw new Error('Ta wersja nie ma jeszcze zawiadomienia — przygotuj je w zakładce „Zawiadomienie o zebraniu”.');
  }
  const spr = req.sprawozdanie ? wersja.sprawozdanie : null;
  if (req.sprawozdanie && !spr) {
    throw new Error('Ta wersja nie ma jeszcze sprawozdania — dołącz je w zakładce „Sprawozdania finansowe”.');
  }
  const plan = req.plan ? wersja.plan : null;
  if (req.plan && !plan) {
    throw new Error('Ta wersja nie ma jeszcze planu gospodarczego — utwórz go w zakładce „Plan gospodarczy”.');
  }
  if (!material && !spr && !plan) throw new Error('Wybierz co najmniej jedną część materiałów.');

  if (material) {
    const missing = missingFieldValues(
      {
        adresNazwa: dane.adresNazwa,
        dateText: formatPolishDate(new Date()),
        pola: await database.getMailingPola(),
        values: material.values,
        tableFields: material.tableFields,
        kalendarz,
      },
      material.temat,
      material.tresc,
    );
    if (missing.length > 0) {
      throw new Error(
        `W zawiadomieniu nie wypełniono: ${missing.join(', ')}. Uzupełnij je w zakładce „Zawiadomienie o zebraniu” albo pobierz pakiet bez zawiadomienia.`,
      );
    }
  }

  const adres =
    dane.adresNazwa || (spr ? nazwaNieruchomosci(spr.dane.nazwa) : plan?.nieruchomosc ?? '') || '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-pakiet-'));
  try {
    const czesci: Czesc[] = [];
    if (material) {
      const plik = path.join(tmp, 'zawiadomienie.pdf');
      const { subject } = await renderLetterPdf(
        database,
        {
          typ: material.typ,
          templateName: material.szablonNazwa,
          temat: material.temat,
          tresc: material.tresc,
          values: material.values,
          tableFields: material.tableFields,
          kalendarz,
          adresId: dane.adresId,
          adresNazwa: dane.adresNazwa,
          spotkanieId: zebranie.spotkanieId,
          adresaci: material.adresaci,
          wykluczeni: material.wykluczeni,
        },
        plik,
      );
      czesci.push({ tytul: 'Zawiadomienie o zebraniu', opis: subject, plik });
    }
    if (spr) {
      const plik = path.join(tmp, 'sprawozdanie.pdf');
      await renderDocumentRaw(
        sprawozdanieHtml(spr.dane, { adres, wstep: req.wstep, wstepTekst: spr.wstep }),
        plik,
      );
      czesci.push({
        tytul: 'Sprawozdanie finansowe',
        opis: `Za okres ${okresLabel(spr.dane.okresOd, spr.dane.okresDo)}${req.wstep ? ', z omówieniem najważniejszych liczb' : ''}`,
        plik,
      });
    }
    if (plan) {
      const plik = path.join(tmp, 'plan.pdf');
      await renderDocumentRaw(planHtml(plan, { dataZebrania: dane.startsAt, adres }), plik);
      czesci.push({
        tytul: `Plan gospodarczy na ${plan.rok} rok`,
        opis: `Załącznik nr 1 do Uchwały nr ${plan.uchwalaNr || '……'}`,
        plik,
      });
    }

    const docs = await Promise.all(czesci.map(async (c) => PDFDocument.load(fs.readFileSync(c.plik))));
    const termin = kalendarz.dataText
      ? `${kalendarz.dataText}${kalendarz.godzinaText ? `, godz. ${kalendarz.godzinaText}` : ''}`
      : 'do ustalenia';
    const miejsce = [dane.lokalizacjaNazwa, dane.lokalizacjaAdres].filter(Boolean).join(', ');

    /** The cover, with the parts' pages counted from `coverPages`. */
    const cover = (coverPages: number): string => {
      let next = coverPages + 1;
      const toc = czesci
        .map((c, i) => {
          const n = docs[i].getPageCount();
          const pages = strony(next, n);
          next += n;
          return `<li><span class="nr">${i + 1}</span><span class="what"><b>${esc(c.tytul)}</b><span>${esc(c.opis)}</span></span><span class="pages">${pages}</span></li>`;
        })
        .join('');
      const sprSkrot = spr
        ? `<h2><span>Sprawozdanie finansowe w skrócie</span></h2>
<div class="skrot-sub">Za okres ${esc(okresLabel(spr.dane.okresOd, spr.dane.okresDo))}</div>
${skrotHtml(sprawozdanieSkrot(spr.dane, spr.wstep))}`
        : '';
      const planSkrotHtml = plan
        ? `<h2><span>Plan gospodarczy na ${plan.rok} rok w skrócie</span></h2>
<div class="skrot-sub">Stawki zaliczek za 1 m² powierzchni miesięcznie</div>
${skrotHtml(planSkrot(plan))}`
        : '';
      const body = `<div class="head">
<h1>${esc(dane.nazwa || 'Zebranie Wspólnoty Mieszkaniowej')}</h1>
${adres ? `<div class="sub">Wspólnota Mieszkaniowa ${esc(adres)}</div>` : ''}
${factsStrip(
  [
    ['Termin', termin],
    miejsce ? ['Miejsce', miejsce] : null,
    ['Wersja materiałów', wersjaLabel(wersja)],
  ].filter((x): x is string[] => !!x),
)}
</div>
<h2><span>Zawartość</span></h2>
<ul class="toc">${toc}</ul>
${sprSkrot}
${planSkrotHtml}
<p class="cover-foot">Szczegóły — na kolejnych stronach. Prosimy o zapoznanie się z materiałami <b>przed zebraniem</b>.</p>`;
      return shell(
        { label: 'Materiały na zebranie', adres, stopka: `Materiały na zebranie · wersja ${wersjaLabel(wersja)}` },
        body,
        COVER_CSS,
      );
    };

    // The table of contents needs the cover's own length: one page is the
    // design, but long figures could push it to two — then render it again.
    const coverPath = path.join(tmp, 'okladka.pdf');
    let coverPages = 1;
    let coverDoc: PDFDocument | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await renderDocumentRaw(cover(coverPages), coverPath);
      coverDoc = await PDFDocument.load(fs.readFileSync(coverPath));
      if (coverDoc.getPageCount() === coverPages) break;
      coverPages = coverDoc.getPageCount();
    }

    const out = await PDFDocument.create();
    out.setTitle(`Materiały na zebranie — ${adres || dane.nazwa}`);
    out.setAuthor('INTER-EJ');
    for (const doc of [coverDoc!, ...docs]) {
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    const filePath = uniquePath(
      deps.downloadsDir,
      `${nazwaPliku(`Materiały na zebranie - ${adres || dane.nazwa} - ${kalendarz.dataText || formatPolishDate(new Date())}`)}.pdf`,
    );
    fs.writeFileSync(filePath, await out.save());
    await stampPages(filePath, 'INTER-EJ');
    return filePath;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // A leftover temp folder is the system's to clear.
    }
  }
}
