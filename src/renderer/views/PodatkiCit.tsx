import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  PodatekCit,
  PodatekCitDane,
  PodatkiCitUstawienia,
  PodatkiPodpisPostep,
  PodatkiPodpisWieleResult,
  PodpisWybor,
  SprawozdanieZapisane,
  ZebraniaWspolnota,
} from '../../shared/types';
import { formatZl, ulicaZNumerem, uwagiPodpisu } from '../../shared/podatki';
import {
  ObliczenieCIT8,
  ProblemCit8,
  daneCitNaKolejnyRok,
  obliczCIT8,
  okresKlucz,
  okresPelny,
  problemyCIT8Xml,
  pozycjeZeSprawozdania,
  pusteDaneCit,
  sprawozdanieDlaRoku,
  stanCit,
  StanCit,
  terminCit,
} from '../../shared/podatki-cit';
import { formatData, formatKwota, okresLabel } from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { czekaNaUpo, ostatniaWysylka } from '../../shared/e-deklaracje';
import Tip from '../components/Tip';
import { translations, Language } from '../translations';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import { FormSection } from '../components/FormSection';
import { PodpisKartaModal, PodpiszTezPdf, bezPrefiksu } from '../components/PodpisKarta';
import { useNavItem } from '../navigation';
import { useRequestSeq } from '../hooks/useRequestSeq';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import Select from '../components/Select';
import {
  DomSlot,
  GotowoscPodpisuWiele,
  PodsumowaniePodpisow,
  baseName,
  etapWysylkiText,
  kwotaWBoksie,
} from './PodatkiNieruchomosci';
import {
  problemText,
  zlozoneLabels,
  zAdresu,
  pobierzMigawke,
  pelnyRok,
} from '../components/podatki-cit/citShared';
import { WyslijOpcja, etapWysylki, sprawdzUpo, potwierdzKorekty } from '../components/podatki-cit/Wysylki';
import { SlownikModal } from '../components/podatki-cit/SlownikModal';
import { SprawozdaniePodgladModal } from '../components/podatki-cit/Sekcje';
import { ZeznanieScreen } from '../components/podatki-cit/ZeznanieScreen';

/** The list's status filter; the segments overlap, like the Pulpit's tiles. */
type Filtr = 'all' | 'errors' | 'ready' | 'downloaded' | 'filed' | 'none' | 'nostmt';
const FILTRY: Filtr[] = ['all', 'errors', 'ready', 'downloaded', 'filed', 'none', 'nostmt'];

/**
 * One line of the year's list: a community of Adresy with its return — or
 * without, which is a placeholder that opens an empty return — or a return
 * whose community is gone from Adresy (renamed, removed), shown flagged.
 */
interface Wiersz {
  adresNazwa: string;
  adres: Adres | null;
  rek: PodatekCit | null;
}

/** A CIT-8 is filed for a finished year, so the year the office works on is the one behind us. */
/** The tax year in progress — the one whose statement and return the office is working on now. */
const biezacyRok = () => new Date().getFullYear();

/* ================================== The tab ================================== */

/** The tab opens on the tax year in progress, whatever older years hold. */
const domyslnyRok = () => biezacyRok();

/**
 * Podatki → CIT: every community of Adresy for the chosen year, each opening
 * its CIT-8 — a community without one yet opens an empty return, created on
 * its first save. The list opens on the current year, whatever older years hold.
 */
const PodatkiCit: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [lista, setLista] = useState<PodatekCit[]>([]);
  const [ustawienia, setUstawienia] = useState<PodatkiCitUstawienia>({ slownik: [] });
  const [adresy, setAdresy] = useState<Adres[]>([]);
  /** What Zebrania remembers per community — here its vDom number, which finds its statements. */
  const [wspolnoty, setWspolnoty] = useState<ZebraniaWspolnota[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<null | 'carry' | 'all' | 'row' | 'stmt' | 'upo'>(null);
  /** Progress of "Podepnij sprawozdania z biblioteki". */
  const [postepStmt, setPostepStmt] = useState<{ done: number; total: number } | null>(null);
  /** Who is signed in, and the statements library — loaded when a bulk action first needs it. */
  const [kto, setKto] = useState('');
  const bibliotekaRef = useRef<SprawozdanieZapisane[] | null>(null);
  const [rokWybrany, setRokWybrany] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filtr, setFiltr] = useState<Filtr>('all');
  const [slownikOpen, setSlownikOpen] = useState(false);
  /** The return whose statement is open in the preview window. */
  const [podglad, setPodglad] = useState<PodatekCit | null>(null);
  /**
   * The return open on its own screen — a step of the app's history, so Back
   * returns here. A saved return is its id; a community without one is `nowy:`
   * and its name, until the first save gives it an id.
   */
  const navItem = useNavItem();
  const detail: { id: number } | { nowa: string } | null =
    navItem.item && /^\d+$/.test(navItem.item)
      ? { id: Number(navItem.item) }
      : navItem.item?.startsWith('nowy:')
        ? { nowa: navItem.item.slice(5) }
        : null;
  const openDetail = (w: Wiersz) =>
    w.rek ? navItem.open(String(w.rek.id), w.adresNazwa) : navItem.open(`nowy:${w.adresNazwa}`, w.adresNazwa);
  /** Ticked returns, by id — what the batch bar acts on. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** "Podpisz zaznaczone": the ids being signed, fixed when the window opens; null = closed. */
  const [podpisWiele, setPodpisWiele] = useState<number[] | null>(null);
  const [pdfPodpisany, setPdfPodpisany] = useState(false);
  const [wyslij, setWyslij] = useState(false);
  const [postepPodpisu, setPostepPodpisu] = useState<PodatkiPodpisPostep | null>(null);
  /** The last run's outcome, shown until closed. */
  const [podsumowanie, setPodsumowanie] = useState<{ rok: number; wynik: PodatkiPodpisWieleResult } | null>(null);
  useEffect(() => window.electronAPI.onPodatkiCitPodpisPostep(setPostepPodpisu), []);
  // The 30-second automat found an answer: reload, and say what came — a UPO with its file one click away.
  useEffect(
    () =>
      window.electronAPI.onCitUpo((wynik) => {
        void load(true);
        for (const w of wynik.wyniki) {
          const env = w.srodowisko === 'prod' ? t.citEnvProd : t.citEnvTest;
          const tekst = t.citUpoAutoNotice
            .replace('{nazwa}', w.nazwa)
            .replace('{env}', env)
            .replace('{etap}', etapWysylkiText(t, w.status, w.refId));
          if (w.upoSciezka) notify.success(tekst, { file: w.upoSciezka });
          else if (w.status !== null && w.status >= 400) notify.warning(`${tekst} ${w.opis}`);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  /** Returns whose "filed" tick is being saved. */
  const [zlozoneSaving, setZlozoneSaving] = useState<Set<number>>(new Set());
  /** The row ticked last — the start of a Shift+click range. */
  const lastTickedRef = useRef<number | null>(null);

  /** Overlapping reloads (a save, the UPO automat): only the newest answer lands. */
  const loadSeq = useRequestSeq();
  const load = async (silent = false) => {
    const ticket = loadSeq.next();
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      bibliotekaRef.current = null;
      const [rows, settings, addresses, communities, session] = await Promise.all([
        window.electronAPI.getPodatkiCit(),
        window.electronAPI.getPodatkiCitUstawienia(),
        window.electronAPI.getAdresy(),
        window.electronAPI.getZebraniaWspolnoty(),
        window.electronAPI.authGetSession().catch(() => null),
      ]);
      if (!loadSeq.isLatest(ticket)) return;
      setKto(session?.email ?? '');
      setLista(rows);
      setUstawienia(settings);
      setAdresy(addresses);
      setWspolnoty(communities);
    } catch (err: unknown) {
      if (loadSeq.isLatest(ticket)) notify.error(bezPrefiksu(err), t.podLoadError);
    } finally {
      // An older load ending must not end the newer one's loader.
      if (loadSeq.isLatest(ticket)) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slownik = ustawienia.slownik;
  const lataZDanymi = useMemo(() => [...new Set(lista.map((r) => r.rok))], [lista]);
  const rok = rokWybrany ?? domyslnyRok();
  // Years that hold something, the current tax year and the year after the
  // newest — how a new year is started.
  const lata = useMemo(() => {
    const nastepny = lataZDanymi.length > 0 ? Math.max(...lataZDanymi) + 1 : null;
    const wszystkie = [...lataZDanymi, biezacyRok(), rok, ...(nastepny ? [nastepny] : [])];
    return [...new Set<number>(wszystkie)].sort((a, b) => b - a);
  }, [lataZDanymi, rok]);

  const wRoku = useMemo(() => lista.filter((r) => r.rok === rok), [lista, rok]);
  const poprzedni = useMemo(() => lista.filter((r) => r.rok === rok - 1), [lista, rok]);
  const brakujace = useMemo(() => {
    const nazwy = new Set(wRoku.map((r) => r.adresNazwa));
    return poprzedni.filter((r) => !nazwy.has(r.adresNazwa));
  }, [wRoku, poprzedni]);

  /** Every community of Adresy, then the year's returns whose community is not there any more. */
  const wiersze = useMemo(() => {
    const poNazwie = new Map(wRoku.map((r) => [r.adresNazwa, r]));
    const znane = new Set(adresy.map((a) => a.nazwa));
    const out: Wiersz[] = adresy.map((a) => ({ adresNazwa: a.nazwa, adres: a, rek: poNazwie.get(a.nazwa) ?? null }));
    for (const r of wRoku) if (!znane.has(r.adresNazwa)) out.push({ adresNazwa: r.adresNazwa, adres: null, rek: r });
    return out;
  }, [adresy, wRoku]);

  /** Each return's state, figures and what is missing, worked out once per render of the year. */
  const ocena = useMemo(() => {
    const m = new Map<number, { stan: StanCit; problemy: ProblemCit8[]; wynik: ObliczenieCIT8 }>();
    for (const rek of wRoku) {
      // One classification of the statement per return, shared by all three.
      const oceny = pozycjeZeSprawozdania(rek.dane, slownik);
      const problemy = problemyCIT8Xml(rek, slownik, oceny);
      m.set(rek.id, {
        stan: stanCit(rek, slownik, problemy),
        problemy,
        wynik: obliczCIT8(rek.dane, oceny),
      });
    }
    return m;
  }, [wRoku, slownik]);

  const wFiltrze = (w: Wiersz, f: Filtr): boolean => {
    if (f === 'all') return true;
    if (f === 'none') return w.rek === null;
    if (f === 'nostmt') return w.rek !== null && w.rek.dane.sprawozdanie === null;
    const o = w.rek ? ocena.get(w.rek.id) : undefined;
    if (!o) return false;
    switch (f) {
      case 'errors':
        return o.problemy.length > 0;
      case 'ready':
        return o.stan === 'gotowa';
      case 'downloaded':
        return o.stan === 'pobrana';
      case 'filed':
        return o.stan === 'zlozone';
    }
  };

  /** The community's latest return before this year — what a return of this year starts from. */
  const wczesniejsze = (adresNazwa: string): PodatekCit | undefined =>
    lista.filter((r) => r.adresNazwa === adresNazwa && r.rok < rok).sort((a, b) => b.rok - a.rok)[0];

  const liczniki = useMemo(() => {
    const c: Record<Filtr, number> = { all: 0, errors: 0, ready: 0, downloaded: 0, filed: 0, none: 0, nostmt: 0 };
    for (const w of wiersze) for (const f of FILTRY) if (wFiltrze(w, f)) c[f] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiersze, ocena]);

  const visible = useMemo(() => {
    const query = foldText(search.trim());
    const digits = query.replace(/\D/g, '');
    return wiersze
      .filter((w) => wFiltrze(w, filtr))
      .filter(
        (w) =>
          !query ||
          foldText(w.adresNazwa).includes(query) ||
          (w.adres?.alternativeNames ?? []).some((n) => foldText(n).includes(query)) ||
          (!!w.rek &&
            (foldText(w.rek.dane.nazwaPelna).includes(query) ||
              (digits !== '' && w.rek.dane.nip.includes(digits)) ||
              foldText(ulicaZNumerem(w.rek.dane.siedziba)).includes(query))),
      )
      .sort((a, b) => a.adresNazwa.localeCompare(b.adresNazwa, 'pl', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiersze, search, filtr, ocena]);
  /** The returns among the visible rows — a placeholder has nothing to tick. */
  const visibleRek = useMemo(() => visible.flatMap((w) => (w.rek ? [w.rek] : [])), [visible]);

  /* ----------------------------- Ticking rows ----------------------------- */

  // Ticks belong to the year on screen: a tick in another year would be acted
  // on without being seen.
  const zaznaczone = wRoku.filter((r) => selected.has(r.id));
  /** Returns of the year with a send the gateway has not answered for good. */
  const czekajaceUpo = wRoku.filter((r) => r.dane.wysylki.some(czekaNaUpo));
  const zaznaczoneUpo = zaznaczone.filter((r) => r.dane.wysylki.some(czekaNaUpo));
  const doPodpisu = podpisWiele ? wRoku.filter((r) => podpisWiele.includes(r.id)) : [];
  const gotoweDoPodpisu = doPodpisu.filter((r) => (ocena.get(r.id)?.problemy.length ?? 0) === 0);
  const selectedVisible = visibleRek.filter((r) => selected.has(r.id)).length;
  const allVisibleSelected = visibleRek.length > 0 && selectedVisible === visibleRek.length;

  const toggleSelected = (id: number, range = false) => {
    const turnOn = !selected.has(id);
    const from = range && lastTickedRef.current !== null ? visibleRek.findIndex((r) => r.id === lastTickedRef.current) : -1;
    const to = visibleRek.findIndex((r) => r.id === id);
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift+click: every row between the last tick and this one takes this
      // row's new state, as on the Pulpit.
      const ids =
        from >= 0 && to >= 0 ? visibleRek.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.id) : [id];
      for (const k of ids) {
        if (turnOn) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    lastTickedRef.current = id;
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visibleRek) {
        if (allVisibleSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
    lastTickedRef.current = null;
  };

  const zmienRok = (r: number) => {
    setRokWybrany(r);
    setSelected(new Set());
    lastTickedRef.current = null;
  };

  /**
   * Tick (or untick) returns as filed with the tax office. Optimistic, like the
   * Pulpit's tick — it is a statement of the user and should feel instant;
   * a failed write reloads the stored rows. True when it was saved.
   */
  const setZlozone = async (ids: number[], filed: boolean, announce: boolean): Promise<boolean> => {
    if (ids.length === 0) return false;
    const idSet = new Set(ids);
    setZlozoneSaving((prev) => new Set([...prev, ...ids]));
    const stamp = { at: new Date().toISOString(), by: '' };
    setLista((prev) =>
      prev.map((r) =>
        idSet.has(r.id) ? { ...r, dane: { ...r.dane, zlozone: filed ? r.dane.zlozone ?? stamp : null } } : r,
      ),
    );
    try {
      const saved = await window.electronAPI.setPodatkiCitZlozone(ids, filed);
      const byId = new Map(saved.map((r) => [r.id, r]));
      setLista((prev) => prev.map((r) => byId.get(r.id) ?? r));
      if (announce) {
        notify.success((filed ? t.citMarkSuccess : t.citUnmarkSuccess).replace('{count}', String(ids.length)));
      }
      return true;
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citMarkError);
      await load(true);
      return false;
    } finally {
      setZlozoneSaving((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const ileWspolnot = (n: number) => plural(n, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities']);
  const ileWspolnotBiernik = (n: number) =>
    plural(n, language, ['wspólnotę', 'wspólnoty', 'wspólnot'], ['community', 'communities']);
  const ileZeznan = (n: number) => plural(n, language, ['zeznanie', 'zeznania', 'zeznań'], ['return', 'returns']);
  const ileDni = (n: number) => plural(n, language, ['dzień', 'dni', 'dni'], ['day', 'days']);

  const vdomDla = (adresNazwa: string): number | null =>
    wspolnoty.find((w) => w.adresNazwa === adresNazwa)?.vdomNr ?? null;
  const nazwyDla = (w: Wiersz): string[] => [w.adresNazwa, ...(w.adres?.alternativeNames ?? [])];

  /**
   * What a community without a return starts from: its latest earlier return
   * carried over (identification, NIP, office, signer), else a blank one named
   * after the address.
   */
  const szkic = (adresNazwa: string): { dane: PodatekCitDane; zRoku: number | null } => {
    const wczesniej = wczesniejsze(adresNazwa);
    const ident = adresy.find((a) => a.nazwa === adresNazwa)?.identyfikacja;
    if (wczesniej) return { dane: zAdresu(daneCitNaKolejnyRok(wczesniej.dane), ident), zRoku: wczesniej.rok };
    return {
      dane: zAdresu({ ...pusteDaneCit(), nazwaPelna: `Wspólnota Mieszkaniowa ${nazwaNieruchomosci(adresNazwa)}` }, ident),
      zRoku: null,
    };
  };

  /** The community's vDom number, learned from a statement picked by hand — Zebrania reads it too. */
  const zapamietajVdom = async (adresNazwa: string, nr: number) => {
    try {
      await window.electronAPI.setZebraniaWspolnota(adresNazwa, { vdomNr: nr });
      setWspolnoty(await window.electronAPI.getZebraniaWspolnoty());
    } catch {
      // The statement is attached; only the shortcut for next time is missing.
    }
  };

  const carry = async () => {
    setBusy('carry');
    try {
      const n = await window.electronAPI.przeniesCitNaRok(rok - 1, rok);
      notify.success(t.podCarried.replace('{rok}', String(rok)).replace('{n}', ileWspolnotBiernik(n)));
      setRokWybrany(rok);
      await load(true);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podCarryError);
    } finally {
      setBusy(null);
    }
  };

  /** The library, fetched once until the next reload of the list. */
  const biblioteka = async (): Promise<SprawozdanieZapisane[]> =>
    (bibliotekaRef.current ??= await window.electronAPI.getSprawozdaniaLista());

  /** Remember the community's vDom number from a statement found for it — only when none is stored, as the editor does. */
  const zapamietajVdomZ = async (pary: Map<string, number>) => {
    for (const [nazwa, nr] of pary) {
      try {
        await window.electronAPI.setZebraniaWspolnota(nazwa, { vdomNr: nr });
      } catch {
        // The statements are attached; only the shortcut for next time is missing.
      }
    }
    if (pary.size > 0) setWspolnoty(await window.electronAPI.getZebraniaWspolnoty().catch(() => wspolnoty));
  };

  /** A community's return created at once from its latest earlier one — with its year's statement, when the library has it. */
  const utworzZPoprzedniego = async (w: Wiersz) => {
    const wczesniej = wczesniejsze(w.adresNazwa);
    if (!wczesniej) return;
    setBusy('row');
    try {
      let dane = zAdresu(daneCitNaKolejnyRok(wczesniej.dane), w.adres?.identyfikacja);
      const pary = new Map<string, number>();
      try {
        const znaleziono = sprawozdanieDlaRoku(await biblioteka(), vdomDla(w.adresNazwa), nazwyDla(w), rok);
        const wynik = znaleziono ? await pobierzMigawke(znaleziono.id, kto) : null;
        if (wynik) {
          dane = { ...dane, sprawozdanie: wynik.migawka };
          if (vdomDla(w.adresNazwa) === null && wynik.nrWsp !== null) pary.set(w.adresNazwa, wynik.nrWsp);
        }
      } catch {
        // No statement is no reason to refuse the return — it can be attached inside.
      }
      await window.electronAPI.addPodatekCit(w.adresNazwa, rok, dane);
      await zapamietajVdomZ(pary);
      notify.success(t.citRowCarried.replace('{rok}', String(wczesniej.rok)));
      await load(true);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citRowCarryError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Podepnij sprawozdania z biblioteki": every community's full-year statement
   * onto its return — and a return created where there is none yet. Counts
   * first, then a confirmation; bodies are fetched a few at a time and one
   * failure does not stop the rest.
   */
  const podepnijZBiblioteki = async () => {
    setBusy('stmt');
    let lib: SprawozdanieZapisane[];
    try {
      lib = bibliotekaRef.current = await window.electronAPI.getSprawozdaniaLista();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citStmtLoadError);
      setBusy(null);
      return;
    }
    const zadania: { w: Wiersz; sprawozdanieId: number; niepelne: boolean }[] = [];
    const bez: string[] = [];
    for (const w of wiersze) {
      if (w.rek?.dane.sprawozdanie) continue;
      const znaleziono = sprawozdanieDlaRoku(lib, vdomDla(w.adresNazwa), nazwyDla(w), rok);
      if (znaleziono) zadania.push({ w, sprawozdanieId: znaleziono.id, niepelne: !pelnyRok(znaleziono, rok) });
      else bez.push(w.adresNazwa);
    }
    setBusy(null);
    const doPodpiecia = zadania.filter((z) => z.w.rek).length;
    const doUtworzenia = zadania.length - doPodpiecia;
    if (zadania.length === 0) {
      notify.info(t.citStmtBulkNothing.replace('{rok}', String(rok)).replace('{s}', String(bez.length)));
      return;
    }
    const potwierdzone = await notify.confirm(
      t.citStmtBulkConfirm
        .replace('{a}', plural(doPodpiecia, language, ['zeznania', 'zeznań', 'zeznań'], ['return', 'returns']))
        .replace('{c}', String(doUtworzenia))
        .replace('{p}', String(zadania.filter((z) => z.niepelne).length))
        .replace('{s}', String(bez.length))
        .replace('{rok}', String(rok)),
      { confirmLabel: t.citStmtBulk },
    );
    if (!potwierdzone) return;

    setBusy('stmt');
    setPostepStmt({ done: 0, total: zadania.length });
    let podpiete = 0;
    let utworzone = 0;
    const bledy: string[] = [];
    const pary = new Map<string, number>();
    /** Returns that now carry a partial period nobody has accepted yet. */
    const niezaakceptowane: PodatekCit[] = [];
    for (let i = 0; i < zadania.length; i += 5) {
      await Promise.all(
        zadania.slice(i, i + 5).map(async ({ w, sprawozdanieId }) => {
          try {
            const wynik = await pobierzMigawke(sprawozdanieId, kto);
            if (!wynik) throw new Error(t.citStmtGone);
            const zapisane = w.rek
              ? await window.electronAPI.setPodatekCit(w.rek.id, { ...w.rek.dane, sprawozdanie: wynik.migawka })
              : await window.electronAPI.addPodatekCit(w.adresNazwa, rok, {
                  ...szkic(w.adresNazwa).dane,
                  sprawozdanie: wynik.migawka,
                });
            if (w.rek) podpiete += 1;
            else utworzone += 1;
            if (!okresPelny(wynik.migawka.dane, rok) && zapisane.dane.zaakceptowanyOkres !== okresKlucz(wynik.migawka.dane)) {
              niezaakceptowane.push(zapisane);
            }
            if (vdomDla(w.adresNazwa) === null && wynik.nrWsp !== null) pary.set(w.adresNazwa, wynik.nrWsp);
          } catch (err: unknown) {
            bledy.push(`${w.adresNazwa} — ${bezPrefiksu(err)}`);
          } finally {
            setPostepStmt((p) => (p ? { ...p, done: p.done + 1 } : p));
          }
        }),
      );
    }
    await zapamietajVdomZ(pary);
    setPostepStmt(null);
    setBusy(null);
    await load(true);

    const skrot = (lista: string[]) =>
      (lista.length <= 6 ? lista : [...lista.slice(0, 5), t.podSignMore.replace('{n}', String(lista.length - 5))]).join('; ');
    notify.success(
      t.citStmtBulkDone
        .replace('{a}', String(podpiete))
        .replace('{c}', String(utworzone))
        .replace('{s}', String(bez.length)),
    );
    if (bez.length > 0) notify.warning(t.citStmtBulkSkipped.replace('{rok}', String(rok)).replace('{list}', skrot(bez)));
    if (bledy.length > 0) notify.error(t.citStmtBulkFailed.replace('{list}', skrot(bledy)), t.citStmtAttachError);

    // Partial periods print only once accepted — offered here for the whole batch, for testing.
    if (
      niezaakceptowane.length > 0 &&
      (await notify.confirm(t.citStmtAcceptAll.replace('{n}', String(niezaakceptowane.length)), {
        confirmLabel: t.citStmtAccept,
      }))
    ) {
      setBusy('stmt');
      const nieudane: string[] = [];
      for (let i = 0; i < niezaakceptowane.length; i += 5) {
        await Promise.all(
          niezaakceptowane.slice(i, i + 5).map(async (rek) => {
            try {
              await window.electronAPI.setPodatekCit(rek.id, {
                ...rek.dane,
                zaakceptowanyOkres: rek.dane.sprawozdanie ? okresKlucz(rek.dane.sprawozdanie.dane) : null,
              });
            } catch (err: unknown) {
              nieudane.push(`${rek.adresNazwa} — ${bezPrefiksu(err)}`);
            }
          }),
        );
      }
      setBusy(null);
      await load(true);
      if (nieudane.length > 0) notify.error(t.citStmtBulkFailed.replace('{list}', skrot(nieudane)), t.citStmtAttachError);
    }
  };

  /**
   * Signs the ticked returns with one PIN. A rejection (wrong PIN, no card —
   * nothing signed) stays in the signing window; anything else closes it and
   * opens the summary.
   */
  const podpiszWiele = async (wybor: PodpisWybor) => {
    if (!podpisWiele) return;
    setPostepPodpisu(null);
    const potwierdzoneKorekty = await potwierdzKorekty(t, notify, doPodpisu, wyslij);
    const wynik = await window.electronAPI.podpiszPodatkiCit(rok, podpisWiele, wybor, { pdfPodpisany, wyslij, potwierdzoneKorekty });
    setPodpisWiele(null);
    setPostepPodpisu(null);
    setPodsumowanie({ rok, wynik });
    if (wynik.podpisane.length > 0) setSelected(new Set());
    await load(true);
  };

  /** "Sprawdź UPO" for the year's waiting sends, or the ticked returns'. */
  const upo = async (ids?: number[]) => {
    setBusy('upo');
    await sprawdzUpo(t, notify, rok, ids);
    setBusy(null);
    await load(true);
  };

  /** Every return of the year — or only the ticked ones — as XML, PDF or both, each to its own file. */
  const downloadAll = async (ids: number[] | undefined, tryb: 'xml' | 'pdf' | 'oba') => {
    setBusy('all');
    try {
      const { folder, zapisane, pominiete } = await window.electronAPI.zapiszPodatkiCitPliki(rok, ids, tryb);
      const opis = pominiete.map((p) => `${p.nazwa} — ${p.powod}`).join('; ');
      if (zapisane === 0) {
        notify.error(t.podDownloadedNone.replace('{list}', opis), t.podDownloadError);
      } else {
        const msg = t.podDownloadedAll.replace('{n}', ileWspolnotBiernik(zapisane)).replace('{folder}', baseName(folder));
        if (pominiete.length > 0) {
          notify.warning(
            `${msg} ${t.podDownloadedAllSkipped.replace('{n}', ileWspolnotBiernik(pominiete.length)).replace('{list}', opis)}`,
            { file: folder },
          );
        } else {
          notify.success(msg, { file: folder });
        }
      }
      await load(true);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podDownloadError);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  // A return opened from the history that is gone by now shows the list.
  const rekordOtwarty = detail && 'id' in detail ? lista.find((r) => r.id === detail.id) ?? null : null;
  const otwartaNazwa = rekordOtwarty?.adresNazwa ?? (detail && 'nowa' in detail ? detail.nowa : null);
  if (otwartaNazwa !== null) {
    const rekord = rekordOtwarty;
    const adres = adresy.find((a) => a.nazwa === otwartaNazwa) ?? null;
    return (
      <ZeznanieScreen
        key={navItem.item}
        language={language}
        locale={locale}
        rok={rekord?.rok ?? rok}
        adresNazwa={otwartaNazwa}
        adres={adres}
        rekord={rekord}
        szkic={szkic(otwartaNazwa)}
        slownik={slownik}
        vdomNr={vdomDla(otwartaNazwa)}
        kto={kto}
        onVdomNr={(nr) => void zapamietajVdom(otwartaNazwa, nr)}
        onSlownik={setUstawienia}
        onBack={() => navItem.close()}
        onSaved={(saved) => {
          setLista((prev) => {
            const rest = prev.filter((r) => r.id !== saved.id);
            return [...rest, saved];
          });
          // A new one gets its id on save: the same history step, now naming it.
          navItem.replace(String(saved.id), saved.adresNazwa);
        }}
        onDeleted={() => {
          navItem.close();
          void load(true);
        }}
        onDownloaded={() => void load(true)}
        onSetZlozone={(filed) => rekord && void setZlozone([rekord.id], filed, true)}
        zlozoneBusy={!!rekord && zlozoneSaving.has(rekord.id)}
      />
    );
  }

  /** A community of Adresy that has no return this year: its row opens an empty one. */
  const renderBrak = (w: Wiersz) => {
    const wczesniej = wczesniejsze(w.adresNazwa);
    const open = () => openDetail(w);
    return (
      <li key={`brak:${w.adresNazwa}`} className="pod-item">
        <span className="ksieg-row__select" aria-hidden="true" />
        <div className="zeb-row pod-row pod-row--brak">
          <div
            className="pod-row__open"
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }}
          >
            <div className="zeb-date pod-kwota">
              <span className="pod-kwota__label">{t.podRowTax}</span>
              <span className="pod-kwota__value is-empty">—</span>
            </div>
            <div className="zeb-row__main">
              <span className="zeb-row__name">{w.adresNazwa}</span>
            </div>
            <div className="zeb-row__side">
              <span className="status-badge status-neutral">{t.citRowNone}</span>
            </div>
          </div>
          {wczesniej && (
            <div className="pod-row__dom cit-row__dom">
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void utworzZPoprzedniego(w)}
                disabled={busy !== null}
                data-tip={t.citRowCarryHint.replace('{rok}', String(wczesniej.rok))}
              >
                <Icon name="copy" size={13} /> {t.citRowCarry.replace('{rok}', String(wczesniej.rok))}
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const renderRow = (w: Wiersz) => {
    const rek = w.rek;
    if (!rek) return renderBrak(w);
    const { stan, problemy, wynik } = ocena.get(rek.id) ?? {
      stan: 'gotowa' as StanCit,
      problemy: [],
      wynik: obliczCIT8(rek.dane, []),
    };
    const ostatnie = rek.dane.pobrania[rek.dane.pobrania.length - 1];
    const wyslana = ostatniaWysylka(rek.dane.wysylki);
    const ulica = ulicaZNumerem(rek.dane.siedziba);
    const spr = rek.dane.sprawozdanie;
    const kwota = spr ? kwotaWBoksie(wynik.podatek) : null;
    const isSelected = selected.has(rek.id);
    const open = () => openDetail(w);
    return (
      <li key={rek.id} className="pod-item">
        {/* The tick sits left of the card, outside it — the card opens the
            return, and a control inside a clickable card fights it. */}
        <span className="ksieg-row__select">
          <label
            className={`ks-check${isSelected ? ' is-on' : ''}`}
            data-tip={t.podSelectFor}
            // Shift+click selects a range; without this it also selects text.
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
          >
            <input
              type="checkbox"
              className="ks-check__input"
              checked={isSelected}
              onChange={(e) => toggleSelected(rek.id, (e.nativeEvent as MouseEvent).shiftKey === true)}
              aria-label={`${t.podSelectFor}: ${rek.adresNazwa}`}
            />
            <span className="ks-check__box" aria-hidden="true">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
          </label>
        </span>
        <div className={`zeb-row pod-row pod-row--${stan}${isSelected ? ' is-selected' : ''}`}>
          <div
            className="pod-row__open"
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }}
          >
            <div className="zeb-date pod-kwota" data-tip={t.citSumTax}>
              <span className="pod-kwota__label">{t.podRowTax}</span>
              {kwota ? (
                <span className={`pod-kwota__value${kwota.size}`}>
                  {kwota.text}
                  <span className="pod-kwota__unit">zł</span>
                </span>
              ) : (
                <span className="pod-kwota__value is-empty">—</span>
              )}
            </div>
            <div className="zeb-row__main">
              <span className="zeb-row__name">{rek.adresNazwa}</span>
              <span className="zeb-row__meta">
                {rek.dane.nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', rek.dane.nip)}
                  </span>
                )}
                {ulica && (
                  <span>
                    <Icon name="map-pin" size={13} /> {ulica}
                  </span>
                )}
                {spr ? (
                  <>
                    <span data-tip={spr.plikNazwa}>
                      <Icon name="table" size={13} />{' '}
                      {t.citRowStatement
                        .replace('{okres}', okresLabel(spr.dane.okresOd, spr.dane.okresDo))
                        .replace('{plik}', spr.plikNazwa || '—')}
                    </span>
                    <span>
                      <Icon name="coins" size={13} />{' '}
                      {t.citRowIncome.replace('{kwota}', formatKwota(wynik.przychodyOpodatkowane))}
                    </span>
                  </>
                ) : (
                  <span className="status-badge status-pending">{t.citRowNoStatement}</span>
                )}
                {spr && !okresPelny(spr.dane, rek.rok) && (
                  rek.dane.zaakceptowanyOkres === okresKlucz(spr.dane) ? (
                    <span className="status-badge status-neutral">{t.citRowPartialAccepted}</span>
                  ) : (
                    <span className="status-badge status-pending" data-tip={t.citStmtPartial.replace('{rok}', String(rek.rok))}>
                      {t.citRowPartial}
                    </span>
                  )
                )}
                {!w.adres && (
                  <span className="pod-meta-warning" data-tip={t.citOrphanHint}>
                    <Icon name="alert-triangle" size={13} /> {t.citOrphanBadge}
                  </span>
                )}
                {ostatnie && (
                  <span>
                    <Icon name="download" size={13} />{' '}
                    {t.podRowDownloaded
                      .replace('{when}', formatStamp(ostatnie.at, locale))
                      .replace('{who}', ostatnie.by || '—')}
                  </span>
                )}
                {wyslana && (
                  <Tip content={wyslana.opis || etapWysylki(t, wyslana).text}>
                    <span className={`status-badge ${etapWysylki(t, wyslana).klasa}`}>
                      {t.citRowSent
                        .replace('{env}', wyslana.srodowisko === 'test' ? ` (${t.citEnvTest})` : '')
                        .replace('{etap}', etapWysylki(t, wyslana).text)}
                    </span>
                  </Tip>
                )}
              </span>
            </div>
            {/* Filed is said by the slot beside; the badge names the other states. */}
            {stan !== 'zlozone' && (
              <div className="zeb-row__side">
                <span
                  className={`status-badge ${
                    stan === 'braki' ? 'status-pending' : stan === 'pobrana' ? 'status-info' : 'status-neutral'
                  }`}
                  data-tip={problemy.map((p) => problemText(t, p, rek.rok)).join('\n') || undefined}
                >
                  {stan === 'braki' ? t.podStatusMissing : stan === 'pobrana' ? t.podStatusDownloaded : t.podStatusReady}
                </span>
              </div>
            )}
          </div>
          <div className="pod-row__dom cit-row__dom">
            {spr && (
              <button
                type="button"
                className="button button-icon button-ghost"
                onClick={() => setPodglad(rek)}
                data-tip={t.citRowPreview}
                aria-label={`${t.citRowPreview}: ${rek.adresNazwa}`}
              >
                <Icon name="eye" size={14} />
              </button>
            )}
            <DomSlot
              t={t}
              locale={locale}
              dom={rek.dane.zlozone}
              busy={zlozoneSaving.has(rek.id)}
              onSet={(filed) => void setZlozone([rek.id], filed, false)}
              labels={zlozoneLabels(t)}
            />
          </div>
        </div>
      </li>
    );
  };

  const filtrLabel: Record<Filtr, string> = {
    all: t.podFilterAll,
    errors: t.podFilterErrors,
    ready: t.podFilterReady,
    downloaded: t.podFilterDownloaded,
    filed: t.citFilterFiled,
    none: t.citFilterNone,
    nostmt: t.citFilterNoStmt,
  };
  const doZlozenia = zaznaczone.filter((r) => !r.dane.zlozone);
  const zlozone = zaznaczone.filter((r) => r.dane.zlozone);

  const minRok = Math.min(...lata);
  const maxRok = Math.max(...lata);
  const podatekRazem = wRoku.reduce((sum, r) => sum + (r.dane.sprawozdanie ? ocena.get(r.id)?.wynik.podatek ?? 0 : 0), 0);
  const wZlozone = liczniki.filed;
  // Progress counts the returns that exist — a community still to start is not "unfiled".
  const procentZlozone = wRoku.length > 0 ? Math.round((wZlozone / wRoku.length) * 100) : 0;
  const fakty =
    wiersze.length === 0
      ? [t.citNoAddressesTitle]
      : [
          t.citHeroReturns.replace('{n}', String(wRoku.length)).replace('{total}', String(wiersze.length)),
          t.podHeroTax.replace('{kwota}', `${formatZl(podatekRazem)} zł`),
          ...(liczniki.errors > 0 ? [t.podHeroErrors.replace('{n}', String(liczniki.errors))] : []),
        ];

  // The deadline matters until every return is filed: tinted a month ahead, and once it has passed.
  const termin = terminCit(rok);
  const dniDoTerminu = Math.ceil((new Date(`${termin}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  const wszystkoZlozone = wRoku.length > 0 && wZlozone === wRoku.length;
  const terminTon = wszystkoZlozone ? '' : dniDoTerminu < 0 ? ' is-over' : dniDoTerminu <= 30 ? ' is-soon' : '';
  const terminText = (terminTon === ' is-over' ? t.citDeadlineOver : terminTon === ' is-soon' ? t.citDeadlineSoon : t.citDeadline)
    .replace('{date}', formatData(termin))
    .replace('{left}', ileDni(Math.max(dniDoTerminu, 0)));

  return (
    <div className="content-body">
      {/* ------------------------------ Year bar ------------------------------
          The year is picked once a season, so it heads the page like the month
          on the Pulpit and in Kalendarz — with the year's one bulk action. */}
      <header className="ksieg-hero pod-hero">
        <div className="ksieg-hero__art">
          <span className="pod-hero__art" aria-hidden="true">
            <Icon name="landmark" size={40} />
          </span>
        </div>

        <div className="ksieg-hero__id">
          <span className="ksieg-hero__eyebrow">
            <Icon name="landmark" size={13} /> {t.citTitle}
          </span>
          <h1 className="ksieg-hero__month">
            {rok}
            <span>{t.citHeroYear}</span>
          </h1>
          <p className="ksieg-hero__facts">
            {fakty.join(' · ')} · <span className={`cit-deadline${terminTon}`}>{terminText}</span>
          </p>
        </div>

        <div className="ksieg-hero__nav">
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => zmienRok(rok - 1)}
            disabled={rok <= minRok}
            data-tip={t.podYearPrev}
            aria-label={t.podYearPrev}
          >
            <Icon name="chevron-left" size={17} />
          </button>
          <Select
            overlay
            value={String(rok)}
            options={lata.map((r) => ({
              value: String(r),
              label: lataZDanymi.includes(r) ? String(r) : t.podYearNew.replace('{rok}', String(r)),
            }))}
            onChange={(v) => zmienRok(Number(v))}
            ariaLabel={t.podYear}
            className="ksieg-nav-select"
          />
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => zmienRok(rok + 1)}
            disabled={rok >= maxRok}
            data-tip={t.podYearNext}
            aria-label={t.podYearNext}
          >
            <Icon name="chevron-right" size={17} />
          </button>
          <button
            type="button"
            className="ksieg-scan-btn"
            onClick={() => void downloadAll(undefined, 'oba')}
            disabled={busy !== null || wRoku.length === 0}
            data-tip={t.citDownloadAllHint.replace('{rok}', String(rok))}
          >
            <Icon name={busy === 'all' ? 'loader' : 'download'} size={15} />
            <span>{t.citDownloadAll}</span>
          </button>
          {czekajaceUpo.length > 0 && (
            <Tip content={t.citCheckUpoHint}>
              <button type="button" className="ksieg-scan-btn" onClick={() => void upo()} disabled={busy !== null}>
                <Icon name={busy === 'upo' ? 'loader' : 'refresh'} size={15} />
                <span>{t.citCheckUpoBatch.replace('{n}', String(czekajaceUpo.length))}</span>
              </button>
            </Tip>
          )}
          <button
            type="button"
            className="ksieg-scan-btn"
            onClick={() => void podepnijZBiblioteki()}
            disabled={busy !== null || wiersze.length === 0}
            data-tip={t.citStmtBulkHint.replace('{rok}', String(rok))}
          >
            <Icon name={busy === 'stmt' ? 'loader' : 'paperclip'} size={15} />
            <span>{t.citStmtBulk}</span>
          </button>
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            data-tip={t.zebraniaRefresh}
            aria-label={t.zebraniaRefresh}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        {wRoku.length > 0 && (
          <div className="ksieg-hero__progress">
            <div className="ksieg-progress__head">
              <span className="ksieg-progress__label">{t.citProgressLabel}</span>
              <span className="ksieg-progress__value">
                {t.ksProgressDone.replace('{done}', String(wZlozone)).replace('{total}', String(wRoku.length))}
                <strong>{procentZlozone}%</strong>
              </span>
            </div>
            <div className="ksieg-progress__track">
              <div className="ksieg-progress__fill" style={{ width: `${procentZlozone}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="zeb-toolbar">
        <div className="ksieg-search">
          <Icon name="search" size={15} />
          <input type="text" placeholder={t.podSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim() && (
            <button type="button" onClick={() => setSearch('')} data-tip={t.close} aria-label={t.close}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        {wiersze.length > 0 && (
          <div className="zad-seg" role="group" aria-label={t.podFilterLabel}>
            {FILTRY.map((f) => (
              <button
                key={f}
                type="button"
                className={`zad-seg__btn${filtr === f ? ' is-active' : ''}${liczniki[f] === 0 ? ' is-empty' : ''}`}
                aria-pressed={filtr === f}
                onClick={() => setFiltr(f)}
              >
                {filtrLabel[f]}
                <span className="zad-seg__count">{liczniki[f]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pod-toolbar-end">
          <button type="button" className="button button-secondary" onClick={() => setSlownikOpen(true)}>
            <Icon name="book" size={14} /> {t.citDictionary}
          </button>
        </div>
      </div>

      <div className="page-form pod-list-page">
        {wiersze.length === 0 ? (
          <div className="zeb-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="landmark" size={22} />
            </span>
            <strong>{t.citNoAddressesTitle}</strong>
            <p>{t.citNoAddressesText}</p>
          </div>
        ) : (
          <>
            {brakujace.length > 0 && (
              <div className="callout">
                <Icon name="info" size={16} />
                <div className="callout__body">
                  {t.podCarryMissing
                    .replace('{prev}', String(rok - 1))
                    .replace('{n}', ileWspolnot(brakujace.length))
                    .replace('{rok}', String(rok))}
                </div>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void carry()}
                  disabled={busy !== null}
                >
                  <Icon name={busy === 'carry' ? 'loader' : 'copy'} size={13} /> {t.podCarryMissingBtn}
                </button>
              </div>
            )}
            {visible.length === 0 ? (
              <div className="zeb-nomatch">
                <Icon name="search" size={18} /> {t.podNoMatch}
              </div>
            ) : (
              <>
                {visibleRek.length > 0 && (
                  <div className="ksieg-selall pod-selall">
                    <span className="ksieg-row__select">
                      <label
                        className={`ks-check${allVisibleSelected ? ' is-on' : ''}${
                          selectedVisible > 0 && !allVisibleSelected ? ' is-mixed' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="ks-check__input"
                          checked={allVisibleSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedVisible > 0 && !allVisibleSelected;
                          }}
                          onChange={toggleAllVisible}
                          aria-label={t.ksSelectAll}
                        />
                        <span className="ks-check__box" aria-hidden="true">
                          <Icon
                            name={selectedVisible > 0 && !allVisibleSelected ? 'minus' : 'check'}
                            size={12}
                            strokeWidth={3}
                          />
                        </span>
                      </label>
                    </span>
                    <button type="button" className="ksieg-selall__label" onClick={toggleAllVisible}>
                      {allVisibleSelected ? t.ksSelectNone : t.ksSelectAll}
                    </button>
                    <span className="ksieg-selall__hint">{t.ksSelectRangeHint}</span>
                  </div>
                )}
                <ul className="zeb-list">{visible.map(renderRow)}</ul>
              </>
            )}
          </>
        )}

        {/* Ticked returns, acted on together: floats at the bottom, as on the Pulpit. */}
        {zaznaczone.length > 0 && (
          <div className="ksieg-selbar">
            <Icon name="check-circle" size={16} />
            <span className="ksieg-selbar__text">{t.podSelectionBar.replace('{n}', String(zaznaczone.length))}</span>
            <button
              type="button"
              className="ksieg-selbar__clear"
              onClick={() => {
                setSelected(new Set());
                lastTickedRef.current = null;
              }}
            >
              {t.ksSelectClear}
            </button>
            {zlozone.length > 0 && (
              <button
                type="button"
                className="button button-small button-ghost"
                disabled={zlozoneSaving.size > 0}
                onClick={() =>
                  void setZlozone(
                    zlozone.map((r) => r.id),
                    false,
                    true,
                  ).then((ok) => ok && setSelected(new Set()))
                }
              >
                {t.citBatchUnfiled.replace('{n}', String(zlozone.length))}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void downloadAll(zaznaczone.map((r) => r.id), 'pdf')}
            >
              <Icon name="download" size={14} /> {t.podBatchPdf.replace('{n}', String(zaznaczone.length))}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void downloadAll(zaznaczone.map((r) => r.id), 'xml')}
            >
              <Icon name="download" size={14} /> {t.citBatchXml.replace('{n}', String(zaznaczone.length))}
            </button>
            {zaznaczoneUpo.length > 0 && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy !== null}
                onClick={() => void upo(zaznaczoneUpo.map((r) => r.id))}
              >
                <Icon name="refresh" size={14} /> {t.citCheckUpoBatch.replace('{n}', String(zaznaczoneUpo.length))}
              </button>
            )}
            <Tip content={t.citSignHint}>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy !== null || podpisWiele !== null}
                onClick={() => setPodpisWiele(zaznaczone.map((r) => r.id))}
              >
                <Icon name="signature" size={14} /> {t.podBatchSign.replace('{n}', String(zaznaczone.length))}
              </button>
            </Tip>
            {doZlozenia.length > 0 && (
              <button
                type="button"
                className="ksieg-book ksieg-book--sm"
                disabled={zlozoneSaving.size > 0}
                onClick={() =>
                  void setZlozone(
                    doZlozenia.map((r) => r.id),
                    true,
                    true,
                  ).then((ok) => ok && setSelected(new Set()))
                }
              >
                <Icon name="check-circle" size={14} />
                <span>{t.citBatchFiled.replace('{n}', String(doZlozenia.length))}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {podpisWiele && (
        <PodpisKartaModal
          language={language}
          title={t.citSignManyTitle}
          subtitle={t.citSignManySubtitle.replace('{rok}', String(rok)).replace('{n}', String(doPodpisu.length))}
          extra={(cert) => (
            <>
              <GotowoscPodpisuWiele
                t={t}
                cert={cert}
                pokazLiczbe
                wpisy={doPodpisu.map((r) => ({
                  nazwa: r.adresNazwa,
                  problemy: (ocena.get(r.id)?.problemy ?? []).map((p) => problemText(t, p, rok)),
                  uwagi: uwagiPodpisu(r.dane, cert?.podmiot ?? null),
                }))}
              />
              <FormSection icon="file-check" title={t.citSignManyTitle} description={t.citSignXmlNote}>
                <PodpiszTezPdf
                  checked={pdfPodpisany}
                  onChange={setPdfPodpisany}
                  label={t.citSignPdfOption}
                  hint={t.citSignPdfOptionHint}
                />
                <WyslijOpcja t={t} checked={wyslij} onChange={setWyslij} />
              </FormSection>
            </>
          )}
          submitLabel={t.podSignManySubmit.replace('{n}', ileZeznan(gotoweDoPodpisu.length))}
          submitDisabled={gotoweDoPodpisu.length === 0}
          pinHint={t.podSignManyPinHint.replace('{n}', ileZeznan(gotoweDoPodpisu.length))}
          postep={postepPodpisu}
          onPrzerwij={() => void window.electronAPI.przerwijPodpisCit()}
          onPodpisz={podpiszWiele}
          onClose={() => setPodpisWiele(null)}
        />
      )}
      {podsumowanie && (
        <PodsumowaniePodpisow
          t={t}
          rok={podsumowanie.rok}
          wynik={podsumowanie.wynik}
          subtitle={(podsumowanie.wynik.podpis
            ? t.citSumSubtitle.replace('{kto}', podsumowanie.wynik.podpis.podmiot)
            : t.citSumSubtitleNone
          ).replace('{rok}', String(podsumowanie.rok))}
          onZaznacz={(ids) => {
            setSelected(new Set(ids));
            lastTickedRef.current = null;
          }}
          onClose={() => setPodsumowanie(null)}
        />
      )}
      {podglad?.dane.sprawozdanie && (
        <SprawozdaniePodgladModal
          t={t}
          nazwa={podglad.adresNazwa}
          spr={podglad.dane.sprawozdanie.dane}
          onClose={() => setPodglad(null)}
        />
      )}
      {slownikOpen && (
        <SlownikModal
          language={language}
          value={ustawienia}
          onSaved={(saved) => {
            setUstawienia(saved);
            setSlownikOpen(false);
          }}
          onClose={() => setSlownikOpen(false)}
        />
      )}
      {busy === 'all' && <BusyOverlay label={t.podDownloadingAll} />}
      {busy === 'stmt' && postepStmt && (
        <BusyOverlay
          label={t.citStmtBulkBusy.replace('{done}', String(postepStmt.done)).replace('{total}', String(postepStmt.total))}
        />
      )}
    </div>
  );
};

export default PodatkiCit;
