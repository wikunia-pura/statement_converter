import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  AdresIdentyfikacja,
  CitAiPropozycja,
  CitKategoria,
  CitKlasyfikacja,
  CitSlownikRegula,
  CitStrona,
  PodatekAdres,
  PodatekCit,
  PodatekCitDane,
  PodatekCitSprawozdanie,
  PodatkiCitUstawienia,
  PodatkiPodpisPostep,
  PodatkiCitUpoResult,
  PodatkiPodpisWieleResult,
  PodpisCertyfikat,
  PodpisWybor,
  Sprawozdanie,
  SprawozdanieZapisane,
  ZebraniaWspolnota,
} from '../../shared/types';
import { formatZl, nipPoprawny, tylkoCyfry, ulicaZNumerem, uwagiPodpisu } from '../../shared/podatki';
import {
  ObliczenieCIT8,
  PozycjaCitOcena,
  ProblemCit8,
  CitPrzegladPozycja,
  citWzor,
  czyRegulaDomyslna,
  daneCitNaKolejnyRok,
  defaultCitSlownik,
  kategorieDlaStrony,
  obliczCIT8,
  okresKlucz,
  okresPelny,
  problemTylkoXml,
  problemyCIT8,
  problemyCIT8Xml,
  problemyTylkoXmlCIT8,
  pozycjeZeSprawozdania,
  regulaDlaNazwy,
  uzupelnijDomyslne,
  pusteDaneCit,
  sprawozdanieDlaRoku,
  stanCit,
  StanCit,
  terminCit,
} from '../../shared/podatki-cit';
import {
  formatData,
  formatKwota,
  okresLabel,
  sprawozdaniaDlaWspolnoty,
} from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { nazwaUrzedu, urzedyOpcje } from '../../shared/pit-urzedy';
import SearchableSelect from '../components/SearchableSelect';
import {
  BlokadaWysylki,
  EDeklaracjeSrodowisko,
  EDeklaracjeWysylka,
  blokadaDoPotwierdzenia,
  blokadyWysylkiProd,
  czekaNaUpo,
  moznaPorzucic,
  niepewnaOtwarta,
  normalizeSrodowisko,
  ostatniaWysylka,
  swiezaWysylka,
  wTrakcieWysylania,
} from '../../shared/e-deklaracje';
import Tip from '../components/Tip';
import { AiWorking } from '../components/AiPanel';
import { nazwaInterEj } from '../../shared/inter-ej';
import { translations, Language } from '../translations';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import { FormField, FormRow, FormSection } from '../components/FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { PodpisKartaModal, PodpiszTezPdf, bezPrefiksu } from '../components/PodpisKarta';
import { SprawozdaniePodglad } from '../components/ZebranieSprawozdanie';
import ScreenTitle from '../components/ScreenTitle';
import { useNavItem } from '../navigation';
import { structuralEqual } from '../structuralEqual';
import { useRequestSeq } from '../hooks/useRequestSeq';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import Select from '../components/Select';
import {
  AdresFields,
  DomSlot,
  GotowoscPodpisuWiele,
  LiczbaInput,
  PodsumowaniePodpisow,
  WpisGotowosci,
  baseName,
  etapWysylkiText,
  klasaEtapu,
  kwotaWBoksie,
  zl2,
} from './PodatkiNieruchomosci';

type T = (typeof translations)['pl'];

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

const dzisIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const newRuleId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `r-${Date.now()}`;
};

const kategoriaNazwy = (t: T): Record<CitKategoria, string> => ({
  przychod_opodatkowany: t.citKat_przychod_opodatkowany,
  przychod_zwolniony: t.citKat_przychod_zwolniony,
  koszt_wspolny: t.citKat_koszt_wspolny,
  koszt_opodatkowany: t.citKat_koszt_opodatkowany,
  koszt_zwolniony: t.citKat_koszt_zwolniony,
  niekoszt: t.citKat_niekoszt,
  pomin: t.citKat_pomin,
});

function problemText(t: T, p: ProblemCit8, rok: number): string {
  switch (p.kod) {
    case 'nip':
      return t.citProblem_nip;
    case 'nazwa':
      return t.citProblem_nazwa;
    case 'urzad':
      return t.citProblem_urzad;
    case 'korekta':
      return t.citProblem_korekta;
    case 'ujemna':
      return t.citProblem_ujemna.replace('{poz}', p.pozycje.join(', '));
    case 'sprawozdanie':
      return t.citProblem_sprawozdanie.replace('{rok}', String(rok));
    case 'okres':
      return t.citProblem_okres
        .replace('{od}', formatData(p.od))
        .replace('{do}', formatData(p.do))
        .replace('{rok}', String(rok));
    case 'nieposortowane':
      return t.citProblem_nieposortowane.replace('{n}', String(p.ile));
    case 'niepotwierdzone':
      return t.citProblem_niepotwierdzone.replace('{n}', String(p.ile));
    case 'wzor':
      return t.citProblem_wzor.replace('{rok}', String(rok));
    case 'nipXml':
      return t.citProblem_nipXml;
    case 'kodUrzedu':
      return p.kodUrz ? t.citProblem_kodUrzedu.replace('{kod}', p.kodUrz) : t.citProblem_kodUrzeduBrak;
    case 'adres':
      return t.citProblem_adres.replace('{pola}', p.pola.map((k) => adresPole(t)[k].toLocaleLowerCase()).join(', '));
    case 'kodPocztowy':
      return t.citProblem_kodPocztowy;
  }
}

/**
 * "Wyślij do e-Deklaracji" in a signing window, with the gateway of Settings → Administracja in plain sight —
 * read when the window opens, so TEST or PRODUKCJA is on screen before the PIN.
 */
const WyslijOpcja: React.FC<{ t: T; checked: boolean; onChange: (v: boolean) => void }> = ({ t, checked, onChange }) => {
  const [srodowisko, setSrodowisko] = useState<EDeklaracjeSrodowisko | null>(null);
  useEffect(() => {
    void window.electronAPI.getSettings().then((s) => setSrodowisko(normalizeSrodowisko(s.eDeklaracjeSrodowisko)));
  }, []);
  const prod = srodowisko === 'prod';
  return (
    <>
      <PodpiszTezPdf checked={checked} onChange={onChange} label={t.citSendOption} hint={t.citSendOptionHint} />
      {checked && srodowisko && (
        <div className={`callout ${prod ? 'callout--warning' : ''}`}>
          <Icon name={prod ? 'alert-triangle' : 'info'} size={16} />
          <div className="callout__body">
            <span className={`status-badge ${prod ? 'status-error' : 'status-info'}`}>{prod ? t.citEnvProd : t.citEnvTest}</span>{' '}
            {prod ? t.citEnvProdNote : t.citEnvTestNote}
          </div>
        </div>
      )}
    </>
  );
};

/** A send's state badge: the gateway's stage, or what the app could not settle and a person did. */
function etapWysylki(t: T, w: EDeklaracjeWysylka): { text: string; klasa: string } {
  if (w.rozstrzygnieta?.jak === 'nie_dotarla') return { text: t.citEtap_nieDotarla, klasa: 'status-neutral' };
  if (w.rozstrzygnieta?.jak === 'dotarla') return { text: t.citEtap_dotarla, klasa: 'status-success' };
  if (w.rozstrzygnieta?.jak === 'porzucona') return { text: t.citEtap_porzucona, klasa: 'status-neutral' };
  if (wTrakcieWysylania(w)) return { text: t.citEtap_wysylanie, klasa: 'status-pending' };
  const niepewna = niepewnaOtwarta(w);
  return { text: etapWysylkiText(t, w.status, w.refId, niepewna), klasa: klasaEtapu(w.status, w.refId, niepewna) };
}

/**
 * The return's sends to the gateway, newest first — a send with its UPO offers it for download. A send the
 * app could not settle offers the person's decision: an uncertain one (no answer — it may have been filed)
 * did not or did reach the gateway; one stuck "in progress" is no longer waited for.
 */
const WysylkiLista: React.FC<{ t: T; locale: string; id: number; wysylki: EDeklaracjeWysylka[]; onZmiana: () => void }> = ({
  t,
  locale,
  id,
  wysylki,
  onZmiana,
}) => {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const pobierz = async (refId: string) => {
    try {
      const { filePath } = await window.electronAPI.pobierzUpoCit(id, refId);
      notify.success(t.citUpoSaved.replace('{file}', baseName(filePath)), { file: filePath });
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citUpoError);
    }
  };
  const rozstrzygnij = async (w: EDeklaracjeWysylka, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => {
    const pytanie =
      jak === 'nie_dotarla'
        ? t.citResolveNotArrivedConfirm
        : jak === 'dotarla'
          ? t.citResolveArrivedConfirm
          : t.citResolveAbandonConfirm.replace('{ref}', w.refId ?? '—');
    if (!(await notify.confirm(pytanie, { danger: jak !== 'dotarla' }))) return;
    setBusy(w.at);
    try {
      await window.electronAPI.rozstrzygnijWysylkeCit(id, w.at, jak);
      notify.success(t.citResolveDone);
      onZmiana();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citResolveError);
    } finally {
      setBusy(null);
    }
  };
  return (
  <ul className="cit-wysylki">
    {/* The six newest — and every unsettled uncertain one: it may block the return, its buttons must show. */}
    {[...wysylki].reverse().filter((w, i) => i < 6 || niepewnaOtwarta(w)).map((w, i) => {
      const etap = etapWysylki(t, w);
      const doRozstrzygniecia = niepewnaOtwarta(w) && !wTrakcieWysylania(w);
      return (
      <li key={`${w.at}${i}`}>
        <span className={`status-badge ${w.srodowisko === 'prod' ? 'status-accent' : 'status-info'}`}>
          {w.srodowisko === 'prod' ? t.citEnvProd : t.citEnvTest}
        </span>
        <span className={`status-badge ${etap.klasa}`}>{etap.text}</span>
        <span>{formatStamp(w.at, locale)} · {w.by || '—'}</span>
        <span className="cit-wysylki__ref">{w.refId ? t.citSendRef.replace('{ref}', w.refId) : t.citSendNoRef}</span>
        {w.upo && w.refId && (
          <button type="button" className="button button-small button-secondary" onClick={() => void pobierz(w.refId!)}>
            <Icon name="download" size={13} /> {t.citUpoDownload}
          </button>
        )}
        {doRozstrzygniecia && (
          <>
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={busy !== null}
              onClick={() => void rozstrzygnij(w, 'nie_dotarla')}
            >
              <Icon name="refresh" size={13} /> {t.citResolveNotArrived}
            </button>
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={busy !== null}
              onClick={() => void rozstrzygnij(w, 'dotarla')}
            >
              <Icon name="check" size={13} /> {t.citResolveArrived}
            </button>
          </>
        )}
        {moznaPorzucic(w) && (
          <button
            type="button"
            className="button button-small button-ghost"
            disabled={busy !== null}
            onClick={() => void rozstrzygnij(w, 'porzucona')}
          >
            <Icon name="x" size={13} /> {t.citResolveAbandon}
          </button>
        )}
        {doRozstrzygniecia && <span className="cit-wysylki__opis">{t.citResolveHint}</span>}
        {czekaNaUpo(w) && swiezaWysylka(w) && <span className="cit-wysylki__opis">{t.citUpoAuto}</span>}
        {w.opis && <span className="cit-wysylki__opis">{w.opis}</span>}
        {w.sprawdzono && <span className="cit-wysylki__opis">{t.citSendChecked.replace('{when}', formatStamp(w.sprawdzono, locale))}</span>}
        {w.rozstrzygnieta && (
          <span className="cit-wysylki__opis">
            {t.citSettledBy.replace('{who}', w.rozstrzygnieta.by || '—').replace('{when}', formatStamp(w.rozstrzygnieta.at, locale))}
          </span>
        )}
      </li>
      );
    })}
  </ul>
  );
};

/** "Sprawdź UPO" for the given returns (or the year); the result as one toast, the list reloaded by the caller. */
async function sprawdzUpo(
  t: T,
  notify: ReturnType<typeof useNotify>,
  rok: number,
  ids?: number[],
): Promise<PodatkiCitUpoResult | null> {
  try {
    const r = await window.electronAPI.sprawdzUpoCit(rok, ids);
    if (r.wyniki.length === 0 && r.bledy.length === 0) {
      notify.info(t.citUpoNothing);
      return r;
    }
    const upo = r.wyniki.filter((w) => w.status === 200).length;
    const toku = r.wyniki.filter((w) => w.status !== null && w.status >= 300 && w.status < 400).length;
    const odrz = r.wyniki.length - upo - toku;
    const msg = t.citUpoDone
      .replace('{n}', String(r.wyniki.length))
      .replace('{upo}', String(upo))
      .replace('{toku}', String(toku))
      .replace('{odrz}', String(odrz));
    const bledy = r.bledy.length > 0 ? ` ${t.citUpoErrors.replace('{list}', r.bledy.map((b) => `${b.nazwa} — ${b.powod}`).join('; '))}` : '';
    if (odrz > 0 || r.bledy.length > 0) notify.warning(msg + bledy, r.folder ? { file: r.folder } : undefined);
    else notify.success(msg, r.folder ? { file: r.folder } : undefined);
    return r;
  } catch (err: unknown) {
    notify.error(bezPrefiksu(err), t.citUpoError);
    return null;
  }
}

/** A correction's hold-up in the window's words. */
const blokadaText = (t: T, b: BlokadaWysylki): string =>
  b.kod === 'korektaCzeka'
    ? t.citBlokada_korektaCzeka.replace('{ref}', 'refId' in b ? b.refId : '—')
    : t.citBlokada_korektaPrzyjeta.replace('{ref}', 'refId' in b ? b.refId : '—');

/**
 * Before a signing run that sends: the corrections an earlier production send holds back — one still waiting
 * for its UPO, or an earlier correction that reached the gateway — are named and the person decides, before
 * anything is signed. Only for the production gateway (the test one files nothing). The ids confirmed go to
 * the run; a correction left unconfirmed is signed but not sent, and the summary says why.
 */
async function potwierdzKorekty(
  t: T,
  notify: ReturnType<typeof useNotify>,
  rekordy: PodatekCit[],
  wyslij: boolean,
): Promise<number[]> {
  if (!wyslij) return [];
  const doPotwierdzenia = rekordy
    .filter((r) => r.dane.cel === 2)
    .map((r) => ({ r, blokady: blokadyWysylkiProd(r.dane).filter(blokadaDoPotwierdzenia) }))
    .filter((x) => x.blokady.length > 0);
  if (doPotwierdzenia.length === 0) return [];
  const settings = await window.electronAPI.getSettings();
  if (normalizeSrodowisko(settings.eDeklaracjeSrodowisko) !== 'prod') return [];
  const lista = doPotwierdzenia
    .map(({ r, blokady }) => `${r.adresNazwa}: ${blokady.map((b) => blokadaText(t, b)).join('; ')}`)
    .join('\n');
  const ok = await notify.confirm(t.citCorrectionConfirm.replace('{list}', lista), {
    title: t.citCorrectionConfirmTitle,
    confirmLabel: t.citCorrectionConfirmYes,
  });
  return ok ? doPotwierdzenia.map(({ r }) => r.id) : [];
}

/** A button's hover hint in the app's own tooltip — none when there is nothing to say. */
const PodpowiedzPrzycisku: React.FC<{ tresc: string | null; children: React.ReactNode }> = ({ tresc, children }) =>
  tresc ? <Tip content={tresc}>{children}</Tip> : <>{children}</>;

const adresPole = (t: T): Record<keyof PodatekAdres, string> => ({
  kraj: t.podKraj,
  wojewodztwo: t.podWojewodztwo,
  powiat: t.podPowiat,
  gmina: t.podGmina,
  ulica: t.podUlica,
  nrDomu: t.podNrDomu,
  nrLokalu: t.podNrLokalu,
  miejscowosc: t.podMiejscowosc,
  kodPocztowy: t.podKod,
});

/** The "filed with the tax office" tick, in the words of the shared tick slot. */
const zlozoneLabels = (t: T) => ({
  done: t.citFiledDone,
  mark: t.citFiledMark,
  undo: t.citFiledUndo,
  doneBy: t.citFiledBy,
});

/**
 * The community's identification from Adresy laid over a return: the Adres is
 * the master, so every field it has filled wins, and what it lacks stays as the
 * return had it.
 */
const zAdresu = (dane: PodatekCitDane, ident: AdresIdentyfikacja | undefined): PodatekCitDane => {
  if (!ident) return dane;
  return {
    ...dane,
    nip: ident.nip || dane.nip,
    nazwaPelna: ident.nazwaPelna || dane.nazwaPelna,
    siedziba: Object.values(ident.siedziba).some(Boolean) ? { ...ident.siedziba } : dane.siedziba,
    urzad: ident.urzadSkarbowy || nazwaUrzedu(ident.kodUrzedu) || dane.urzad,
    kodUrzedu: ident.kodUrzedu || dane.kodUrzedu,
    telefon: ident.telefon || dane.telefon,
  };
};

/**
 * A library statement as a return keeps it — a snapshot, so a later upload
 * never rewrites a filed return — with the vDom number it carries. Null when
 * the statement is gone from the library.
 */
async function pobierzMigawke(
  id: number,
  kto: string,
): Promise<{ migawka: PodatekCitSprawozdanie; nrWsp: number | null } | null> {
  const row = await window.electronAPI.getSprawozdanie(id);
  if (!row?.dane) return null;
  return {
    migawka: { zrodloId: row.id, dane: row.dane, plikNazwa: row.plikNazwa, dodano: new Date().toISOString(), dodal: kto },
    nrWsp: row.nrWsp,
  };
}

/** A statement spanning exactly the calendar year — the only one a return can be drawn from. */
const pelnyRok = (s: { okresOd: string; okresDo: string }, rok: number) =>
  s.okresOd === `${rok}-01-01` && s.okresDo === `${rok}-12-31`;

/* ============================ Statement preview ============================ */

/** The attached statement as vDom printed it, in a window — the same view the Sprawozdania module opens. */
const SprawozdaniePodgladModal: React.FC<{
  t: T;
  nazwa: string;
  spr: Sprawozdanie;
  onClose: () => void;
}> = ({ t, nazwa, spr, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
      <ModalDismiss onClose={onClose} ariaLabel={t.close} />
      <ModalHeader
        icon="table"
        title={t.citStmtPreviewTitle}
        subtitle={`${nazwa} · ${okresLabel(spr.okresOd, spr.okresDo)}`}
      />
      <div className="modal-body modal-body--sectioned">
        <SprawozdaniePodglad t={t} spr={spr} />
      </div>
      <ModalFooter onCancel={onClose} cancelLabel={t.close} />
    </div>
  </div>
);

/* ================================ Dictionary ================================ */

/** The AI's own category for a row name that a rule already covers. */
interface OcenaAudytu {
  kategoria: CitKategoria;
  uzasadnienie: string;
}

/** A row name whose rule the AI disagrees with. */
interface Rozbieznosc {
  p: CitPrzegladPozycja;
  regula: CitSlownikRegula;
  nr: number;
  ai: OcenaAudytu;
}

/**
 * "Sprawdzenie AI": the AI sorts every library row name a rule covers, and only
 * the names where it disagrees with the rule are listed. Nothing changes by
 * itself — each disagreement is kept, taken (an exception on top, or the rule
 * itself when it is that very name), or opened in the rule list.
 */
const AudytSlownika: React.FC<{
  t: T;
  gotowy: boolean;
  blad: string | null;
  sprawdzono: boolean;
  rozbieznosci: Rozbieznosc[];
  aiBusy: boolean;
  onSprawdz: () => void;
  onPrzyjmij: (r: Rozbieznosc) => void;
  onZostaw: (r: Rozbieznosc) => void;
  onPokaz: (r: Rozbieznosc) => void;
}> = ({ t, gotowy, blad, sprawdzono, rozbieznosci, aiBusy, onSprawdz, onPrzyjmij, onZostaw, onPokaz }) => {
  const nazwy = kategoriaNazwy(t);
  return (
    <FormSection
      icon="sparkles"
      title={t.citAudTitle}
      description={t.citAudDesc}
      aside={
        <div className="form-section__actions">
          <button type="button" className="button button-small button-primary" onClick={onSprawdz} disabled={aiBusy || !gotowy}>
            <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {sprawdzono ? t.citAudRerun : t.citAudRun}
          </button>
        </div>
      }
    >
      {blad ? (
        <p className="zeb-muted">{blad}</p>
      ) : !gotowy ? (
        <Loader />
      ) : aiBusy ? (
        <AiWorking title={t.citAudWorking} hint={t.citAudWorkingHint} />
      ) : !sprawdzono ? (
        <p className="zeb-muted">{t.citAudNotRun}</p>
      ) : rozbieznosci.length === 0 ? (
        <p className="zeb-muted">{t.citAudNone}</p>
      ) : (
        <div className="table-scroll cit-rev">
          <table className="zfin-table cit-table">
            <thead>
              <tr>
                <th>{t.citColName}</th>
                <th>{t.citAudColRule}</th>
                <th>{t.citAudColAi}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rozbieznosci.map((r) => (
                <tr key={r.p.klucz}>
                  <td>
                    <div className="cit-pos__name">{r.p.nazwa}</div>
                    <div className="cit-pos__meta">
                      {r.p.strona === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt} ·{' '}
                      <Tip content={r.p.przyklady.join(', ') + (r.p.wspolnot > r.p.przyklady.length ? ' …' : '')}>
                        {t.citRevWhere.replace('{w}', String(r.p.wspolnot)).replace('{s}', String(r.p.sprawozdan))}
                      </Tip>
                    </div>
                  </td>
                  <td>
                    <div>{nazwy[r.regula.kategoria]}</div>
                    <div className="cit-pos__meta">
                      {t.citAudRuleRef.replace('{nr}', String(r.nr)).replace('{fraza}', r.regula.fraza)}
                    </div>
                  </td>
                  <td>
                    <Tip content={r.ai.uzasadnienie || t.citRevAiNoReason}>{nazwy[r.ai.kategoria]}</Tip>
                  </td>
                  <td>
                    <span className="row-actions">
                      <button type="button" className="button button-small button-subtle" onClick={() => onPrzyjmij(r)}>
                        {t.citAudTake}
                      </button>
                      <button type="button" className="button button-small button-ghost" onClick={() => onPokaz(r)}>
                        {t.citAudShow}
                      </button>
                      <button type="button" className="button button-small button-ghost" onClick={() => onZostaw(r)}>
                        {t.citAudKeep}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
};

/** What the AI's two passes said about a name they disagreed on — the hint of an uncertain row. */
const WatpliwoscAi: React.FC<{ t: T; w: CitAiPropozycja }> = ({ t, w }) => {
  const nazwy = kategoriaNazwy(t);
  const odpowiedzi = [{ kategoria: w.kategoria, uzasadnienie: w.uzasadnienie }, ...(w.alternatywa ? [w.alternatywa] : [])];
  return (
    <div className="cit-unsure">
      <div>{w.alternatywa ? t.citRevUnsureTip : t.citRevUnsureOnce}</div>
      {odpowiedzi.map((o, i) => (
        <div key={i}>
          <b>{nazwy[o.kategoria]}</b>
          {o.uzasadnienie ? ` — ${o.uzasadnienie}` : ''}
        </div>
      ))}
    </div>
  );
};

/** A category picked in the dictionary review, with the AI's reason when the AI proposed it. */
interface WyborPrzegladu {
  kategoria: CitKategoria;
  ai?: string;
}

/**
 * One side of the dictionary review: the library's row names of that column no
 * rule covers, the category to give each, and the AI's proposal. Nothing here
 * touches the dictionary — "Dodaj do słownika" hands the picks to the modal,
 * which puts them among its unsaved rules.
 */
const PrzegladSlownika: React.FC<{
  t: T;
  strona: CitStrona;
  pozycje: CitPrzegladPozycja[] | null;
  blad: string | null;
  wybory: Record<string, WyborPrzegladu>;
  watpliwosci: Record<string, CitAiPropozycja>;
  aiBusy: boolean;
  onWybor: (klucz: string, wybor: WyborPrzegladu | null) => void;
  onAi: () => void;
  onDodaj: () => void;
  onOdswiez: () => void;
}> = ({ t, strona, pozycje, blad, wybory, watpliwosci, aiBusy, onWybor, onAi, onDodaj, onOdswiez }) => {
  const nazwy = kategoriaNazwy(t);
  const wybrane = (pozycje ?? []).filter((p) => wybory[p.klucz]).length;
  const options = [
    { value: '', label: t.citRevSkip },
    ...kategorieDlaStrony(strona).map((k) => ({ value: k, label: nazwy[k] })),
  ];
  return (
    <FormSection
      icon="search"
      title={strona === 'przychod' ? t.citRevIncomeTitle : t.citRevCostTitle}
      description={strona === 'przychod' ? t.citRevIncomeDesc : t.citRevCostDesc}
      aside={
        <div className="form-section__actions">
          <button type="button" className="button button-small button-subtle" onClick={onOdswiez} disabled={pozycje === null}>
            <Icon name="refresh" size={13} /> {t.citRevRefresh}
          </button>
          <button
            type="button"
            className="button button-small button-subtle"
            onClick={onAi}
            disabled={aiBusy || !pozycje || pozycje.length === 0}
          >
            <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {t.citRevAi}
          </button>
          <button type="button" className="button button-small button-primary" onClick={onDodaj} disabled={wybrane === 0}>
            <Icon name="plus" size={13} /> {t.citRevAdd.replace('{n}', String(wybrane))}
          </button>
        </div>
      }
    >
      {blad ? (
        <p className="zeb-muted">{blad}</p>
      ) : pozycje === null ? (
        <Loader />
      ) : aiBusy ? (
        <AiWorking title={t.citRevWorking} hint={t.citAiWorkingHint} />
      ) : pozycje.length === 0 ? (
        <p className="zeb-muted">{strona === 'przychod' ? t.citRevIncomeNone : t.citRevCostNone}</p>
      ) : (
        <div className="table-scroll cit-rev">
          <table className="zfin-table cit-table">
            <thead>
              <tr>
                <th>{t.citColName}</th>
                <th className="zfin-num">{t.citRevColAmount}</th>
                <th>{t.citColCategory}</th>
                <th>{t.citColSource}</th>
              </tr>
            </thead>
            <tbody>
              {pozycje.map((p) => {
                const w = wybory[p.klucz];
                return (
                  <tr key={p.klucz} className={strona === 'przychod' && !w ? 'cit-row--open' : undefined}>
                    <td>
                      <div className="cit-pos__name">{p.nazwa}</div>
                      <div className="cit-pos__meta">
                        {p.sekcja === 'fundusz' ? t.citSekcja_fundusz : t.citSekcja_eksploatacja} ·{' '}
                        <Tip content={p.przyklady.join(', ') + (p.wspolnot > p.przyklady.length ? ' …' : '')}>
                          {t.citRevWhere.replace('{w}', String(p.wspolnot)).replace('{s}', String(p.sprawozdan))}
                        </Tip>
                      </div>
                    </td>
                    <td className="zfin-num">{p.kwotaUkryta || nazwaInterEj(p.nazwa) ? '—' : formatKwota(p.kwota)}</td>
                    <td className="cit-pos__category">
                      <Select
                        overlay
                        size="sm"
                        value={w?.kategoria ?? null}
                        placeholder={t.citRevPick}
                        options={options}
                        onChange={(k) => onWybor(p.klucz, k ? { kategoria: k as CitKategoria } : null)}
                        ariaLabel={`${t.citColCategory}: ${p.nazwa}`}
                      />
                    </td>
                    <td>
                      {w?.ai !== undefined ? (
                        <Tip content={w.ai || t.citRevAiNoReason} className="status-badge status-info">
                          {t.citRevSourceAi}
                        </Tip>
                      ) : w ? (
                        <span className="status-badge status-success">{t.citZrodlo_reczne}</span>
                      ) : watpliwosci[p.klucz] ? (
                        <Tip content={<WatpliwoscAi t={t} w={watpliwosci[p.klucz]} />} className="status-badge status-pending">
                          {t.citRevSourceUnsure}
                        </Tip>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
};


/**
 * "Słownik pozycji CIT" — shared by every return: which statement rows are
 * taxed income, exempt income or a cost. The first matching rule wins, so the
 * order is part of what is saved.
 */
const SlownikModal: React.FC<{
  language: Language;
  value: PodatkiCitUstawienia;
  onSaved: (value: PodatkiCitUstawienia) => void;
  onClose: () => void;
}> = ({ language, value, onSaved, onClose }) => {
  const t = translations[language];
  const notify = useNotify();
  const [rules, setRules] = useState<CitSlownikRegula[]>(value.slownik);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const zapisane = useMemo(() => new Map(value.slownik.map((r) => [r.id, r])), [value.slownik]);
  const [tab, setTab] = useState<'reguly' | 'bez' | CitStrona | 'audyt'>('reguly');
  const [audyt, setAudyt] = useState<Record<string, OcenaAudytu> | null>(null);
  const [zostawione, setZostawione] = useState<Set<string>>(new Set());
  const [przeglad, setPrzeglad] = useState<CitPrzegladPozycja[] | null>(null);
  const [przegladBlad, setPrzegladBlad] = useState<string | null>(null);
  const [wybory, setWybory] = useState<Record<string, WyborPrzegladu>>({});
  /** Names the AI's two passes answered differently: a hint beside the row, never a pick. */
  const [watpliwosci, setWatpliwosci] = useState<Record<string, CitAiPropozycja>>({});
  const [aiBusy, setAiBusy] = useState(false);

  const wczytajPrzeglad = async () => {
    setPrzeglad(null);
    setPrzegladBlad(null);
    try {
      setPrzeglad(await window.electronAPI.przegladPozycjiCit());
    } catch (err: unknown) {
      setPrzegladBlad(`${t.citRevLoadError}: ${bezPrefiksu(err)}`);
    }
  };
  // The library is read once per opening, in the background: the tabs' counts and the rules' hits come from it.
  useEffect(() => {
    void wczytajPrzeglad();
  }, []);

  /** The rules as they would be saved now — the review always matches against the unsaved list. */
  const aktywne = useMemo(() => rules.filter((r) => r.fraza.trim()), [rules]);
  const bezReguly = useMemo(() => {
    const out: Record<CitStrona, CitPrzegladPozycja[]> = { przychod: [], koszt: [] };
    for (const p of przeglad ?? []) if (!regulaDlaNazwy(p.nazwa, p.strona, aktywne)) out[p.strona].push(p);
    return out;
  }, [przeglad, aktywne]);
  /** How many of the library's row names each rule is the first match for. */
  const trafienia = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of przeglad ?? []) {
      const r = regulaDlaNazwy(p.nazwa, p.strona, aktywne);
      if (r) out.set(r.id, (out.get(r.id) ?? 0) + 1);
    }
    return out;
  }, [przeglad, aktywne]);

  const rozbieznosci = useMemo<Rozbieznosc[]>(() => {
    if (!audyt) return [];
    const out: Rozbieznosc[] = [];
    for (const p of przeglad ?? []) {
      const ai = audyt[p.klucz];
      const regula = regulaDlaNazwy(p.nazwa, p.strona, aktywne);
      if (!ai || !regula || ai.kategoria === regula.kategoria || zostawione.has(p.klucz)) continue;
      out.push({ p, regula, nr: rules.indexOf(regula) + 1, ai });
    }
    return out;
  }, [audyt, przeglad, aktywne, rules, zostawione]);

  const sprawdzRegulyAi = async () => {
    const cele = (przeglad ?? []).filter((p) => regulaDlaNazwy(p.nazwa, p.strona, aktywne));
    if (cele.length === 0) {
      notify.info(t.citAiNothing);
      return;
    }
    setAiBusy(true);
    try {
      // The rule's category goes along: the model keeps it unless it is clearly wrong,
      // so a second check does not flip ambiguous names the other way.
      const { propozycje, zapasowy } = await window.electronAPI.klasyfikujCitAi(
        cele.map((p) => ({
          klucz: p.klucz,
          nazwa: p.nazwa,
          strona: p.strona,
          sekcja: p.sekcja,
          kwota: p.kwota,
          ukryta: p.kwotaUkryta,
          regula: regulaDlaNazwy(p.nazwa, p.strona, aktywne)?.kategoria,
        })),
        // No dictionary as examples: the rules are what is being checked.
        [],
      );
      if (zapasowy) notify.warning(t.citAiFallback);
      const strony = new Map(cele.map((p) => [p.klucz, p.strona]));
      const wynik: Record<string, OcenaAudytu> = {};
      for (const w of propozycje) {
        const strona = strony.get(w.klucz);
        // Two passes that disagree are no case against the rule: one of them kept it.
        if (w.niepewne) continue;
        if (strona && kategorieDlaStrony(strona).includes(w.kategoria)) {
          wynik[w.klucz] = { kategoria: w.kategoria, uzasadnienie: w.uzasadnienie };
        }
      }
      setAudyt(wynik);
      setZostawione(new Set());
      if (Object.keys(wynik).length < cele.length) {
        notify.warning(t.citAiMissed.replace('{n}', String(cele.length - Object.keys(wynik).length)));
      }
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citAiError);
    } finally {
      setAiBusy(false);
    }
  };

  /** The AI's category wins: the rule itself when it is that very name, else an exception of the full name on top. */
  const przyjmijAudyt = (r: Rozbieznosc) => {
    if (foldText(r.regula.fraza) === foldText(r.p.nazwa)) {
      setRule(r.regula.id, { kategoria: r.ai.kategoria });
    } else {
      setRules((prev) => [{ id: newRuleId(), fraza: r.p.nazwa, strona: r.p.strona, kategoria: r.ai.kategoria }, ...prev]);
    }
    notify.success(t.citAudTaken.replace('{fraza}', r.p.nazwa));
  };

  const uzupelnij = async () => {
    const u = uzupelnijDomyslne(aktywne);
    const strona = (st: CitStrona) => (st === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt);
    const zmienione = u.zmienione.length
      ? ' ' +
        t.citDictFillChanged.replace(
          '{lista}',
          u.zmienione
            .map((z) =>
              t.citDictFillChangedItem
                .replace('{fraza}', z.fraza)
                .replace('{kolumna}', strona(z.strona))
                .replace('{obecna}', nazwy[z.obecna])
                .replace('{domyslna}', nazwy[z.domyslna]),
            )
            .join('; '),
        )
      : '';
    if (u.dodane.length === 0) {
      notify.info(t.citDictFillNothing + zmienione);
      return;
    }
    const pytanie =
      t.citDictFillConfirm
        .replace('{n}', plural(u.dodane.length, language, ['regułę', 'reguły', 'reguł'], ['rule', 'rules']))
        .replace('{lista}', u.dodane.map((r) => `${t.citDictQuote.replace('{fraza}', r.fraza)} (${strona(r.strona)} → ${nazwy[r.kategoria]})`).join('; ')) + zmienione;
    if (await notify.confirm(pytanie, { confirmLabel: t.citDictFill })) setRules(u.slownik);
  };

  const przywrocWszystko = async () => {
    const wlasne = aktywne.filter((r) => !czyRegulaDomyslna(r)).length;
    const pytanie =
      wlasne > 0
        ? t.citDictRestoreConfirmLose.replace('{n}', plural(wlasne, language, ['własną regułę', 'własne reguły', 'własnych reguł'], ['own rule', 'own rules']))
        : t.citDictRestoreConfirm;
    if (await notify.confirm(pytanie, { danger: wlasne > 0, confirmLabel: t.citDictRestore })) setRules(defaultCitSlownik());
  };

  const setWybor = (klucz: string, w: WyborPrzegladu | null) =>
    setWybory((prev) => {
      const next = { ...prev };
      if (w) next[klucz] = w;
      else delete next[klucz];
      return next;
    });

  const zaproponujAi = async (strona: CitStrona) => {
    const cele = bezReguly[strona].filter((p) => !wybory[p.klucz]);
    if (cele.length === 0) {
      notify.info(t.citAiNothing);
      return;
    }
    setAiBusy(true);
    try {
      // The modal's rules as they stand, unsaved ones included, are the examples to follow.
      const { propozycje, zapasowy } = await window.electronAPI.klasyfikujCitAi(
        cele.map((p) => ({ klucz: p.klucz, nazwa: p.nazwa, strona: p.strona, sekcja: p.sekcja, kwota: p.kwota, ukryta: p.kwotaUkryta })),
        aktywne,
      );
      if (zapasowy) notify.warning(t.citAiFallback);
      const nowe: Record<string, WyborPrzegladu> = {};
      const niepewne: Record<string, CitAiPropozycja> = {};
      for (const w of propozycje) {
        if (!kategorieDlaStrony(strona).includes(w.kategoria)) continue;
        // A shared cost becomes a rule too, so the name is settled and leaves the list for good.
        if (w.niepewne) niepewne[w.klucz] = w;
        else nowe[w.klucz] = { kategoria: w.kategoria, ai: w.uzasadnienie };
      }
      setWybory((prev) => ({ ...prev, ...nowe }));
      setWatpliwosci((prev) => {
        const next = { ...prev, ...niepewne };
        for (const k of Object.keys(nowe)) delete next[k];
        return next;
      });
      const ile = Object.keys(nowe).length;
      const ileNiepewnych = Object.keys(niepewne).length;
      if (ile > 0) notify.success(t.citRevAiDone.replace('{n}', String(ile)));
      if (ileNiepewnych > 0) notify.warning(t.citAiUnsure.replace('{n}', String(ileNiepewnych)));
      if (ile + ileNiepewnych < cele.length) {
        notify.warning(t.citAiMissed.replace('{n}', String(cele.length - ile - ileNiepewnych)));
      }
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citAiError);
    } finally {
      setAiBusy(false);
    }
  };

  /** The picked names go on top of the list as rules of their full name — the most specific there are. */
  const dodajDoSlownika = async (strona: CitStrona) => {
    const lista = bezReguly[strona].filter((p) => wybory[p.klucz]);
    if (lista.length === 0) return;
    const ile = plural(lista.length, language, ['regułę', 'reguły', 'reguł'], ['rule', 'rules']);
    if (!(await notify.confirm(t.citRevAddConfirm.replace('{n}', ile), { confirmLabel: t.citRevAdd.replace('{n}', String(lista.length)) }))) {
      return;
    }
    setRules((prev) => [
      ...lista.map((p) => ({ id: newRuleId(), fraza: p.nazwa, strona: p.strona, kategoria: wybory[p.klucz].kategoria })),
      ...prev,
    ]);
    setWybory((prev) => {
      const next = { ...prev };
      for (const p of lista) delete next[p.klucz];
      return next;
    });
    setTab('reguly');
    notify.success(t.citRevAdded.replace('{n}', ile));
  };

  const nazwy = kategoriaNazwy(t);
  /** Who put the rule in — shown only for rules the built-in dictionary does not ship. */
  const autor = (r: CitSlownikRegula): string | null => {
    if (czyRegulaDomyslna(r)) return null;
    const z = zapisane.get(r.id);
    const zmieniona = !z || z.fraza !== r.fraza.trim() || z.strona !== r.strona || z.kategoria !== r.kategoria;
    if (zmieniona) return t.citDictAddedUnsaved;
    if (!r.dodano) return t.citDictAddedUnknown;
    return t.citDictAddedBy.replace('{kto}', r.dodal || '—').replace('{kiedy}', formatStamp(r.dodano, locale));
  };
  const stronaOptions = [
    { value: 'przychod', label: t.citStrona_przychod },
    { value: 'koszt', label: t.citStrona_koszt },
  ];
  const categoryOptions = (strona: CitStrona) =>
    kategorieDlaStrony(strona).map((k) => ({ value: k, label: nazwy[k] }));

  const q = foldText(filter);
  const bezTrafien = (r: CitSlownikRegula) => przeglad !== null && !!r.fraza.trim() && !trafienia.has(r.id);
  const ileBezTrafien = przeglad ? aktywne.filter(bezTrafien).length : 0;
  const visible = rules
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => tab !== 'bez' || bezTrafien(r))
    .filter(({ r }) => !q || foldText(r.fraza).includes(q) || foldText(nazwy[r.kategoria]).includes(q));

  const setRule = (id: string, patch: Partial<CitSlownikRegula>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // A rule keeps its category only when the new column allows it — otherwise saving would drop the row.
  const setStrona = (r: CitSlownikRegula, strona: CitStrona) =>
    setRule(r.id, {
      strona,
      kategoria: kategorieDlaStrony(strona).includes(r.kategoria) ? r.kategoria : kategorieDlaStrony(strona)[0],
    });
  const move = (index: number, by: number) =>
    setRules((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const save = async () => {
    // Picks of the review not yet added are what the user just worked on — saving without them would drop them silently.
    const czekajace = [...bezReguly.przychod, ...bezReguly.koszt].filter((p) => wybory[p.klucz]);
    let lista = rules;
    if (czekajace.length > 0) {
      const ile = plural(czekajace.length, language, ['wybraną pozycję', 'wybrane pozycje', 'wybranych pozycji'], ['picked item', 'picked items']);
      if (!(await notify.confirm(t.citRevSavePending.replace('{n}', ile), { confirmLabel: t.citRevSavePendingOk }))) return;
      lista = [
        ...czekajace.map((p) => ({ id: newRuleId(), fraza: p.nazwa, strona: p.strona, kategoria: wybory[p.klucz].kategoria })),
        ...rules,
      ];
      setRules(lista);
      setWybory({});
    }
    setSaving(true);
    try {
      const saved = await window.electronAPI.setPodatkiCitUstawienia({
        slownik: lista.filter((r) => r.fraza.trim()).map((r) => ({ ...r, fraza: r.fraza.trim() })),
      });
      notify.success(t.citDictSaved);
      onSaved(saved);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citDictSaveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="book" title={t.citDictTitle} subtitle={t.citDictSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <div className="zad-seg" role="group" aria-label={t.citDictTitle}>
            <button
              type="button"
              className={`zad-seg__btn${tab === 'reguly' ? ' is-active' : ''}`}
              aria-pressed={tab === 'reguly'}
              onClick={() => setTab('reguly')}
            >
              {t.citDictSection}
              <span className="zad-seg__count">{aktywne.length}</span>
            </button>
            {(['przychod', 'koszt'] as const).map((strona) => (
              <button
                key={strona}
                type="button"
                className={`zad-seg__btn${tab === strona ? ' is-active' : ''}`}
                aria-pressed={tab === strona}
                onClick={() => setTab(strona)}
              >
                {strona === 'przychod' ? t.citRevTabIncome : t.citRevTabCost}
                {przeglad && <span className="zad-seg__count">{bezReguly[strona].length}</span>}
              </button>
            ))}
            <button
              type="button"
              className={`zad-seg__btn${tab === 'bez' ? ' is-active' : ''}`}
              aria-pressed={tab === 'bez'}
              onClick={() => setTab('bez')}
            >
              {t.citDictNoHitsTab}
              {przeglad && <span className="zad-seg__count">{ileBezTrafien}</span>}
            </button>
            <button
              type="button"
              className={`zad-seg__btn${tab === 'audyt' ? ' is-active' : ''}`}
              aria-pressed={tab === 'audyt'}
              onClick={() => setTab('audyt')}
            >
              {t.citAudTab}
              {audyt && <span className="zad-seg__count">{rozbieznosci.length}</span>}
            </button>
          </div>
          {tab === 'audyt' ? (
            <AudytSlownika
              t={t}
              gotowy={przeglad !== null}
              blad={przegladBlad}
              sprawdzono={audyt !== null}
              rozbieznosci={rozbieznosci}
              aiBusy={aiBusy}
              onSprawdz={() => void sprawdzRegulyAi()}
              onPrzyjmij={przyjmijAudyt}
              onZostaw={(r) => setZostawione((prev) => new Set(prev).add(r.p.klucz))}
              onPokaz={(r) => {
                setFilter(r.regula.fraza);
                setTab('reguly');
              }}
            />
          ) : tab === 'przychod' || tab === 'koszt' ? (
            <PrzegladSlownika
              t={t}
              strona={tab}
              pozycje={przeglad ? bezReguly[tab] : null}
              blad={przegladBlad}
              wybory={wybory}
              watpliwosci={watpliwosci}
              aiBusy={aiBusy}
              onWybor={setWybor}
              onAi={() => void zaproponujAi(tab)}
              onDodaj={() => void dodajDoSlownika(tab)}
              onOdswiez={() => void wczytajPrzeglad()}
            />
          ) : (
          <FormSection
            icon="book"
            title={tab === 'bez' ? t.citDictNoHitsTitle : t.citDictSection}
            description={tab === 'bez' ? t.citDictNoHitsDesc : t.citDictDesc}
            aside={
              <div className="form-section__actions">
                <button type="button" className="button button-small button-subtle" onClick={() => void uzupelnij()}>
                  <Icon name="undo" size={13} /> {t.citDictFill}
                </button>
                <button type="button" className="button button-small button-ghost" onClick={() => void przywrocWszystko()}>
                  {t.citDictRestore}
                </button>
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() =>
                    setRules((prev) => [
                      { id: newRuleId(), fraza: '', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
                      ...prev,
                    ])
                  }
                >
                  <Icon name="plus" size={13} /> {t.citDictAdd}
                </button>
              </div>
            }
          >
            <div className="ksieg-search zset-search">
              <Icon name="search" size={15} />
              <input type="text" placeholder={t.citDictSearch} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="zset-rules">
              <div className="zset-rule cit-rule zset-rule--head">
                <span>#</span>
                <span>{t.citDictPhrase}</span>
                <span>{t.citDictSide}</span>
                <span>{t.citDictCategory}</span>
                <span />
              </div>
              {visible.map(({ r, index }) => (
                <div key={r.id} className="zset-rule cit-rule">
                  <span className="zeb-muted">{index + 1}</span>
                  <span className="cit-rule__fraza">
                    <input
                      type="text"
                      value={r.fraza}
                      placeholder={t.citDictPhrasePlaceholder}
                      onChange={(e) => setRule(r.id, { fraza: e.target.value })}
                      aria-label={t.citDictPhrase}
                    />
                    {autor(r) !== null && (
                      <Tip content={autor(r)} className="status-badge status-info">
                        {t.citDictAddedBadge}
                      </Tip>
                    )}
                    {bezTrafien(r) && (
                      <Tip
                        content={czyRegulaDomyslna(r) ? t.citDictNoHitsHintDefault : t.citDictNoHitsHint}
                        className={`status-badge ${czyRegulaDomyslna(r) ? 'status-neutral' : 'status-pending'}`}
                      >
                        {t.citDictNoHits}
                      </Tip>
                    )}
                  </span>
                  <Select
                    overlay
                    size="sm"
                    value={r.strona}
                    options={stronaOptions}
                    onChange={(s) => setStrona(r, s as CitStrona)}
                    ariaLabel={t.citDictSide}
                  />
                  <Select
                    overlay
                    size="sm"
                    value={r.kategoria}
                    options={categoryOptions(r.strona)}
                    onChange={(k) => setRule(r.id, { kategoria: k as CitKategoria })}
                    ariaLabel={t.citDictCategory}
                  />
                  <span className="row-actions">
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || tab === 'bez'}
                      data-tip={t.citDictMoveUp}
                      aria-label={t.citDictMoveUp}
                    >
                      <Icon name="arrow-up" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, 1)}
                      disabled={index === rules.length - 1 || tab === 'bez'}
                      data-tip={t.citDictMoveDown}
                      aria-label={t.citDictMoveDown}
                    >
                      <Icon name="arrow-down" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost icon-danger"
                      onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                      data-tip={t.citDictRemove}
                      aria-label={t.citDictRemove}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {visible.length === 0 && <p className="zeb-muted">{t.citDictNone}</p>}
            </div>
          </FormSection>
          )}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => void save()}
          submitLabel={t.save}
          submitIcon="save"
          busy={saving}
        />
      </div>
    </div>
  );
};

/* ================================ Statement ================================= */

/**
 * The statement a return is drawn from: the attached copy with its particulars,
 * or — while none is attached, or on "Zmień" — a picker over the library.
 * The community's own statements come first (full-year ones above partial
 * periods); the search over every statement is the way out when names differ.
 */
const SprawozdanieSekcja: React.FC<{
  t: T;
  locale: string;
  rok: number;
  dane: PodatekCitDane;
  /** The community's name and the other names its statements may carry. */
  nazwy: string[];
  /** The community's number in vDom, when Zebrania remembers it — the surest way to its statements. */
  vdomNr: number | null;
  /** Who attaches it — the signed-in account, kept with the snapshot. */
  kto: string;
  onAttach: (s: PodatekCitSprawozdanie) => void;
  /** The community's vDom number was learned from a statement picked by hand. */
  onVdomNr: (nr: number) => void;
  /** Resolves true when the statement was taken off (the person may decline). */
  onDetach: () => Promise<boolean>;
  /** Accept (true) or withdraw (false) the acceptance of a partial period. */
  onAkceptacja: (przyjety: boolean) => void;
  onPreview: () => void;
}> = ({ t, locale, rok, dane, nazwy, vdomNr, kto, onAttach, onVdomNr, onDetach, onAkceptacja, onPreview }) => {
  const notify = useNotify();
  const spr = dane.sprawozdanie;
  const [picking, setPicking] = useState(false);
  const [lista, setLista] = useState<SprawozdanieZapisane[] | null>(null);
  const [wszystkie, setWszystkie] = useState(false);
  const [q, setQ] = useState('');
  const [attachingId, setAttachingId] = useState<number | null>(null);
  /** The statement in the form was found by the app, not picked. */
  const [auto, setAuto] = useState(false);
  /** One attempt per editor session — a statement the person detached must not come back. */
  const autoProbowano = useRef(false);
  const open = picking || !spr;

  useEffect(() => {
    if (!open || lista) return;
    let alive = true;
    window.electronAPI
      .getSprawozdaniaLista()
      .then((rows) => alive && setLista(rows))
      .catch((err: unknown) => notify.error(bezPrefiksu(err), t.citStmtLoadError));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wlasne = useMemo(
    () =>
      sprawozdaniaDlaWspolnoty(lista ?? [], vdomNr, nazwy).sort(
        (a, b) => Number(pelnyRok(b, rok)) - Number(pelnyRok(a, rok)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, vdomNr, nazwy.join('|'), rok],
  );
  const wszystkieZFiltrem = useMemo(() => {
    const query = foldText(q.trim());
    return (lista ?? [])
      .filter((s) => !query || foldText(s.nazwa).includes(query) || String(s.nrWsp ?? '') === query)
      .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true }) || b.okresDo.localeCompare(a.okresDo));
  }, [lista, q]);
  const pokazane = (wszystkie ? wszystkieZFiltrem : wlasne).slice(0, 50);

  const attach = async (id: number, automatycznie = false) => {
    setAttachingId(id);
    try {
      const wynik = await pobierzMigawke(id, kto);
      if (!wynik) {
        notify.error(t.citStmtGone);
        return;
      }
      onAttach(wynik.migawka);
      setAuto(automatycznie);
      // Remembered for the next file, as Zebrania does — only when nothing is stored yet.
      if (vdomNr === null && wynik.nrWsp !== null) onVdomNr(wynik.nrWsp);
      setPicking(false);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citStmtAttachError);
    } finally {
      setAttachingId(null);
    }
  };

  // The community's full-year statement is attached as soon as the library is in.
  useEffect(() => {
    if (spr || !lista || autoProbowano.current) return;
    autoProbowano.current = true;
    const znaleziono = sprawozdanieDlaRoku(lista, vdomNr, nazwy, rok);
    if (znaleziono) void attach(znaleziono.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, spr]);

  const niepelny = !!spr && !okresPelny(spr.dane, rok);
  const zaakceptowany = !!spr && dane.zaakceptowanyOkres === okresKlucz(spr.dane);

  return (
    <FormSection
      icon="file-text"
      title={t.citSecStatement}
      description={t.citSecStatementDesc.replace('{rok}', String(rok))}
      aside={
        spr ? (
          <div className="form-section__actions">
            <button type="button" className="button button-small button-secondary" onClick={onPreview}>
              <Icon name="eye" size={13} /> {t.citStmtPreview}
            </button>
            <button type="button" className="button button-small button-ghost" onClick={() => setPicking((p) => !p)}>
              <Icon name="refresh" size={13} /> {t.citStmtChange}
            </button>
            <button
              type="button"
              className="button button-small button-ghost icon-danger"
              onClick={async () => {
                if (await onDetach()) setAuto(false);
              }}
            >
              <Icon name="x" size={13} /> {t.citStmtDetach}
            </button>
          </div>
        ) : undefined
      }
    >
      {spr && (
        <>
          <dl className="facts">
            <dt>{t.zfinPeriod}</dt>
            <dd>
              <strong>{okresLabel(spr.dane.okresOd, spr.dane.okresDo)}</strong>
            </dd>
            <dt>{t.citStmtFileLabel}</dt>
            <dd>{spr.plikNazwa || '—'}</dd>
            <dt>{t.citStmtAttachedLabel}</dt>
            <dd>{formatStamp(spr.dodano, locale)} · {spr.dodal || '—'}</dd>
          </dl>
          {auto && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.citStmtAuto.replace('{rok}', String(rok))}</div>
            </div>
          )}
          {niepelny && !zaakceptowany && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citStmtPartial.replace('{rok}', String(rok))}</div>
              <button type="button" className="button button-small button-secondary" onClick={() => onAkceptacja(true)}>
                <Icon name="check" size={13} /> {t.citStmtAccept}
              </button>
            </div>
          )}
          {niepelny && zaakceptowany && spr && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">
                {t.citStmtAccepted
                  .replace('{od}', formatData(spr.dane.okresOd))
                  .replace('{do}', formatData(spr.dane.okresDo))}
              </div>
              <button type="button" className="button button-small button-ghost" onClick={() => onAkceptacja(false)}>
                {t.citStmtAcceptUndo}
              </button>
            </div>
          )}
        </>
      )}
      {!spr && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.citStmtNone}</div>
        </div>
      )}
      {open && (
        <>
          {lista === null ? (
            <Loader label={t.loading} />
          ) : (
            <>
              <div className="list-filter zfin-filter">
                {wszystkie && (
                  <div className="input-icon">
                    <Icon name="search" size={15} />
                    <input
                      type="text"
                      placeholder={t.citStmtSearch}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      aria-label={t.citStmtSearch}
                    />
                  </div>
                )}
                <button type="button" className="button button-small button-ghost" onClick={() => setWszystkie((w) => !w)}>
                  <Icon name={wszystkie ? 'building' : 'search'} size={13} />{' '}
                  {wszystkie ? t.citStmtShowOwn : t.citStmtShowAll}
                </button>
              </div>
              {pokazane.length === 0 ? (
                <div className="form-empty">{wszystkie ? t.citStmtNoMatch : t.citStmtNoOwn}</div>
              ) : (
                <ul className="record-list">
                  {pokazane.map((s) => {
                    const pelny = pelnyRok(s, rok);
                    return (
                      <li key={s.id} className="record-row">
                        <div className="record-row__main">
                          <span className="record-row__title record-row__title--wrap">{s.nazwa}</span>
                          <span className="record-row__meta">
                            <span>{okresLabel(s.okresOd, s.okresDo)}</span>
                            <span className={`status-badge ${pelny ? 'status-success' : 'status-pending'}`}>
                              {pelny ? t.citStmtFullYear : t.citStmtPartialTag}
                            </span>
                            <span>{s.plikNazwa}</span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => void attach(s.id, false)}
                          disabled={attachingId !== null}
                        >
                          <Icon name={attachingId === s.id ? 'loader' : 'check'} size={13} /> {t.citStmtAttach}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </FormSection>
  );
};

/* ================================== Positions ================================== */

/**
 * The statement's income and cost rows, each with the category the return
 * counts it under — and the tools to settle the open ones: a pick by hand, the
 * AI's suggestion (which counts only once approved), a rule for the dictionary.
 */
const PozycjeSekcja: React.FC<{
  t: T;
  dane: PodatekCitDane;
  pozycje: PozycjaCitOcena[];
  slownik: CitSlownikRegula[];
  /** Decisions to merge into the return's own, keyed by row; null drops the row's own decision. */
  onKlasyfikacja: (patch: Record<string, CitKlasyfikacja | null>) => void;
  onSlownik: (value: PodatkiCitUstawienia) => void;
}> = ({ t, dane, pozycje, slownik, onKlasyfikacja, onSlownik }) => {
  const notify = useNotify();
  /** Rows the AI's two passes answered differently: left unsorted, with both answers beside them. */
  const [watpliwosci, setWatpliwosci] = useState<Record<string, CitAiPropozycja>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const nazwy = kategoriaNazwy(t);
  const doDecyzji = (p: PozycjaCitOcena) => p.kategoria === null || (p.zrodlo === 'ai' && !p.potwierdzona);
  const otwarte = pozycje.filter(doDecyzji);
  const doZatwierdzenia = pozycje.filter((p) => p.zrodlo === 'ai' && !p.potwierdzona);
  const widoczne = onlyOpen ? otwarte : pozycje;

  const wybierz = (p: PozycjaCitOcena, kategoria: CitKategoria) =>
    onKlasyfikacja({ [p.klucz]: { kategoria, zrodlo: 'reczne', potwierdzona: true } });

  const zatwierdz = (lista: PozycjaCitOcena[]) =>
    onKlasyfikacja(
      Object.fromEntries(
        lista.flatMap((p) =>
          p.kategoria
            ? [
                [
                  p.klucz,
                  {
                    kategoria: p.kategoria,
                    zrodlo: 'ai' as const,
                    potwierdzona: true,
                    ...(p.uzasadnienie ? { uzasadnienie: p.uzasadnienie } : {}),
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    );

  const dopasuj = async () => {
    const cele = pozycje.filter((p) => p.kategoria === null);
    if (cele.length === 0) {
      notify.info(t.citAiNothing);
      return;
    }
    setAiBusy(true);
    try {
      const { propozycje, zapasowy } = await window.electronAPI.klasyfikujCitAi(
        cele.map((p) => ({ klucz: p.klucz, nazwa: p.nazwa, strona: p.strona, sekcja: p.sekcja, kwota: p.kwota, ukryta: p.kwotaUkryta })),
        slownik,
      );
      if (zapasowy) notify.warning(t.citAiFallback);
      const byKlucz = new Map(cele.map((p) => [p.klucz, p]));
      // The AI may answer with a cost category for an income row; such an answer is no answer.
      const poprawne = propozycje.filter((w) => {
        const p = byKlucz.get(w.klucz);
        return !!p && kategorieDlaStrony(p.strona).includes(w.kategoria);
      });
      // Two passes that disagree leave the row to the accountant, unsorted.
      const przyjete = poprawne.filter((w) => !w.niepewne);
      const niepewne = poprawne.length - przyjete.length;
      setWatpliwosci((prev) => {
        const next = { ...prev };
        for (const w of poprawne) {
          if (w.niepewne) next[w.klucz] = w;
          else delete next[w.klucz];
        }
        return next;
      });
      onKlasyfikacja(
        Object.fromEntries(
          przyjete.map((w) => [
            w.klucz,
            { kategoria: w.kategoria, zrodlo: 'ai' as const, potwierdzona: false, uzasadnienie: w.uzasadnienie },
          ]),
        ),
      );
      if (przyjete.length > 0) notify.success(t.citAiDone.replace('{n}', String(przyjete.length)));
      if (niepewne > 0) notify.warning(t.citAiUnsure.replace('{n}', String(niepewne)));
      if (poprawne.length < cele.length) {
        notify.warning(t.citAiMissed.replace('{n}', String(cele.length - poprawne.length)));
      }
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citAiError);
    } finally {
      setAiBusy(false);
    }
  };

  /** The row's phrase goes on top of the dictionary — it is the most specific one there. */
  const zapiszRegule = async (p: PozycjaCitOcena) => {
    if (!p.kategoria) return;
    const fraza = foldText(p.nazwa);
    const stara = slownik.findIndex((r) => r.strona === p.strona && foldText(r.fraza) === fraza);
    const pytanie =
      t.citRuleConfirm
        .replace('{fraza}', p.nazwa)
        .replace('{kolumna}', p.strona === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt)
        .replace('{kategoria}', kategoriaNazwy(t)[p.kategoria]) +
      (stara >= 0 ? ' ' + t.citRuleConfirmReplaces.replace('{nr}', String(stara + 1)) : '');
    if (!(await notify.confirm(pytanie, { confirmLabel: t.citRuleSave }))) return;
    setRuleBusy(p.klucz);
    try {
      const saved = await window.electronAPI.setPodatkiCitUstawienia({
        slownik: [
          { id: newRuleId(), fraza: p.nazwa, strona: p.strona, kategoria: p.kategoria },
          ...slownik.filter((r) => !(r.strona === p.strona && foldText(r.fraza) === fraza)),
        ],
      });
      onSlownik(saved);
      notify.success(t.citRuleSaved.replace('{fraza}', p.nazwa));
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citRuleSaveError);
    } finally {
      setRuleBusy(null);
    }
  };

  const zrodlo = (p: PozycjaCitOcena): { text: string; tone: string; hint?: string } => {
    switch (p.zrodlo) {
      case 'regula':
        return { text: t.citZrodlo_regula, tone: 'status-neutral' };
      case 'ai':
        return p.potwierdzona
          ? { text: t.citZrodlo_aiOk, tone: 'status-info', hint: p.uzasadnienie }
          : { text: t.citZrodlo_ai, tone: 'status-pending', hint: p.uzasadnienie };
      case 'reczne':
        return { text: t.citZrodlo_reczne, tone: 'status-success' };
      case 'domyslna':
        return { text: t.citZrodlo_domyslna, tone: 'status-neutral', hint: t.citZrodloDomyslnaHint };
      default:
        return { text: t.citZrodlo_none, tone: 'status-pending' };
    }
  };

  const bezKategorii = pozycje.filter((p) => p.kategoria === null).length;

  return (
    <FormSection
      icon="table"
      title={t.citSecPositions}
      description={t.citSecPositionsDesc}
      badge={otwarte.length > 0 ? <span className="status-badge status-pending">{otwarte.length}</span> : undefined}
      aside={
        dane.sprawozdanie ? (
          <div className="form-section__actions">
            <Tip content={t.citAiSortHint}>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void dopasuj()}
                disabled={aiBusy}
              >
                <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {t.citAiSort}
              </button>
            </Tip>
            {doZatwierdzenia.length > 0 && (
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => zatwierdz(doZatwierdzenia)}
              >
                <Icon name="check-circle" size={13} />{' '}
                {t.citAiAcceptAll.replace('{n}', String(doZatwierdzenia.length))}
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {!dane.sprawozdanie ? (
        <div className="form-empty">{t.citPositionsNoStatement}</div>
      ) : pozycje.length === 0 ? (
        <div className="form-empty">{t.citPositionsEmpty}</div>
      ) : (
        <>
          {bezKategorii > 0 && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citUnsortedCallout.replace('{n}', String(bezKategorii))}</div>
            </div>
          )}
          {aiBusy && (
            <span className="action-note">
              <Icon name="loader" size={13} /> {t.citAiBusy}
            </span>
          )}
          {otwarte.length > 0 && (
            <div className="zad-seg" role="group" aria-label={t.citSecPositions}>
              <button
                type="button"
                className={`zad-seg__btn${!onlyOpen ? ' is-active' : ''}`}
                aria-pressed={!onlyOpen}
                onClick={() => setOnlyOpen(false)}
              >
                {t.podFilterAll}
                <span className="zad-seg__count">{pozycje.length}</span>
              </button>
              <button
                type="button"
                className={`zad-seg__btn${onlyOpen ? ' is-active' : ''}`}
                aria-pressed={onlyOpen}
                onClick={() => setOnlyOpen(true)}
              >
                {t.citOnlyOpen.replace('{n}', String(otwarte.length))}
              </button>
            </div>
          )}
          <div className="table-scroll">
            <table className="zfin-table cit-table">
              <thead>
                <tr>
                  <th>{t.citColName}</th>
                  <th className="zfin-num">{t.citColAmount}</th>
                  <th>{t.citColCategory}</th>
                  <th>{t.citColSource}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {widoczne.map((p) => {
                  const z = zrodlo(p);
                  const open = doDecyzji(p);
                  const mozeRegula = p.kategoria !== null && (p.zrodlo === 'reczne' || (p.zrodlo === 'ai' && p.potwierdzona));
                  return (
                    <tr key={p.klucz} className={open ? 'cit-row--open' : undefined}>
                      <td>
                        <div className="cit-pos__name" data-tip={p.wierszy > 1 ? t.citRowMerged.replace('{n}', String(p.wierszy)) : undefined}>
                          {p.nazwa}
                        </div>
                        <div className="cit-pos__meta">
                          {p.sekcja === 'fundusz' ? t.citSekcja_fundusz : t.citSekcja_eksploatacja} ·{' '}
                          {p.strona === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt}
                        </div>
                      </td>
                      <td className="zfin-num">{formatKwota(p.kwota)}</td>
                      <td className="cit-pos__category">
                        <Select
                          overlay
                          size="sm"
                          value={p.kategoria}
                          placeholder={t.citPickCategory}
                          options={kategorieDlaStrony(p.strona).map((k) => ({ value: k, label: nazwy[k] }))}
                          onChange={(k) => wybierz(p, k as CitKategoria)}
                          ariaLabel={`${t.citColCategory}: ${p.nazwa}`}
                        />
                      </td>
                      <td>
                        {p.kategoria === null && watpliwosci[p.klucz] ? (
                          <Tip content={<WatpliwoscAi t={t} w={watpliwosci[p.klucz]} />} className="status-badge status-pending">
                            {t.citRevSourceUnsure}
                          </Tip>
                        ) : z.hint ? (
                          <Tip content={z.hint} className={`status-badge ${z.tone}`}>
                            {z.text}
                          </Tip>
                        ) : (
                          <span className={`status-badge ${z.tone}`}>{z.text}</span>
                        )}
                      </td>
                      <td>
                        <span className="row-actions">
                          {p.zrodlo === 'ai' && !p.potwierdzona && (
                            <button
                              type="button"
                              className="button button-icon button-ghost"
                              onClick={() => zatwierdz([p])}
                              data-tip={t.citAiAccept}
                              aria-label={`${t.citAiAccept}: ${p.nazwa}`}
                            >
                              <Icon name="check" size={13} />
                            </button>
                          )}
                          {p.wlasna && (
                            <Tip content={t.citRowRestoreHint}>
                              <button
                                type="button"
                                className="button button-icon button-ghost"
                                onClick={() => onKlasyfikacja({ [p.klucz]: null })}
                                aria-label={`${t.citRowRestore}: ${p.nazwa}`}
                              >
                                <Icon name="undo" size={13} />
                              </button>
                            </Tip>
                          )}
                          {p.kategoria !== null && (
                            <Tip content={t.citRowClearHint}>
                              <button
                                type="button"
                                className="button button-icon button-ghost"
                                onClick={() => onKlasyfikacja({ [p.klucz]: { kategoria: null, zrodlo: 'reczne', potwierdzona: true } })}
                                aria-label={`${t.citRowClear}: ${p.nazwa}`}
                              >
                                <Icon name="x" size={13} />
                              </button>
                            </Tip>
                          )}
                          {mozeRegula && (
                            <button
                              type="button"
                              className="button button-icon button-ghost"
                              onClick={() => void zapiszRegule(p)}
                              disabled={ruleBusy !== null}
                              data-tip={t.citRuleSave}
                              aria-label={`${t.citRuleSave}: ${p.nazwa}`}
                            >
                              <Icon name={ruleBusy === p.klucz ? 'loader' : 'book'} size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FormSection>
  );
};

/* ================================== Summary ================================== */

/**
 * The tax as the PDF will print it — worked out with the same code — and what
 * still keeps the PDF from being made.
 */
const WyliczenieSekcja: React.FC<{
  t: T;
  rok: number;
  dane: PodatekCitDane;
  wynik: ObliczenieCIT8;
  problemy: ProblemCit8[];
  /** Everything that stops the XML — the PDF's problems among them; the rest is listed apart. */
  problemyXml: ProblemCit8[];
}> = ({ t, rok, dane, wynik, problemy, problemyXml }) => {
  const tylkoXml = problemyXml.filter(problemTylkoXml);
  const line = (label: string, value: number, strong = false) => (
    <>
      <dt>{label}</dt>
      <dd>
        <span className={`pod-calc__sum${strong ? ' pod-calc__sum--total' : ''}`}>{strong ? `${formatZl(value)} zł` : zl2(value)}</span>
      </dd>
    </>
  );

  return (
    <FormSection icon="coins" title={t.citSecSummary} description={t.citSecSummaryDesc}>
      {problemy.length > 0 && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            {t.podPdfBlocked}
            <ul className="pod-problems">
              {problemy.map((p, i) => (
                <li key={i}>{problemText(t, p, rok)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {tylkoXml.length > 0 && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            {t.citXmlBlocked}
            <ul className="pod-problems">
              {tylkoXml.map((p, i) => (
                <li key={i}>{problemText(t, p, rok)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!dane.sprawozdanie ? (
        <div className="form-empty">{t.citSumNone}</div>
      ) : (
        <>
          <dl className="facts pod-calc">
            {line(t.citSumIncomeTaxed, wynik.przychodyOpodatkowane)}
            {line(t.citSumIncomeExempt, wynik.przychodyZwolnione)}
            {line(t.citSumCostsTaxed, wynik.kosztyOpodatkowane)}
            {line(t.citSumCostsExempt, wynik.kosztyZwolnione)}
            {wynik.kosztyPonadZwolnione > 0 && line(t.citSumCostsAbove, wynik.kosztyPonadZwolnione)}
            {wynik.kosztyNiezaliczone > 0 && line(t.citSumCostsNot, wynik.kosztyNiezaliczone)}
            {line(t.citSumExemptIncome, wynik.dochodZwolniony)}
            {line(t.citSumTaxedIncome, wynik.dochodOpodatkowany)}
            {line(t.citSumBase, wynik.poz[138] ?? 0)}
            {line(t.citSumTax, wynik.podatek, true)}
            {line(t.citSumAdvances, wynik.zaliczkiZaplacone)}
            {wynik.nadplata > 0 ? line(t.citSumOverpaid, wynik.nadplata, true) : line(t.citSumToPay, wynik.doZaplaty, true)}
          </dl>
          {wynik.kosztyWspolne > 0 && (
            <p className="pod-note">
              {t.citSumCostsShared
                .replace('{kwota}', formatKwota(wynik.kosztyWspolne))
                .replace('{udzial}', (wynik.udzialOpodatkowany * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 }))}
            </p>
          )}
          {wynik.strata > 0 && <p className="pod-note">{t.citSumLoss.replace('{kwota}', formatKwota(wynik.strata))}</p>}
          {wynik.cit8o && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.citSumCit8o}</div>
            </div>
          )}
        </>
      )}
    </FormSection>
  );
};

/* ================================ One return ================================ */

/**
 * What "unsaved changes" ignores: downloads and the filing mark are written at
 * once by their own calls, so they never make the form dirty.
 */
const CIT_NIE_EDYCJA = ['pobrania', 'zlozone'] as const;
/** Whether the form holds what was last loaded or saved — see structuralEqual. */
const sameDane = (a: PodatekCitDane, b: PodatekCitDane) => structuralEqual(a, b, CIT_NIE_EDYCJA);

/** Months that end a quarter — the only ones quarterly advances use. */
const KONIEC_KWARTALU = [2, 5, 8, 11];

/**
 * One community's CIT-8 for one year, as a page form: identification, the
 * attached statement and the decisions on its rows, the advances paid, and the
 * tax worked out live with the same code the PDF uses. A community without a
 * return yet opens on a draft (`szkic`) and gets its row on the first save.
 */
const ZeznanieScreen: React.FC<{
  language: Language;
  locale: string;
  rok: number;
  /** The community — `Adres.nazwa`, which is what the return is kept under. */
  adresNazwa: string;
  /** Null when the community is gone from Adresy: its return stays, flagged. */
  adres: Adres | null;
  rekord: PodatekCit | null;
  /** What a community without a return starts from, and the year it was carried over from. */
  szkic: { dane: PodatekCitDane; zRoku: number | null };
  slownik: CitSlownikRegula[];
  vdomNr: number | null;
  /** The signed-in account — kept with an attached statement. */
  kto: string;
  onVdomNr: (nr: number) => void;
  onSlownik: (value: PodatkiCitUstawienia) => void;
  onBack: () => void;
  onSaved: (rek: PodatekCit) => void;
  onDeleted: () => void;
  onDownloaded: () => void;
  onSetZlozone: (filed: boolean) => void;
  zlozoneBusy: boolean;
}> = ({
  language,
  locale,
  rok,
  adresNazwa,
  adres,
  rekord,
  szkic,
  slownik,
  vdomNr,
  kto,
  onVdomNr,
  onSlownik,
  onBack,
  onSaved,
  onDeleted,
  onDownloaded,
  onSetZlozone,
  zlozoneBusy,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [dane, setDane] = useState<PodatekCitDane>(rekord?.dane ?? szkic.dane);
  // A draft counts as unchanged until it is edited, but it can still be saved as it is.
  const [baseline, setBaseline] = useState<PodatekCitDane>(() => rekord?.dane ?? szkic.dane);
  const [busy, setBusy] = useState<null | 'save' | 'pdf' | 'xml' | 'delete'>(null);
  const [podpisOpen, setPodpisOpen] = useState(false);
  const [pdfPodpisany, setPdfPodpisany] = useState(false);
  const [wyslij, setWyslij] = useState(false);
  const [upoBusy, setUpoBusy] = useState(false);
  const [podgladOpen, setPodgladOpen] = useState(false);

  // Walks only what an edit replaced — no serializing of the whole return
  // (attached statement included) on every key pressed.
  const dirty = useMemo(() => !sameDane(dane, baseline), [dane, baseline]);
  // The statement's rows and their categories depend on the statement, the
  // return's own decisions and the dictionary — not on the NIP being typed.
  const pozycje = useMemo(
    () => pozycjeZeSprawozdania(dane, slownik),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dane.sprawozdanie, dane.klasyfikacja, slownik],
  );
  const wynik = useMemo(() => obliczCIT8(dane, pozycje), [dane, pozycje]);
  const problemy = useMemo(() => problemyCIT8({ rok, dane }, slownik, pozycje), [rok, dane, slownik, pozycje]);
  /** The PDF's problems and those only the XML has — the XML is what is filed, and what gets signed. */
  const problemyXml = useMemo(() => [...problemy, ...problemyTylkoXmlCIT8({ rok, dane })], [problemy, rok, dane]);
  const wzor = citWzor(rok);
  const canAdd = dane.nip.length === 10 && dane.nazwaPelna.trim() !== '';
  const odswiez = () => {
    setDane((d) => zAdresu(d, adres?.identyfikacja));
    notify.success(t.citRefreshed);
  };
  /** "Refresh from Adresy" — in the return's section for the office, in the taxpayer's for the rest. */
  const przyciskOdswiez = (
    <Tip content={adres?.identyfikacja ? t.citRefreshHint : t.citRefreshNone}>
      <button
        type="button"
        className="button button-small button-secondary"
        onClick={odswiez}
        disabled={!adres?.identyfikacja}
      >
        <Icon name="refresh" size={13} /> {t.citRefresh}
      </button>
    </Tip>
  );
  /** Names a statement of this community may be filed under. */
  const nazwy = useMemo(() => [adresNazwa, ...(adres?.alternativeNames ?? [])], [adresNazwa, adres]);

  const set = <K extends keyof PodatekCitDane>(key: K, value: PodatekCitDane[K]) =>
    setDane((d) => ({ ...d, [key]: value }));
  const setAdres = (key: keyof PodatekAdres, value: string) =>
    setDane((d) => ({ ...d, siedziba: { ...d.siedziba, [key]: value } }));
  const kodyUrzedow = useMemo(() => [{ value: '', label: t.adresIdentKodUrzeduBrak }, ...urzedyOpcje(true)], [t]);
  /** As in Adresy: the code names its office — an empty name, or the one the previous code put there, follows the pick. */
  const setKodUrzedu = (kod: string) =>
    setDane((d) => {
      const nazwaKodu = nazwaUrzedu(kod);
      const zKodu = !d.urzad.trim() || d.urzad === nazwaUrzedu(d.kodUrzedu);
      return { ...d, kodUrzedu: kod, urzad: nazwaKodu && zKodu ? nazwaKodu : d.urzad };
    });
  const setZaliczka = (i: number, value: number | null) =>
    setDane((d) => ({ ...d, zaliczki: d.zaliczki.map((z, j) => (j === i ? value : z)) }));
  /** Null drops the return's own decision for the row, so the dictionary sorts it again. */
  const mergeKlasyfikacja = (patch: Record<string, CitKlasyfikacja | null>) =>
    setDane((d) => {
      const klasyfikacja = { ...d.klasyfikacja };
      for (const [klucz, v] of Object.entries(patch)) {
        if (v) klasyfikacja[klucz] = v;
        else delete klasyfikacja[klucz];
      }
      return { ...d, klasyfikacja };
    });

  /** The totals add up every month, so quarterly mode must not leave amounts in the months it does not use. */
  const setKwartalne = async (kwartalne: boolean) => {
    const tracone = kwartalne ? dane.zaliczki.filter((z, i) => z !== null && !KONIEC_KWARTALU.includes(i)).length : 0;
    if (tracone > 0 && !(await notify.confirm(t.citQuarterlyLose, { danger: true, confirmLabel: t.citQuarterly }))) return;
    setDane((d) => ({
      ...d,
      zaliczkiKwartalne: kwartalne,
      zaliczki: kwartalne ? d.zaliczki.map((z, i) => (KONIEC_KWARTALU.includes(i) ? z : null)) : d.zaliczki,
    }));
  };

  const back = async () => {
    if (dirty) {
      const canSave = !!rekord || canAdd;
      const choice = await notify.unsaved(canSave ? t.podUnsavedConfirm : t.podUnsavedNoSave, {
        saveLabel: t.podUnsavedSave,
        discardLabel: t.podUnsavedDiscard,
        keepLabel: t.podUnsavedKeep,
        canSave,
      });
      if (choice === 'keep' || (choice === 'save' && !(await save()))) return;
    }
    onBack();
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = rekord
        ? await window.electronAPI.setPodatekCit(rekord.id, dane)
        : await window.electronAPI.addPodatekCit(adresNazwa, rok, dane);
      setDane(saved.dane);
      setBaseline(saved.dane);
      notify.success(t.podSaved);
      onSaved(saved);
      return true;
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podSaveError);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!rekord) return;
    setBusy('pdf');
    try {
      const { filePath } = await window.electronAPI.exportPodatekCitPdf(rekord.id);
      notify.success(t.podDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podDownloadError);
    } finally {
      setBusy(null);
    }
  };

  const downloadXml = async () => {
    if (!rekord) return;
    setBusy('xml');
    try {
      const { filePath } = await window.electronAPI.exportPodatekCitXml(rekord.id);
      notify.success(t.citXmlDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citXmlError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * The signing run of the list with this one return: the XML with XAdES, the PDF next to it. Errors stay in
   * the signing modal (wrong PIN, card pulled out) — it shows them itself.
   */
  const podpisz = async (wybor: PodpisWybor) => {
    if (!rekord) return;
    const potwierdzoneKorekty = await potwierdzKorekty(t, notify, [rekord], wyslij);
    const wynik = await window.electronAPI.podpiszPodatkiCit(rok, [rekord.id], wybor, { pdfPodpisany, wyslij, potwierdzoneKorekty });
    setPodpisOpen(false);
    const xml = wynik.podpisane.find((p) => p.sciezka.endsWith('.xml'));
    if (xml) {
      notify.success(t.citSigned.replace('{file}', baseName(xml.sciezka)), { file: xml.sciezka });
      const w = wynik.wysylki?.[0];
      if (w) {
        const tekst = `${t.citSendOption} (${w.srodowisko === 'prod' ? t.citEnvProd : t.citEnvTest}): ${etapWysylkiText(t, w.status, w.refId, w.niepewna)}${
          w.refId ? ` — ${t.citSendRef.replace('{ref}', w.refId)}` : ''
        }${w.opis ? `. ${w.opis}` : ''}`;
        // A send whose record was lost, or with no answer at all, is never reported as a success.
        if (w.niezapisana) notify.error(tekst, t.citSendNotRecordedTitle);
        else if (w.refId && !w.niepewna) notify.success(tekst);
        else notify.warning(tekst);
      }
      onDownloaded();
    } else {
      const powod = wynik.przerwano ?? wynik.pominiete.map((p) => p.powod).join(' ');
      notify.error(t.citSignFailed.replace('{reason}', powod));
    }
  };

  const remove = async () => {
    if (!rekord) return;
    if (
      !(await notify.confirm(
        t.podDeleteConfirm.replace('{name}', adresNazwa).replace('{rok}', String(rok)),
        { danger: true, confirmLabel: t.delete },
      ))
    ) {
      return;
    }
    setBusy('delete');
    try {
      await window.electronAPI.deletePodatekCit(rekord.id);
      notify.success(t.podDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err));
      setBusy(null);
    }
  };

  const ulica = ulicaZNumerem(dane.siedziba);
  /** Why the file can't be made yet — the top bar's buttons say it on hover. */
  const pdfBlocked =
    !rekord || dirty
      ? t.podPdfSaveFirst
      : problemy.length > 0
        ? `${t.podPdfBlocked} ${problemy.map((p) => problemText(t, p, rok)).join(' ')}`
        : null;
  /** Why the XML — and with it the signature — can't be made yet. */
  const xmlBlocked =
    pdfBlocked ??
    (problemyXml.length > 0 ? `${t.citXmlBlocked} ${problemyXml.map((p) => problemText(t, p, rok)).join(' ')}` : null);

  const note = !rekord && !canAdd ? (
    <span className="action-note">
      <Icon name="info" size={13} /> {t.citNewNeeds}
    </span>
  ) : dirty ? (
    <span className="action-note action-note--warning">
      <Icon name="alert-triangle" size={13} /> {t.podUnsaved}
    </span>
  ) : (
    <span className="action-note">
      <Icon name="check" size={13} /> {t.podAllSaved}
    </span>
  );

  const miesiac = (i: number) => new Date(2000, i, 1).toLocaleString(locale, { month: 'long' });
  const zaliczkiPola = dane.zaliczkiKwartalne ? KONIEC_KWARTALU : dane.zaliczki.map((_, i) => i);
  const wpisGotowosci = (cert: PodpisCertyfikat | null): WpisGotowosci[] =>
    rekord
      ? [
          {
            nazwa: adresNazwa,
            problemy: problemyXml.map((p) => problemText(t, p, rok)),
            uwagi: uwagiPodpisu(rekord.dane, cert?.podmiot ?? null),
          },
        ]
      : [];

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.podBack}
            crumb={`${t.citTitle} · ${rok}`}
            onBack={() => void back()}
            title={adresNazwa}
            meta={
              <>
                <span>
                  <Icon name="calendar" size={13} /> {t.podMetaYear.replace('{rok}', String(rok))}
                </span>
                {dane.nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', dane.nip)}
                  </span>
                )}
                {ulica && (
                  <span>
                    <Icon name="map-pin" size={13} /> {ulica}
                  </span>
                )}
                {dane.cel === 2 && <span className="status-badge status-pending">{t.podMetaCorrection}</span>}
                {!adres && <span className="status-badge status-pending">{t.citOrphanBadge}</span>}
              </>
            }
          />
          {/* The return's actions, in the order of the work: the rare
              destructive one first and set apart, then the file — plain or
              signed — and last the "filed" tick, which closes the job. */}
          {rekord && (
            <div className="pod-head-actions">
              <button
                type="button"
                className="button button-small button-ghost icon-danger"
                onClick={() => void remove()}
                disabled={busy !== null}
              >
                <Icon name="trash" size={13} /> {t.delete}
              </button>
              <span className="toolbar-divider" aria-hidden="true" />
              <PodpowiedzPrzycisku tresc={pdfBlocked}>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void download()}
                  disabled={pdfBlocked !== null || busy !== null}
                >
                  <Icon name={busy === 'pdf' ? 'loader' : 'download'} size={13} /> {t.podDownloadPdf}
                </button>
              </PodpowiedzPrzycisku>
              <PodpowiedzPrzycisku tresc={xmlBlocked}>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void downloadXml()}
                  disabled={xmlBlocked !== null || busy !== null}
                >
                  <Icon name={busy === 'xml' ? 'loader' : 'download'} size={13} /> {t.citDownloadXml}
                </button>
              </PodpowiedzPrzycisku>
              <PodpowiedzPrzycisku tresc={xmlBlocked ?? t.citSignHint}>
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() => setPodpisOpen(true)}
                  disabled={xmlBlocked !== null || busy !== null}
                >
                  <Icon name="signature" size={13} /> {t.citSignCard}
                </button>
              </PodpowiedzPrzycisku>
              <DomSlot
                t={t}
                locale={locale}
                dom={rekord.dane.zlozone}
                busy={zlozoneBusy}
                onSet={onSetZlozone}
                size="button"
                labels={zlozoneLabels(t)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="content-body">
        <div className="page-form">
          {!adres && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citOrphanHint}</div>
            </div>
          )}
          {wzor && !wzor.potwierdzony && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citWzorUnconfirmed.replace('{rok}', String(rok))}</div>
            </div>
          )}
          {!rekord && szkic.zRoku !== null && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.citDraftFrom.replace('{rok}', String(szkic.zRoku))}</div>
            </div>
          )}
          <FormSection icon="landmark" title={t.citSecReturn} description={t.citSecReturnDesc} aside={przyciskOdswiez}>
            <FormRow>
              <FormField label={t.citUrzad} htmlFor="cit-urzad" required hint={t.citUrzadHint}>
                <input id="cit-urzad" type="text" value={dane.urzad} onChange={(e) => set('urzad', e.target.value)} />
              </FormField>
              <FormField label={t.citKodUrzedu} required hint={t.citKodUrzeduHint}>
                <SearchableSelect
                  overlay
                  value={dane.kodUrzedu}
                  options={kodyUrzedow}
                  onChange={setKodUrzedu}
                  ariaLabel={t.citKodUrzedu}
                  searchPlaceholder={t.adresIdentKodUrzeduSearch}
                  emptyText={t.adresIdentKodUrzeduEmpty}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={t.citCel}>
                <div className="zad-seg" role="radiogroup" aria-label={t.citCel}>
                  {([1, 2] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={dane.cel === c}
                      className={`zad-seg__btn${dane.cel === c ? ' is-active' : ''}`}
                      onClick={() =>
                        setDane((d) => ({ ...d, cel: c, rodzajKorekty: c === 2 ? d.rodzajKorekty ?? 1 : null }))
                      }
                    >
                      {c === 1 ? t.citCel1 : t.citCel2}
                    </button>
                  ))}
                </div>
              </FormField>
              {dane.cel === 2 && (
                <FormField label={t.citRodzajKorekty}>
                  <Select
                    value={String(dane.rodzajKorekty ?? 1)}
                    options={[
                      { value: '1', label: t.citKorekta1 },
                      { value: '2', label: t.citKorekta2 },
                    ]}
                    onChange={(v) => set('rodzajKorekty', v === '2' ? 2 : 1)}
                    ariaLabel={t.citRodzajKorekty}
                  />
                </FormField>
              )}
              <FormField label={t.citStawka}>
                <div className="zad-seg" role="radiogroup" aria-label={t.citStawka}>
                  {([9, 19] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={dane.stawka === s}
                      className={`zad-seg__btn${dane.stawka === s ? ' is-active' : ''}`}
                      onClick={() => set('stawka', s)}
                    >
                      {s === 9 ? t.citStawka9 : t.citStawka19}
                    </button>
                  ))}
                </div>
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection
            icon="building"
            title={t.citSecTaxpayer}
            description={t.citSecTaxpayerDesc}
            aside={przyciskOdswiez}
          >
            <FormField
              label={t.podNip}
              htmlFor="cit-nip"
              required
              hint={adres && !adres.identyfikacja?.nip ? t.citNoNipInAdresy : undefined}
              error={dane.nip.length === 10 && !nipPoprawny(dane.nip) ? t.podNipInvalid : null}
            >
              <input
                id="cit-nip"
                type="text"
                inputMode="numeric"
                className="input-mono"
                value={dane.nip}
                onChange={(e) => set('nip', tylkoCyfry(e.target.value).slice(0, 10))}
              />
            </FormField>
            <FormField label={t.podNazwaPelna} htmlFor="cit-nazwa" required>
              <input
                id="cit-nazwa"
                type="text"
                value={dane.nazwaPelna}
                onChange={(e) => set('nazwaPelna', e.target.value)}
              />
            </FormField>
          </FormSection>

          <FormSection icon="map-pin" title={t.podSecSeat} description={t.citSecSeatDesc}>
            <AdresFields t={t} idPrefix="cit-siedziba" value={dane.siedziba} onChange={setAdres} />
          </FormSection>

          <SprawozdanieSekcja
            t={t}
            locale={locale}
            rok={rok}
            dane={dane}
            nazwy={nazwy}
            vdomNr={vdomNr}
            kto={kto}
            onAttach={(s) => set('sprawozdanie', s)}
            onVdomNr={onVdomNr}
            onDetach={async () => {
              if (!(await notify.confirm(t.citStmtDetachConfirm, { danger: true, confirmLabel: t.citStmtDetach }))) {
                return false;
              }
              set('sprawozdanie', null);
              return true;
            }}
            onAkceptacja={(przyjety) =>
              setDane((d) => ({
                ...d,
                zaakceptowanyOkres: przyjety && d.sprawozdanie ? okresKlucz(d.sprawozdanie.dane) : null,
              }))
            }
            onPreview={() => setPodgladOpen(true)}
          />

          <PozycjeSekcja
            t={t}
            dane={dane}
            pozycje={pozycje}
            slownik={slownik}
            onKlasyfikacja={mergeKlasyfikacja}
            onSlownik={onSlownik}
          />

          <FormSection
            icon="wallet"
            title={t.citSecAdvances}
            description={t.citSecAdvancesDesc.replace('{rok}', String(rok))}
          >
            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">{t.citQuarterly}</span>
                <span className="switch-row__hint">{t.citQuarterlyHint}</span>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={dane.zaliczkiKwartalne}
                  onChange={(e) => void setKwartalne(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </span>
            </label>
            <div className="pod-grid">
              {zaliczkiPola.map((i) => (
                <div key={i} className={dane.zaliczkiKwartalne ? 'pod-span-3' : 'pod-span-1'}>
                  <FormField
                    label={
                      dane.zaliczkiKwartalne
                        ? t.citQuarter.replace('{n}', String((i + 1) / 3))
                        : miesiac(i)
                    }
                    htmlFor={`cit-zal-${i}`}
                  >
                    <LiczbaInput
                      id={`cit-zal-${i}`}
                      value={dane.zaliczki[i]}
                      onChange={(v) => setZaliczka(i, v === null ? null : Math.round(v))}
                      decimals={0}
                      unit="zł"
                    />
                  </FormField>
                </div>
              ))}
            </div>
            <p className="pod-note">{t.citAdvancesTotal.replace('{kwota}', formatZl(wynik.zaliczkiZaplacone))}</p>
          </FormSection>

          <WyliczenieSekcja t={t} rok={rok} dane={dane} wynik={wynik} problemy={problemy} problemyXml={problemyXml} />

          <FormSection icon="users" title={t.citSecSign} description={t.citSecSignDesc}>
            <FormRow>
              <FormField label={t.citImie} htmlFor="cit-imie">
                <input
                  id="cit-imie"
                  type="text"
                  value={dane.reprezentant.imie}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, imie: e.target.value })}
                />
              </FormField>
              <FormField label={t.citNazwisko} htmlFor="cit-nazwisko">
                <input
                  id="cit-nazwisko"
                  type="text"
                  value={dane.reprezentant.nazwisko}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, nazwisko: e.target.value })}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField
                label={t.citData}
                htmlFor="cit-data"
                hint={t.podDataHint}
                action={
                  <button
                    type="button"
                    className="button button-small button-ghost"
                    onClick={() => set('reprezentant', { ...dane.reprezentant, dataWypelnienia: dzisIso() })}
                  >
                    {t.podToday}
                  </button>
                }
              >
                <input
                  id="cit-data"
                  type="date"
                  value={dane.reprezentant.dataWypelnienia ?? ''}
                  onChange={(e) =>
                    set('reprezentant', { ...dane.reprezentant, dataWypelnienia: e.target.value || null })
                  }
                />
              </FormField>
              <FormField label={t.citTelefon} htmlFor="cit-tel">
                <input id="cit-tel" type="text" value={dane.telefon} onChange={(e) => set('telefon', e.target.value)} />
              </FormField>
            </FormRow>
          </FormSection>

          {rekord && (
            <FormSection
              icon="mail"
              title={t.citSecSend}
              description={t.citSecSendDesc}
              aside={
                rekord.dane.wysylki.some(czekaNaUpo) ? (
                  <button
                    type="button"
                    className="button button-small button-secondary"
                    disabled={upoBusy}
                    onClick={() => {
                      setUpoBusy(true);
                      void sprawdzUpo(t, notify, rok, [rekord.id]).then(() => {
                        setUpoBusy(false);
                        onDownloaded();
                      });
                    }}
                  >
                    <Icon name={upoBusy ? 'loader' : 'refresh'} size={13} /> {t.citCheckUpo}
                  </button>
                ) : undefined
              }
            >
              {rekord.dane.wysylki.length === 0 ? (
                <div className="form-empty">{t.citSendNone}</div>
              ) : (
                <WysylkiLista t={t} locale={locale} id={rekord.id} wysylki={rekord.dane.wysylki} onZmiana={onDownloaded} />
              )}
            </FormSection>
          )}

          <FormSection icon="download" title={t.citSecPdf} description={t.citSecPdfDesc}>
            {(!rekord || dirty) && (
              <span className="action-note">
                <Icon name="info" size={13} /> {t.podPdfSaveFirst}
              </span>
            )}
            {rekord && rekord.dane.pobrania.length > 0 && (
              <div className="pod-pdf-history">
                <span className="pod-pdf-history__title">{t.podPdfHistory}</span>
                <ul>
                  {[...rekord.dane.pobrania]
                    .reverse()
                    .slice(0, 3)
                    .map((p, i) => (
                      <li key={i} data-tip={p.plik}>
                        {(p.podpis ? t.podPdfHistorySigned.replace('{signer}', p.podpis.podmiot) : t.podPdfHistoryItem)
                          .replace('{when}', formatStamp(p.at, locale))
                          .replace('{who}', p.by || '—')}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </FormSection>

          {rekord?.dane.zlozone && dirty && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.citFiledChangedHint
                  .replace('{when}', formatStamp(rekord.dane.zlozone.at, locale))
                  .replace('{who}', rekord.dane.zlozone.by || '—')}
              </div>
            </div>
          )}

          <ModalFooter
            className="page-action-bar"
            note={note}
            onSubmit={() => void save()}
            submitLabel={rekord ? t.podSave : t.citCreate}
            submitIcon={rekord ? 'save' : 'plus'}
            submitDisabled={rekord ? !dirty : !canAdd}
            submitTitle={!rekord && !canAdd ? t.citNewNeeds : undefined}
            busy={busy === 'save'}
          />
        </div>
      </div>
      {podpisOpen && rekord && (
        <PodpisKartaModal
          language={language}
          title={t.citSignTitle}
          subtitle={`CIT-8 ${rok} · ${adresNazwa}`}
          extra={(cert) => (
            <>
              <GotowoscPodpisuWiele t={t} wpisy={wpisGotowosci(cert)} cert={cert} pokazLiczbe={false} />
              <FormSection icon="file-check" title={t.citSignTitle} description={t.citSignXmlNote}>
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
          onPodpisz={podpisz}
          onClose={() => setPodpisOpen(false)}
        />
      )}
      {podgladOpen && dane.sprawozdanie && (
        <SprawozdaniePodgladModal
          t={t}
          nazwa={adresNazwa}
          spr={dane.sprawozdanie.dane}
          onClose={() => setPodgladOpen(false)}
        />
      )}
    </>
  );
};

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
