import React, { useMemo, useState } from 'react';
import { PlanGospodarczy, ZebraniaUstawienia, Zebranie, ZebranieDokumentKlucz, ZebranieWersja } from '../../shared/types';
import {
  ZebranieDane,
  ZrodloSzablonu,
  materialyZeSzablonu,
  uchwalyOf,
  wersjaLabel,
  wersjaMaMaterialy,
  withUchwaly,
  zawiadomienieOf,
} from '../../shared/zebrania';
import { liczbaWlasnychWzrostow, planZeSzablonu } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';
import Select from './Select';
import Tip from './Tip';

type T = (typeof translations)['pl'];

/** One meeting as the list shows it. */
export interface SzablonWiersz {
  zebranie: Zebranie;
  dane: ZebranieDane;
  wersja: ZebranieWersja | null;
}

/** The parts of a meeting the template passes on. */
type Czesc = 'zawiadomienie' | 'uchwaly' | 'plan';
const CZESCI: Czesc[] = ['zawiadomienie', 'uchwaly', 'plan'];

/** Whether the version already holds this part — what applying the template would overwrite. */
function maCzesc(wersja: ZebranieWersja | null, czesc: Czesc): boolean {
  if (czesc === 'zawiadomienie') return !!zawiadomienieOf(wersja);
  if (czesc === 'uchwaly') return uchwalyOf(wersja).length > 0;
  return wersja?.plan != null;
}

/** Whether the template has this part to give. */
function szablonMa(zrodlo: ZrodloSzablonu, czesc: Czesc): boolean {
  if (czesc === 'zawiadomienie') return zrodlo.zawiadomienie != null;
  if (czesc === 'uchwaly') return zrodlo.uchwaly.length > 0;
  return zrodlo.plan != null;
}

function czescLabel(t: T, czesc: Czesc): string {
  if (czesc === 'zawiadomienie') return t.zebSzablonPartNotice;
  if (czesc === 'uchwaly') return t.zebSzablonPartResolutions;
  return t.zebSzablonPartPlan;
}

function kiedy(dane: ZebranieDane, t: T, locale: string): string {
  return dane.startsAt ? formatStamp(dane.startsAt, locale) : t.zebraniaNoDate;
}

/** "3 uchwały" — Polish plural forms; English just adds an s. */
function uchwalyCount(t: T, n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form =
    n === 1 ? t.zebSzablonResolutionsOne : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? t.zebSzablonResolutionsFew : t.zebSzablonResolutionsMany;
  return form.replace('{n}', String(n));
}

/** What the template's plan passes on, as a chip's words. */
function planOpis(t: T, plan: PlanGospodarczy | null): string {
  if (!plan) return t.zebSzablonNoPlan;
  const n = liczbaWlasnychWzrostow(plan);
  const base = t.zebSzablonPlanIndex.replace('{p}', String(plan.wskaznik || 0));
  return n > 0 ? `${base} · ${t.zebSzablonPlanOwn.replace('{n}', String(n))}` : base;
}

/* ================================ The section ================================ */

/**
 * "Zebranie-szablon" on the Zebrania list: the community whose newest meeting
 * every new meeting starts from — its notice, its resolutions and its plan's
 * assumptions — and the way to put them onto meetings that already exist.
 */
export const ZebraniaSzablonSekcja: React.FC<{
  language: Language;
  locale: string;
  rows: SzablonWiersz[];
  ustawienia: ZebraniaUstawienia;
  zrodlo: ZrodloSzablonu | null;
  busy: boolean;
  onChange: (adresNazwa: string) => void;
  onOpen: (zebranieId: number) => void;
  onApply: () => void;
}> = ({ language, locale, rows, ustawienia, zrodlo, busy, onChange, onOpen, onApply }) => {
  const t = translations[language];
  const wybrana = ustawienia.szablonAdresNazwa;

  // Communities that have a meeting with materials — only those can be a template.
  const options = useMemo(() => {
    const nazwy = new Set<string>();
    for (const r of rows) {
      const n = r.dane.adresNazwa.trim();
      if (n && r.zebranie.wersje.some(wersjaMaMaterialy)) nazwy.add(n);
    }
    if (wybrana) nazwy.add(wybrana);
    return [...nazwy]
      .sort((a, b) => a.localeCompare(b, 'pl'))
      .map((n) => ({ value: n, label: n }));
  }, [rows, wybrana]);

  const zaw = zrodlo?.zawiadomienie ?? null;
  const uchwaly = zrodlo?.uchwaly ?? [];

  return (
    <section className={`zeb-szablon${wybrana ? ' is-set' : ''}`} aria-label={t.zebSzablonTitle}>
      <div className="zeb-szablon__head">
        <span className="zeb-szablon__icon">
          <Icon name="copy" size={18} />
        </span>
        <div className="zeb-szablon__intro">
          <strong>{t.zebSzablonTitle}</strong>
          <p>{t.zebSzablonHint}</p>
        </div>
        <div className="zeb-szablon__pick">
          <Select
            overlay
            value={wybrana}
            options={options}
            onChange={onChange}
            placeholder={t.zebSzablonPick}
            ariaLabel={t.zebSzablonPick}
            disabled={busy}
          />
          {wybrana && (
            <button
              type="button"
              className="button button-icon button-ghost"
              onClick={() => onChange('')}
              disabled={busy}
              aria-label={t.zebSzablonClear}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>

      {wybrana &&
        (zrodlo ? (
          <div className="zeb-szablon__body">
            <button type="button" className="zeb-szablon__source" onClick={() => onOpen(zrodlo.zebranie.id)}>
              <Icon name="calendar" size={13} />
              <span className="zeb-szablon__source-name">{zrodlo.dane.nazwa || '—'}</span>
              <span className="zeb-muted">
                {kiedy(zrodlo.dane, t, locale)} · {t.zebraniaVersion.replace('{v}', wersjaLabel(zrodlo.wersja))}
              </span>
              <Icon name="chevron-right" size={14} />
            </button>
            <div className="zeb-szablon__chips">
              <span className={`status-badge ${zaw ? 'status-info' : 'status-neutral'}`}>
                <Icon name="mail" size={11} /> {zaw ? zaw.szablonNazwa || t.zebSzablonPartNotice : t.zebSzablonNoNotice}
              </span>
              <span className={`status-badge ${uchwaly.length ? 'status-info' : 'status-neutral'}`}>
                <Icon name="file-text" size={11} />{' '}
                {uchwaly.length ? uchwalyCount(t, uchwaly.length) : t.zebSzablonNoResolutions}
              </span>
              <Tip
                className="zeb-status-tip"
                ariaLabel={t.zebSzablonPlanTip}
                content={
                  <>
                    <div className="tip__title">{t.zebSzablonPartPlan}</div>
                    <div>{t.zebSzablonPlanTip}</div>
                  </>
                }
              >
                <span className={`status-badge ${zrodlo.plan ? 'status-info' : 'status-neutral'}`}>
                  <Icon name="wallet" size={11} /> {planOpis(t, zrodlo.plan)}
                  {zrodlo.planZ && (
                    <span className="zeb-szablon__from">
                      {' '}
                      · {t.zebSzablonPlanFrom.replace('{kiedy}', kiedy(zrodlo.planZ.dane, t, locale))}
                    </span>
                  )}
                </span>
              </Tip>
            </div>
            <button type="button" className="button button-secondary button-small" onClick={onApply} disabled={busy}>
              <Icon name="copy" size={13} /> {t.zebSzablonApply}
            </button>
          </div>
        ) : (
          <p className="zeb-szablon__warn">
            <Icon name="alert-triangle" size={14} /> {t.zebSzablonNoSource.replace('{nazwa}', wybrana)}
          </p>
        ))}
    </section>
  );
};

/* ========================= Applying to existing meetings ========================= */

type Widok = 'wszystkie' | 'puste' | 'z_danymi';

/**
 * "Zastosuj do istniejących": the meetings besides the template, each showing
 * which of its documents already hold something and which are empty. The ticked
 * ones get the template's parts on their current version; a document marked
 * ready goes back to being prepared, since its content just changed.
 */
export const ZebraniaSzablonModal: React.FC<{
  language: Language;
  locale: string;
  userEmail: string;
  rows: SzablonWiersz[];
  zrodlo: ZrodloSzablonu;
  ustawienia: ZebraniaUstawienia;
  onClose: () => void;
  onDone: () => Promise<void>;
}> = ({ language, locale, userEmail, rows, zrodlo, ustawienia, onClose, onDone }) => {
  const t = translations[language];
  const notify = useNotify();

  const [czesci, setCzesci] = useState<Record<Czesc, boolean>>(() => ({
    zawiadomienie: szablonMa(zrodlo, 'zawiadomienie'),
    uchwaly: szablonMa(zrodlo, 'uchwaly'),
    plan: szablonMa(zrodlo, 'plan'),
  }));
  const aktywne = CZESCI.filter((c) => czesci[c]);

  const cele = useMemo(
    () =>
      rows
        .filter((r): r is SzablonWiersz & { wersja: ZebranieWersja } => r.wersja != null && r.zebranie.id !== zrodlo.zebranie.id)
        .sort((a, b) => {
          const ta = a.dane.startsAt ? new Date(a.dane.startsAt).getTime() : -Infinity;
          const tb = b.dane.startsAt ? new Date(b.dane.startsAt).getTime() : -Infinity;
          return tb - ta || b.zebranie.id - a.zebranie.id;
        }),
    [rows, zrodlo.zebranie.id],
  );

  /** Holds something in one of the chosen parts — applying overwrites it. */
  const zDanymi = (w: ZebranieWersja) => aktywne.some((c) => maCzesc(w, c));

  // Start with the empty ones ticked: filling them overwrites nothing.
  const [wybrane, setWybrane] = useState<Set<number>>(
    () => new Set(cele.filter((r) => !CZESCI.some((c) => szablonMa(zrodlo, c) && maCzesc(r.wersja, c))).map((r) => r.zebranie.id)),
  );
  const [widok, setWidok] = useState<Widok>('wszystkie');
  const [saving, setSaving] = useState(false);

  const puste = cele.filter((r) => !zDanymi(r.wersja));
  const widoczne = widok === 'puste' ? puste : widok === 'z_danymi' ? cele.filter((r) => zDanymi(r.wersja)) : cele;
  const zaznaczone = cele.filter((r) => wybrane.has(r.zebranie.id));
  const nadpisywane = zaznaczone.filter((r) => zDanymi(r.wersja));

  const toggle = (id: number) =>
    setWybrane((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const zaznacz = (lista: typeof cele) => setWybrane(new Set(lista.map((r) => r.zebranie.id)));

  const tplZaw = zrodlo.zawiadomienie;
  const tplUchwaly = zrodlo.uchwaly;
  const tplPlan = zrodlo.plan;

  const apply = async () => {
    if (zaznaczone.length === 0 || aktywne.length === 0) return;
    if (
      nadpisywane.length > 0 &&
      !(await notify.confirm(t.zebSzablonOverwriteConfirm.replace('{n}', String(nadpisywane.length)), {
        danger: true,
        confirmLabel: t.zebSzablonApplySubmit,
      }))
    )
      return;
    setSaving(true);
    const bledy: string[] = [];
    for (const { zebranie, dane, wersja } of zaznaczone) {
      try {
        let materialy = wersja.materialy;
        const zmienione: ZebranieDokumentKlucz[] = [];
        if (czesci.zawiadomienie && tplZaw) {
          materialy = [
            ...materialyZeSzablonu([tplZaw], userEmail),
            ...materialy.filter((m) => m.rodzaj !== 'zawiadomienie'),
          ];
          zmienione.push('zawiadomienie');
        }
        if (czesci.uchwaly && tplUchwaly.length > 0) {
          materialy = withUchwaly(materialy, materialyZeSzablonu(tplUchwaly, userEmail));
          zmienione.push('uchwaly');
        }
        if (materialy !== wersja.materialy) {
          await window.electronAPI.updateZebranieWersja(wersja.id, { opis: wersja.opis, materialy });
        }
        // A version without a plan has none to change: the template's assumptions apply when it is drafted.
        if (czesci.plan && tplPlan && wersja.plan) {
          const plan = planZeSzablonu(wersja.plan, tplPlan, ustawienia.zaokraglenie);
          // Already on the template's assumptions: nothing to write, and its ready mark stays.
          if (JSON.stringify(plan) !== JSON.stringify(wersja.plan)) {
            await window.electronAPI.setZebranieWersjaPlan(wersja.id, plan);
            zmienione.push('plan');
          }
        }
        for (const d of zmienione) {
          if (wersja.gotowe[d]) await window.electronAPI.setZebranieDokumentGotowe(wersja.id, d, false);
        }
      } catch (err: unknown) {
        bledy.push(`${dane.nazwa || zebranie.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await onDone();
    setSaving(false);
    if (bledy.length) notify.error(`${t.zebSzablonApplyErrors}\n${bledy.join('\n')}`);
    else notify.success(t.zebSzablonApplied.replace('{n}', String(zaznaczone.length)));
    onClose();
  };

  const komorka = (wersja: ZebranieWersja, czesc: Czesc) => {
    const ma = maCzesc(wersja, czesc);
    const gotowe = ma && wersja.gotowe[czesc] === true;
    let label: string;
    if (czesc === 'uchwaly') label = ma ? uchwalyCount(t, uchwalyOf(wersja).length) : t.zebSzablonEmpty;
    else if (czesc === 'plan') label = ma ? t.zebSzablonPlanIndex.replace('{p}', String(wersja.plan!.wskaznik || 0)) : t.zebSzablonNoPlan;
    else label = ma ? t.zebSzablonHasData : t.zebSzablonEmpty;
    const badge = (
      <span className={`status-badge ${ma ? 'status-pending' : 'status-neutral'}`}>
        {gotowe && <Icon name="check-circle" size={11} />} {label}
      </span>
    );
    const hint = gotowe ? t.zebSzablonReadyTip : czesc === 'plan' && !ma ? t.zebSzablonNoPlanTip : null;
    return (
      <td key={czesc} className={czesci[czesc] ? undefined : 'is-off'}>
        {hint ? (
          <Tip className="zeb-status-tip" ariaLabel={hint} content={hint}>
            {badge}
          </Tip>
        ) : (
          badge
        )}
      </td>
    );
  };

  const widoki: { key: Widok; label: string; count: number }[] = [
    { key: 'wszystkie', label: t.zebSzablonViewAll, count: cele.length },
    { key: 'puste', label: t.zebSzablonViewEmpty, count: puste.length },
    { key: 'z_danymi', label: t.zebSzablonViewFilled, count: cele.length - puste.length },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="copy"
          title={t.zebSzablonApplyTitle}
          subtitle={t.zebSzablonApplySubtitle
            .replace('{nazwa}', zrodlo.dane.nazwa || zrodlo.dane.adresNazwa)
            .replace('{v}', wersjaLabel(zrodlo.wersja))}
        />
        <div className="modal-body">
          <div className="zeb-szb-parts" role="group" aria-label={t.zebSzablonParts}>
            <span className="zeb-szb-parts__label">{t.zebSzablonParts}</span>
            {CZESCI.map((c) => {
              const dostepna = szablonMa(zrodlo, c);
              return (
                <label key={c} className={`zeb-szb-part${dostepna ? '' : ' is-off'}`}>
                  <input
                    type="checkbox"
                    checked={czesci[c]}
                    disabled={!dostepna || saving}
                    onChange={(e) => setCzesci((prev) => ({ ...prev, [c]: e.target.checked }))}
                  />
                  {czescLabel(t, c)}
                  {!dostepna && <span className="zeb-muted"> — {t.zebSzablonPartMissing}</span>}
                </label>
              );
            })}
          </div>

          <div className="zeb-szb-toolbar">
            <div className="zad-seg" role="group" aria-label={t.zebSzablonView}>
              {widoki.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`zad-seg__btn${widok === o.key ? ' is-active' : ''}${o.count === 0 ? ' is-empty' : ''}`}
                  aria-pressed={widok === o.key}
                  onClick={() => setWidok(o.key)}
                >
                  {o.label}
                  <span className="zad-seg__count">{o.count}</span>
                </button>
              ))}
            </div>
            <div className="zeb-szb-toolbar__select">
              <button type="button" className="button button-small button-subtle" onClick={() => zaznacz(puste)}>
                {t.zebSzablonSelectEmpty}
              </button>
              <button type="button" className="button button-small button-subtle" onClick={() => zaznacz(cele)}>
                {t.zebSzablonSelectAll}
              </button>
              <button type="button" className="button button-small button-subtle" onClick={() => zaznacz([])}>
                {t.zebSzablonSelectNone}
              </button>
            </div>
          </div>

          {widoczne.length === 0 ? (
            <p className="zeb-muted">{t.zebSzablonNoTargets}</p>
          ) : (
            <div className="zeb-szb-table-wrap">
              <table className="zeb-szb-table">
                <thead>
                  <tr>
                    <th aria-label={t.zebSzablonSelect} />
                    <th>{t.zebSzablonMeeting}</th>
                    {CZESCI.map((c) => (
                      <th key={c} className={czesci[c] ? undefined : 'is-off'}>
                        {czescLabel(t, c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {widoczne.map(({ zebranie, dane, wersja }) => {
                    const checked = wybrane.has(zebranie.id);
                    const dane_ = zDanymi(wersja);
                    return (
                      <tr
                        key={zebranie.id}
                        className={`${checked ? 'is-checked' : ''}${checked && dane_ ? ' is-overwrite' : ''}`}
                        onClick={() => !saving && toggle(zebranie.id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggle(zebranie.id)}
                            aria-label={dane.nazwa || '—'}
                          />
                        </td>
                        <td>
                          <span className="zeb-szb-name">{dane.nazwa || '—'}</span>
                          <span className="zeb-muted">
                            {[dane.adresNazwa, kiedy(dane, t, locale), t.zebraniaVersion.replace('{v}', wersjaLabel(wersja))]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </td>
                        {CZESCI.map((c) => komorka(wersja, c))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => void apply()}
          submitLabel={t.zebSzablonApplySubmit}
          submitIcon="copy"
          busy={saving}
          submitDisabled={zaznaczone.length === 0 || aktywne.length === 0}
          note={t.zebSzablonSummary
            .replace('{n}', String(zaznaczone.length))
            .replace('{m}', String(nadpisywane.length))}
        />
      </div>
    </div>
  );
};
