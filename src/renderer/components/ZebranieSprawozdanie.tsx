import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sprawozdanie,
  SprawozdanieCel,
  SprawozdanieWiersz,
  SprawozdanieWstepTekst,
  SprawozdanieZapisane,
  ZebraniaWspolnota,
  ZebranieSprawozdanie as ZebranieSprawozdanieDane,
  ZebranieWersja,
} from '../../shared/types';
import {
  formatKwota,
  okresLabel,
  sprawozdaniaDlaWspolnoty,
  sprawozdanieDlaZebrania,
  sprawozdanieWersji,
  sprawozdanieWstep,
  zastosujLaczenia,
} from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { wersjaLabel } from '../../shared/zebrania';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormSection } from './FormSection';
import Icon from './Icon';
import ZebranieDokumentActions, { DokumentZrodlo } from './ZebranieDokumentActions';
import ZebranieSprawozdanieLaczenia from './ZebranieSprawozdanieLaczenia';
import { bezPrefiksu } from './PodpisKarta';
import MergedBadge from './MergedBadge';

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
 * The introduction the PDF opens with — the same figures, paragraph and notes,
 * so what is shown here is what is printed. The figures and the notes are
 * computed from the statement; the paragraph starts empty and is written for
 * the version — by the AI from the figures, with the user's guidance, or by
 * hand. An AI draft lands in the editor and is stored only once saved. The
 * notes can be rewritten too (and one added where the figures raised none).
 * Without `onSave` it is read-only — a library statement belongs to no version
 * to keep the words in.
 */
export const SprawozdanieWstepSection: React.FC<{
  t: T;
  spr: Sprawozdanie;
  /** The words as written for this version; null = none yet (empty paragraph, computed notes). */
  tekst: SprawozdanieWstepTekst | null;
  busy: boolean;
  onSave?: (tekst: SprawozdanieWstepTekst | null) => Promise<boolean>;
  /** A draft of the paragraph by the AI; null when it failed (the caller says why). */
  onGenerate?: (wskazowki: string) => Promise<string | null>;
  /** The description of a read-only introduction. */
  readOnlyHint?: string;
}> = ({ t, spr, tekst, busy: parentBusy, onSave, onGenerate, readOnlyHint }) => {
  const computed = useMemo(() => sprawozdanieWstep(spr), [spr]);
  const akapit = tekst?.akapit ?? '';
  const uwagi = tekst ? tekst.uwagi : computed.uwagi;
  const [draft, setDraft] = useState<SprawozdanieWstepTekst | null>(null);
  /** The draft's paragraph is the AI's, not yet saved. */
  const [zAi, setZAi] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [wskazowki, setWskazowki] = useState('');
  const [generating, setGenerating] = useState(false);
  const busy = parentBusy || generating;

  const startEdit = (addNote = false) => {
    setZAi(false);
    setDraft({ akapit, uwagi: addNote ? [...uwagi, ''] : [...uwagi] });
  };
  const setNote = (i: number, value: string) =>
    setDraft((d) => d && { ...d, uwagi: d.uwagi.map((u, j) => (j === i ? value : u)) });
  const save = async (value: SprawozdanieWstepTekst | null) => {
    if (onSave && (await onSave(value))) {
      setDraft(null);
      setZAi(false);
    }
  };
  const cancel = () => {
    setDraft(null);
    setZAi(false);
  };

  const generate = async () => {
    if (!onGenerate) return;
    setGenerating(true);
    try {
      const text = await onGenerate(wskazowki);
      if (text) {
        // The draft keeps notes already being edited; otherwise it starts from the current ones.
        setDraft((d) => ({ akapit: text, uwagi: d ? d.uwagi : [...uwagi] }));
        setZAi(true);
        setAiOpen(false);
      }
    } finally {
      setGenerating(false);
    }
  };

  // The guidance panel: asked for, or offered while there is no paragraph to read.
  const showAi = !!onGenerate && !generating && (aiOpen || (!akapit && !draft));

  const aiPanel = showAi && (
    <div className="zfin-ai-panel">
      <FormField
        label={t.zfinIntroAiGuidance}
        htmlFor="zfin-ai-wskazowki"
        hint={t.zfinIntroAiGuidanceHint}
      >
        <textarea
          id="zfin-ai-wskazowki"
          rows={3}
          value={wskazowki}
          maxLength={2000}
          placeholder={t.zfinIntroAiGuidancePlaceholder}
          onChange={(e) => setWskazowki(e.target.value)}
          disabled={busy}
        />
      </FormField>
      <div className="section-actions">
        {aiOpen && (
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => setAiOpen(false)}
            disabled={busy}
          >
            {t.cancel}
          </button>
        )}
        <button
          type="button"
          className="button button-small button-primary"
          onClick={() => void generate()}
          disabled={busy}
        >
          <Icon name="sparkles" size={13} /> {akapit || draft?.akapit ? t.zfinIntroAiRegenerate : t.zfinIntroAiGenerate}
        </button>
      </div>
    </div>
  );

  const loader = generating && (
    <div className="zlacz-ai-working" role="status" aria-live="polite">
      <div className="zlacz-ai-working__head">
        <span className="loader-spinner zlacz-ai-working__spinner" aria-hidden="true" />
        <span className="zlacz-ai-working__text">
          <strong>{t.zfinIntroAiWorking}</strong>
          <span>{t.zfinIntroAiWorkingHint}</span>
        </span>
      </div>
      <div className="zlacz-ai-working__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );

  return (
    <FormSection
      icon="sparkles"
      title={t.zfinIntroTitle}
      description={!onSave ? readOnlyHint : tekst ? t.zfinIntroHintEdited : t.zfinIntroHint}
      badge={tekst ? t.zfinIntroEdited : undefined}
      aside={
        onSave &&
        !draft &&
        !generating && (
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
            {onGenerate && akapit && !aiOpen && (
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => setAiOpen(true)}
                disabled={busy}
              >
                <Icon name="sparkles" size={13} /> {t.zfinIntroAiOpen}
              </button>
            )}
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => startEdit()}
              disabled={busy}
            >
              <Icon name="edit" size={13} /> {akapit ? t.zfinIntroEdit : t.zfinIntroWrite}
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

      {loader}

      {draft ? (
        <>
          {zAi && (
            <div className="callout callout--info">
              <Icon name="sparkles" size={16} />
              <div className="callout__body">{t.zfinIntroAiDraft}</div>
            </div>
          )}
          <FormField
            label={t.zfinIntroText}
            action={
              onGenerate &&
              !aiOpen &&
              !generating && (
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => setAiOpen(true)}
                  disabled={busy}
                >
                  <Icon name="sparkles" size={13} /> {t.zfinIntroAiOpen}
                </button>
              )
            }
          >
            <textarea
              rows={6}
              value={draft.akapit}
              placeholder={t.zfinIntroTextPlaceholder}
              onChange={(e) => setDraft({ ...draft, akapit: e.target.value })}
              disabled={busy}
            />
          </FormField>
          {aiPanel}
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
              onClick={cancel}
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
              <Icon name={parentBusy ? 'loader' : 'save'} size={13} /> {t.zfinIntroSave}
            </button>
          </div>
        </>
      ) : (
        <>
          {akapit ? (
            akapit
              .split(/\n\s*\n/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => (
                <p key={i} className="zfin-lead">
                  {p}
                </p>
              ))
          ) : (
            onSave &&
            !generating && <p className="zfin-lead-empty">{t.zfinIntroEmpty}</p>
          )}
          {aiPanel}
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
  /** Folded subcategories, as "section index:heading". */
  const [subFolded, setSubFolded] = useState<Set<string>>(() => new Set());
  const query = foldText(q.trim());
  const filtering = !!query || onlyNegative;

  const negativeCount = useMemo(
    () =>
      spr.sekcje.reduce(
        (n, sec) =>
          n + sec.wiersze.filter((w) => w.podkategoria !== 'naglowek' && w.kwoty.some(isNegative)).length,
        0
      ),
    [spr]
  );

  // A section named by the search keeps all its rows; otherwise only the rows that match.
  // A subcategory goes as a block: named by the search, it keeps all its rows; a
  // row of it that matches brings its heading along.
  const sekcje = useMemo(
    () =>
      spr.sekcje.map((sec) => {
        const titleHit = !!query && foldText(sec.tytul).includes(query);
        const hit = (w: SprawozdanieWiersz) =>
          !query ||
          titleHit ||
          foldText(w.nazwa).includes(query) ||
          !!w.polaczone?.some((n) => foldText(n).includes(query));
        const neg = (w: SprawozdanieWiersz) => !onlyNegative || w.kwoty.some(isNegative);
        const wiersze: SprawozdanieWiersz[] = [];
        for (let r = 0; r < sec.wiersze.length; r++) {
          const w = sec.wiersze[r];
          if (w.podkategoria !== 'naglowek') {
            if (hit(w) && neg(w)) wiersze.push(w);
            continue;
          }
          let end = r + 1;
          while (sec.wiersze[end]?.podkategoria === 'pozycja') end++;
          const headHit = !!query && hit(w);
          const kids = sec.wiersze.slice(r + 1, end).filter((k) => (headHit || hit(k)) && neg(k));
          if (kids.length > 0 || (headHit && !onlyNegative)) wiersze.push(w, ...kids);
          r = end - 1;
        }
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

  const toggleSub = (key: string) =>
    setSubFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
                      {(() => {
                        // Two levels: a subcategory's heading (folds its rows away) and its
                        // rows, joined to it by a tree line; a search or a filter opens it.
                        const out: React.ReactNode[] = [];
                        let fold = '';
                        items.forEach((w, j) => {
                          const cells = w.kwoty.map((k, c) => (
                            <td key={c} className={`zfin-num${isNegative(k) ? ' is-negative' : ''}`}>
                              {formatKwota(k)}
                            </td>
                          ));
                          const merged = w.polaczone && (
                            <MergedBadge label={t.zfinMergedOf} wiersze={w.polaczone} />
                          );
                          if (w.podkategoria === 'naglowek') {
                            const key = `${i}:${w.nazwa}`;
                            const folded = !filtering && subFolded.has(key);
                            fold = folded ? key : '';
                            let n = 0;
                            while (items[j + 1 + n]?.podkategoria === 'pozycja') n++;
                            out.push(
                              <tr key={j} className={`is-subcat${folded ? ' is-folded' : ''}`}>
                                <td>
                                  <button
                                    type="button"
                                    className="zfin-subcat__head"
                                    onClick={() => toggleSub(key)}
                                    aria-expanded={!folded}
                                    disabled={filtering}
                                  >
                                    <Icon name="chevron-right" size={13} className="zfin-subcat__chevron" />
                                    <span className="zfin-subcat__name">{w.nazwa}</span>
                                    <span className="zfin-subcat__count">
                                      {t.zfinSubcatCount.replace('{n}', String(n))}
                                    </span>
                                  </button>
                                </td>
                                {cells}
                              </tr>
                            );
                            return;
                          }
                          if (w.podkategoria === 'pozycja') {
                            if (fold) return;
                            const last = items[j + 1]?.podkategoria !== 'pozycja';
                            out.push(
                              <tr key={j} className={`is-subitem${last ? ' is-last' : ''}`}>
                                <td>
                                  <span className="zfin-subitem__name">
                                    {w.nazwa}
                                    {merged}
                                  </span>
                                </td>
                                {cells}
                              </tr>
                            );
                            return;
                          }
                          fold = '';
                          out.push(
                            <tr key={j}>
                              <td>
                                {w.nazwa}
                                {merged}
                              </td>
                              {cells}
                            </tr>
                          );
                        });
                        return out;
                      })()}
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

/** Every statement in the Sprawozdania module, searchable — for a community the app could not match. */
const SprawozdaniePickerModal: React.FC<{
  t: T;
  locale: string;
  lista: SprawozdanieZapisane[];
  adresNazwa: string;
  busy: boolean;
  onPick: (s: SprawozdanieZapisane) => void;
  onClose: () => void;
}> = ({ t, locale, lista, adresNazwa, busy, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const query = foldText(q);
    return lista.filter(
      (s) => !query || foldText(s.nazwa).includes(query) || String(s.nrWsp ?? '') === query
    );
  }, [lista, q]);

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

/* ============================== The statement body ============================== */

/**
 * A statement as its owner shows it — a meeting version, or a plan of Plany
 * gospodarcze: the particulars, the introduction, the downloads, the merges and
 * subcategories, and the preview. The figures are the library's; the rest is
 * the owner's own (`cel`). Read-only shows the introduction and the preview
 * as they are, with nothing to change.
 */
export const SprawozdanieRobocze: React.FC<{
  language: Language;
  locale: string;
  cel: SprawozdanieCel;
  z: ZebranieSprawozdanieDane;
  /** Where "Pobierz PDF / Excel" builds the file from. */
  pobieranie: DokumentZrodlo;
  busy: boolean;
  readOnly?: boolean;
  /** Actions in the header of the statement's card. */
  aside?: React.ReactNode;
  /** A box at the end (a version's status). */
  statusBox?: React.ReactNode;
  onChanged: () => Promise<void>;
}> = ({ language, locale, cel, z, pobieranie, busy: parentBusy, readOnly = false, aside, statusBox, onChanged }) => {
  const t = translations[language];
  const notify = useNotify();
  const [saving, setSaving] = useState(false);
  const [wstep, setWstep] = useState(true);
  const busy = parentBusy || saving;
  const celKey = 'planId' in cel ? `p${cel.planId}` : `w${cel.wersjaId}`;
  // What the documents show: the library's figures with the owner's merges.
  const spr = useMemo(() => sprawozdanieWersji(z), [z]);
  // Subcategories are made over the rows as merged.
  const pozycjePolaczone = useMemo(() => zastosujLaczenia(z.dane, z.laczenia), [z]);

  /** Save the introduction's words (null = back to the computed ones). */
  const saveWstep = async (value: SprawozdanieWstepTekst | null): Promise<boolean> => {
    setSaving(true);
    try {
      await window.electronAPI.setSprawozdanieWstep(cel, value);
      await onChanged();
      notify.success(value ? t.zfinIntroSaved : t.zfinIntroResetDone);
      return true;
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** A draft of the paragraph by the AI, over the statement as its owner shows it. */
  const generateWstep = async (wskazowki: string): Promise<string | null> => {
    try {
      return await window.electronAPI.napiszWstepSprawozdaniaAi(cel, wskazowki);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.zfinIntroAiError);
      return null;
    }
  };

  return (
    // A column of cards of a sheet's width, like every page form — the
    // statement reads like the printout, not stretched to the window.
    <div className="page-form zeb-page">
      <FormSection
        icon="bar-chart"
        title={`Wspólnota Mieszkaniowa ${nazwaNieruchomosci(spr.nazwa)}`}
        description={t.zfinStatementDesc
          .replace('{okres}', okresLabel(spr.okresOd, spr.okresDo))
          .replace('{wydruk}', spr.wydruk || '—')}
        aside={aside}
      >
        <SprawozdanieFakty t={t} spr={spr} />
      </FormSection>

      <SprawozdanieWstepSection
        key={celKey}
        t={t}
        spr={spr}
        tekst={z.wstep}
        busy={busy}
        onSave={readOnly ? undefined : saveWstep}
        onGenerate={readOnly ? undefined : generateWstep}
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
          zrodlo={pobieranie}
          pobrania={z.pobrania}
          wstep={wstep}
          disabled={busy}
          onDownloaded={() => void onChanged()}
        />
      </FormSection>

      {!readOnly && (
        <>
          <ZebranieSprawozdanieLaczenia
            key={`l${celKey}`}
            t={t}
            rodzaj="laczenia"
            cel={cel}
            spr={z.dane}
            lista={z.laczenia}
            busy={busy}
            onChanged={onChanged}
          />
          <ZebranieSprawozdanieLaczenia
            key={`p${celKey}`}
            t={t}
            rodzaj="podkategorie"
            cel={cel}
            spr={pozycjePolaczone}
            lista={z.podkategorie}
            busy={busy}
            onChanged={onChanged}
          />
        </>
      )}

      <SprawozdaniePodglad t={t} spr={spr} />

      {statusBox}
    </div>
  );
};

/* ================================== The tab ================================== */

/**
 * "Sprawozdania finansowe" of one version. Statements are uploaded in the
 * Sprawozdania module only — it is the source of truth; the version links one
 * of them (its figures are always read from there) and keeps only its own
 * introduction and downloads. The community's statements are matched by the
 * vDom number remembered for it, or by name the first time (then the number is
 * remembered). The current version links one by itself when the choice is
 * unambiguous (`sprawozdanieDlaZebrania`) — never again after a hand-made unlink.
 */
const ZebranieSprawozdanie: React.FC<{
  language: Language;
  locale: string;
  wersja: ZebranieWersja;
  /** The entry's current version — the only one linked by itself. */
  biezaca: boolean;
  adresNazwa: string;
  wspolnota: ZebraniaWspolnota | null;
  lista: SprawozdanieZapisane[];
  dataZebrania: string | null;
  onChanged: () => Promise<void>;
  /** Open the Sprawozdania module — on one statement, or on its list with null. */
  onOpenSprawozdanie: (sprawozdanieId: number | null) => void;
  /** The version's status box, shown at the end of the statement, also while none is linked. */
  statusBox?: React.ReactNode;
  /** After a statement is linked — the template meeting drafts the plan from it (see `ZebranieScreen`). */
  onLinked?: (sprawozdanieId: number) => Promise<void>;
}> = ({
  language,
  locale,
  wersja,
  biezaca,
  adresNazwa,
  wspolnota,
  lista,
  dataZebrania,
  onChanged,
  onOpenSprawozdanie,
  statusBox,
  onLinked,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const v = wersjaLabel(wersja);
  const attached = wersja.sprawozdanie;

  const matches = useMemo(
    () =>
      sprawozdaniaDlaWspolnoty(lista, wspolnota?.vdomNr ?? null, adresNazwa ? [adresNazwa] : []),
    [lista, wspolnota?.vdomNr, adresNazwa]
  );

  /** Link, and remember the community's vDom number for the next time. */
  const attach = async (s: SprawozdanieZapisane, message: string) => {
    setBusy(true);
    try {
      await window.electronAPI.attachZebranieSprawozdanie(wersja.id, s.id);
      if (adresNazwa && s.nrWsp != null && wspolnota?.vdomNr !== s.nrWsp) {
        try {
          await window.electronAPI.setZebraniaWspolnota(adresNazwa, { vdomNr: s.nrWsp });
        } catch {
          // The statement is linked; only the shortcut for next time is missing.
        }
      }
      setPicker(false);
      notify.success(message);
      await onLinked?.(s.id);
      await onChanged();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The one statement the meeting clearly presents is linked without a click —
  // once per version shown, and never after someone unlinked it by hand.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || attached || wersja.sprawozdanieOdlaczone || !biezaca) return;
    const s = sprawozdanieDlaZebrania(lista, wspolnota?.vdomNr ?? null, dataZebrania);
    if (!s) return;
    autoTried.current = true;
    void attach(s, t.zfinAutoLinked.replace('{okres}', okresLabel(s.okresOd, s.okresDo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, wersja.sprawozdanieOdlaczone, biezaca, lista, wspolnota?.vdomNr, dataZebrania]);

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
      busy={busy}
      onPick={(s) => void attach(s, t.zfinAttached.replace('{v}', v))}
      onClose={() => setPicker(false)}
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
              <p>{wersja.sprawozdanieOdlaczone ? t.zfinUnlinkedHint : t.zfinUploadHint}</p>
              <div className="zfin-empty-state__actions">
                {lista.length > 0 && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setPicker(true)}
                    disabled={busy}
                  >
                    <Icon name="search" size={14} /> {t.zfinPickFromLibrary}
                  </button>
                )}
                <button
                  type="button"
                  className={`button ${lista.length > 0 ? 'button-secondary' : 'button-primary'}`}
                  onClick={() => onOpenSprawozdanie(null)}
                  disabled={busy}
                >
                  <Icon name="book" size={14} /> {t.zfinGoToSpraw}
                </button>
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
                          onClick={() => void attach(s, t.zfinAttached.replace('{v}', v))}
                          disabled={busy}
                        >
                          <Icon name="paperclip" size={12} /> {t.zfinAttach}
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

  return (
    <>
      <SprawozdanieRobocze
        language={language}
        locale={locale}
        cel={{ wersjaId: wersja.id }}
        z={attached}
        pobieranie={{ wersjaId: wersja.id, dokument: 'sprawozdanie', dataZebrania }}
        busy={busy}
        statusBox={statusBox}
        onChanged={onChanged}
        aside={
          <div className="form-section__actions">
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={() => onOpenSprawozdanie(attached.sprawozdanieId)}
              disabled={busy}
            >
              <Icon name="book" size={13} /> {t.zfinOpenInSpraw}
            </button>
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => setPicker(true)}
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
      />
      {picking}
    </>
  );
};

export default ZebranieSprawozdanie;
