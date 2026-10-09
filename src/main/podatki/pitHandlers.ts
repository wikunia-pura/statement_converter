/**
 * IPC of the Podatki → PIT tab: the data (list, save, next year), the imports (XML files of the office, the
 * Excel with the year's amounts) and the files (XML for e-Deklaracje, PDF for the taxpayer, both signed with
 * the card). Kept apart from main.ts, which only hands over what it owns (the window, the database, who is
 * signed in, the folder logic of the other tax tabs).
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import DatabaseService from '../database';
import {
  IPC_CHANNELS,
  PodatekPobranie,
  PodatkiPitExcelResult,
  PodatkiPitImportResult,
  PodatkiPitPlikiResult,
  PodpisSlad,
  PodpisWybor,
} from '../../shared/types';
import {
  PitDane,
  PitOsoba,
  PitProblem,
  PodatekPit,
  maBlad,
  nazwaOsoby,
  nipPoprawny,
  nazwaPlikuPit,
  problemyOsoby,
  problemyPit4R,
  rozbijDokumentId,
  czescPliku,
} from '../../shared/podatki-pit';
import { pit11Xml, pit4rXml } from './pitXml';
import { pit11Pdf, pit4rPdf } from './pitPdf';
import { importujPitFolder } from './pitImport';
import { wczytajPit, zastosujZmianyPit, zbudujSzablonPit } from './pitExcel';
import { podpiszXml } from '../podpis/xades';
import { podpiszPdf } from '../podpis/pades';
import { BladKarty, zKartaDoPodpisu } from '../podpis/karta';

export interface PitDeps {
  getMainWindow: () => BrowserWindow | null;
  database: DatabaseService;
  /** Who is signed in — recorded on rows and downloads. */
  who: () => Promise<string>;
  /** The Settings folder's "<prefix> <year>" (created), null when none is set; throws when it is gone. */
  rokFolder: (rok: number, prefiks: string) => string | null;
  downloads: string;
  uniquePath: (dir: string, name: string) => string;
  /** Path of the card library picked in Settings ('' = look next to Szafir). */
  podpisBiblioteka: () => string;
}

/** One document as the handlers see it: the row, what it is, its name and what blocks it. */
interface Dokument {
  id: string;
  wiersz: PodatekPit;
  osoba: PitOsoba | null;
  nazwa: string;
  problemy: PitProblem[];
}

const PREFIKS = 'PIT';

/** What stops a document for the payer's sake — both the XML and the PDF carry the payer's NIP and name. */
function problemyPlatnika(w: PodatekPit): PitProblem[] {
  const out: PitProblem[] = [];
  if (!nipPoprawny(w.nip)) out.push({ poziom: 'blad', tekst: 'Brak poprawnego NIP-u płatnika (10 cyfr, cyfra kontrolna).' });
  if (!w.dane.nazwa.trim()) out.push({ poziom: 'blad', tekst: 'Brak nazwy płatnika.' });
  return out;
}

function dokumentyZIdow(wiersze: PodatekPit[], rok: number, ids: string[]): { dokumenty: Dokument[]; brak: string[] } {
  const dokumenty: Dokument[] = [];
  const brak: string[] = [];
  const poId = new Map(wiersze.filter(w => w.rok === rok).map(w => [w.id, w]));
  for (const id of ids) {
    const r = rozbijDokumentId(id);
    const wiersz = r ? poId.get(r.wierszId) : undefined;
    if (!r || !wiersz) {
      brak.push(id);
      continue;
    }
    if (r.klucz === null) {
      if (!wiersz.dane.pit4r) {
        brak.push(id);
        continue;
      }
      dokumenty.push({
        id,
        wiersz,
        osoba: null,
        nazwa: `PIT-4R ${wiersz.dane.nazwa || wiersz.nip}`,
        problemy: [...problemyPlatnika(wiersz), ...problemyPit4R(wiersz.dane, rok)],
      });
    } else {
      const osoba = wiersz.dane.osoby.find(o => o.klucz === r.klucz);
      if (!osoba) {
        brak.push(id);
        continue;
      }
      dokumenty.push({
        id,
        wiersz,
        osoba,
        nazwa: `PIT-11 ${wiersz.dane.nazwa || wiersz.nip} — ${nazwaOsoby(osoba)}`,
        problemy: [...problemyPlatnika(wiersz), ...problemyOsoby(osoba, rok)],
      });
    }
  }
  return { dokumenty, brak };
}

const platnik = (w: PodatekPit) => ({ nip: w.nip, nazwa: w.dane.nazwa });

function xmlDokumentu(d: Dokument, rok: number): string {
  const { wiersz } = d;
  if (d.osoba) return pit11Xml({ rok, platnik: platnik(wiersz), osoba: d.osoba });
  return pit4rXml({
    rok,
    platnik: platnik(wiersz),
    urzadPlatnika: wiersz.dane.urzadPlatnika,
    pit4r: wiersz.dane.pit4r!,
  });
}

function pdfDokumentu(d: Dokument, rok: number): Promise<Uint8Array> {
  const { wiersz } = d;
  if (d.osoba) return pit11Pdf({ rok, platnik: platnik(wiersz), osoba: d.osoba });
  return pit4rPdf({
    rok,
    platnik: platnik(wiersz),
    urzadPlatnika: wiersz.dane.urzadPlatnika,
    pit4r: wiersz.dane.pit4r!,
  });
}

const bazaPliku = (d: Dokument, rok: number): string =>
  nazwaPlikuPit(rok, d.osoba ? 'pit11' : 'pit4r', d.wiersz.dane.nazwa || d.wiersz.nip, d.osoba ?? undefined);

const powod = (d: Dokument): string =>
  d.problemy
    .filter(p => p.poziom === 'blad')
    .map(p => p.tekst)
    .join('; ');

export function registerPitHandlers(deps: PitDeps): void {
  const { database } = deps;

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_LISTA, async () => database.getPodatkiPit());

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_ADD, async (_, nip: string, rok: number, dane: PitDane) =>
    database.addPodatekPit(nip, rok, dane, await deps.who()),
  );

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_SET, async (_, id: number, nip: string, dane: PitDane) =>
    database.setPodatekPit(id, nip, dane, await deps.who()),
  );

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_DELETE, async (_, id: number) => {
    await database.deletePodatekPit(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_PRZENIES, async (_, zRoku: number, naRok: number) =>
    database.przeniesPitNaRok(zRoku, naRok, await deps.who()),
  );

  /* ---------------------------------- imports ---------------------------------- */

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_IMPORT_XML, async (_, rok: number): Promise<PodatkiPitImportResult | null> => {
    const window = deps.getMainWindow();
    const wybor = await dialog.showOpenDialog(window!, {
      title: `Folder z plikami XML PIT-11 i PIT-4R za ${rok}`,
      properties: ['openDirectory'],
    });
    if (wybor.canceled || wybor.filePaths.length === 0) return null;
    const folder = wybor.filePaths[0];
    const wynik = await importujPitFolder(folder, rok);
    if (wynik.wiersze.length === 0) {
      throw new Error(`W tym folderze nie ma żadnego PIT-11 ani PIT-4R za ${rok} — nic nie zaimportowano.`);
    }
    const { dodane, istniejace } = await database.addPodatkiPitBrakujace(wynik.wiersze, await deps.who());
    const osoby = wynik.wiersze.reduce((n, w) => n + w.dane.osoby.length, 0);
    const doPrzegladu = wynik.wiersze.reduce(
      (n, w) => n + w.dane.osoby.filter(o => o.przeglad.length > 0).length + (w.dane.pit4r?.przeglad.length ? 1 : 0),
      0,
    );
    log.info(`[PIT] imported ${dodane}/${wynik.wiersze.length} communities (${osoby} people) from ${path.basename(folder)}`);
    return {
      folder: path.basename(folder),
      plikow: wynik.plikow,
      dodane,
      istniejace,
      osoby,
      doPrzegladu,
      pominiete: wynik.pominiete,
      ostrzezenia: wynik.ostrzezenia,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_EXCEL_SZABLON, async (_, rok: number) => {
    const wiersze = await database.getPodatkiPit();
    if (!wiersze.some(w => w.rok === rok)) throw new Error(`Rok ${rok} nie ma jeszcze żadnej wspólnoty — najpierw przenieś go z poprzedniego roku.`);
    const bufor = await zbudujSzablonPit(wiersze, rok);
    const wybor = await dialog.showSaveDialog(deps.getMainWindow()!, {
      title: 'Szablon kwot PIT',
      defaultPath: path.join(deps.downloads, `PIT ${rok} - kwoty.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (wybor.canceled || !wybor.filePath) return null;
    fs.writeFileSync(wybor.filePath, bufor);
    return { filePath: wybor.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_EXCEL_WCZYTAJ, async (_, rok: number): Promise<PodatkiPitExcelResult | null> => {
    const wybor = await dialog.showOpenDialog(deps.getMainWindow()!, {
      title: `Wypełniony szablon kwot PIT za ${rok}`,
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (wybor.canceled || wybor.filePaths.length === 0) return null;
    const plik = wybor.filePaths[0];
    const wiersze = await database.getPodatkiPit();
    const wynik = await wczytajPit(fs.readFileSync(plik), wiersze, rok);
    const poId = new Map(wiersze.map(w => [w.id, w]));
    const poWierszu = new Map<number, typeof wynik.zmiany>();
    for (const z of wynik.zmiany) poWierszu.set(z.wierszId, [...(poWierszu.get(z.wierszId) ?? []), z]);
    const who = await deps.who();
    let zmienione = 0;
    for (const [wierszId, zmiany] of poWierszu) {
      const wiersz = poId.get(wierszId);
      if (!wiersz) continue;
      await database.zapiszDanePit(wierszId, zastosujZmianyPit(wiersz.dane, zmiany), who);
      zmienione += zmiany.length;
    }
    log.info(`[PIT] Excel ${path.basename(plik)}: ${zmienione} changes`);
    return { plikNazwa: path.basename(plik), zmienione, pominiete: wynik.pominiete, ostrzezenia: wynik.ostrzezenia };
  });

  /* ----------------------------------- files ----------------------------------- */

  /** The year's folder, one subfolder per community — about a hundred and fifty files a year do not fit one. */
  const folderRoku = (rok: number, nazwaSufiksu: string): string =>
    deps.rokFolder(rok, PREFIKS) ?? deps.uniquePath(deps.downloads, `${PREFIKS} ${rok}${nazwaSufiksu}`);

  const folderWspolnoty = (rokFolder: string, d: Dokument): string => {
    const dir = path.join(rokFolder, czescPliku(d.wiersz.dane.nazwa || d.wiersz.nip));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  ipcMain.handle(
    IPC_CHANNELS.PODATKI_PIT_PLIKI,
    async (_, rok: number, ids: string[], tryb: 'xml' | 'pdf' | 'oba'): Promise<PodatkiPitPlikiResult> => {
      const wiersze = await database.getPodatkiPit();
      const { dokumenty, brak } = dokumentyZIdow(wiersze, rok, ids);
      const pominiete: PodatkiPitPlikiResult['pominiete'] = brak.map(id => ({ id, nazwa: id, powod: 'Tego dokumentu już nie ma.' }));
      const zapisane: PodatkiPitPlikiResult['zapisane'] = [];
      const gotowe = dokumenty.filter(d => {
        if (!maBlad(d.problemy)) return true;
        pominiete.push({ id: d.id, nazwa: d.nazwa, powod: powod(d) });
        return false;
      });
      if (gotowe.length === 0) return { folder: '', zapisane, pominiete, podpis: null, przerwano: null, niepodpisane: [] };

      const folder = folderRoku(rok, '');
      const who = await deps.who();
      const wpisy = new Map<number, { klucz: string | null; entry: PodatekPobranie }[]>();
      for (const d of gotowe) {
        try {
          const dir = folderWspolnoty(folder, d);
          const baza = bazaPliku(d, rok);
          const pliki: string[] = [];
          if (tryb !== 'pdf') {
            const sciezka = deps.uniquePath(dir, `${baza}.xml`);
            fs.writeFileSync(sciezka, xmlDokumentu(d, rok), 'utf8');
            pliki.push(sciezka);
          }
          if (tryb !== 'xml') {
            const sciezka = deps.uniquePath(dir, `${baza}.pdf`);
            fs.writeFileSync(sciezka, await pdfDokumentu(d, rok));
            pliki.push(sciezka);
          }
          for (const sciezka of pliki) {
            zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka });
            const lista = wpisy.get(d.wiersz.id) ?? [];
            lista.push({ klucz: d.osoba?.klucz ?? null, entry: { at: new Date().toISOString(), by: who, plik: path.basename(sciezka) } });
            wpisy.set(d.wiersz.id, lista);
          }
        } catch (error: unknown) {
          pominiete.push({ id: d.id, nazwa: d.nazwa, powod: error instanceof Error ? error.message : String(error) });
        }
      }
      for (const [wierszId, lista] of wpisy) {
        await database.recordPitPliki(wierszId, lista).catch((error: unknown) => {
          log.warn('[PIT] download not recorded:', error instanceof Error ? error.message : error);
        });
      }
      log.info(`[PIT] ${zapisane.length} files of ${gotowe.length} documents (${rok}) saved to ${folder}`);
      return { folder: zapisane.length > 0 ? folder : '', zapisane, pominiete, podpis: null, przerwano: null, niepodpisane: [] };
    },
  );

  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_SET_ZLOZONE, async (_, ids: string[], zlozone: boolean, numerRef: string) => {
    const dokumenty = ids.map(rozbijDokumentId).filter((d): d is { wierszId: number; klucz: string | null } => d !== null);
    const znak = zlozone ? { at: new Date().toISOString(), by: await deps.who(), numerRef: (numerRef ?? '').trim() } : null;
    return database.setPitZlozone(dokumenty, znak);
  });

  /* ---------------------------------- signing ---------------------------------- */

  let przerwane = false;
  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_PODPISZ_PRZERWIJ, () => {
    przerwane = true;
    return true;
  });

  /**
   * The ticked documents signed one by one under a single login — one PIN for all. The XML gets the XAdES
   * signature e-Deklaracje wants ("… (podpisany).xml"); the PDF is the taxpayer's copy, signed with PAdES only
   * when asked. A document that cannot be made yet is skipped with the reason before the card is touched; a
   * card failure (wrong PIN, card pulled out) stops the run — rejecting while nothing is signed, so the
   * window can ask for the PIN again.
   */
  ipcMain.handle(
    IPC_CHANNELS.PODATKI_PIT_PODPISZ_WIELE,
    async (event, rok: number, ids: string[], wybor: PodpisWybor, opcje: { pdfPodpisany: boolean }): Promise<PodatkiPitPlikiResult> => {
      przerwane = false;
      const wiersze = await database.getPodatkiPit();
      const { dokumenty, brak } = dokumentyZIdow(wiersze, rok, ids);
      const pominiete: PodatkiPitPlikiResult['pominiete'] = brak.map(id => ({ id, nazwa: id, powod: 'Tego dokumentu już nie ma.' }));
      const gotowe = dokumenty.filter(d => {
        if (!maBlad(d.problemy)) return true;
        pominiete.push({ id: d.id, nazwa: d.nazwa, powod: powod(d) });
        return false;
      });
      const zapisane: PodatkiPitPlikiResult['zapisane'] = [];
      if (gotowe.length === 0) return { folder: '', zapisane, pominiete, podpis: null, przerwano: null, niepodpisane: [] };

      // Before the PIN: a missing folder must not cost a signature.
      const folder = folderRoku(rok, ' podpisane');
      const who = await deps.who();
      const postep = (zrobione: number, teraz: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('podatki:pit-podpis-postep', { zrobione, wszystkie: gotowe.length, nazwa: teraz });
        }
      };
      const wpisy = new Map<number, { klucz: string | null; entry: PodatekPobranie }[]>();
      let przetworzone = 0;
      let przerwano: string | null = null;
      let slad: PodpisSlad | null = null;
      let podpisane = 0;

      await zKartaDoPodpisu(deps.podpisBiblioteka(), wybor, async sesja => {
        const podpis = { podmiot: sesja.cert.podmiot, wystawca: sesja.cert.wystawca, numerSeryjny: sesja.cert.numerSeryjny };
        slad = podpis;
        for (const d of gotowe) {
          if (przerwane) {
            przerwano = 'Podpisywanie przerwane na Twoje polecenie.';
            break;
          }
          postep(przetworzone, d.nazwa);
          try {
            const dir = folderWspolnoty(folder, d);
            const baza = bazaPliku(d, rok);
            // Everything that can fail without the card is made first: a signature must never be spent on a
            // document whose other half cannot be made.
            const xml = xmlDokumentu(d, rok);
            const pdf = await pdfDokumentu(d, rok);
            const podpisanyXml = await podpiszXml(xml, sesja);
            const sciezkaXml = deps.uniquePath(dir, `${baza} (podpisany).xml`);
            fs.writeFileSync(sciezkaXml, podpisanyXml, 'utf8');
            const nowe: { klucz: string | null; entry: PodatekPobranie }[] = [
              { klucz: d.osoba?.klucz ?? null, entry: { at: new Date().toISOString(), by: who, plik: path.basename(sciezkaXml), podpis } },
            ];
            zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka: sciezkaXml });
            podpisane += 1;
            wpisy.set(d.wiersz.id, [...(wpisy.get(d.wiersz.id) ?? []), ...nowe]);

            const bytes = opcje.pdfPodpisany
              ? await podpiszPdf(pdf, { ...sesja, powod: d.osoba ? `PIT-11 za ${rok} r.` : `PIT-4R za ${rok} r.` })
              : pdf;
            const sciezkaPdf = deps.uniquePath(dir, `${baza}${opcje.pdfPodpisany ? ' (podpisany)' : ''}.pdf`);
            fs.writeFileSync(sciezkaPdf, bytes);
            zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka: sciezkaPdf });
            wpisy.set(d.wiersz.id, [
              ...(wpisy.get(d.wiersz.id) ?? []),
              { klucz: d.osoba?.klucz ?? null, entry: { at: new Date().toISOString(), by: who, plik: path.basename(sciezkaPdf), ...(opcje.pdfPodpisany ? { podpis } : {}) } },
            ]);
          } catch (error: unknown) {
            if (error instanceof BladKarty) {
              if (podpisane === 0) throw error;
              przerwano = error.message;
              break;
            }
            pominiete.push({ id: d.id, nazwa: d.nazwa, powod: error instanceof Error ? error.message : String(error) });
          }
          przetworzone += 1;
        }
        postep(przetworzone, '');
      });

      for (const [wierszId, lista] of wpisy) {
        await database.recordPitPliki(wierszId, lista).catch((error: unknown) => {
          log.warn('[PIT] download not recorded:', error instanceof Error ? error.message : error);
        });
      }
      log.info(`[PIT] ${podpisane}/${gotowe.length} documents of ${rok} signed with one login` + (przerwano ? ` — stopped: ${przerwano}` : ''));
      return {
        folder: podpisane > 0 ? folder : '',
        zapisane,
        pominiete,
        podpis: slad,
        przerwano,
        // The run stopped at `przetworzone`: that one and the rest are left.
        niepodpisane: gotowe.slice(przetworzone).map(d => ({ id: d.id, nazwa: d.nazwa })),
      };
    },
  );
}
