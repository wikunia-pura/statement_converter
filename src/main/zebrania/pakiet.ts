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
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { ZebraniePakietRequest } from '../../shared/types';
import type DatabaseService from '../database';
import { buildKalendarzContext, formatPolishDate, missingFieldValues } from '../../shared/mailing-template';
import {
  buildZebranieContext,
  uchwalaMissing,
  uchwalaTytul,
  uchwalyOf,
  zawiadomienieOf,
  zebranieDane,
} from '../../shared/zebrania';
import { nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { okresLabel, sprawozdanieWersji } from '../../shared/sprawozdanie';
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
import { AppError } from '../../shared/app-errors';

/** One part of the package, as listed on the cover. */
interface Czesc {
  tytul: string;
  opis: string;
  plik: string;
}

/**
 * What a contents row links to while the cover is HTML. Chromium keeps a link
 * only to a URL, and the parts are not in that document yet — so the row links
 * here, and `linkujSpis` turns the link into a jump to the part's first page.
 */
const SPIS_URI = 'https://spis.invalid/czesc-';

/** The contents rows' links on the cover pages, pointed at the first page of their part. */
function linkujSpis(out: PDFDocument, coverPages: number, pierwsze: number[]): void {
  const pages = out.getPages();
  for (const page of pages.slice(0, coverPages)) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const action = annot?.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString)?.decodeText() ?? '';
      if (!annot || !uri.startsWith(SPIS_URI)) continue;
      const target = pages[pierwsze[Number(uri.slice(SPIS_URI.length))]];
      annot.delete(PDFName.of('A'));
      // A part that is not there (it cannot happen, but) keeps no dead link.
      if (target) annot.set(PDFName.of('Dest'), out.context.obj([target.ref, 'XYZ', null, null, null]));
    }
  }
}

const COVER_CSS = `
  .toc { list-style: none; margin: 0; padding: 0; }
  .toc li { margin-bottom: 2mm; break-inside: avoid; }
  /* The whole row is the link to its part (see \`linkujSpis\`). */
  .toc a { display: flex; align-items: center; gap: 4mm; padding: 3mm 4mm; color: inherit; text-decoration: none;
           border: 1px solid #e3e7ea; border-radius: 6px; background: #fff; }
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
  /* The summaries together on a page of their own, after the contents; each one
     whole, so a heading is never left at the foot of a page without its figures. */
  .skrot-strona { break-before: page; }
  .skrot-sekcja { break-inside: avoid; }
  .skrot-sekcja + .skrot-sekcja { margin-top: 8mm; }
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
  if (!wersja) throw new AppError('wersjaGone');
  const zebranie = await database.getZebranie(wersja.zebranieId);
  if (!zebranie) throw new AppError('zebranieGone');
  const [spotkania, lokalizacje] = await Promise.all([
    database.getSpotkania(),
    database.getSpotkaniaLokalizacje(),
  ]);
  const dane = zebranieDane(zebranie, spotkania, lokalizacje);
  const kalendarz = buildKalendarzContext(dane);
  const pola = await database.getMailingPola();
  // The version's statement, plan and resolutions — what the Zebrania fields read.
  const zebranieCtx = buildZebranieContext(wersja, dane, pola);

  const material = req.zawiadomienie ? zawiadomienieOf(wersja) : undefined;
  if (req.zawiadomienie && !material) {
    throw new AppError('pakietNoZawiadomienie');
  }
  const spr = req.sprawozdanie && wersja.sprawozdanie
    ? { ...wersja.sprawozdanie, dane: sprawozdanieWersji(wersja.sprawozdanie) }
    : null;
  if (req.sprawozdanie && !spr) {
    throw new AppError('pakietNoSprawozdanie');
  }
  const plan = req.plan ? wersja.plan : null;
  if (req.plan && !plan) {
    throw new AppError('pakietNoPlan');
  }
  const uchwaly = req.uchwaly
    ? uchwalyOf(wersja).filter((u) => !req.uchwalyIds || req.uchwalyIds.includes(u.id))
    : [];
  if (req.uchwaly && uchwaly.length === 0) {
    throw new AppError('pakietNoUchwaly');
  }
  if (!material && !spr && !plan && uchwaly.length === 0) {
    throw new AppError('pakietNothingChosen');
  }

  if (material) {
    const missing = missingFieldValues(
      {
        adresNazwa: dane.adresNazwa,
        dateText: formatPolishDate(new Date()),
        pola,
        values: material.values,
        tableFields: material.tableFields,
        kalendarz,
        zebranie: zebranieCtx,
      },
      material.temat,
      material.tresc,
    );
    if (missing.length > 0) {
      throw new AppError('pakietZawiadomienieIncomplete', { fields: missing.join(', ') });
    }
  }

  if (uchwaly.length > 0) {
    // The same gate as the notice: a resolution with a blank field is not handed out.
    const niekompletne = uchwaly
      .map((u) => ({
        tytul: uchwalaTytul(u, dane, pola, zebranieCtx),
        missing: uchwalaMissing(u, dane, pola, zebranieCtx),
      }))
      .filter((u) => u.missing.length > 0);
    if (niekompletne.length > 0) {
      throw new AppError('pakietUchwalyIncomplete', {
        fields: niekompletne.map((u) => `${u.tytul} (${u.missing.join(', ')})`).join('; '),
      });
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
          zebranie: zebranieCtx,
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

    if (uchwaly.length > 0) {
      for (const [i, u] of uchwaly.entries()) {
        const plik = path.join(tmp, `uchwala-${i + 1}.pdf`);
        await renderLetterPdf(
          database,
          {
            typ: u.typ,
            templateName: u.szablonNazwa,
            temat: u.temat,
            tresc: u.tresc,
            values: u.values,
            tableFields: u.tableFields,
            kalendarz,
            zebranie: zebranieCtx,
            adresId: dane.adresId,
            adresNazwa: dane.adresNazwa,
            spotkanieId: zebranie.spotkanieId,
            adresaci: u.adresaci,
            wykluczeni: u.wykluczeni,
          },
          plik,
        );
        czesci.push({
          tytul: uchwaly.length > 1 ? `Uchwała ${i + 1} z ${uchwaly.length}` : 'Uchwała',
          opis: uchwalaTytul(u, dane, pola, zebranieCtx),
          plik,
        });
      }
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
          return `<li><a href="${SPIS_URI}${i}"><span class="nr">${i + 1}</span><span class="what"><b>${esc(c.tytul)}</b><span>${esc(c.opis)}</span></span><span class="pages">${pages}</span></a></li>`;
        })
        .join('');
      const sprSkrot = spr
        ? `<section class="skrot-sekcja"><h2><span>Sprawozdanie finansowe w skrócie</span></h2>
<div class="skrot-sub">Za okres ${esc(okresLabel(spr.dane.okresOd, spr.dane.okresDo))}</div>
${skrotHtml(sprawozdanieSkrot(spr.dane, spr.wstep))}</section>`
        : '';
      const planSkrotHtml = plan
        ? `<section class="skrot-sekcja"><h2><span>Plan gospodarczy na ${plan.rok} rok w skrócie</span></h2>
<div class="skrot-sub">Stawki zaliczek za 1 m² powierzchni miesięcznie</div>
${skrotHtml(planSkrot(plan))}</section>`
        : '';
      const body = `<div class="head">
<h1>${esc(dane.nazwa || 'Zebranie Wspólnoty Mieszkaniowej')}</h1>
${adres ? `<div class="sub">Wspólnota Mieszkaniowa ${esc(adres)}</div>` : ''}
${factsStrip(
  [
    ['Termin', termin],
    miejsce ? ['Miejsce', miejsce] : null,
  ].filter((x): x is string[] => !!x),
)}
</div>
<h2><span>Zawartość</span></h2>
<ul class="toc">${toc}</ul>
<p class="cover-foot">Szczegóły — na kolejnych stronach. Prosimy o zapoznanie się z materiałami <b>przed zebraniem</b>.</p>
${sprSkrot || planSkrotHtml ? `<div class="skrot-strona">${sprSkrot}${planSkrotHtml}</div>` : ''}`;
      return shell(
        { label: 'Materiały na zebranie', adres, stopka: 'Materiały na zebranie' },
        body,
        COVER_CSS,
      );
    };

    // The table of contents needs the cover's own length: a page for the
    // contents and one for the summaries, but long figures could push it
    // further — then render it again.
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
    const pierwsze: number[] = [];
    let start = coverDoc!.getPageCount();
    for (const doc of docs) {
      pierwsze.push(start);
      start += doc.getPageCount();
    }
    linkujSpis(out, coverDoc!.getPageCount(), pierwsze);
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
