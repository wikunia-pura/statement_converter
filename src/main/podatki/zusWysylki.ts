/**
 * Podatki → ZUS: sending the month's documents straight to ZUS (EWD) and following them to their confirmation.
 *
 *  • "Podpisz i wyślij do ZUS": the ticked documents, each its own KEDU, signed one by one under one card login (one PIN)
 *    and sent after the card is let go — one przesyłka per document, so a confirmation maps onto one document.
 *    What cannot go is named before the PIN.
 *  • Every send is recorded BEFORE the POST, as uncertain: the record is the trace left if no answer ever
 *    comes, and on production the lock (the table's unique index) that keeps another computer from sending the
 *    same document meanwhile. The answer then settles it: ZUS's id of the przesyłka, or an error that certainly
 *    kept it out (no connection, a SOAP fault). Anything else — a timeout, a dropped connection — leaves it
 *    uncertain for a person to settle (eZUS shows what arrived).
 *  • The automat asks ZUS for the confirmations of what it took — in the background, whether or not the tab is
 *    open — and stops once nothing waits. A production confirmation saying the documents were taken marks them
 *    sent, as the "Oznacz jako wysłane" button would.
 *
 * The mirror of the CIT sends to e-Deklaracje (main.ts, `citWyslij`), with ZUS's protocol (zusEwd.ts).
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { BladKarty, zKartaDoPodpisu } from '../podpis/karta';
import { BramkaNiePrzyjela } from './eDeklaracjeBramka';
import { certyfikatZus } from './zusCertyfikaty';
import { ProgramEwd, czytajPotwierdzenie, pobierzIndeks, pobierzPotwierdzenie, sprawdzPolaczenie, wyslijPrzesylke, zbudujPrzesylke } from './zusEwd';
import type { ZusDeps } from './zusHandlers';
import {
  IPC_CHANNELS,
  PodatkiZusPotwierdzeniaResult,
  PodatkiZusWyslijResult,
  PodatkiZusWysylkaWynik,
  PodpisWybor,
} from '../../shared/types';
import { PodatekZusPlatnik, PodatekZusRozliczenie, ZusProblem, ZusZnak, maBladZus, rozbijIdZus } from '../../shared/podatki-zus';
import {
  ZusSrodowisko,
  ZusWysylka,
  blokujeDokument,
  czekaNaPotwierdzenie,
  kluczWysylki,
  niepewnaOtwarta,
  normalizeZusSrodowisko,
  odstepMs,
  swiezaWysylka,
} from '../../shared/zus-ewd';
import { AppError, hasAppErrorCode, localizeErrorMessage } from '../../shared/app-errors';
import { errorTextIn } from '../errorText';
import { czescPliku } from '../../shared/podatki-pit';

/** One document as the send needs it — what `dokumenty` of zusHandlers.ts resolves an id to. */
export interface DokumentDoWysylki {
  id: string;
  platnik: PodatekZusPlatnik;
  rozliczenie: PodatekZusRozliczenie | null;
  nazwa: string;
  /** The file name without extension. */
  plik: string;
  problemy: ZusProblem[];
  /** The whole KEDU file of this one document, as text. */
  kedu: () => string;
  /** Whether it is marked sent already (the set's mark, or the title's / family member's). */
  wyslane: boolean;
}

export interface ZusWysylkiDeps extends ZusDeps {
  program: ProgramEwd;
  /** The documents behind ticked ids; `brak` = ids that no longer resolve. */
  dokumenty: (platnicy: PodatekZusPlatnik[], rozliczenia: PodatekZusRozliczenie[], ids: string[]) => { lista: DokumentDoWysylki[]; brak: string[] };
  /** "<Settings folder>/ZUS <year>/<month>", else "ZUS <month>" in Downloads — made if missing. */
  folderMiesiaca: (okres: string) => string;
  /**
   * Mark a document sent (the "Oznacz jako wysłane" path), as `by` at `at` — a set by the identifier that went,
   * so a late confirmation of 01 never marks a correction 02 made meanwhile.
   */
  oznaczWyslane: (dokument: string, identyfikator: number | null, znak: ZusZnak) => Promise<void>;
}

/** Stored on the send, worded in Polish like ZUS's own answers around it. */
const blad = (error: unknown) => localizeErrorMessage(error instanceof Error ? error.message : String(error), 'pl');

const PIERWSZY_MS = 60_000;

/** What zusHandlers.ts calls back: the ZUS list was read (the window is on the tab). */
export interface ZusWysylkiApi {
  poOdczycie: (wysylki: ZusWysylka[]) => void;
}

export function registerZusWysylki(deps: ZusWysylkiDeps): ZusWysylkiApi {
  const { database, program } = deps;
  const naOkno = (kanal: string, dane: unknown) => {
    const okno = deps.getMainWindow();
    if (okno && !okno.isDestroyed()) okno.webContents.send(kanal, dane);
  };

  ipcMain.handle(IPC_CHANNELS.SET_ZUS_SRODOWISKO, async (_, srodowisko: unknown) => {
    const wybrane = normalizeZusSrodowisko(srodowisko);
    database.setSetting('zusSrodowisko', wybrane);
    log.info(`[ZUS] EWD service switched to ${wybrane}`);
    return wybrane;
  });

  /** "Sprawdź połączenie": ZUS's echo on the service of the switch — nothing is sent but a few bytes. */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_POLACZENIE, async () => {
    const srodowisko = database.getZusSrodowisko();
    await sprawdzPolaczenie(deps.fetch, srodowisko);
    return srodowisko;
  });

  /* ------------------------------------ sending ------------------------------------ */

  /**
   * One signed document to ZUS, recorded whatever the answer (see the file's comment). The KEDU that went is
   * written next to the month's files first — the trace of what was signed, and the fallback for ePłatnik.
   */
  const wyslij = async (
    d: DokumentDoWysylki,
    okres: string,
    srodowisko: ZusSrodowisko,
    przesylka: Buffer,
    plik: string,
    podpisal: string,
    who: string,
  ): Promise<PodatkiZusWysylkaWynik> => {
    const prod = srodowisko === 'prod';
    const identyfikator = d.rozliczenie?.identyfikator ?? null;
    const wynik = (
      wysylkaId: number | null,
      idPrzesylki: string | null,
      opis: string,
      extra: Pick<PodatkiZusWysylkaWynik, 'niepewna' | 'niezapisana'> = {},
    ): PodatkiZusWysylkaWynik => ({ id: d.id, nazwa: d.nazwa, srodowisko, wysylkaId, idPrzesylki, opis, ...extra });

    let zapisana: ZusWysylka | null;
    try {
      zapisana = await database.dodajZusWysylke({
        nip: d.platnik.nip,
        okres: d.rozliczenie?.okres ?? okres,
        dokument: d.id,
        identyfikator,
        nazwa: d.nazwa,
        srodowisko,
        at: new Date().toISOString(),
        by: who,
        plik,
        podpisal,
        idPrzesylki: null,
        opis: 'Wysyłanie…',
        sprawdzono: null,
        potwierdzenie: null,
        niepewna: true,
        rozstrzygnieta: null,
      });
    } catch (error: unknown) {
      log.error('[ZUS] send not recorded, nothing sent:', blad(error));
      return wynik(null, null, `Nie wysłano: nie udało się zapisać wysyłki w bazie (${blad(error)}) — bez zapisu dokument nie idzie do ZUS. Spróbuj ponownie.`);
    }
    if (!zapisana) {
      return wynik(
        null,
        null,
        'Nie wysłano: inna wysyłka tego dokumentu do ZUS nie ma jeszcze odpowiedzi albo potwierdzenia (może z innego komputera) — sprawdź ją na liście.',
      );
    }

    let idPrzesylki: string | null = null;
    let opis: string;
    let niepewna = false;
    try {
      const r = await wyslijPrzesylke(deps.fetch, srodowisko, program, przesylka);
      idPrzesylki = r.id;
      opis = r.skrotZgodny ? `ZUS przyjął przesyłkę (nr ${r.id}) — czeka na potwierdzenie.` : blad(new AppError('ewdDigestMismatch', { id: r.id }));
    } catch (error: unknown) {
      if (error instanceof BramkaNiePrzyjela) opis = blad(error);
      else {
        niepewna = true;
        opis =
          `${blad(error)} Nie wiadomo, czy ZUS przyjął przesyłkę — ` +
          `${prod ? 'sprawdź to w eZUS (dokumenty płatnika) i ' : ''}rozstrzygnij tę wysyłkę na liście, zanim wyślesz ten dokument ponownie.`;
      }
    }

    // The answer onto the record — tried again, since losing it loses ZUS's id (and with it the confirmation).
    let zapisBlad: string | null = null;
    for (let proba = 0; proba < 3; proba += 1) {
      try {
        const po = await database.zmienZusWysylke(zapisana.id, 'zakonczZusWysylke', (w) => ({ ...w, idPrzesylki, opis, niepewna }));
        zapisBlad = po ? null : 'wysyłki już nie ma';
        break;
      } catch (error: unknown) {
        zapisBlad = blad(error);
        await new Promise((r) => setTimeout(r, 1000 * (proba + 1)));
      }
    }
    if (zapisBlad) {
      log.error(`[ZUS] answer of send ${zapisana.id} (${d.id}, ${srodowisko}, przesyłka ${idPrzesylki ?? '—'}) not recorded:`, zapisBlad);
      const numer = idPrzesylki ? `numer przesyłki ${idPrzesylki} — zanotuj go, bez niego nie pobierzesz potwierdzenia` : 'ZUS nie podał numeru przesyłki';
      return wynik(
        zapisana.id,
        idPrzesylki,
        `UWAGA: odpowiedzi ZUS nie udało się zapisać (${zapisBlad}); ${numer}. Wysyłka zostaje na liście jako niepewna. Odpowiedź ZUS: ${opis}`,
        { niepewna: true, niezapisana: true },
      );
    }
    log.info(`[ZUS] ${d.id} sent to ${srodowisko}: ${idPrzesylki ?? '—'} ${opis}`);
    return wynik(zapisana.id, idPrzesylki, opis, niepewna ? { niepewna: true } : {});
  };

  /** "Przerwij" of a run: it stops after the document in hand. */
  let przerwane = false;
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_WYSLIJ_PRZERWIJ, () => {
    przerwane = true;
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.PODATKI_ZUS_WYSLIJ,
    async (event, okres: string, ids: string[], wybor: PodpisWybor): Promise<PodatkiZusWyslijResult> => {
      przerwane = false;
      const srodowisko = database.getZusSrodowisko();
      const prod = srodowisko === 'prod';
      // Before the PIN: an expired ZUS certificate must not cost a signature.
      const certZus = certyfikatZus(srodowisko);
      const [platnicy, rozliczenia, wysylki] = await Promise.all([
        database.getPodatkiZus(),
        database.getPodatkiZusRozliczenia(),
        database.getZusWysylki(),
      ]);
      const { lista, brak } = deps.dokumenty(platnicy, rozliczenia, ids);
      const gone = errorTextIn(database, new AppError('zusDocumentGone'));
      const pominiete: PodatkiZusWyslijResult['pominiete'] = brak.map((id) => ({ id, nazwa: id, powod: gone }));
      const gotowe: { d: DokumentDoWysylki; kedu: string }[] = [];
      for (const d of lista) {
        const klucz = kluczWysylki(d.id, d.rozliczenie?.identyfikator ?? null);
        const trwa = wysylki.find((w) => blokujeDokument(w) && kluczWysylki(w.dokument, w.identyfikator) === klucz);
        let powod: string | null = null;
        if (maBladZus(d.problemy)) {
          powod = d.problemy
            .filter((p) => p.poziom === 'blad')
            .map((p) => p.tekst)
            .join('\n');
        } else if (prod && d.wyslane) {
          powod = 'Ten dokument jest oznaczony jako wysłany. Żeby wysłać go jeszcze raz, najpierw zdejmij oznaczenie (zmiana w rozliczeniu to korekta).';
        } else if (trwa) {
          powod = niepewnaOtwarta(trwa)
            ? 'Wcześniejsza wysyłka tego dokumentu nie dostała odpowiedzi ZUS i mogła dotrzeć — sprawdź ją w eZUS i rozstrzygnij na liście wysyłek.'
            : `Wcześniejsza wysyłka tego dokumentu (nr ${trwa.idPrzesylki ?? '—'}) czeka jeszcze na potwierdzenie ZUS.`;
        }
        if (powod) {
          pominiete.push({ id: d.id, nazwa: d.nazwa, powod });
          continue;
        }
        try {
          gotowe.push({ d, kedu: d.kedu() });
        } catch (error: unknown) {
          pominiete.push({ id: d.id, nazwa: d.nazwa, powod: errorTextIn(database, error) });
        }
      }
      if (gotowe.length === 0) return { folder: '', podpis: null, wysylki: [], pominiete, przerwano: null, niepodpisane: [] };

      // Before the PIN: a missing folder must not cost a signature.
      const folder = deps.folderMiesiaca(okres);
      const who = await deps.who();
      const postep = (zrobione: number, teraz: string) => {
        if (!event.sender.isDestroyed()) event.sender.send('podatki:zus-postep', { zrobione, wszystkie: gotowe.length, nazwa: teraz });
      };
      const podpisane: { d: DokumentDoWysylki; kedu: string; przesylka: Buffer }[] = [];
      let przetworzone = 0;
      let przerwano: string | null = null;
      let slad: PodatkiZusWyslijResult['podpis'] = null;

      await zKartaDoPodpisu(database.getSettings().podpisBiblioteka ?? '', wybor, async (sesja) => {
        slad = { podmiot: sesja.cert.podmiot, wystawca: sesja.cert.wystawca, numerSeryjny: sesja.cert.numerSeryjny };
        for (const g of gotowe) {
          if (przerwane) {
            przerwano = errorTextIn(database, new AppError('podpisStopped'));
            break;
          }
          postep(przetworzone, g.d.nazwa);
          try {
            podpisane.push({ ...g, przesylka: await zbudujPrzesylke(Buffer.from(g.kedu, 'utf8'), sesja, certZus) });
          } catch (error: unknown) {
            if (error instanceof BladKarty) {
              // Nothing signed yet: reject, so the window asks for the PIN again.
              if (podpisane.length === 0) throw error;
              przerwano = errorTextIn(database, error);
              break;
            }
            pominiete.push({ id: g.d.id, nazwa: g.d.nazwa, powod: errorTextIn(database, error) });
          }
          przetworzone += 1;
        }
        postep(przetworzone, '');
      });

      // The card is let go: now the network, one document at a time.
      const wyniki: PodatkiZusWysylkaWynik[] = [];
      const podpisal = (slad as PodatkiZusWyslijResult['podpis'])?.podmiot ?? '';
      for (const [i, g] of podpisane.entries()) {
        if (przerwane) {
          wyniki.push({ id: g.d.id, nazwa: g.d.nazwa, srodowisko, wysylkaId: null, idPrzesylki: null, opis: 'Nie wysłano: przerwane na Twoje polecenie.' });
          continue;
        }
        postep(i, `${g.d.nazwa} — ZUS`);
        let plik: string;
        try {
          fs.mkdirSync(folder, { recursive: true });
          const sciezka = deps.uniquePath(folder, `${czescPliku(g.d.plik).slice(0, 150)}${prod ? '' : ' (TEST)'}.xml`);
          fs.writeFileSync(sciezka, g.kedu, 'utf8');
          plik = path.basename(sciezka);
        } catch (error: unknown) {
          wyniki.push({ id: g.d.id, nazwa: g.d.nazwa, srodowisko, wysylkaId: null, idPrzesylki: null, opis: `Nie wysłano: nie udało się zapisać pliku KEDU (${blad(error)}).` });
          continue;
        }
        // The service the run started on: the przesyłka is encrypted to its certificate, whatever the switch says now.
        wyniki.push(await wyslij(g.d, okres, srodowisko, g.przesylka, plik, podpisal, who));
      }
      postep(podpisane.length, '');
      log.info(`[ZUS] ${wyniki.filter((w) => w.idPrzesylki).length}/${gotowe.length} documents of ${okres} sent (${srodowisko})`);
      if (wyniki.some((w) => w.idPrzesylki)) automat(PIERWSZY_MS);
      return {
        folder: wyniki.some((w) => w.wysylkaId !== null) ? folder : '',
        podpis: slad,
        wysylki: wyniki,
        pominiete,
        przerwano,
        // The run stopped at `przetworzone`: that one and the rest are left.
        niepodpisane: gotowe.slice(przetworzone).map((g) => ({ id: g.d.id, nazwa: g.d.nazwa })),
      };
    },
  );

  /* ---------------------------------- confirmations ---------------------------------- */

  /** The confirmation file of a send: "<the KEDU's name> - potwierdzenie ZUS.asics" in the month's folder. */
  const zapiszPotwierdzenie = (w: ZusWysylka, kontener: Buffer): string => {
    const folder = deps.folderMiesiaca(w.okres);
    fs.mkdirSync(folder, { recursive: true });
    const baza = (w.plik ? w.plik.replace(/\.xml$/i, '') : czescPliku(w.nazwa)).slice(0, 150);
    const nazwa = `${baza} - potwierdzenie ZUS.asics`;
    const juz = path.join(folder, nazwa);
    if (fs.existsSync(juz) && fs.readFileSync(juz).equals(kontener)) return juz;
    const sciezka = deps.uniquePath(folder, nazwa);
    fs.writeFileSync(sciezka, kontener);
    return sciezka;
  };

  /** A production send ZUS took (or a person said it did): its document marked sent, by whoever sent it. */
  const oznacz = async (w: ZusWysylka, at: string) => {
    if (w.srodowisko !== 'prod' || !rozbijIdZus(w.dokument)) return;
    try {
      await deps.oznaczWyslane(w.dokument, w.identyfikator, { at, by: w.by });
    } catch (error: unknown) {
      log.warn(`[ZUS] send ${w.id} confirmed, but its document not marked sent:`, blad(error));
    }
  };

  /**
   * Asks ZUS about every send of `filtr` still waiting for its confirmation, each on the service it went to.
   * A confirmation is read, kept on the send (XML and ZUS's container) and saved next to the month's files. One
   * pass at a time: the automat and the button share this queue. `odstep`: when to look again (null = nothing
   * waits any more).
   */
  let kolejka: Promise<unknown> = Promise.resolve();
  const sprawdz = (filtr: (w: ZusWysylka) => boolean): Promise<{ wynik: PodatkiZusPotwierdzeniaResult; odstep: number | null }> => {
    const praca = kolejka.then(async () => {
      const wszystkie = await database.getZusWysylki();
      const wyniki: PodatkiZusPotwierdzeniaResult['wyniki'] = [];
      const bledy: PodatkiZusPotwierdzeniaResult['bledy'] = [];
      const zmienione = new Map<number, ZusWysylka>();
      let folder = '';
      for (const w of wszystkie.filter((x) => czekaNaPotwierdzenie(x) && filtr(x))) {
        try {
          const teraz = new Date().toISOString();
          const indeks = await pobierzIndeks(deps.fetch, w.srodowisko, program, w.idPrzesylki!);
          if (indeks.length === 0) {
            const po = await database.zmienZusWysylke(w.id, 'sprawdzZusWysylke', (s) => (czekaNaPotwierdzenie(s) ? { ...s, sprawdzono: teraz } : null));
            if (po) zmienione.set(po.id, po);
            wyniki.push({ wysylkaId: w.id, nazwa: w.nazwa, srodowisko: w.srodowisko, etap: 'czeka', opis: w.opis, plik: null, zmiana: false });
            continue;
          }
          const wpis = [...indeks].sort((a, b) => b.dataWpisu.localeCompare(a.dataWpisu))[0];
          const kontener = await pobierzPotwierdzenie(deps.fetch, w.srodowisko, program, wpis.identyfikator);
          const c = czytajPotwierdzenie(kontener, wpis.identyfikator);
          // The receipt goes onto the send whatever happens to the file — it can be saved again from there.
          let sciezka: string | null = null;
          try {
            sciezka = zapiszPotwierdzenie(w, kontener);
            folder = path.dirname(sciezka);
          } catch (error: unknown) {
            log.warn(`[ZUS] confirmation of send ${w.id} kept, its file not written:`, blad(error));
          }
          const bledyTekst = c.bledy.map((b) => [b.rodzaj, b.opis].filter(Boolean).join(': ')).join('; ');
          const opis = c.przyjeta
            ? `ZUS przyjął dokumenty${c.status ? ` (${c.status})` : ''}.`
            : `ZUS nie przyjął dokumentów${c.status ? ` (${c.status})` : ''}${bledyTekst ? `: ${bledyTekst}` : '.'}`;
          const { idPrzesylki: _id, ...pola } = c;
          void _id;
          const po = await database.zmienZusWysylke(w.id, 'potwierdzenieZusWysylki', (s) =>
            s.potwierdzenie
              ? null
              : {
                  ...s,
                  sprawdzono: teraz,
                  opis,
                  potwierdzenie: { ...pola, at: teraz, plik: sciezka ? path.basename(sciezka) : '', kontener: kontener.toString('base64') },
                },
          );
          if (po) {
            zmienione.set(po.id, po);
            if (c.przyjeta) await oznacz(po, teraz);
          }
          wyniki.push({
            wysylkaId: w.id,
            nazwa: w.nazwa,
            srodowisko: w.srodowisko,
            etap: c.przyjeta ? 'przyjeta' : 'odrzucona',
            opis,
            plik: sciezka,
            zmiana: true,
          });
        } catch (error: unknown) {
          bledy.push({ wysylkaId: w.id, nazwa: w.nazwa, powod: errorTextIn(database, error) });
          // A confirmation that came but cannot be read would keep the badge at "waiting" with no clue why: say
          // it on the send. A network failure is not written — the next pass simply asks again.
          if (hasAppErrorCode(error, 'ewdConfirmationUnreadable') || hasAppErrorCode(error, 'ewdDigestMismatch')) {
            const teraz = new Date().toISOString();
            const opis = `ZUS ma potwierdzenie, ale nie udało się go odczytać: ${blad(error)}`;
            const po = await database
              .zmienZusWysylke(w.id, 'sprawdzZusWysylke', (s) => (czekaNaPotwierdzenie(s) ? { ...s, sprawdzono: teraz, opis } : null))
              .catch(() => null);
            if (po) zmienione.set(po.id, po);
          }
        }
      }
      if (wyniki.length + bledy.length > 0) {
        log.info(`[ZUS] confirmations asked for ${wyniki.length + bledy.length} sends: ${wyniki.filter((x) => x.zmiana).length} came`);
      }
      const teraz = Date.now();
      const czekajace = wszystkie
        .map((x) => zmienione.get(x.id) ?? x)
        .filter((x) => czekaNaPotwierdzenie(x) && swiezaWysylka(x, teraz));
      return {
        wynik: { wyniki, bledy, folder, wysylki: [...zmienione.values()] },
        odstep: czekajace.length > 0 ? Math.min(...czekajace.map((x) => odstepMs(x, teraz))) : null,
      };
    });
    kolejka = praca.catch(() => undefined);
    return praca;
  };

  /**
   * The automat: while a send waits for its confirmation, ZUS is asked — at a pace that slows down as the send
   * gets older — and it stops by itself once nothing waits. Kicked at start, after a send, after "Sprawdź
   * potwierdzenia" and whenever the ZUS list is read. What changed is pushed to the window.
   */
  let timer: NodeJS.Timeout | null = null;
  let termin = 0;
  let biegnie = false;
  let ponow: number | null = null;
  const automat = (zaMs = PIERWSZY_MS) => {
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
        const { wynik, odstep } = await sprawdz((w) => swiezaWysylka(w));
        const zmiany = wynik.wyniki.filter((w) => w.zmiana);
        if (zmiany.length > 0) naOkno('podatki:zus-potwierdzenie', { ...wynik, wyniki: zmiany });
        dalej = odstep;
      } catch (error: unknown) {
        // Not signed in yet, no network to the database: the next kick starts it again.
        log.debug('[ZUS] confirmation automat paused:', error instanceof Error ? error.message : error);
      }
      biegnie = false;
      const p = ponow;
      ponow = null;
      const nastepny = dalej === null ? p : p === null ? dalej : Math.min(dalej, p);
      if (nastepny !== null) automat(nastepny);
    }, zaMs);
  };
  automat(20_000);

  /** "Sprawdź potwierdzenia" by hand: the given sends, or every waiting one — then the automat carries on. */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_POTWIERDZENIA, async (_, wysylkaIds?: number[]): Promise<PodatkiZusPotwierdzeniaResult> => {
    const tylko = wysylkaIds && wysylkaIds.length > 0 ? new Set(wysylkaIds) : null;
    const { wynik, odstep } = await sprawdz((w) => !tylko || tylko.has(w.id));
    if (odstep !== null) automat(odstep);
    return wynik;
  });

  /** "Pobierz potwierdzenie": the container kept on the send, written into the month's folder (or found there). */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_POTWIERDZENIE_POBIERZ, async (_, wysylkaId: number) => {
    const w = (await database.getZusWysylki()).find((x) => x.id === wysylkaId);
    if (!w) throw new AppError('zusWysylkaGone');
    if (!w.potwierdzenie?.kontener) throw new AppError('zusPotwierdzenieMissing');
    return { filePath: zapiszPotwierdzenie(w, Buffer.from(w.potwierdzenie.kontener, 'base64')) };
  });

  /**
   * A person settles a send the app could not: an uncertain one did not reach ZUS (it stops holding the
   * document back) or did (on production the document is marked sent), or one waiting for its confirmation is
   * no longer waited for. The send as it now is.
   */
  ipcMain.handle(IPC_CHANNELS.PODATKI_ZUS_WYSYLKA_ROZSTRZYGNIJ, async (_, wysylkaId: number, jak: unknown) => {
    if (jak !== 'nie_dotarla' && jak !== 'dotarla' && jak !== 'porzucona') throw new AppError('zusSettlementUnknown');
    const who = await deps.who();
    const at = new Date().toISOString();
    let odmowa = false;
    const po = await database.zmienZusWysylke(wysylkaId, 'rozstrzygnijZusWysylke', (w) => {
      const wolno = jak === 'porzucona' ? czekaNaPotwierdzenie(w) : niepewnaOtwarta(w);
      odmowa = !wolno;
      return wolno ? { ...w, rozstrzygnieta: { at, by: who, jak } } : null;
    });
    if (!po) throw new AppError('zusWysylkaGone');
    if (odmowa) throw new AppError('zusWysylkaSettled');
    if (jak === 'dotarla') await oznacz(po, at);
    log.info(`[ZUS] send ${wysylkaId} settled by hand: ${jak}`);
    return po;
  });

  return {
    // The list read kicks the automat when anything waits — the window open on ZUS keeps it going.
    poOdczycie: (wysylki) => {
      if (wysylki.some((w) => czekaNaPotwierdzenie(w) && swiezaWysylka(w))) automat(PIERWSZY_MS);
    },
  };
}
