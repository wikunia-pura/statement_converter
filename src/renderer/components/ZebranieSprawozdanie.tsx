import React, { useMemo, useState } from 'react';
import {
  Sprawozdanie,
  SprawozdanieWstepTekst,
  SprawozdanieZapisane,
  ZebraniaWspolnota,
  ZebranieWersja,
} from '../../shared/types';
import {
  formatKwota,
  okresLabel,
  sprawozdaniaDlaWspolnoty,
  sprawozdanieWstep,
} from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { wersjaLabel } from '../../shared/zebrania';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormSection } from './FormSection';
import Icon from './Icon';
import ZebranieDokumentActions from './ZebranieDokumentActions';

type T = (typeof translations)['pl'];

/* ================================ The sections ================================ */

const isNegative = (k: number | null) => k != null && k < -0.005;

/** The statement's particulars, read-only. */
export const SprawozdanieFakty: React.FC<{ t: T; spr: Sprawozdanie }> = ({ t, spr }) => (
  <dl className="facts">
    <dt>{t.zfinPeriod}</dt>
    <dd>
      <strong>{okresLabel(spr.okresOd, spr.okresDo)}</strong>
    </dd>
    {spr.nrWsp != null && (
      <>
        <dt>{t.zfinNr}</dt>
        <dd>{spr.nrWsp}</dd>
      </>
    )}
    {spr.powierzchnia != null && (
      <>
        <dt>{t.zfinArea}</dt>
        <dd>{formatKwota(spr.powierzchnia)} m²</dd>
      </>
    )}
    {spr.powierzchniaCo != null && (
      <>
        <dt>{t.zfinAreaCo}</dt>
        <dd>{formatKwota(spr.powierzchniaCo)} m²</dd>
      </>
    )}
    {spr.sredniaLiczbaOsob != null && (
      <>
        <dt>{t.zfinPersons}</dt>
        <dd>{formatKwota(spr.sredniaLiczbaOsob)}</dd>
      </>
    )}
  </dl>
);

/**
 * The introduction the PDF opens with — the same figures, summary and notes,
 * so what is shown here is what is printed. The figures are always the
 * statement's; the summary and the notes can be rewritten for the version
 * (and a note added where the figures raised none). Without `onSave` it is
 * read-only — a library statement belongs to no version to keep the words in.
 */
export const SprawozdanieWstepSection: React.FC<{
  t: T;
  spr: Sprawozdanie;
  /** The words as edited for this version; null = computed. */
  tekst: SprawozdanieWstepTekst | null;
  busy: boolean;
  onSave?: (tekst: SprawozdanieWstepTekst | null) => Promise<boolean>;
  /** The description of a read-only introduction. */
  readOnlyHint?: string;
}> = ({ t, spr, tekst, busy, onSave, readOnlyHint }) => {
  const computed = useMemo(() => sprawozdanieWstep(spr), [spr]);
  const akapit = tekst ? tekst.akapit : computed.akapit;
  const uwagi = tekst ? tekst.uwagi : computed.uwagi;
  const [draft, setDraft] = useState<SprawozdanieWstepTekst | null>(null);

  const startEdit = (addNote = false) =>
    setDraft({ akapit, uwagi: addNote ? [...uwagi, ''] : [...uwagi] });
  const setNote = (i: number, value: string) =>
    setDraft((d) => d && { ...d, uwagi: d.uwagi.map((u, j) => (j === i ? value : u)) });
  const save = async (value: SprawozdanieWstepTekst | null) => {
    if (onSave && (await onSave(value))) setDraft(null);
  };

  return (
    <FormSection
      icon="sparkles"
      title={t.zfinIntroTitle}
      description={!onSave ? readOnlyHint : tekst ? t.zfinIntroHintEdited : t.zfinIntroHint}
      badge={tekst ? t.zfinIntroEdited : undefined}
      aside={
        onSave &&
        !draft && (
          <div className="form-section__actions">
            {tekst && (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => void save(null)}
                disabled={busy}
                title={t.zfinIntroResetHint}
              >
                <Icon name="refresh" size={13} /> {t.zfinIntroReset}
              </button>
            )}
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => startEdit()}
              disabled={busy}
            >
              <Icon name="edit" size={13} /> {t.zfinIntroEdit}
            </button>
          </div>
        )
      }
    >
      {computed.kluczowe.length > 0 && (
        <div className="zfin-kpis">
          {computed.kluczowe.map((k) => (
            <div key={k.etykieta} className={`zfin-kpi zfin-kpi--${k.ton}`}>
              <span>{k.etykieta}</span>
              <strong>{formatKwota(k.kwota)} zł</strong>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <>
          <FormField label={t.zfinIntroText}>
            <textarea
              rows={6}
              value={draft.akapit}
              onChange={(e) => setDraft({ ...draft, akapit: e.target.value })}
              disabled={busy}
            />
          </FormField>
          <FormField
            label={t.zfinIntroNotes}
            hint={draft.uwagi.length === 0 ? t.zfinIntroNoNotes : undefined}
          >
            <div className="zfin-notes-edit">
              {draft.uwagi.map((u, i) => (
                <div key={i} className="form-inline">
                  <input
                    type="text"
                    value={u}
                    autoFocus={i === draft.uwagi.length - 1 && !u}
                    placeholder={t.zfinIntroNotePlaceholder}
                    onChange={(e) => setNote(i, e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="button button-small button-ghost icon-danger"
                    onClick={() =>
                      setDraft({ ...draft, uwagi: draft.uwagi.filter((_, j) => j !== i) })
                    }
                    disabled={busy}
                    aria-label={t.zfinIntroNoteRemove}
                    title={t.zfinIntroNoteRemove}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button button-small button-subtle zfin-notes-edit__add"
                onClick={() => setDraft({ ...draft, uwagi: [...draft.uwagi, ''] })}
                disabled={busy}
              >
                <Icon name="plus" size={13} /> {t.zfinIntroNoteAdd}
              </button>
            </div>
          </FormField>
          <div className="section-actions">
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="button button-small button-success"
              onClick={() => void save(draft)}
              disabled={busy}
            >
              <Icon name={busy ? 'loader' : 'save'} size={13} /> {t.zfinIntroSave}
            </button>
          </div>
        </>
      ) : (
        <>
          {akapit
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="zfin-lead">
                {p}
              </p>
            ))}
          {uwagi.length > 0 ? (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                <strong>{t.zfinIntroNotes}</strong>
                <ul className="zfin-notes">
                  {uwagi.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            onSave && (
              <div>
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() => startEdit(true)}
                  disabled={busy}
                >
                  <Icon name="plus" size={13} /> {t.zfinIntroNoteAddFirst}
                </button>
              </div>
            )
          )}
        </>
      )}
    </FormSection>
  );
};

/**
 * The statement as vDom printed it: its sections, as tables — each one folds
 * away, and the rows can be searched or narrowed to the negative ones.
 * Read-only.
 */
export const SprawozdaniePodglad: React.FC<{ t: T; spr: Sprawozdanie }> = ({ t, spr }) => {
  const [q, setQ] = useState('');
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const query = foldText(q.trim());
  const filtering = !!query || onlyNegative;

  const negativeCount = useMemo(
    () =>
      spr.sekcje.reduce(
        (n, sec) => n + sec.wiersze.filter((w) => w.kwoty.some(isNegative)).length,
        0
      ),
    [spr]
  );

  // A section named by the search keeps all its rows; otherwise only the rows that match.
  const sekcje = useMemo(
    () =>
      spr.sekcje.map((sec) => {
        const titleHit = !!query && foldText(sec.tytul).includes(query);
        const wiersze = sec.wiersze.filter(
          (w) =>
            (!query || titleHit || foldText(w.nazwa).includes(query)) &&
            (!onlyNegative || w.kwoty.some(isNegative))
        );
        return {
          sec,
          wiersze,
          visible: !filtering || wiersze.length > 0 || (titleHit && !onlyNegative),
        };
      }),
    [spr, query, onlyNegative, filtering]
  );
  const shown = sekcje.filter((s) => s.visible);
  const allCollapsed = spr.sekcje.length > 0 && collapsed.size === spr.sekcje.length;

  const toggle = (i: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <FormSection
      icon="table"
      title={t.zfinItemsTitle}
      description={t.zfinItemsDesc}
      aside={
        <button
          type="button"
          className="button button-small button-ghost"
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(spr.sekcje.map((_, i) => i)))
          }
          disabled={filtering}
        >
          <Icon name={allCollapsed ? 'chevron-down' : 'chevron-right'} size={13} />
          {allCollapsed ? t.zfinExpandAll : t.zfinCollapseAll}
        </button>
      }
    >
      <div className="list-filter zfin-filter">
        <div className="input-icon">
          <Icon name="search" size={15} />
          <input
            type="text"
            placeholder={t.zfinSearch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t.zfinSearch}
          />
        </div>
        <div className="zad-seg" role="group" aria-label={t.zfinOnlyNegative}>
          <button
            type="button"
            className={`zad-seg__btn${onlyNegative ? ' is-active' : ''}${negativeCount === 0 ? ' is-empty' : ''}`}
            aria-pressed={onlyNegative}
            onClick={() => setOnlyNegative((v) => !v)}
          >
            {t.zfinOnlyNegative}
            <span className="zad-seg__count">{negativeCount}</span>
          </button>
        </div>
      </div>

      {shown.length === 0 && <p className="form-empty">{t.zfinNoFilterMatch}</p>}

      <div className="zfin-sections">
        {sekcje.map(({ sec, wiersze, visible }, i) => {
          if (!visible) return null;
          // A search or a filter opens what it found.
          const open = filtering || !collapsed.has(i);
          const items = wiersze.filter((w) => !w.podsumowanie);
          const sums = wiersze.filter((w) => w.podsumowanie);
          const firstSum = sec.wiersze.find((w) => w.podsumowanie);
          const bodyId = `zfin-sec-${i}`;
          return (
            <section key={i} className={`zfin-section${open ? '' : ' is-collapsed'}`}>
              <button
                type="button"
                className="zfin-section__head"
                onClick={() => toggle(i)}
                aria-expanded={open}
                aria-controls={bodyId}
                disabled={filtering}
              >
                <Icon name="chevron-right" size={14} className="zfin-section__chevron" />
                <span className="zfin-section__title">{sec.tytul}</span>
                {sec.kwotaNaglowka != null && (
                  <span className="zfin-section__total">{formatKwota(sec.kwotaNaglowka)}</span>
                )}
              </button>
              {open && sec.kolumny.length > 0 && (
                <div className="table-scroll" id={bodyId}>
                  <table className="zfin-table">
                    <thead>
                      <tr>
                        <th>{t.zfinItem}</th>
                        {sec.kolumny.map((k) => (
                          <th key={k} className="zfin-num">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && sums.length === 0 && (
                        <tr>
                          <td colSpan={sec.kolumny.length + 1} className="zfin-empty">
                            {filtering ? t.zfinNoFilterMatch : t.zfinNoRows}
                          </td>
                        </tr>
                      )}
                      {items.map((w, j) => (
                        <tr key={j}>
                          <td>{w.nazwa}</td>
                          {w.kwoty.map((k, c) => (
                            <td
                              key={c}
                              className={`zfin-num${isNegative(k) ? ' is-negative' : ''}`}
                            >
                              {formatKwota(k)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {sums.map((w, j) => (
                        <tr
                          key={`s${j}`}
                          className={w === firstSum ? 'is-sum' : w.wyroznienie ? 'is-strong' : ''}
                        >
                          <td>{w.nazwa}</td>
                          {w.kwoty.map((k, c) => (
                            <td
                              key={c}
                              className={`zfin-num${isNegative(k) ? ' is-negative' : ''}`}
                            >
                              {formatKwota(k)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </FormSection>
  );
};

/* ================================ The picker ================================ */

/** Every statement in the library, searchable — for a community the app could not match. */
const SprawozdaniePickerModal: React.FC<{
  t: T;
  locale: string;
  lista: SprawozdanieZapisane[];
  adresNazwa: string;
  /** Statements of the file just uploaded come first. */
  wyroznionyPlik?: string;
  busy: boolean;
  onPick: (s: SprawozdanieZapisane) => void;
  onClose: () => void;
}> = ({ t, locale, lista, adresNazwa, wyroznionyPlik, busy, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const query = foldText(q);
    const filtered = lista.filter(
      (s) => !query || foldText(s.nazwa).includes(query) || String(s.nrWsp ?? '') === query
    );
    return wyroznionyPlik
      ? [...filtered].sort(
          (a, b) => Number(b.plikNazwa === wyroznionyPlik) - Number(a.plikNazwa === wyroznionyPlik)
        )
      : filtered;
  }, [lista, q, wyroznionyPlik]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="bar-chart"
          title={t.zfinPickTitle}
          subtitle={adresNazwa ? t.zfinPickHint.replace('{name}', adresNazwa) : t.zfinNoAdres}
        />
        <div className="modal-body">
          <div className="ksieg-search zfin-pick-search">
            <Icon name="search" size={15} />
            <input
              type="text"
              autoFocus
              placeholder={t.zfinPickSearch}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {lista.length === 0 ? (
            <p className="zeb-muted">{t.zfinPickEmpty}</p>
          ) : shown.length === 0 ? (
            <p className="zeb-muted">{t.zfinNoMatch}</p>
          ) : (
            <ul className="zfin-pick-list">
              {shown.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="zfin-pick-item"
                    onClick={() => onPick(s)}
                    disabled={busy}
                  >
                    <span className="zfin-pick-item__nr">{s.nrWsp ?? '—'}</span>
                    <span className="zfin-pick-item__main">
                      <strong>{s.nazwa}</strong>
                      <span className="zeb-muted">
                        {okresLabel(s.okresOd, s.okresDo)} · {s.plikNazwa} ·{' '}
                        {t.zfinImportedBy
                          .replace('{when}', formatStamp(s.importedAt, locale))
                          .replace('{who}', s.importedBy || '—')}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.cancel} />
      </div>
    </div>
  );
};

/* ================================== The tab ================================== */

/**
 * "Sprawozdania finansowe" of one version. A vDom file holds every community,
 * so an upload fills the shared library and this version takes its own
 * community's statement from it — matched by the vDom number remembered for the
 * community, or by name the first time (then the number is remembered).
 */
const ZebranieSprawozdanie: React.FC<{
  language: Language;
  locale: string;
  wersja: ZebranieWersja;
  adresNazwa: string;
  wspolnota: ZebraniaWspolnota | null;
  lista: SprawozdanieZapisane[];
  dataZebrania: string | null;
  onChanged: () => Promise<void>;
  /** The version's status box, shown at the end of the statement, also while none is attached. */
  statusBox?: React.ReactNode;
}> = ({ language, locale, wersja, adresNazwa, wspolnota, lista, dataZebrania, onChanged, statusBox }) => {
  const t = translations[language];
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ plik?: string } | null>(null);
  const [wstep, setWstep] = useState(true);
  const v = wersjaLabel(wersja);
  const attached = wersja.sprawozdanie;

  const matches = useMemo(
    () =>
      sprawozdaniaDlaWspolnoty(lista, wspolnota?.vdomNr ?? null, adresNazwa ? [adresNazwa] : []),
    [lista, wspolnota?.vdomNr, adresNazwa]
  );

  /** Attach, and remember the community's vDom number for the next file. */
  const attach = async (s: SprawozdanieZapisane, quiet = false) => {
    setBusy(true);
    try {
      await window.electronAPI.attachZebranieSprawozdanie(wersja.id, s.id);
      if (adresNazwa && s.nrWsp != null && wspolnota?.vdomNr !== s.nrWsp) {
        try {
          await window.electronAPI.setZebraniaWspolnota(adresNazwa, { vdomNr: s.nrWsp });
        } catch {
          // The statement is attached; only the shortcut for next time is missing.
        }
      }
      setPicker(null);
      await onChanged();
      if (!quiet) notify.success(t.zfinAttached.replace('{v}', v));
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    setBusy(true);
    let result: Awaited<ReturnType<typeof window.electronAPI.importSprawozdania>> = null;
    try {
      result = await window.electronAPI.importSprawozdania();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinImportError);
    } finally {
      setBusy(false);
    }
    if (!result) return;
    const { plikNazwa, zapisane } = result;
    const n = String(zapisane.length);
    const hits = sprawozdaniaDlaWspolnoty(
      zapisane,
      wspolnota?.vdomNr ?? null,
      adresNazwa ? [adresNazwa] : []
    );
    // One statement of this community in the file: attach it — but a statement
    // already attached (even of the same period: the print may be newer) is
    // only replaced when the user says so.
    const take =
      hits.length === 1 &&
      (!attached ||
        (await notify.confirm(
          t.zfinReplaceConfirm
            .replace('{v}', v)
            .replace('{okres}', okresLabel(hits[0].okresOd, hits[0].okresDo)),
          { confirmLabel: t.zfinReplace }
        )));
    if (take) {
      await attach(hits[0], true);
      notify.success(t.zfinImportedAttached.replace('{n}', n).replace('{file}', plikNazwa));
      return;
    }
    await onChanged();
    if (attached) {
      notify.success(t.zfinImported.replace('{n}', n).replace('{file}', plikNazwa));
      return;
    }
    notify.info(t.zfinImportNoMatch.replace('{n}', n));
    setPicker({ plik: plikNazwa });
  };

  /** Save the introduction's words (null = back to the computed ones). */
  const saveWstep = async (value: SprawozdanieWstepTekst | null): Promise<boolean> => {
    setBusy(true);
    try {
      await window.electronAPI.setZebranieSprawozdanieWstep(wersja.id, value);
      await onChanged();
      notify.success(value ? t.zfinIntroSaved : t.zfinIntroResetDone);
      return true;
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await notify.confirm(t.zfinRemoveConfirm.replace('{v}', v), {
        danger: true,
        confirmLabel: t.zfinRemove,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await window.electronAPI.removeZebranieSprawozdanie(wersja.id);
      await onChanged();
      notify.success(t.zfinRemoved);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const picking = picker && (
    <SprawozdaniePickerModal
      t={t}
      locale={locale}
      lista={lista}
      adresNazwa={adresNazwa}
      wyroznionyPlik={picker.plik}
      busy={busy}
      onPick={(s) => void attach(s)}
      onClose={() => setPicker(null)}
    />
  );

  if (!attached) {
    return (
      <>
        <div className="page-form zeb-page">
          <FormSection icon="bar-chart" title={t.zebraniaTabReports}>
            <div className="uch-empty zfin-empty-state">
              <span className="zeb-tab-empty__icon">
                <Icon name="bar-chart" size={22} />
              </span>
              <strong>{t.zfinEmptyTitle}</strong>
              <p>{t.zfinUploadHint}</p>
              <div className="zfin-empty-state__actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void upload()}
                  disabled={busy}
                >
                  <Icon name={busy ? 'loader' : 'upload'} size={14} /> {t.zfinUpload}
                </button>
                {lista.length > 0 && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setPicker({})}
                    disabled={busy}
                  >
                    <Icon name="search" size={14} /> {t.zfinPickFromLibrary}
                  </button>
                )}
              </div>
              {matches.length > 0 && (
                <div className="zfin-matches">
                  <span className="zfin-matches__title">{t.zfinFound}</span>
                  <ul>
                    {matches.map((s) => (
                      <li key={s.id}>
                        <span>
                          <strong>{okresLabel(s.okresOd, s.okresDo)}</strong>
                          <span className="zeb-muted">
                            {' '}
                            · {s.plikNazwa} ·{' '}
                            {t.zfinImportedBy
                              .replace('{when}', formatStamp(s.importedAt, locale))
                              .replace('{who}', s.importedBy || '—')}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="button button-small button-success"
                          onClick={() => void attach(s)}
                          disabled={busy}
                        >
                          <Icon name="plus" size={12} /> {t.zfinAttach}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </FormSection>

          {statusBox}
        </div>
        {picking}
      </>
    );
  }

  const spr = attached.dane;
  return (
    <>
      {/* A column of cards of a sheet's width, like every page form — the
          statement reads like the printout, not stretched to the window. */}
      <div className="page-form zeb-page">
        <FormSection
          icon="bar-chart"
          title={`Wspólnota Mieszkaniowa ${nazwaNieruchomosci(spr.nazwa)}`}
          description={t.zfinStatementDesc
            .replace('{okres}', okresLabel(spr.okresOd, spr.okresDo))
            .replace('{wydruk}', spr.wydruk || '—')}
          aside={
            <div className="form-section__actions">
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => void upload()}
                disabled={busy}
              >
                <Icon name="upload" size={13} /> {t.zfinUpload}
              </button>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => setPicker({})}
                disabled={busy}
              >
                <Icon name="refresh" size={13} /> {t.zfinChange}
              </button>
              <button
                type="button"
                className="button button-small button-ghost icon-danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                <Icon name="trash" size={13} /> {t.zfinRemove}
              </button>
            </div>
          }
        >
          <SprawozdanieFakty t={t} spr={spr} />
        </FormSection>

        <SprawozdanieWstepSection
          t={t}
          spr={spr}
          tekst={attached.wstep}
          busy={busy}
          onSave={saveWstep}
        />

        <FormSection icon="download" title={t.zfinDownloadTitle} description={t.zfinZeroHint}>
          <label className="switch-row">
            <span className="switch-row__text">
              <span className="switch-row__label">{t.zfinIntroInPdf}</span>
              <span className="switch-row__hint">{t.zfinIntroInPdfHint}</span>
            </span>
            <span className="toggle-switch">
              <input type="checkbox" checked={wstep} onChange={(e) => setWstep(e.target.checked)} />
              <span className="toggle-slider"></span>
            </span>
          </label>
          <ZebranieDokumentActions
            language={language}
            locale={locale}
            zrodlo={{ wersjaId: wersja.id, dokument: 'sprawozdanie', dataZebrania }}
            pobrania={attached.pobrania}
            wstep={wstep}
            disabled={busy}
            onDownloaded={() => void onChanged()}
          />
        </FormSection>

        <SprawozdaniePodglad t={t} spr={spr} />

        {statusBox}
      </div>
      {picking}
    </>
  );
};

export default ZebranieSprawozdanie;
