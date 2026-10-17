import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CitAiPropozycja,
  CitKategoria,
  CitKlasyfikacja,
  CitSlownikRegula,
  PodatekCitDane,
  PodatekCitSprawozdanie,
  PodatkiCitUstawienia,
  Sprawozdanie,
  SprawozdanieZapisane,
} from '../../../shared/types';
import { formatZl } from '../../../shared/podatki';
import {
  ObliczenieCIT8,
  PozycjaCitOcena,
  ProblemCit8,
  kategorieDlaStrony,
  okresKlucz,
  okresPelny,
  problemTylkoXml,
  sprawozdanieDlaRoku,
} from '../../../shared/podatki-cit';
import {
  formatData,
  formatKwota,
  okresLabel,
  sprawozdaniaDlaWspolnoty,
} from '../../../shared/sprawozdanie';
import { foldText } from '../../../shared/plan-gospodarczy';
import { formatStamp } from '../../../shared/calendar';
import Tip from '../Tip';
import { useNotify } from '../Notifications';
import { FormSection } from '../FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { bezPrefiksu } from '../PodpisKarta';
import { SprawozdaniePodglad } from '../ZebranieSprawozdanie';
import Icon from '../Icon';
import Loader from '../Loader';
import Select from '../Select';
import { zl2 } from '../../views/PodatkiNieruchomosci';
import { type T, newRuleId, kategoriaNazwy, problemText, pobierzMigawke, pelnyRok } from './citShared';
import { WatpliwoscAi } from './SlownikModal';

/* ============================ Statement preview ============================ */

/** The attached statement as vDom printed it, in a window — the same view the Sprawozdania module opens. */
export const SprawozdaniePodgladModal: React.FC<{
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

/* ================================ Statement ================================= */

/**
 * The statement a return is drawn from: the attached copy with its particulars,
 * or — while none is attached, or on "Zmień" — a picker over the library.
 * The community's own statements come first (full-year ones above partial
 * periods); the search over every statement is the way out when names differ.
 */
export const SprawozdanieSekcja: React.FC<{
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
export const PozycjeSekcja: React.FC<{
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
export const WyliczenieSekcja: React.FC<{
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
