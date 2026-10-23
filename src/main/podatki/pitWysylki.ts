/**
 * Podatki → PIT: the signed PIT-11 and PIT-4R sent to the e-Deklaracje gateway and followed to their UPO — the
 * CIT-8's way (main.ts, `citWyslij` and its UPO automat), with the sends kept on each document inside the
 * community's row (`podatki_pit.dane`, written through `zmienWysylkiPit`), so no table and no SQL of their own.
 *
 *  • A send is recorded BEFORE the POST, as uncertain, and on production only if the guards
 *    (`blokadyWysylkiProd`), asked about the document as stored at that moment, let it go — the record is the
 *    lock another computer finds, and the trace left if no answer ever comes. The answer then settles it.
 *  • The UPO pass asks about every waiting send of a row and writes the row once — a year is some two hundred
 *    documents in a few dozen rows, and a write per document would race itself. A production UPO marks the
 *    document filed, with the refId as its number.
 *  • The gateway is the e-Deklaracje one of Settings → Administracja, the same switch as the CIT-8's.
 */

import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import DatabaseService from '../database';
import { BramkaNiePrzyjela, FetchLike, pobierzUpo, wyslijDokument } from './eDeklaracjeBramka';
import { IPC_CHANNELS, PodatkiPitUpoResult, PodatkiPitWysylkaWynik } from '../../shared/types';
import {
  BlokadaWysylki,
  EDeklaracjeSrodowisko,
  EDeklaracjeWysylka,
  WysylkaRozstrzygniecie,
  blokadaDoPotwierdzenia,
  blokadyWysylkiProd,
  czekaNaUpo,
  niepewnaOtwarta,
  odstepUpoMs,
  swiezaWysylka,
} from '../../shared/e-deklaracje';
import { PitZlozone, PodatekPit, czescPliku, nazwaOsoby, nazwaPlikuPit, rozbijDokumentId } from '../../shared/podatki-pit';
import { AppError, AppErrorCode, localizeErrorMessage } from '../../shared/app-errors';
import { errorTextIn } from '../errorText';

export interface PitWysylkiDeps {
  getMainWindow: () => BrowserWindow | null;
  database: DatabaseService;
  who: () => Promise<string>;
  /** The gateway is reached through Electron's network stack, so the system proxy applies. */
  fetch: FetchLike;
  rokFolder: (rok: number, prefiks: string) => string | null;
  downloads: string;
  uniquePath: (dir: string, name: string) => string;
}

/** One signed document about to go: where it lives and what its XML says it is. */
export interface DokumentPitDoWysylki {
  id: string;
  wierszId: number;
  /** The person's key; null = the PIT-4R. */
  klucz: string | null;
  nazwa: string;
  /** The purpose the signed XML carries (1 filing, 2 correction) — the document may have been edited since. */
  cel: 1 | 2;
}

export interface PitWysylkiApi {
  /** One signed XML to the gateway, recorded on its document whatever the answer. */
  wyslij: (
    d: DokumentPitDoWysylki,
    xml: string,
    plik: string,
    srodowisko: EDeklaracjeSrodowisko,
    who: string,
    potwierdzona: boolean,
  ) => Promise<PodatkiPitWysylkaWynik>;
  /** Wake the UPO automat (after a send). */
  kopnij: (zaMs?: number) => void;
}

const PREFIKS = 'PIT';
const UPO_PIERWSZY_MS = 30_000;

/** Stored on the document, worded in Polish like the gateway's own answers around it. */
const blad = (error: unknown) => localizeErrorMessage(error instanceof Error ? error.message : String(error), 'pl');

/** A production hold-up in the words of a PIT document (the CIT-8's `opisBlokady` speaks of a return). */
function opisBlokadyPit(b: BlokadaWysylki): string {
  switch (b.kod) {
    case 'niepewna':
      return 'Nie wysłano: wcześniejsza wysyłka tego dokumentu nie dostała odpowiedzi bramki i mogła dotrzeć — sprawdź ją i rozstrzygnij na liście wysyłek.';
    case 'przyjeta':
      return `Nie wysłano: ten dokument ma już UPO (nr ${b.refId}). Zmianę złóż jako korektę.`;
    case 'zlozone':
      return 'Nie wysłano: dokument jest oznaczony jako złożony. Zmianę złóż jako korektę.';
    case 'czeka':
      return `Nie wysłano: poprzednia wysyłka (nr ${b.refId}) czeka jeszcze na UPO — sprawdź UPO.`;
    case 'korektaCzeka':
      return `Nie wysłano korekty: poprzednia wysyłka (nr ${b.refId}) czeka jeszcze na UPO, a ponownej wysyłki nie potwierdzono.`;
    case 'korektaPrzyjeta':
      return `Nie wysłano korekty: wcześniejsza korekta (nr ${b.refId}) już dotarła do bramki, a ponownej wysyłki nie potwierdzono.`;
  }
}

/** A document of a row: the person (or the PIT-4R) and its sends. */
interface DokumentWiersza {
  klucz: string | null;
  nazwa: string;
  plikBaza: string;
  wysylki: EDeklaracjeWysylka[];
}

function dokumentyZWysylkami(w: PodatekPit): DokumentWiersza[] {
  const wsp = w.dane.nazwa || w.nip;
  const out: DokumentWiersza[] = w.dane.osoby.map((o) => ({
    klucz: o.klucz,
    nazwa: `PIT-11 ${wsp} — ${nazwaOsoby(o)}`,
    plikBaza: nazwaPlikuPit(w.rok, 'pit11', wsp, o),
    wysylki: o.wysylki,
  }));
  if (w.dane.pit4r) out.push({ klucz: null, nazwa: `PIT-4R ${wsp}`, plikBaza: nazwaPlikuPit(w.rok, 'pit4r', wsp), wysylki: w.dane.pit4r.wysylki });
  return out;
}

export function registerPitWysylki(deps: PitWysylkiDeps): PitWysylkiApi {
  const { database } = deps;

  /* ------------------------------------ sending ------------------------------------ */

  const wyslij: PitWysylkiApi['wyslij'] = async (d, xml, plik, srodowisko, who, potwierdzona) => {
    const prod = srodowisko === 'prod';
    const at = new Date().toISOString();
    const wynik = (
      refId: string | null,
      status: number | null,
      opis: string,
      extra: Pick<PodatkiPitWysylkaWynik, 'niepewna' | 'niezapisana'> = {},
    ): PodatkiPitWysylkaWynik => ({ id: d.id, nazwa: d.nazwa, srodowisko, refId, status, opis, ...extra });
    const nowa: EDeklaracjeWysylka = {
      at,
      by: who,
      srodowisko,
      plik,
      refId: null,
      status: null,
      opis: 'Wysyłanie…',
      sprawdzono: null,
      upo: null,
      cel: d.cel,
      niepewna: true,
    };

    // Set on each run of the change (it may run again after a lost race), read once it is written.
    const stan: { powod: string | null; brak: boolean } = { powod: null, brak: false };
    let rek: PodatekPit | null;
    try {
      rek = await database.zmienWysylkiPit(d.wierszId, [d.klucz], 'rezerwujWysylkePit', (_k, doc) => {
        stan.powod = null;
        stan.brak = !doc;
        if (!doc) return null;
        if (prod) {
          const blokady = blokadyWysylkiProd({ cel: d.cel, wysylki: doc.wysylki, zlozone: doc.zlozone }).filter(
            (b) => !(potwierdzona && blokadaDoPotwierdzenia(b)),
          );
          if (blokady.length > 0) {
            stan.powod = blokady.map(opisBlokadyPit).join(' ');
            return null;
          }
        }
        return { wysylki: [...doc.wysylki, nowa], zlozone: doc.zlozone };
      });
    } catch (error: unknown) {
      log.error('[PIT] send not reserved, nothing sent:', blad(error));
      return wynik(null, null, `Nie wysłano: nie udało się zapisać wysyłki w bazie (${blad(error)}) — bez zapisu dokument nie idzie do bramki. Spróbuj ponownie.`);
    }
    if (!rek || stan.brak) return wynik(null, null, 'Nie wysłano: tego dokumentu już nie ma — mógł zostać usunięty.');
    if (stan.powod) return wynik(null, null, stan.powod);

    let odp: PodatkiPitWysylkaWynik;
    try {
      const r = await wyslijDokument(deps.fetch, srodowisko, xml);
      odp = wynik(r.refId, r.status, r.opis);
    } catch (error: unknown) {
      odp =
        error instanceof BramkaNiePrzyjela
          ? wynik(null, null, blad(error))
          : wynik(
              null,
              null,
              `${blad(error)} Nie wiadomo, czy bramka przyjęła dokument — ${
                prod ? 'sprawdź to (e-Urząd Skarbowy, urząd) i ' : ''
              }rozstrzygnij tę wysyłkę na liście wysyłek dokumentu, zanim wyślesz go ponownie.`,
              { niepewna: true },
            );
    }

    // The answer onto the record — tried again, since losing it loses the refId (and with it the UPO).
    let zapisBlad: string | null = null;
    for (let proba = 0; proba < 3; proba += 1) {
      try {
        const po = await database.zmienWysylkiPit(d.wierszId, [d.klucz], 'zakonczWysylkePit', (_k, doc) => {
          if (!doc || !doc.wysylki.some((w) => w.at === at)) return null;
          const wysylki = doc.wysylki.map((w) => {
            if (w.at !== at) return w;
            const p: EDeklaracjeWysylka = { ...w, refId: odp.refId, status: odp.status, opis: odp.opis };
            // An answer settles what a person may have guessed meanwhile; still none keeps the send uncertain.
            if (odp.niepewna) return p;
            delete p.niepewna;
            delete p.rozstrzygnieta;
            return p;
          });
          return { wysylki, zlozone: doc.zlozone };
        });
        zapisBlad = po ? null : 'dokumentu już nie ma';
        break;
      } catch (error: unknown) {
        zapisBlad = blad(error);
        await new Promise((r) => setTimeout(r, 1000 * (proba + 1)));
      }
    }
    if (zapisBlad) {
      log.error(`[PIT] answer of send ${at} (${d.id}, ${srodowisko}, refId ${odp.refId ?? '—'}) not recorded:`, zapisBlad);
      const numer = odp.refId ? `numer referencyjny ${odp.refId} — zanotuj go, bez niego nie pobierzesz UPO` : 'bramka nie podała numeru referencyjnego';
      return {
        ...odp,
        niezapisana: true,
        opis:
          `UWAGA: odpowiedzi bramki nie udało się zapisać w dokumencie (${zapisBlad}); ${numer}.` +
          ' Wysyłka zostaje na liście jako niepewna' +
          (prod ? ' i blokuje kolejne, dopóki jej nie rozstrzygniesz.' : '.') +
          ` Odpowiedź bramki: ${odp.opis}`,
      };
    }
    log.info(`[PIT] ${d.id} sent to ${srodowisko}: ${odp.refId ?? '—'} ${odp.status ?? ''} ${odp.opis}`);
    return odp;
  };

  /* ---------------------------------------- UPO ---------------------------------------- */

  /** "<Settings folder>/PIT <rok>/<community>", else "PIT <rok>/<community>" in Downloads — the signed files' layout. */
  const folderWspolnoty = (w: PodatekPit): string => {
    const rok = deps.rokFolder(w.rok, PREFIKS) ?? path.join(deps.downloads, `${PREFIKS} ${w.rok}`);
    const dir = path.join(rok, czescPliku(w.dane.nazwa || w.nip));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  /** Writes a UPO next to the document's files — or finds it there already, same name and same bytes. */
  const zapiszUpoPlik = (w: PodatekPit, plikBaza: string, wysylka: EDeklaracjeWysylka, tresc: string): string => {
    const folder = folderWspolnoty(w);
    const nazwa = `${plikBaza} UPO${wysylka.srodowisko === 'test' ? ' (TEST)' : ''}.xml`;
    const juz = path.join(folder, nazwa);
    if (fs.existsSync(juz) && fs.readFileSync(juz, 'utf8') === tresc) return juz;
    const sciezka = deps.uniquePath(folder, nazwa);
    fs.writeFileSync(sciezka, tresc, 'utf8');
    return sciezka;
  };

  /**
   * Asks the gateway about every send of the given rows it took and has not answered for good — each on the
   * gateway it went to — then writes each row once. A UPO is kept on the send (so any computer can download
   * it) and saved next to the document's files; a production UPO marks the document filed. A 200 without the
   * UPO itself is no receipt: the send keeps its status and is asked about again. One pass at a time.
   */
  let kolejka: Promise<unknown> = Promise.resolve();
  const sprawdzUpo = (
    filtr: (w: PodatekPit) => boolean,
    wysylka: (w: EDeklaracjeWysylka) => boolean = czekaNaUpo,
  ): Promise<{ wynik: PodatkiPitUpoResult; odstep: number | null }> => {
    const praca = kolejka.then(async () => {
      const wiersze = (await database.getPodatkiPit()).filter(filtr);
      const who = await deps.who();
      const wyniki: PodatkiPitUpoResult['wyniki'] = [];
      const bledy: PodatkiPitUpoResult['bledy'] = [];
      const zmienione = new Map<number, PodatekPit>();
      let folder = '';
      for (const w of wiersze) {
        const odpowiedzi: {
          klucz: string | null;
          refId: string;
          status: number | null;
          opis: string;
          sprawdzono: string;
          upo: EDeklaracjeWysylka['upo'];
        }[] = [];
        for (const doc of dokumentyZWysylkami(w)) {
          const id = `${w.id}:${doc.klucz ?? 'r'}`;
          for (const s of doc.wysylki.filter(wysylka)) {
            const refId = s.refId!;
            try {
              const odp = await pobierzUpo(deps.fetch, s.srodowisko, refId);
              const teraz = new Date().toISOString();
              let upoSciezka: string | null = null;
              let upo = s.upo;
              if (odp.status === 200 && odp.upo) {
                // The receipt goes onto the send whatever happens to the file — it can be saved again from there.
                try {
                  upoSciezka = zapiszUpoPlik(w, doc.plikBaza, s, odp.upo);
                  folder = path.dirname(upoSciezka);
                } catch (error: unknown) {
                  log.warn(`[PIT] UPO of ${refId} kept, its file not written:`, blad(error));
                }
                upo = { at: teraz, plik: upoSciezka ? path.basename(upoSciezka) : '', tresc: odp.upo };
              }
              // "Processed" with no UPO in the answer is no receipt: nothing is filed until the UPO itself comes.
              const bezUpo = odp.status === 200 && !odp.upo;
              const status = bezUpo ? s.status : odp.status;
              const opis = bezUpo ? `Bramka podała status 200${odp.opis ? ` (${odp.opis})` : ''}, ale bez UPO — zapytam o nie ponownie.` : odp.opis;
              odpowiedzi.push({ klucz: doc.klucz, refId, status, opis, sprawdzono: teraz, upo });
              wyniki.push({ id, nazwa: doc.nazwa, srodowisko: s.srodowisko, refId, status, opis, upoSciezka, zmiana: status !== s.status });
            } catch (error: unknown) {
              bledy.push({ id, nazwa: doc.nazwa, powod: errorTextIn(database, error) });
            }
          }
        }
        if (odpowiedzi.length === 0) continue;
        try {
          const klucze = [...new Set(odpowiedzi.map((o) => o.klucz))];
          const po = await database.zmienWysylkiPit(w.id, klucze, 'upoPit', (klucz, doc) => {
            const moje = odpowiedzi.filter((o) => o.klucz === klucz);
            if (!doc || moje.length === 0) return null;
            let zlozone: PitZlozone | null = doc.zlozone;
            const wysylki = doc.wysylki.map((s) => {
              const o = moje.find((x) => x.refId === s.refId);
              if (!o) return s;
              if (s.srodowisko === 'prod' && o.status === 200 && o.upo?.tresc && !zlozone) {
                zlozone = { at: o.sprawdzono, by: who, numerRef: o.refId };
              }
              return { ...s, status: o.status, opis: o.opis, sprawdzono: o.sprawdzono, upo: o.upo };
            });
            return { wysylki, zlozone };
          });
          if (po) zmienione.set(po.id, po);
        } catch (error: unknown) {
          for (const o of odpowiedzi) bledy.push({ id: `${w.id}:${o.klucz ?? 'r'}`, nazwa: w.dane.nazwa || w.nip, powod: errorTextIn(database, error) });
        }
      }
      if (wyniki.length + bledy.length > 0) {
        log.info(`[PIT] UPO asked for ${wyniki.length + bledy.length} sends: ${wyniki.filter((x) => x.upoSciezka).length} UPO`);
      }
      const teraz = Date.now();
      const odstepy = wiersze
        .map((w) => zmienione.get(w.id) ?? w)
        .flatMap((w) => dokumentyZWysylkami(w).flatMap((doc) => doc.wysylki))
        .filter((s) => czekaNaUpo(s) && swiezaWysylka(s, teraz))
        .map((s) => odstepUpoMs(s, teraz));
      return {
        wynik: { wyniki, bledy, rekordy: [...zmienione.values()], folder },
        odstep: odstepy.length > 0 ? Math.min(...odstepy) : null,
      };
    });
    kolejka = praca.catch(() => undefined);
    return praca;
  };

  /**
   * The automat: while any PIT send waits for its answer, the gateway is asked in the background at a pace that
   * slows down as the send gets older; it stops by itself once nothing waits. What changed goes to the window.
   */
  let timer: NodeJS.Timeout | null = null;
  let termin = 0;
  let biegnie = false;
  let ponow: number | null = null;
  const automat = (zaMs = UPO_PIERWSZY_MS) => {
    if (biegnie) {
      ponow = Math.min(ponow ?? zaMs, zaMs);
      return;
    }
    const kiedy = Date.now() + zaMs;
    if (timer) {
      if (termin <= kiedy) return;
      clearTimeout(timer);
    }
    termin = kiedy;
    timer = setTimeout(async () => {
      timer = null;
      biegnie = true;
      let dalej: number | null = null;
      try {
        const czeka = (s: EDeklaracjeWysylka) => czekaNaUpo(s) && swiezaWysylka(s);
        const { wynik, odstep } = await sprawdzUpo((w) => dokumentyZWysylkami(w).some((doc) => doc.wysylki.some(czeka)), czeka);
        const zmiany = wynik.wyniki.filter((x) => x.zmiana);
        const okno = deps.getMainWindow();
        if (zmiany.length > 0 && okno && !okno.isDestroyed()) okno.webContents.send('podatki:pit-upo-zmiana', { ...wynik, wyniki: zmiany });
        dalej = odstep;
      } catch (error: unknown) {
        // Not signed in yet, no network to the database: the next kick starts it again.
        log.debug('[PIT] UPO automat paused:', error instanceof Error ? error.message : error);
      }
      biegnie = false;
      const p = ponow;
      ponow = null;
      const nastepny = dalej === null ? p : p === null ? dalej : Math.min(dalej, p);
      if (nastepny !== null) automat(nastepny);
    }, zaMs);
  };
  automat(25_000);

  /** "Sprawdź UPO" by hand: the year's waiting sends, or those of the rows of `ids` (document ids). */
  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_UPO, async (_, rok: number, ids?: string[]): Promise<PodatkiPitUpoResult> => {
    const wiersze = ids && ids.length > 0 ? new Set(ids.map((id) => rozbijDokumentId(id)?.wierszId)) : null;
    const { wynik, odstep } = await sprawdzUpo((w) => w.rok === rok && (!wiersze || wiersze.has(w.id)));
    if (odstep !== null) automat(odstep);
    return wynik;
  });

  /** Finds a document of a row by its id, with its sends; throws when it is gone. */
  const dokumentPoId = async (dokumentId: string): Promise<{ w: PodatekPit; doc: DokumentWiersza }> => {
    const r = rozbijDokumentId(dokumentId);
    const w = r ? await database.getPodatekPit(r.wierszId) : null;
    const doc = w && r ? dokumentyZWysylkami(w).find((x) => x.klucz === r.klucz) : undefined;
    if (!w || !doc) throw new AppError('pitDocumentGone');
    return { w, doc };
  };

  /** "Pobierz UPO": the UPO kept on a send, written next to the document's files (or found there) — its path. */
  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_UPO_POBIERZ, async (_, dokumentId: string, refId: string) => {
    const { w, doc } = await dokumentPoId(dokumentId);
    const s = doc.wysylki.find((x) => x.refId === refId);
    if (!s?.upo?.tresc) throw new AppError('citUpoMissing');
    return { filePath: zapiszUpoPlik(w, doc.plikBaza, s, s.upo.tresc) };
  });

  /**
   * A person settles a send the app could not (found by its `at`): an uncertain one did not reach the gateway
   * (it stops blocking) or did (on production the document is marked filed), or one stuck "in progress" is no
   * longer waited for. The row as it now is.
   */
  ipcMain.handle(IPC_CHANNELS.PODATKI_PIT_WYSYLKA_ROZSTRZYGNIJ, async (_, dokumentId: string, at: string, jak: unknown) => {
    if (jak !== 'nie_dotarla' && jak !== 'dotarla' && jak !== 'porzucona') throw new AppError('citSettlementUnknown');
    const r = rozbijDokumentId(dokumentId);
    if (!r) throw new AppError('pitDocumentGone');
    const who = await deps.who();
    const stamp = { at: new Date().toISOString(), by: who };
    const stan: { odmowa: AppErrorCode | null } = { odmowa: null };
    const po = await database.zmienWysylkiPit(r.wierszId, [r.klucz], 'rozstrzygnijWysylkePit', (_k, doc) => {
      stan.odmowa = null;
      const s = doc?.wysylki.find((x) => x.at === String(at));
      if (!doc || !s) {
        stan.odmowa = 'pitWysylkaGone';
        return null;
      }
      if (!(jak === 'porzucona' ? czekaNaUpo(s) : niepewnaOtwarta(s))) {
        stan.odmowa = 'pitWysylkaSettled';
        return null;
      }
      const rozstrzygnieta: WysylkaRozstrzygniecie = { ...stamp, jak };
      const wysylki = doc.wysylki.map((x) => (x.at === s.at ? { ...x, rozstrzygnieta } : x));
      const zlozone =
        jak === 'dotarla' && s.srodowisko === 'prod' ? (doc.zlozone ?? { ...stamp, numerRef: s.refId ?? '' }) : doc.zlozone;
      return { wysylki, zlozone };
    });
    if (!po) throw new AppError('pitGone');
    if (stan.odmowa) throw new AppError(stan.odmowa);
    log.info(`[PIT] send ${at} of ${dokumentId} settled by hand: ${jak}`);
    return po;
  });

  return { wyslij, kopnij: (zaMs = UPO_PIERWSZY_MS) => automat(zaMs) };
}
