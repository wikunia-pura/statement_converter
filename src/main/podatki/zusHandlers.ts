/**
 * IPC of the Podatki → ZUS tab: the register and the monthly sets (list, save, prepare a month, correction), the
 * import of Płatnik's KEDU files, the files (KEDU for Płatnik / ePłatnik, the month's printout) and the "sent"
 * marks; sending straight to ZUS is zusWysylki.ts. Kept apart from main.ts, which only hands over what it owns
 * (the window, the database, who is signed in, the folder logic of the tax tabs, the network).
 */

import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { showOpenDialog } from '../dialogs';
import DatabaseService from '../database';
import { IPC_CHANNELS, PodatekPobranie, PodatkiZusImportResult, PodatkiZusPlikiOpcje, PodatkiZusPlikiResult } from '../../shared/types';
import {
  PodatekZusPlatnik,
  PodatekZusRozliczenie,
  ZusDokumentId,
  ZusZnak,
  ZusProblem,
  ZusRozliczenieDane,
  biezaceRozliczenia,
  daneKorekty,
  kluczPozycji,
  maBladZus,
  nazwaPlatnikaPliku,
  nazwaUbezpieczonego,
  obliczRozliczenie,
  pozycjaZmieniona,
  problemyCzlonka,
  problemyPlatnika,
  problemyRozliczenia,
  problemyWyrejestrowania,
  problemyZgloszenia,
  rozbijIdZus,
  szkicRozliczenia,
  tytulyWOkresie,
  OKRES,
} from '../../shared/podatki-zus';
import { czescPliku } from '../../shared/podatki-pit';
import { importujKedu } from './zusImport';
import {
  DokumentKedu,
  PlatnikKedu,
  ProgramKedu,
  dokumentCzlonka,
  dokumentWyrejestrowania,
  dokumentZgloszenia,
  dokumentyRozliczenia,
  plikKedu,
} from './zusKedu';
import { zestawieniePdf } from './zusPdf';
import type { EwdFetch } from './zusEwd';
import { registerZusWysylki } from './zusWysylki';
import { AppError } from '../../shared/app-errors';
import { errorTextIn } from '../errorText';

export interface ZusDeps {
  getMainWindow: () => BrowserWindow | null;
  database: DatabaseService;
  /** Who is signed in — recorded on rows, marks and downloads. */
  who: () => Promise<string>;
  /** The Settings folder's "<prefix> <year>" (created), null when none is set; throws when it is gone. */
  rokFolder: (rok: number, prefiks: string) => string | null;
  downloads: string;
  uniquePath: (dir: string, name: string) => string;
  /** The app's version — the KEDU header names the program that wrote the file. */
  wersja: string;
  /** The network for ZUS's EWD service (Electron's, so the system proxy applies). */
  fetch: EwdFetch;
}

const PREFIKS = 'ZUS';

const dzis = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One document as the handlers see it: its payer, what it is, its name, what blocks it and how to write it. */
interface Dokument {
  id: string;
  ref: ZusDokumentId;
  platnik: PodatekZusPlatnik;
  rozliczenie: PodatekZusRozliczenie | null;
  nazwa: string;
  plik: string;
  problemy: ZusProblem[];
  kedu: () => DokumentKedu[];
  /** Where its download is noted. */
  wpis: { rejestr?: { kluczOsoby: string; klucz: string }; rozliczenieId?: number };
  /** Marked sent already. */
  wyslane: boolean;
}

const powod = (problemy: ZusProblem[]) =>
  problemy
    .filter((p) => p.poziom === 'blad')
    .map((p) => p.tekst)
    .join('\n');

export function registerZusHandlers(deps: ZusDeps): void {
  const { database } = deps;
  const program: ProgramKedu = { producent: 'FileFunky', symbol: 'FileFunky', wersja: deps.wersja };

  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_LISTA, async () => {
    const [platnicy, rozliczenia, wysylki] = await Promise.all([
      database.getPodatkiZus(),
      database.getPodatkiZusRozliczenia(),
      // Before podatki-zus.sql made the table, the list still loads — with no sends.
      database.getZusWysylki().catch((error: unknown) => {
        log.warn('[ZUS] sends not read:', error instanceof Error ? error.message : error);
        return [];
      }),
    ]);
    wysylkiApi.poOdczycie(wysylki);
    return { platnicy, rozliczenia, wysylki };
  });

  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_ADD, async (_, nip: string, dane) => database.addPodatekZus(nip, dane, await deps.who()));
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_SET, async (_, id: number, dane) => database.setPodatekZus(id, dane, await deps.who()));
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_DELETE, async (_, id: number) => {
    await database.deletePodatekZus(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_ROZL_ADD, async (_, nip: string, okres: string, identyfikator: number, dane: ZusRozliczenieDane) =>
    database.addZusRozliczenie(nip, okres, identyfikator, dane, await deps.who()),
  );
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_ROZL_SET, async (_, id: number, dane: ZusRozliczenieDane) => database.setZusRozliczenie(id, dane, await deps.who()));
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_ROZL_DELETE, async (_, id: number) => {
    await database.deleteZusRozliczenie(id);
    return true;
  });

  /**
   * "Przygotuj miesiąc": a set for every payer with a title in force in the month and no set of it yet, the
   * bases carried from the previous month. Returns how many were made.
   */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_PRZYGOTUJ, async (_, okres: string, nips?: string[]) => {
    if (!OKRES.test(okres)) return 0;
    const [platnicy, rozliczenia] = await Promise.all([database.getPodatkiZus(), database.getPodatkiZusRozliczenia()]);
    const who = await deps.who();
    let n = 0;
    for (const p of platnicy) {
      if (nips && !nips.includes(p.nip)) continue;
      if (rozliczenia.some((r) => r.nip === p.nip && r.okres === okres)) continue;
      if (tytulyWOkresie(p.dane, okres).length === 0) continue;
      await database.addZusRozliczenie(p.nip, okres, 1, szkicRozliczenia(p.dane, okres, rozliczenia.filter((r) => r.nip === p.nip)), who);
      n += 1;
    }
    log.info(`[ZUS] month ${okres} prepared for ${n} payers`);
    return n;
  });

  /** A correction of a sent set: the next identifier, the same figures to edit. */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_KOREKTA, async (_, rozliczenieId: number) => {
    const wszystkie = await database.getPodatkiZusRozliczenia();
    const r = wszystkie.find((x) => x.id === rozliczenieId);
    if (!r) throw new AppError('zusRozliczenieGone');
    if (!r.dane.wyslane) throw new AppError('zusKorektaNotSent');
    const nastepny = Math.max(...wszystkie.filter((x) => x.nip === r.nip && x.okres === r.okres).map((x) => x.identyfikator)) + 1;
    return database.addZusRozliczenie(r.nip, r.okres, nastepny, daneKorekty(r.dane), await deps.who());
  });

  /* ---------------------------------- import ---------------------------------- */

  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_IMPORT, async (): Promise<PodatkiZusImportResult | null> => {
    const wybor = await showOpenDialog(deps.getMainWindow()!, {
      title: 'Pliki KEDU wyeksportowane z Płatnika',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'KEDU (XML)', extensions: ['xml', 'kdu'] }],
    });
    if (wybor.canceled || wybor.filePaths.length === 0) return null;
    const [platnicy, rozliczenia] = await Promise.all([database.getPodatkiZus(), database.getPodatkiZusRozliczenia()]);
    const wynik = await importujKedu(wybor.filePaths, platnicy, rozliczenia);
    if (wynik.dokumentow === 0) throw new AppError('zusImportEmpty');
    const poId = new Map(platnicy.map((p) => [p.id, p]));
    const zapis = await database.zapiszImportZus(
      wynik.nowiPlatnicy,
      wynik.zmienieniPlatnicy.map((p) => ({ id: p.id, dane: p.dane, updatedAt: poId.get(p.id)?.updatedAt ?? '' })),
      wynik.rozliczenia,
      await deps.who(),
    );
    const dotkniete = [...wynik.nowiPlatnicy, ...wynik.zmienieniPlatnicy];
    const osoby = dotkniete.reduce((n, p) => n + p.dane.ubezpieczeni.length, 0);
    const doPrzegladu =
      dotkniete.reduce((n, p) => n + p.dane.ubezpieczeni.filter((o) => o.przeglad.length > 0).length, 0) +
      wynik.rozliczenia.filter((r) => r.dane.przeglad.length > 0).length;
    log.info(
      `[ZUS] imported ${wynik.dokumentow} documents of ${wynik.plikow} files: payers +${zapis.dodaniPlatnicy} ~${zapis.zmienieniPlatnicy}, months +${zapis.dodaneRozliczenia}`,
    );
    return {
      plikow: wynik.plikow,
      dokumentow: wynik.dokumentow,
      dodaniPlatnicy: zapis.dodaniPlatnicy,
      zmienieniPlatnicy: zapis.zmienieniPlatnicy,
      osoby,
      dodaneRozliczenia: zapis.dodaneRozliczenia,
      istniejaceRozliczenia: wynik.istniejaceRozliczenia + (wynik.rozliczenia.length - zapis.dodaneRozliczenia),
      doPrzegladu,
      pominiete: wynik.pominiete,
      ostrzezenia: wynik.ostrzezenia,
    };
  });

  /* ----------------------------------- files ----------------------------------- */

  /** The documents behind ticked ids, each with what blocks it and how to write it. */
  function dokumenty(platnicy: PodatekZusPlatnik[], rozliczenia: PodatekZusRozliczenie[], ids: string[]): { lista: Dokument[]; brak: string[] } {
    const poId = new Map(platnicy.map((p) => [p.id, p]));
    const lista: Dokument[] = [];
    const brak: string[] = [];
    const data = dzis();
    for (const id of ids) {
      const ref = rozbijIdZus(id);
      const platnik = ref ? poId.get(ref.platnikId) : undefined;
      if (!ref || !platnik) {
        brak.push(id);
        continue;
      }
      const pl: PlatnikKedu = { nip: platnik.nip, dane: platnik.dane };
      const wsp = nazwaPlatnikaPliku(platnik.dane.nazwaSkrocona || platnik.nip);
      if (ref.typ === 'r') {
        const okres = ref.okres!;
        const wersje = rozliczenia.filter((r) => r.nip === platnik.nip && r.okres === okres).sort((a, b) => a.identyfikator - b.identyfikator);
        const r = wersje[wersje.length - 1];
        if (!r) {
          brak.push(id);
          continue;
        }
        const wynik = obliczRozliczenie(platnik.dane, r.dane, okres);
        let tylkoPozycje: Set<string> | undefined;
        const poprzedni = wersje.length > 1 ? wersje[wersje.length - 2] : null;
        if (r.identyfikator > 1 && poprzedni) {
          const przed = new Map(obliczRozliczenie(platnik.dane, poprzedni.dane, okres).pozycje.map((w) => [kluczPozycji(w.pozycja), w.skladki]));
          tylkoPozycje = new Set(wynik.pozycje.filter((w) => pozycjaZmieniona(przed.get(kluczPozycji(w.pozycja)), w.skladki)).map((w) => kluczPozycji(w.pozycja)));
        }
        const korekta = r.identyfikator > 1 ? ` korekta ${String(r.identyfikator).padStart(2, '0')}` : '';
        lista.push({
          id,
          ref,
          platnik,
          rozliczenie: r,
          nazwa: `DRA ${okres} — ${wsp}${korekta}`,
          plik: `ZUS ${okres} - ${wsp} - DRA RCA${r.dane.rsa.length > 0 ? ' RSA' : ''}${korekta}`,
          problemy: problemyRozliczenia(platnik.nip, platnik.dane, r, wynik),
          kedu: () =>
            dokumentyRozliczenia({ platnik: pl, okres, identyfikator: r.identyfikator, dane: r.dane, wynik, tylkoPozycje, dataWypelnienia: r.dane.dataWypelnienia ?? data }),
          wpis: { rozliczenieId: r.id },
          wyslane: !!r.dane.wyslane,
        });
        continue;
      }
      const osoba = platnik.dane.ubezpieczeni.find((o) => o.klucz === ref.kluczOsoby);
      if (!osoba) {
        brak.push(id);
        continue;
      }
      const kto = czescPliku(nazwaUbezpieczonego(osoba));
      if (ref.typ === 'c') {
        const czlonek = osoba.czlonkowie.find((c) => c.klucz === ref.kluczCzlonka);
        if (!czlonek) {
          brak.push(id);
          continue;
        }
        const zdarzenie = ref.zdarzenie!;
        lista.push({
          id,
          ref,
          platnik,
          rozliczenie: null,
          nazwa: `ZCNA ${zdarzenie === 'z' ? 'zgłoszenie' : 'wyrejestrowanie'} — ${wsp} — ${kto}`,
          plik: `ZUS ZCNA - ${wsp} - ${kto} - ${czescPliku(`${czlonek.nazwisko} ${czlonek.imie}`)}${zdarzenie === 'w' ? ' wyrejestrowanie' : ''}`,
          problemy: [...problemyPlatnika(platnik.nip, platnik.dane), ...problemyCzlonka(osoba, czlonek, zdarzenie)],
          kedu: () => [dokumentCzlonka(pl, osoba, czlonek, zdarzenie, data)],
          wpis: { rejestr: { kluczOsoby: osoba.klucz, klucz: czlonek.klucz } },
          wyslane: !!(zdarzenie === 'z' ? czlonek.zgloszenie : czlonek.wyrejestrowanie),
        });
        continue;
      }
      const tytul = osoba.tytuly.find((t) => t.klucz === ref.kluczTytulu);
      if (!tytul) {
        brak.push(id);
        continue;
      }
      const zgl = ref.typ === 'z';
      const rodzaj = zgl ? (tytul.schemat === 'zdrowotne' ? 'ZZA' : 'ZUA') : 'ZWUA';
      lista.push({
        id,
        ref,
        platnik,
        rozliczenie: null,
        nazwa: `${rodzaj} — ${wsp} — ${kto}`,
        plik: `ZUS ${rodzaj} - ${wsp} - ${kto} - ${tytul.kod}`,
        problemy: [...problemyPlatnika(platnik.nip, platnik.dane), ...(zgl ? problemyZgloszenia(osoba, tytul) : problemyWyrejestrowania(osoba, tytul))],
        kedu: () => [zgl ? dokumentZgloszenia(pl, osoba, tytul, data) : dokumentWyrejestrowania(pl, osoba, tytul, data)],
        wpis: { rejestr: { kluczOsoby: osoba.klucz, klucz: tytul.klucz } },
        wyslane: !!(zgl ? tytul.zgloszenie : tytul.wyrejestrowanie),
      });
    }
    return { lista, brak };
  }

  /** "<Settings folder>/ZUS <rok>/<miesiąc>", else "ZUS <miesiąc>" in Downloads — one folder per month. */
  const folderMiesiaca = (okres: string): string => {
    const rokFolder = deps.rokFolder(Number(okres.slice(0, 4)), PREFIKS);
    return rokFolder ? path.join(rokFolder, okres) : path.join(deps.downloads, `${PREFIKS} ${okres}`);
  };

  /** Documents marked sent (`znak`) or unmarked (null) — the button's way and the confirmation's. */
  const ustawWyslane = async (ids: string[], znak: ZusZnak | null) => {
    const refs = ids.map(rozbijIdZus).filter((r): r is ZusDokumentId => r !== null);
    const rozliczeniaIds: number[] = [];
    if (refs.some((r) => r.typ === 'r')) {
      const [platnicy, rozliczenia] = await Promise.all([database.getPodatkiZus(), database.getPodatkiZusRozliczenia()]);
      const nipy = new Map(platnicy.map((p) => [p.id, p.nip]));
      for (const r of refs.filter((x) => x.typ === 'r')) {
        const nip = nipy.get(r.platnikId);
        const biezace = nip ? biezaceRozliczenia(rozliczenia, nip).find((x) => x.okres === r.okres) : undefined;
        if (biezace) rozliczeniaIds.push(biezace.id);
      }
    }
    return database.setZusWyslane(
      refs
        .filter((r) => r.typ !== 'r')
        .map((r) => ({
          platnikId: r.platnikId,
          typ: r.typ as 'z' | 'w' | 'c',
          kluczOsoby: r.kluczOsoby!,
          klucz: (r.typ === 'c' ? r.kluczCzlonka : r.kluczTytulu)!,
          zdarzenie: r.zdarzenie,
        })),
      rozliczeniaIds,
      znak,
    );
  };

  const wysylkiApi = registerZusWysylki({
    ...deps,
    program: { producent: program.producent, nazwa: program.symbol, wersja: program.wersja },
    folderMiesiaca,
    oznaczWyslane: async (dokument, identyfikator, znak) => {
      const ref = rozbijIdZus(dokument);
      if (ref?.typ !== 'r' || !identyfikator) {
        await ustawWyslane([dokument], znak);
        return;
      }
      // A set: the version that went, not whichever is the month's newest now.
      const [platnicy, rozliczenia] = await Promise.all([database.getPodatkiZus(), database.getPodatkiZusRozliczenia()]);
      const nip = platnicy.find((p) => p.id === ref.platnikId)?.nip;
      const r = rozliczenia.find((x) => x.nip === nip && x.okres === ref.okres && x.identyfikator === identyfikator);
      if (r) await database.setZusWyslane([], [r.id], znak);
    },
    dokumenty: (platnicy, rozliczenia, ids) => {
      const { lista, brak } = dokumenty(platnicy, rozliczenia, ids);
      return {
        brak,
        lista: lista.map((d) => ({
          id: d.id,
          platnik: d.platnik,
          rozliczenie: d.rozliczenie,
          nazwa: d.nazwa,
          plik: d.plik,
          problemy: d.problemy,
          kedu: () => plikKedu(d.kedu(), program, dzis()),
          wyslane: d.wyslane,
        })),
      };
    },
  });

  ipcMain.handle(
    IPC_CHANNELS.PODATKI_ZUS_PLIKI,
    async (_, okres: string, ids: string[], opcje: PodatkiZusPlikiOpcje): Promise<PodatkiZusPlikiResult> => {
      const [platnicy, rozliczenia] = await Promise.all([database.getPodatkiZus(), database.getPodatkiZusRozliczenia()]);
      const { lista, brak } = dokumenty(platnicy, rozliczenia, ids);
      const gone = errorTextIn(database, new AppError('zusDocumentGone'));
      const pominiete: PodatkiZusPlikiResult['pominiete'] = brak.map((id) => ({ id, nazwa: id, powod: gone }));
      const zapisane: PodatkiZusPlikiResult['zapisane'] = [];
      const gotowe = lista.filter((d) => {
        if (!maBladZus(d.problemy)) return true;
        pominiete.push({ id: d.id, nazwa: d.nazwa, powod: powod(d.problemy) });
        return false;
      });
      if (gotowe.length === 0 || (opcje.kedu === 'brak' && !opcje.pdf)) return { folder: '', zapisane, pominiete };

      // "<folder ustawień>/ZUS <rok>/<miesiąc>", else Pobrane/"ZUS <miesiąc>".
      const rokFolder = deps.rokFolder(Number(okres.slice(0, 4)), PREFIKS);
      const folder = rokFolder ? path.join(rokFolder, okres) : deps.uniquePath(deps.downloads, `${PREFIKS} ${okres}`);
      fs.mkdirSync(folder, { recursive: true });
      const who = await deps.who();
      const rejestr: { platnikId: number; kluczOsoby: string; klucz: string; entry: PodatekPobranie }[] = [];
      const rozl: { rozliczenieId: number; entry: PodatekPobranie }[] = [];
      const zanotuj = (d: Dokument, sciezka: string) => {
        const entry: PodatekPobranie = { at: new Date().toISOString(), by: who, plik: path.basename(sciezka) };
        if (d.wpis.rejestr) rejestr.push({ platnikId: d.platnik.id, ...d.wpis.rejestr, entry });
        if (d.wpis.rozliczenieId) rozl.push({ rozliczenieId: d.wpis.rozliczenieId, entry });
      };

      const wKedu: Dokument[] = [];
      const wspolne: DokumentKedu[] = [];
      for (const d of gotowe) {
        try {
          const kedu = opcje.kedu !== 'brak' ? d.kedu() : [];
          if (opcje.kedu === 'osobno') {
            const sciezka = deps.uniquePath(folder, `${czescPliku(d.plik).slice(0, 150)}.xml`);
            fs.writeFileSync(sciezka, plikKedu(kedu, program, dzis()), 'utf8');
            zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka });
            zanotuj(d, sciezka);
          } else if (opcje.kedu === 'razem') {
            wspolne.push(...kedu);
            wKedu.push(d);
          }
          if (opcje.pdf && d.rozliczenie) {
            const r = d.rozliczenie;
            const bytes = await zestawieniePdf({
              nip: d.platnik.nip,
              platnik: d.platnik.dane,
              okres: r.okres,
              identyfikator: r.identyfikator,
              dane: r.dane,
              wynik: obliczRozliczenie(d.platnik.dane, r.dane, r.okres),
              wydrukowano: new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }),
            });
            const sciezka = deps.uniquePath(folder, `${czescPliku(d.plik).slice(0, 150)}.pdf`);
            fs.writeFileSync(sciezka, bytes);
            zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka });
            zanotuj(d, sciezka);
          }
        } catch (error: unknown) {
          pominiete.push({ id: d.id, nazwa: d.nazwa, powod: errorTextIn(database, error) });
        }
      }
      if (opcje.kedu === 'razem' && wspolne.length > 0) {
        const platnikow = new Set(wKedu.map((d) => d.platnik.id)).size;
        const sciezka = deps.uniquePath(folder, `ZUS ${okres} - razem (${wKedu.length} dok., ${platnikow} płatn.).xml`);
        fs.writeFileSync(sciezka, plikKedu(wspolne, program, dzis()), 'utf8');
        for (const d of wKedu) {
          zapisane.push({ id: d.id, nazwa: d.nazwa, sciezka });
          zanotuj(d, sciezka);
        }
      }
      await database.recordZusPliki(rejestr, rozl).catch((error: unknown) => {
        log.warn('[ZUS] download not recorded:', error instanceof Error ? error.message : error);
      });
      log.info(`[ZUS] ${zapisane.length} files of ${gotowe.length} documents (${okres}) saved to ${folder}`);
      return { folder: zapisane.length > 0 ? folder : '', zapisane, pominiete };
    },
  );

  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_SET_WYSLANE, async (_, ids: string[], wyslane: boolean) =>
    ustawWyslane(ids, wyslane ? { at: new Date().toISOString(), by: await deps.who() } : null),
  );
}
