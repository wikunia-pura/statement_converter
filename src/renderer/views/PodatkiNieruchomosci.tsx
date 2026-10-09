import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  GruntRodzaj,
  PodatekAdres,
  PodatekDom,
  PodatekGrunt,
  PodatekNieruchomosci,
  PodatekNieruchomosciDane,
  PodatkiPodpisPostep,
  PodatkiPodpisWieleResult,
  PodatkiStawki,
  PodatkiStawkiDane,
  PodpisCertyfikat,
  PodpisWybor,
} from '../../shared/types';
import {
  FORMY_WLADANIA,
  GRUNT_RODZAJE,
  ProblemDN1,
  ZDN1_WIERSZY,
  formatPowierzchnia,
  formatStawka,
  formatZl,
  jednostkaGruntu,
  liczbaZdn1,
  nipPoprawny,
  obliczDN1,
  problemyDN1,
  pusteDane,
  pusteStawki,
  pustyGrunt,
  StanDeklaracji,
  czyAdresPusty,
  stanDeklaracji,
  tylkoCyfry,
  ulicaZNumerem,
  uwagiPodpisu,
  UwagaPodpisu,
  zlGr,
} from '../../shared/podatki';
import { foldText } from '../../shared/plan-gospodarczy';
import { WierszDn1, wierszeDn1 } from '../../shared/adres-identyfikacja';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import { FormField, FormRow, FormSection } from '../components/FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { PodpisKartaModal } from '../components/PodpisKarta';
import ScreenTitle from '../components/ScreenTitle';
import { useNavItem } from '../navigation';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import Select from '../components/Select';
import { parseKwota } from '../components/KwotaInput';

type T = (typeof translations)['pl'];

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const rodzajLabel = (t: T, r: GruntRodzaj): string =>
  ({
    dzialalnosc: t.podRodzaj_dzialalnosc,
    wody: t.podRodzaj_wody,
    pozostale: t.podRodzaj_pozostale,
    rewitalizacja: t.podRodzaj_rewitalizacja,
  })[r];

const jednostka = (r: GruntRodzaj) => (jednostkaGruntu(r) === 'ha' ? 'ha' : 'm²');
const stawkaJednostka = (t: T, r: GruntRodzaj) => (jednostkaGruntu(r) === 'ha' ? t.podRateUnitHa : t.podRateUnitM2);

/** The list's status filter; the segments overlap, like the Pulpit's tiles. */
type Filtr = 'all' | 'errors' | 'ready' | 'downloaded' | 'waiting' | 'dom' | 'none';
const FILTRY: Filtr[] = ['all', 'errors', 'ready', 'downloaded', 'waiting', 'dom', 'none'];

/**
 * The tax in a row's box: whole złoty joined by no-break spaces, so "1 234"
 * never splits over two lines, and a size that keeps it on one line in the
 * box's fixed width — the more digits, the smaller.
 */
export function kwotaWBoksie(n: number): { text: string; size: string } {
  const text = formatZl(n).replace(/ /g, '\u00a0');
  const size = text.length <= 4 ? '' : text.length === 5 ? ' is-m' : text.length === 6 ? ' is-s' : ' is-xs';
  return { text, size };
}

/** An amount as the screen shows it: "1 234,56 zł". */
export const zl2 = (n: number) => {
  const { zl, gr } = zlGr(n);
  return `${zl},${gr} zł`;
};

function problemText(t: T, p: ProblemDN1, rok: number): string {
  switch (p.kod) {
    case 'nip':
      return t.podProblem_nip;
    case 'nazwa':
      return t.podProblem_nazwa;
    case 'organ':
      return t.podProblem_organ;
    case 'grunty':
      return t.podProblem_grunty;
    case 'powierzchnia':
      return t.podProblem_powierzchnia.replace('{n}', String(p.wiersz));
    case 'stawka':
      return t.podProblem_stawka.replace('{rok}', String(rok)).replace('{rodzaj}', rodzajLabel(t, p.rodzaj));
  }
}

/** Up to five entries, then "i jeszcze N" — a list in a callout stays readable for 48 communities. */
const krotko = (t: T, items: string[]): string[] =>
  items.length <= 6 ? items : [...items.slice(0, 5), t.podSignMore.replace('{n}', String(items.length - 5))];

const ListaUwag: React.FC<{ tone: 'warning' | 'muted' | 'danger'; icon: 'alert-triangle' | 'info'; title: string; items: string[] }> = ({
  tone,
  icon,
  title,
  items,
}) => (
  <div className={`callout callout--${tone}`}>
    <Icon name={icon} size={16} />
    <div className="callout__body">
      {title}
      <ul className="podpis-gotowosc__list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  </div>
);

const Licznik: React.FC<{ value: number; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = ({
  value,
  label,
  tone,
}) => (
  <div className={`podpis-sum__stat is-${value > 0 ? tone : 'neutral'}`}>
    <span className="podpis-sum__stat-value">{value}</span>
    <span className="podpis-sum__stat-label">{label}</span>
  </div>
);

/**
 * After "Podpisz zaznaczone": what one PIN signed — each file one click from
 * opening — what was skipped and why, and what a stop left unsigned. Those
 * last two can be ticked in the list in one go, to fix and sign again.
 */
export const PodsumowaniePodpisow: React.FC<{
  t: T;
  rok: number;
  wynik: PodatkiPodpisWieleResult;
  /** Another form's heading line (the CIT-8 names itself); the DN-1's is the default. */
  subtitle?: string;
  onZaznacz: (ids: number[]) => void;
  onClose: () => void;
}> = ({ t, rok, wynik, subtitle, onZaznacz, onClose }) => {
  const notify = useNotify();
  const { folder, podpis, podpisane, pominiete, niepodpisane, przerwano } = wynik;
  const reszta = [...pominiete, ...niepodpisane].map((x) => x.id);
  const wszystko = podpisane.length > 0 && reszta.length === 0 && !przerwano;
  const otworz = async (sciezka: string) => {
    if (!(await window.electronAPI.openFile(sciezka))) notify.error(t.podSumFileMissing);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon={wszystko ? 'check-circle' : 'alert-triangle'}
          tone={podpisane.length === 0 ? 'danger' : 'accent'}
          title={t.podSumTitle}
          subtitle={
            subtitle ??
            (podpis
              ? t.podSumSubtitle.replace('{rok}', String(rok)).replace('{kto}', podpis.podmiot)
              : t.podSumSubtitleNone.replace('{rok}', String(rok)))
          }
        />
        <div className="modal-body modal-body--sectioned">
          <div className="podpis-sum__stats">
            <Licznik value={podpisane.length} label={t.podSumSigned} tone="success" />
            <Licznik value={pominiete.length} label={t.podSumSkipped} tone="warning" />
            <Licznik value={niepodpisane.length} label={t.podSumUnsigned} tone="danger" />
          </div>
          {wszystko && (
            <div className="callout callout--success">
              <Icon name="check-circle" size={16} />
              <div className="callout__body">{t.podSumAllOk}</div>
            </div>
          )}
          {podpisane.length === 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-circle" size={16} />
              <div className="callout__body">{t.podSumNothing}</div>
            </div>
          )}
          {przerwano && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.podSumStopped.replace('{reason}', przerwano)}</div>
            </div>
          )}

          {podpisane.length > 0 && (
            <FormSection
              icon="signature"
              title={t.podSumSignedList.replace('{n}', String(podpisane.length))}
              description={t.podSumSignedDesc}
            >
              {folder && <div className="podpis-sum__folder">{t.podSumFolder.replace('{folder}', folder)}</div>}
              <ul className="podpis-sum__list">
                {podpisane.map((p) => (
                  <li key={p.id}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <button type="button" className="podpis-sum__file" onClick={() => void otworz(p.sciezka)}>
                      <Icon name="file-text" size={13} /> {baseName(p.sciezka)}
                    </button>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {pominiete.length > 0 && (
            <FormSection
              icon="alert-triangle"
              title={t.podSumSkippedList.replace('{n}', String(pominiete.length))}
              description={t.podSumSkippedDesc}
            >
              <ul className="podpis-sum__list">
                {pominiete.map((p) => (
                  <li key={p.id}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <span className="podpis-sum__reason">{p.powod}</span>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {niepodpisane.length > 0 && (
            <FormSection
              icon="clock"
              title={t.podSumUnsignedList.replace('{n}', String(niepodpisane.length))}
              description={t.podSumUnsignedDesc}
            >
              <ul className="podpis-sum__list">
                {niepodpisane.map((p) => (
                  <li key={p.id}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          secondaryAction={
            reszta.length > 0 ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onZaznacz(reszta);
                  onClose();
                }}
              >
                <Icon name="check-circle" size={14} /> {t.podSumSelectRest.replace('{n}', String(reszta.length))}
              </button>
            ) : undefined
          }
          onSubmit={folder ? () => void otworz(folder) : undefined}
          submitLabel={t.podSumOpenFolder}
          submitIcon="folder"
          autoFocus={folder ? 'submit' : 'cancel'}
        />
      </div>
    </div>
  );
};

/** One return in the signing window: its name, what keeps the PDF from being made, and what a signed file would say differently. */
export interface WpisGotowosci {
  nazwa: string;
  problemy: string[];
  uwagi: UwagaPodpisu[];
}

/**
 * "Gotowość do podpisu" in the signing window: which declarations the PDF can
 * be made of (the rest are skipped, never signed), and what a signed file
 * would leave blank or say differently from the certificate picked. Only
 * missing data blocks a declaration; the rest are things to know first.
 * Shared by the DN-1 and the CIT-8 — each tab hands in its own findings.
 */
export const GotowoscPodpisuWiele: React.FC<{
  t: T;
  wpisy: WpisGotowosci[];
  cert: PodpisCertyfikat | null;
  /** The "Do podpisu: N" line — for a run, not for one declaration. */
  pokazLiczbe: boolean;
}> = ({ t, wpisy, cert, pokazLiczbe }) => {
  const braki = wpisy.filter((x) => x.problemy.length > 0);
  const gotowe = wpisy.filter((x) => x.problemy.length === 0);
  const z = (kod: string) => gotowe.filter((x) => x.uwagi.some((u) => u.kod === kod));
  const inni = gotowe.flatMap((x) =>
    x.uwagi.flatMap((u) => (u.kod === 'inny' ? [`${x.nazwa} — ${u.reprezentant}`] : [])),
  );
  const bezReprezentanta = z('reprezentant').map((x) => x.nazwa);
  const podpisane = z('podpisana').map((x) => x.nazwa);
  const bezDaty = z('data').map((x) => x.nazwa);
  const wszystkoGra =
    gotowe.length > 0 && inni.length + bezReprezentanta.length + podpisane.length + bezDaty.length === 0;

  return (
    <FormSection icon="file-check" title={t.podSignReady} description={t.podSignReadyDesc}>
      {pokazLiczbe && gotowe.length > 0 && (
        <div className="podpis-gotowosc__count">{t.podSignReadyCount.replace('{n}', String(gotowe.length))}</div>
      )}
      {gotowe.length === 0 && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-circle" size={16} />
          <div className="callout__body">{t.podSignNothing}</div>
        </div>
      )}
      {braki.length > 0 && (
        <ListaUwag
          tone="warning"
          icon="alert-triangle"
          title={t.podSignSkipped.replace('{n}', String(braki.length))}
          items={krotko(t, braki.map((x) => `${x.nazwa} — ${x.problemy.join(' ')}`))}
        />
      )}
      {inni.length > 0 && cert && (
        <ListaUwag
          tone="warning"
          icon="alert-triangle"
          title={t.podSignWarnOther.replace('{cert}', cert.podmiot).replace('{n}', String(inni.length))}
          items={krotko(t, inni)}
        />
      )}
      {bezReprezentanta.length > 0 && (
        <ListaUwag
          tone="warning"
          icon="alert-triangle"
          title={t.podSignWarnNoRep.replace('{n}', String(bezReprezentanta.length))}
          items={krotko(t, bezReprezentanta)}
        />
      )}
      {podpisane.length > 0 && (
        <ListaUwag
          tone="muted"
          icon="info"
          title={t.podSignWarnSigned.replace('{n}', String(podpisane.length))}
          items={krotko(t, podpisane)}
        />
      )}
      {bezDaty.length > 0 && (
        <ListaUwag
          tone="muted"
          icon="info"
          title={t.podSignInfoDate.replace('{n}', String(bezDaty.length))}
          items={krotko(t, bezDaty)}
        />
      )}
      {wszystkoGra && (
        <div className="callout callout--success">
          <Icon name="check-circle" size={16} />
          <div className="callout__body">{t.podSignAllGood}</div>
        </div>
      )}
    </FormSection>
  );
};

const GotowoscPodpisu: React.FC<{
  t: T;
  rok: number;
  rekordy: PodatekNieruchomosci[];
  stawki: PodatkiStawkiDane | null;
  cert: PodpisCertyfikat | null;
  pokazLiczbe: boolean;
}> = ({ t, rok, rekordy, stawki, cert, pokazLiczbe }) => (
  <GotowoscPodpisuWiele
    t={t}
    cert={cert}
    pokazLiczbe={pokazLiczbe}
    wpisy={rekordy.map((r) => ({
      nazwa: r.dane.nazwaPelna || r.nip,
      problemy: problemyDN1(r, stawki).map((p) => problemText(t, p, rok)),
      uwagi: uwagiPodpisu(r.dane, cert?.podmiot ?? null),
    }))}
  />
);

/** The month's name for the "from month" picker: "01 — styczeń". */
const miesiacOptions = (locale: string) =>
  Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${String(i + 1).padStart(2, '0')} — ${new Date(2000, i, 1).toLocaleString(locale, { month: 'long' })}`,
  }));

/* ================================ Number input ================================ */

/**
 * A decimal typed the Polish way that may be left empty (unknown area, no rate
 * yet) — `null`, never a silent 0. Shows the unit at its right edge.
 */
export const LiczbaInput: React.FC<{
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  decimals: number;
  unit?: string;
  ariaLabel?: string;
  disabled?: boolean;
}> = ({ id, value, onChange, decimals, unit, ariaLabel, disabled }) => {
  const show = (n: number | null) =>
    n === null ? '' : n.toLocaleString('pl-PL', { maximumFractionDigits: decimals, useGrouping: false });
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const parsed = text.trim() === '' ? null : parseKwota(text);
  const invalid = text.trim() !== '' && (parsed === null || parsed < 0);

  return (
    <div className="pod-num">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={invalid ? 'is-invalid' : undefined}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === '' ? null : parseKwota(e.target.value);
          if (e.target.value.trim() === '') onChange(null);
          else if (v !== null && v >= 0) onChange(v);
        }}
      />
      {unit && <span className="pod-num__unit">{unit}</span>}
    </div>
  );
};

/* ================================== Address ================================== */

export const AdresFields: React.FC<{
  t: T;
  idPrefix: string;
  value: PodatekAdres;
  onChange: (key: keyof PodatekAdres, value: string) => void;
}> = ({ t, idPrefix, value, onChange }) => {
  const field = (key: keyof PodatekAdres, label: string, span: number, mono = false) => (
    <div className={`pod-span-${span}`}>
      <FormField label={label} htmlFor={`${idPrefix}-${key}`}>
        <input
          id={`${idPrefix}-${key}`}
          type="text"
          className={mono ? 'input-mono' : undefined}
          value={value[key]}
          onChange={(e) => onChange(key, e.target.value)}
        />
      </FormField>
    </div>
  );
  return (
    <div className="pod-grid">
      {field('kraj', t.podKraj, 1)}
      {field('wojewodztwo', t.podWojewodztwo, 2)}
      {field('powiat', t.podPowiat, 3)}
      {field('gmina', t.podGmina, 2)}
      {field('ulica', t.podUlica, 2)}
      {field('nrDomu', t.podNrDomu, 1)}
      {field('nrLokalu', t.podNrLokalu, 1)}
      {field('miejscowosc', t.podMiejscowosc, 4)}
      {field('kodPocztowy', t.podKod, 2, true)}
    </div>
  );
};

/* ================================== Rates ================================== */

/**
 * The year's rates, above the list — one set for every declaration of the year.
 * Saving is what confirms them: rates carried over from last year stay "to
 * check" until somebody compares them with the new resolution.
 */
const StawkiSection: React.FC<{
  language: Language;
  locale: string;
  rok: number;
  wpis: PodatkiStawki | undefined;
  uzyte: GruntRodzaj[];
  onSaved: () => void;
}> = ({ language, locale, rok, wpis, uzyte, onSaved }) => {
  const t = translations[language];
  const notify = useNotify();
  const [draft, setDraft] = useState<PodatkiStawkiDane>(wpis?.stawki ?? pusteStawki());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(wpis?.stawki ?? pusteStawki());
  }, [rok, wpis]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(wpis?.stawki ?? pusteStawki());
  const canSave = dirty || (wpis !== undefined && !wpis.potwierdzone);
  const brakujace = uzyte.filter((r) => wpis?.stawki[r] == null);

  const save = async () => {
    setSaving(true);
    try {
      await window.electronAPI.setPodatkiStawki(rok, draft);
      notify.success(t.podRatesSaved.replace('{rok}', String(rok)));
      onSaved();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podRatesSaveError);
    } finally {
      setSaving(false);
    }
  };

  const summary = GRUNT_RODZAJE.filter((r) => wpis?.stawki[r] != null)
    .map((r) => `${rodzajLabel(t, r)}: ${formatStawka(wpis!.stawki[r]!)} ${stawkaJednostka(t, r)}`)
    .join(' · ');

  return (
    <FormSection
      icon="coins"
      title={t.podRatesTitle.replace('{rok}', String(rok))}
      description={t.podRatesDesc}
      badge={
        wpis && !wpis.potwierdzone ? (
          <span className="status-badge status-pending">{t.podRatesBadgeUnconfirmed}</span>
        ) : undefined
      }
      aside={
        <button
          type="button"
          className="button button-small button-primary"
          onClick={() => void save()}
          disabled={!canSave || saving}
        >
          <Icon name={saving ? 'loader' : 'save'} size={13} /> {t.podRatesSave}
        </button>
      }
      collapsible
      persistKey="podatki-stawki"
      collapsedSummary={summary || t.podRatesNone}
    >
      {wpis && !wpis.potwierdzone && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.podRatesUnconfirmed.replace(/\{rok\}/g, String(rok))}</div>
        </div>
      )}
      {brakujace.map((r) => (
        <div key={r} className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.podRatesMissing.replace('{rodzaj}', rodzajLabel(t, r))}</div>
        </div>
      ))}
      <div className="pod-grid">
        {GRUNT_RODZAJE.map((r) => (
          <div key={r} className="pod-span-3">
            <FormField label={rodzajLabel(t, r)} htmlFor={`pod-stawka-${r}`}>
              <LiczbaInput
                id={`pod-stawka-${r}`}
                value={draft[r]}
                onChange={(v) => setDraft((d) => ({ ...d, [r]: v }))}
                decimals={4}
                unit={stawkaJednostka(t, r)}
              />
            </FormField>
          </div>
        ))}
      </div>
      {wpis?.updatedAt && (
        <p className="pod-note">
          {t.podRatesSavedBy
            .replace('{when}', formatStamp(wpis.updatedAt, locale))
            .replace('{who}', wpis.updatedBy || '—')}
        </p>
      )}
    </FormSection>
  );
};

/* ================================== DOM tick ================================== */

/**
 * "Zaksięguj w DOM" — the Pulpit's action, for a declaration: the green button
 * while the tax is not posted, then "Zaksięgowane w DOM" with "Zdejmij" under it.
 * Clicks stop here, so a tick inside a clickable row does not open the row.
 */
export const DomSlot: React.FC<{
  t: T;
  locale: string;
  dom: PodatekDom | null;
  busy: boolean;
  onSet: (booked: boolean) => void;
  /** 'button': the size of the small buttons beside it, done state on one line — for a toolbar. */
  size?: 'row' | 'button';
  /** Words for another kind of tick (the CIT-8's "filed"); the DOM's are the default. */
  labels?: { done: string; mark: string; undo: string; doneBy: string };
  /** False hides the "mark" button (an undo of a mark already made stays) — the DN-1 is posted only once its PDF is made. */
  canMark?: boolean;
}> = ({ t, locale, dom, busy, onSet, size = 'row', labels, canMark = true }) =>
  dom ? (
    <div
      className={`ksieg-book-done ksieg-book-done--sm${size === 'button' ? ' ksieg-book-done--inline' : ''}`}
      title={(labels?.doneBy ?? t.podDomBookedBy).replace('{when}', formatStamp(dom.at, locale)).replace('{who}', dom.by || '—')}
    >
      <span className="ksieg-book-done__label">
        <Icon name="check-circle" size={size === 'button' ? 13 : 14} /> {labels?.done ?? t.ksAllInDom}
      </span>
      <button
        type="button"
        className="ksieg-book-undo"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onSet(false);
        }}
      >
        {labels?.undo ?? t.ksUnmarkAll}
      </button>
    </div>
  ) : !canMark ? null : (
    <button
      type="button"
      className={`ksieg-book ${size === 'button' ? 'ksieg-book--btn' : 'ksieg-book--sm'}`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onSet(true);
      }}
    >
      <Icon name="check-circle" size={size === 'button' ? 13 : 14} />
      <span>{labels?.mark ?? t.ksBookInDom}</span>
    </button>
  );

/* ============================== One declaration ============================== */

const snapshot = (nip: string, d: PodatekNieruchomosciDane) =>
  JSON.stringify({ nip, d: { ...d, pobrania: [], dom: null } });

/**
 * One community's declaration for one year, as a page form: the fields of the
 * DN-1 in the form's order, the plots of the ZDN-1, and the tax worked out
 * live with the same code the PDF uses.
 */
const DeklaracjaScreen: React.FC<{
  language: Language;
  locale: string;
  rok: number;
  rekord: PodatekNieruchomosci | null;
  szablon: PodatekNieruchomosciDane;
  /** The NIP a new declaration starts with (a community of Adresy that has none yet). */
  nipStart?: string;
  stawki: PodatkiStawki | undefined;
  onBack: () => void;
  onSaved: (rek: PodatekNieruchomosci) => void;
  onDeleted: () => void;
  onDownloaded: () => void;
  onSetDom: (booked: boolean) => void;
  domBusy: boolean;
}> = ({ language, locale, rok, rekord, szablon, nipStart, stawki, onBack, onSaved, onDeleted, onDownloaded, onSetDom, domBusy }) => {
  const t = translations[language];
  const notify = useNotify();
  const [nip, setNip] = useState(rekord?.nip ?? nipStart ?? '');
  const [dane, setDane] = useState<PodatekNieruchomosciDane>(rekord?.dane ?? szablon);
  const [baseline, setBaseline] = useState(() => (rekord ? snapshot(rekord.nip, rekord.dane) : ''));
  const [busy, setBusy] = useState<null | 'save' | 'pdf' | 'delete'>(null);
  const [podpisOpen, setPodpisOpen] = useState(false);

  const dirty = snapshot(nip, dane) !== baseline;
  const wynik = obliczDN1(dane, stawki?.stawki ?? null);
  const problemy = problemyDN1({ nip, dane }, stawki?.stawki ?? null);
  const canAdd = nip.length === 10 && dane.nazwaPelna.trim() !== '';

  const set = <K extends keyof PodatekNieruchomosciDane>(key: K, value: PodatekNieruchomosciDane[K]) =>
    setDane((d) => ({ ...d, [key]: value }));
  const setAdres = (which: 'siedziba' | 'doreczenia', key: keyof PodatekAdres, value: string) =>
    setDane((d) => ({ ...d, [which]: { ...d[which], [key]: value } }));
  const setGrunt = (i: number, patch: Partial<PodatekGrunt>) =>
    setDane((d) => ({ ...d, grunty: d.grunty.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  const addGrunt = () =>
    setDane((d) => {
      const last = d.grunty[d.grunty.length - 1];
      // A new plot of the same community: its district and holding are usually the same.
      return {
        ...d,
        grunty: [
          ...d.grunty,
          { ...pustyGrunt(last?.rodzaj), polozenie: last?.polozenie ?? '', formaWladania: last?.formaWladania ?? '' },
        ],
      };
    });
  const removeGrunt = (i: number) => setDane((d) => ({ ...d, grunty: d.grunty.filter((_, j) => j !== i) }));

  const back = async () => {
    if (
      dirty &&
      !(await notify.confirm(t.podUnsavedConfirm, { danger: true, confirmLabel: t.podUnsavedDiscard }))
    ) {
      return;
    }
    onBack();
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = rekord
        ? await window.electronAPI.setPodatekNieruchomosci(rekord.id, nip, dane)
        : await window.electronAPI.addPodatekNieruchomosci(nip, rok, dane);
      setNip(saved.nip);
      setDane(saved.dane);
      setBaseline(snapshot(saved.nip, saved.dane));
      notify.success(t.podSaved);
      onSaved(saved);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podSaveError);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!rekord) return;
    setBusy('pdf');
    try {
      const { filePath } = await window.electronAPI.exportPodatekPdf(rekord.id);
      notify.success(t.podDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podDownloadError);
    } finally {
      setBusy(null);
    }
  };

  /** Errors stay in the signing modal (wrong PIN, card pulled out) — it shows them itself. */
  const podpisz = async (wybor: PodpisWybor) => {
    if (!rekord) return;
    const { filePath } = await window.electronAPI.podpiszPodatekPdf(rekord.id, wybor);
    setPodpisOpen(false);
    notify.success(t.podSigned.replace('{file}', baseName(filePath)), { file: filePath });
    onDownloaded();
  };

  const remove = async () => {
    if (!rekord) return;
    if (
      !(await notify.confirm(
        t.podDeleteConfirm.replace('{name}', rekord.dane.nazwaPelna || rekord.nip).replace('{rok}', String(rok)),
        { danger: true, confirmLabel: t.delete },
      ))
    ) {
      return;
    }
    setBusy('delete');
    try {
      await window.electronAPI.deletePodatekNieruchomosci(rekord.id);
      notify.success(t.podDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const ulica = ulicaZNumerem(dane.siedziba);
  const formy = [...FORMY_WLADANIA] as string[];
  /** Why the file can't be made yet — the top bar's buttons say it on hover. */
  const pdfBlocked = !rekord
    ? t.podPdfSaveFirst
    : dirty
      ? t.podPdfSaveFirst
      : problemy.length > 0
        ? `${t.podPdfBlocked} ${problemy.map((p) => problemText(t, p, rok)).join(' ')}`
        : null;

  const note = !rekord && !canAdd ? (
    <span className="action-note">
      <Icon name="info" size={13} /> {t.podNewNeeds}
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

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.podBack}
            crumb={`${t.podTitle} · ${rok}`}
            onBack={() => void back()}
            title={dane.nazwaPelna || t.podNew}
            meta={
              <>
                <span>
                  <Icon name="calendar" size={13} /> {t.podMetaYear.replace('{rok}', String(rok))}
                </span>
                {nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', nip)}
                  </span>
                )}
                {ulica && (
                  <span>
                    <Icon name="map-pin" size={13} /> {ulica}
                  </span>
                )}
                {dane.cel === 2 && <span className="status-badge status-pending">{t.podMetaCorrection}</span>}
              </>
            }
          />
          {/* The declaration's actions, in the order of the work: the rare
              destructive one first and set apart, then the file — plain or
              signed — and last the DOM tick, which closes the job. */}
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
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void download()}
                disabled={pdfBlocked !== null || busy !== null}
                title={pdfBlocked ?? undefined}
              >
                <Icon name={busy === 'pdf' ? 'loader' : 'download'} size={13} /> {t.podDownloadPdf}
              </button>
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => setPodpisOpen(true)}
                disabled={pdfBlocked !== null || busy !== null}
                title={pdfBlocked ?? t.podSignPdfHint}
              >
                <Icon name="signature" size={13} /> {t.podSignPdf}
              </button>
              {/* Judged on the saved declaration, not the form being edited: the PDF is made from what is saved. */}
              <DomSlot
                t={t}
                locale={locale}
                dom={rekord.dane.dom}
                busy={domBusy}
                onSet={onSetDom}
                size="button"
                canMark={stanDeklaracji(rekord, stawki?.stawki ?? null) === 'pobrana'}
              />
            </div>
          )}
        </div>
      </div>

      <div className="content-body">
        <div className="page-form">
          <FormSection icon="landmark" title={t.podSecDeclaration} description={t.podSecDeclarationDesc}>
            <FormField label={t.podOrgan} htmlFor="pod-organ" required hint={t.podOrganHint}>
              <input id="pod-organ" type="text" value={dane.organ} onChange={(e) => set('organ', e.target.value)} />
            </FormField>
            <FormRow>
              <FormField label={t.podCel}>
                <div className="zad-seg" role="radiogroup" aria-label={t.podCel}>
                  {([1, 2] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={dane.cel === c}
                      className={`zad-seg__btn${dane.cel === c ? ' is-active' : ''}`}
                      onClick={() => set('cel', c)}
                    >
                      {c === 1 ? t.podCel1 : t.podCel2}
                    </button>
                  ))}
                </div>
              </FormField>
              <FormField label={t.podOkres}>
                <Select
                  value={String(dane.okresOd)}
                  options={miesiacOptions(locale)}
                  onChange={(v) => set('okresOd', Number(v))}
                  ariaLabel={t.podOkres}
                />
              </FormField>
            </FormRow>
            <FormField label={t.podPodmiot}>
              <Select
                value={String(dane.rodzajPodmiotu)}
                options={[
                  { value: '1', label: t.podPodmiot1 },
                  { value: '2', label: t.podPodmiot2 },
                ]}
                onChange={(v) => set('rodzajPodmiotu', v === '2' ? 2 : 1)}
                ariaLabel={t.podPodmiot}
              />
            </FormField>
          </FormSection>

          <FormSection icon="building" title={t.podSecTaxpayer} description={t.podSecTaxpayerDesc}>
            <FormRow>
              <FormField
                label={t.podNip}
                htmlFor="pod-nip"
                required
                error={nip.length === 10 && !nipPoprawny(nip) ? t.podNipInvalid : null}
              >
                <input
                  id="pod-nip"
                  type="text"
                  inputMode="numeric"
                  className="input-mono"
                  value={nip}
                  onChange={(e) => setNip(tylkoCyfry(e.target.value).slice(0, 10))}
                />
              </FormField>
              <FormField label={t.podRegon} htmlFor="pod-regon">
                <input
                  id="pod-regon"
                  type="text"
                  inputMode="numeric"
                  className="input-mono"
                  value={dane.regon}
                  onChange={(e) => set('regon', tylkoCyfry(e.target.value).slice(0, 14))}
                />
              </FormField>
            </FormRow>
            <FormField label={t.podNazwaPelna} htmlFor="pod-nazwa" required>
              <input
                id="pod-nazwa"
                type="text"
                value={dane.nazwaPelna}
                onChange={(e) => set('nazwaPelna', e.target.value)}
              />
            </FormField>
            <FormRow>
              <FormField label={t.podNazwaSkrocona} htmlFor="pod-nazwa-skr">
                <input
                  id="pod-nazwa-skr"
                  type="text"
                  value={dane.nazwaSkrocona}
                  onChange={(e) => set('nazwaSkrocona', e.target.value)}
                />
              </FormField>
              <FormField label={t.podPodatnik}>
                <Select
                  value={String(dane.rodzajPodatnika)}
                  options={[
                    { value: '1', label: t.podPodatnik1 },
                    { value: '2', label: t.podPodatnik2 },
                    { value: '3', label: t.podPodatnik3 },
                  ]}
                  onChange={(v) => set('rodzajPodatnika', v === '1' ? 1 : v === '2' ? 2 : 3)}
                  ariaLabel={t.podPodatnik}
                />
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection icon="map-pin" title={t.podSecSeat} description={t.podSecSeatDesc}>
            <AdresFields
              t={t}
              idPrefix="pod-siedziba"
              value={dane.siedziba}
              onChange={(k, v) => setAdres('siedziba', k, v)}
            />
          </FormSection>

          <FormSection
            icon="mail"
            title={t.podSecDelivery}
            description={t.podSecDeliveryDesc}
            aside={
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() =>
                  set('doreczenia', {
                    kraj: '',
                    wojewodztwo: '',
                    powiat: '',
                    gmina: '',
                    ulica: '',
                    nrDomu: '',
                    nrLokalu: '',
                    miejscowosc: '',
                    kodPocztowy: '',
                  })
                }
                disabled={Object.values(dane.doreczenia).every((v) => v === '')}
              >
                <Icon name="x" size={13} /> {t.podSecDeliveryClear}
              </button>
            }
          >
            <AdresFields
              t={t}
              idPrefix="pod-doreczenia"
              value={dane.doreczenia}
              onChange={(k, v) => setAdres('doreczenia', k, v)}
            />
          </FormSection>

          <FormSection
            icon="map-pin"
            title={t.podSecLand}
            description={t.podSecLandDesc}
            aside={
              <button type="button" className="button button-small button-secondary" onClick={addGrunt}>
                <Icon name="plus" size={13} /> {t.podLandAdd}
              </button>
            }
          >
            {dane.grunty.length === 0 ? (
              <div className="form-empty">{t.podLandEmpty}</div>
            ) : (
              <ol className="record-list pod-grunty">
                {dane.grunty.map((g, i) => {
                  const forma = g.formaWladania && !formy.includes(g.formaWladania) ? [g.formaWladania, ...formy] : formy;
                  return (
                    <li key={i} className="record-row record-row--top">
                      <span className="record-row__index">{i + 1}</span>
                      <div className="record-row__main">
                        <div className="pod-grid">
                          <div className="pod-span-4">
                            <FormField label={t.podLandPolozenie} htmlFor={`pod-g${i}-pol`}>
                              <input
                                id={`pod-g${i}-pol`}
                                type="text"
                                value={g.polozenie}
                                onChange={(e) => setGrunt(i, { polozenie: e.target.value })}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-2">
                            <FormField label={t.podLandRodzaj}>
                              <Select
                                value={g.rodzaj}
                                options={GRUNT_RODZAJE.map((r) => ({ value: r, label: rodzajLabel(t, r) }))}
                                onChange={(v) => setGrunt(i, { rodzaj: v as GruntRodzaj })}
                                ariaLabel={t.podLandRodzaj}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-2">
                            <FormField label={t.podLandKw} htmlFor={`pod-g${i}-kw`}>
                              <input
                                id={`pod-g${i}-kw`}
                                type="text"
                                className="input-mono"
                                value={g.ksiegaWieczysta}
                                onChange={(e) => setGrunt(i, { ksiegaWieczysta: e.target.value })}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-1">
                            <FormField label={t.podLandObreb} htmlFor={`pod-g${i}-obr`}>
                              <input
                                id={`pod-g${i}-obr`}
                                type="text"
                                className="input-mono"
                                value={g.obreb}
                                onChange={(e) => setGrunt(i, { obreb: e.target.value })}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-1">
                            <FormField label={t.podLandDzialka} htmlFor={`pod-g${i}-dz`}>
                              <input
                                id={`pod-g${i}-dz`}
                                type="text"
                                className="input-mono"
                                value={g.dzialka}
                                onChange={(e) => setGrunt(i, { dzialka: e.target.value })}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-2">
                            <FormField
                              label={t.podLandArea.replace('{unit}', jednostka(g.rodzaj))}
                              htmlFor={`pod-g${i}-pow`}
                              error={g.powierzchnia === null ? t.podRowNoArea : null}
                            >
                              <LiczbaInput
                                id={`pod-g${i}-pow`}
                                value={g.powierzchnia}
                                onChange={(v) => setGrunt(i, { powierzchnia: v })}
                                decimals={jednostkaGruntu(g.rodzaj) === 'ha' ? 4 : 2}
                                unit={jednostka(g.rodzaj)}
                              />
                            </FormField>
                          </div>
                          <div className="pod-span-3">
                            <FormField label={t.podLandForma}>
                              <Select
                                value={g.formaWladania || null}
                                placeholder={t.podLandFormaChoose}
                                options={forma.map((f) => ({ value: f, label: f }))}
                                onChange={(v) => setGrunt(i, { formaWladania: v })}
                                ariaLabel={t.podLandForma}
                              />
                            </FormField>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="button button-small button-ghost icon-danger"
                        onClick={() => removeGrunt(i)}
                        title={t.podLandRemove}
                        aria-label={t.podLandRemove}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {dane.grunty.length > ZDN1_WIERSZY && (
              <div className="callout">
                <Icon name="info" size={16} />
                <div className="callout__body">
                  {t.podLandPages
                    .replace('{n}', String(ZDN1_WIERSZY))
                    .replace('{pages}', String(liczbaZdn1(dane)))}
                </div>
              </div>
            )}
          </FormSection>

          <FormSection icon="coins" title={t.podSecCalc} description={t.podSecCalcDesc}>
            {wynik.d1.length === 0 ? (
              <div className="form-empty">{t.podCalcEmpty}</div>
            ) : (
              <>
                <dl className="facts pod-calc">
                  {wynik.d1.map((p) => (
                    <React.Fragment key={p.rodzaj}>
                      <dt>{rodzajLabel(t, p.rodzaj)}</dt>
                      <dd>
                        <span className="pod-calc__line">
                          {t.podCalcLine
                            .replace('{area}', `${formatPowierzchnia(p.powierzchnia, p.rodzaj)} ${jednostka(p.rodzaj)}`)
                            .replace('{rate}', p.stawka === null ? t.podCalcNoRate : `${formatStawka(p.stawka)} zł`)
                            .replace('{months}', String(wynik.miesiace))}
                        </span>
                        <span className="pod-calc__sum">{p.kwota === null ? '—' : zl2(p.kwota)}</span>
                      </dd>
                    </React.Fragment>
                  ))}
                  <dt>{t.podCalc97}</dt>
                  <dd>
                    <span className="pod-calc__sum">{wynik.kwota97 === null ? '—' : zl2(wynik.kwota97)}</span>
                  </dd>
                  {dane.cel === 2 && (
                    <>
                      <dt>{t.podCalc98}</dt>
                      <dd>
                        <div className="pod-calc__input">
                          <LiczbaInput
                            value={dane.kwotaNieobjeta}
                            onChange={(v) => set('kwotaNieobjeta', v)}
                            decimals={2}
                            unit="zł"
                            ariaLabel={t.podCalc98}
                          />
                          <span className="form-field__hint">{t.podCalc98Hint}</span>
                        </div>
                      </dd>
                    </>
                  )}
                  <dt>{t.podCalc99}</dt>
                  <dd>
                    <span className="pod-calc__sum pod-calc__sum--total">
                      {wynik.kwota99 === null ? '—' : `${formatZl(wynik.kwota99)} zł`}
                    </span>
                  </dd>
                </dl>
                {wynik.kwota99 !== null && wynik.kwota99 > 0 && (
                  <div className="pod-raty">
                    <span className="pod-raty__title">{t.podCalcInstallments}</span>
                    <ol className="pod-raty__list">
                      {wynik.raty.map((r, i) =>
                        r === null ? null : (
                          <li key={i}>
                            <span>{new Date(2000, i, 1).toLocaleString(locale, { month: 'short' })}</span>
                            <strong>{formatZl(r)} zł</strong>
                          </li>
                        ),
                      )}
                    </ol>
                    {wynik.kwota99 <= 100 && <span className="form-field__hint">{t.podCalcOneOff}</span>}
                  </div>
                )}
              </>
            )}
            {wynik.brakujaceStawki.length > 0 && (
              <div className="callout callout--warning">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">{t.podCalcMissingRate.replace(/\{rok\}/g, String(rok))}</div>
              </div>
            )}
          </FormSection>

          <FormSection icon="users" title={t.podSecSign} description={t.podSecSignDesc}>
            <FormRow>
              <FormField label={t.podTelefon} htmlFor="pod-tel">
                <input id="pod-tel" type="text" value={dane.telefon} onChange={(e) => set('telefon', e.target.value)} />
              </FormField>
              <FormField label={t.podEmail} htmlFor="pod-email">
                <input id="pod-email" type="text" value={dane.email} onChange={(e) => set('email', e.target.value)} />
              </FormField>
            </FormRow>
            <FormField label={t.podInne} htmlFor="pod-inne" hint={t.podInneHint}>
              <input id="pod-inne" type="text" value={dane.inne} onChange={(e) => set('inne', e.target.value)} />
            </FormField>
            <FormRow>
              <FormField label={t.podImie} htmlFor="pod-imie">
                <input
                  id="pod-imie"
                  type="text"
                  value={dane.reprezentant.imie}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, imie: e.target.value })}
                />
              </FormField>
              <FormField label={t.podNazwisko} htmlFor="pod-nazwisko">
                <input
                  id="pod-nazwisko"
                  type="text"
                  value={dane.reprezentant.nazwisko}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, nazwisko: e.target.value })}
                />
              </FormField>
              <FormField
                label={t.podData}
                htmlFor="pod-data"
                hint={t.podDataHint}
                action={
                  <button
                    type="button"
                    className="button button-small button-ghost"
                    onClick={() => {
                      const d = new Date();
                      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      set('reprezentant', { ...dane.reprezentant, dataWypelnienia: iso });
                    }}
                  >
                    {t.podToday}
                  </button>
                }
              >
                <input
                  id="pod-data"
                  type="date"
                  value={dane.reprezentant.dataWypelnienia ?? ''}
                  onChange={(e) =>
                    set('reprezentant', { ...dane.reprezentant, dataWypelnienia: e.target.value || null })
                  }
                />
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection icon="download" title={t.podSecPdf} description={t.podSecPdfDesc}>
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
                      <li key={i} title={p.plik}>
                        {(p.podpis ? t.podPdfHistorySigned.replace('{signer}', p.podpis.podmiot) : t.podPdfHistoryItem)
                          .replace('{when}', formatStamp(p.at, locale))
                          .replace('{who}', p.by || '—')}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </FormSection>

          {rekord?.dane.dom && dirty && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.podDomChangedHint
                  .replace('{when}', formatStamp(rekord.dane.dom.at, locale))
                  .replace('{who}', rekord.dane.dom.by || '—')}
              </div>
            </div>
          )}

          <ModalFooter
            className="page-action-bar"
            note={note}
            onSubmit={() => void save()}
            submitLabel={rekord ? t.podSave : t.podAdd}
            submitIcon={rekord ? 'save' : 'plus'}
            submitDisabled={!dirty || (!rekord && !canAdd)}
            submitTitle={!rekord && !canAdd ? t.podNewNeeds : undefined}
            busy={busy === 'save'}
          />
        </div>
      </div>
      {podpisOpen && rekord && (
        <PodpisKartaModal
          language={language}
          title={t.podSignTitle}
          subtitle={`DN-1 ${rok} · ${rekord.dane.nazwaPelna || rekord.nip}`}
          extra={(cert) => (
            <GotowoscPodpisu
              t={t}
              rok={rok}
              rekordy={[rekord]}
              stawki={stawki?.stawki ?? null}
              cert={cert}
              pokazLiczbe={false}
            />
          )}
          onPodpisz={podpisz}
          onClose={() => setPodpisOpen(false)}
        />
      )}
    </>
  );
};

/* ================================== The tab ================================== */

/** The highest year anything is kept for, or the current year when nothing is. */
const domyslnyRok = (lata: number[]) => (lata.length > 0 ? Math.max(...lata) : new Date().getFullYear());

/**
 * Podatki → Nieruchomości: every community's DN-1 for the chosen year — the
 * year's rates on top, the communities below, each opening its declaration.
 * A new year starts as a copy of the previous one.
 */
const PodatkiNieruchomosci: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [lista, setLista] = useState<PodatekNieruchomosci[]>([]);
  const [stawki, setStawki] = useState<PodatkiStawki[]>([]);
  /** Every community of Adresy — the list shows them all, with or without a declaration. */
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<null | 'import' | 'carry' | 'all'>(null);
  const [rokWybrany, setRokWybrany] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filtr, setFiltr] = useState<Filtr>('all');
  /** The declaration open on its own screen — a step of the app's history, so Back returns here. */
  const navItem = useNavItem();
  /** A community of Adresy opened without a declaration: `nowy:<adres id>`, so the form starts from what Adresy knows. */
  const nowyAdresId = navItem.item?.startsWith('nowy:') ? Number(navItem.item.slice(5)) : null;
  const detail: number | 'nowy' | null =
    navItem.item === 'nowy' || nowyAdresId !== null
      ? 'nowy'
      : navItem.item && /^\d+$/.test(navItem.item)
        ? Number(navItem.item)
        : null;
  const nazwaWiersza = (w: WierszDn1): string =>
    w.rek ? w.rek.dane.nazwaPelna || w.rek.nip : w.adres?.identyfikacja?.nazwaPelna || w.adres?.nazwa || '';
  const openDetail = (w: WierszDn1) =>
    w.rek
      ? navItem.open(String(w.rek.id), nazwaWiersza(w))
      : w.adres
        ? navItem.open(`nowy:${w.adres.id}`, nazwaWiersza(w))
        : undefined;
  /** Ticked declarations, by id — what the batch bar acts on. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** "Podpisz zaznaczone": the ids being signed, fixed when the window opens; null = closed. */
  const [podpisWiele, setPodpisWiele] = useState<number[] | null>(null);
  const [postepPodpisu, setPostepPodpisu] = useState<PodatkiPodpisPostep | null>(null);
  /** The last run's outcome, shown until closed. */
  const [podsumowanie, setPodsumowanie] = useState<{ rok: number; wynik: PodatkiPodpisWieleResult } | null>(null);
  useEffect(() => window.electronAPI.onPodatkiPodpisPostep(setPostepPodpisu), []);
  /** Declarations whose DOM tick is being saved. */
  const [domSaving, setDomSaving] = useState<Set<number>>(new Set());
  /** The row ticked last — the start of a Shift+click range. */
  const lastTickedRef = useRef<number | null>(null);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [rows, rates, addresses] = await Promise.all([
        window.electronAPI.getPodatkiNieruchomosci(),
        window.electronAPI.getPodatkiStawki(),
        window.electronAPI.getAdresy(),
      ]);
      setLista(rows);
      setStawki(rates);
      setAdresy(addresses);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lataZDanymi = useMemo(() => [...new Set(lista.map((r) => r.rok))], [lista]);
  const rok = rokWybrany ?? domyslnyRok(lataZDanymi);
  // Years that hold something, plus the one after the last of them — one step
  // ahead only, so picking the new year does not offer yet another.
  const lata = useMemo(() => {
    const znane = [...lataZDanymi, ...stawki.map((s) => s.rok)];
    const nastepny = (znane.length > 0 ? Math.max(...znane) : new Date().getFullYear()) + 1;
    return [...new Set<number>([...znane, nastepny, rok])].sort((a, b) => b - a);
  }, [lataZDanymi, stawki, rok]);

  const wRoku = useMemo(() => lista.filter((r) => r.rok === rok), [lista, rok]);
  const poprzedni = useMemo(() => lista.filter((r) => r.rok === rok - 1), [lista, rok]);
  const brakujace = useMemo(() => {
    const nips = new Set(wRoku.map((r) => r.nip));
    return poprzedni.filter((r) => !nips.has(r.nip));
  }, [wRoku, poprzedni]);
  const stawkiRoku = stawki.find((s) => s.rok === rok);
  const uzyteRodzaje = useMemo(
    () => GRUNT_RODZAJE.filter((r) => wRoku.some((rek) => rek.dane.grunty.some((g) => g.rodzaj === r))),
    [wRoku],
  );

  /** Each declaration's state and what is missing, worked out once per render of the year. */
  const ocena = useMemo(() => {
    const m = new Map<number, { stan: StanDeklaracji; problemy: ProblemDN1[] }>();
    for (const rek of wRoku) {
      m.set(rek.id, {
        stan: stanDeklaracji(rek, stawkiRoku?.stawki ?? null),
        problemy: problemyDN1(rek, stawkiRoku?.stawki ?? null),
      });
    }
    return m;
  }, [wRoku, stawkiRoku]);

  /** Every community of Adresy with its declaration of the year (or none), then declarations whose community is not there. */
  const wiersze = useMemo(() => wierszeDn1(adresy, wRoku), [adresy, wRoku]);

  const wFiltrze = (w: WierszDn1, f: Filtr): boolean => {
    // A community without a declaration is only "all" and "no information".
    if (!w.rek) return f === 'all' || f === 'none';
    const o = ocena.get(w.rek.id);
    if (!o) return false;
    switch (f) {
      case 'all':
        return true;
      case 'none':
        return false;
      case 'errors':
        return o.problemy.length > 0;
      case 'ready':
        return o.stan === 'gotowa';
      case 'downloaded':
        return o.stan === 'pobrana';
      case 'waiting':
        return o.stan !== 'dom';
      case 'dom':
        return o.stan === 'dom';
    }
  };

  const liczniki = useMemo(() => {
    const c: Record<Filtr, number> = { all: 0, errors: 0, ready: 0, downloaded: 0, waiting: 0, dom: 0, none: 0 };
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
          foldText(nazwaWiersza(w)).includes(query) ||
          (!!w.adres &&
            (foldText(w.adres.nazwa).includes(query) ||
              (w.adres.alternativeNames ?? []).some((n) => foldText(n).includes(query)) ||
              (digits !== '' && (w.adres.identyfikacja?.nip ?? '').includes(digits)))) ||
          (!!w.rek &&
            ((digits !== '' && w.rek.nip.includes(digits)) ||
              foldText(ulicaZNumerem(w.rek.dane.siedziba)).includes(query))),
      )
      .sort((a, b) => nazwaWiersza(a).localeCompare(nazwaWiersza(b), 'pl', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiersze, search, filtr, ocena]);
  /** The declarations among the visible rows — a community without one has nothing to tick. */
  const visibleRek = useMemo(() => visible.flatMap((w) => (w.rek ? [w.rek] : [])), [visible]);

  /* ----------------------------- Ticking rows ----------------------------- */

  // Ticks belong to the year on screen: a tick in another year would be acted
  // on without being seen.
  const zaznaczone = wRoku.filter((r) => selected.has(r.id));
  const doPodpisu = podpisWiele ? wRoku.filter((r) => podpisWiele.includes(r.id)) : [];
  const gotoweDoPodpisu = doPodpisu.filter((r) => problemyDN1(r, stawkiRoku?.stawki ?? null).length === 0);
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
   * Tick (or untick) declarations as posted in DOM. Optimistic, like the
   * Pulpit's tick — it is a statement of the user and should feel instant;
   * a failed write reloads the stored rows. True when it was saved.
   */
  const setDom = async (ids: number[], booked: boolean, announce: boolean): Promise<boolean> => {
    if (ids.length === 0) return false;
    const idSet = new Set(ids);
    setDomSaving((prev) => new Set([...prev, ...ids]));
    const stamp = { at: new Date().toISOString(), by: '' };
    setLista((prev) =>
      prev.map((r) =>
        idSet.has(r.id) ? { ...r, dane: { ...r.dane, dom: booked ? r.dane.dom ?? stamp : null } } : r,
      ),
    );
    try {
      const saved = await window.electronAPI.setPodatkiDom(ids, booked);
      const byId = new Map(saved.map((r) => [r.id, r]));
      setLista((prev) => prev.map((r) => byId.get(r.id) ?? r));
      if (announce) {
        notify.success((booked ? t.ksMarkSuccess : t.ksUnmarkSuccess).replace('{count}', String(ids.length)));
      }
      return true;
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.ksMarkError);
      await load(true);
      return false;
    } finally {
      setDomSaving((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const ileWspolnot = (n: number) => plural(n, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities']);
  const ileDeklaracji = (n: number) =>
    plural(n, language, ['deklarację', 'deklaracje', 'deklaracji'], ['declaration', 'declarations']);
  const ileWspolnotBiernik = (n: number) =>
    plural(n, language, ['wspólnotę', 'wspólnoty', 'wspólnot'], ['community', 'communities']);

  /** A new community starts with what the year's others share: authority, delivery address, signer. */
  const szablon = useMemo((): PodatekNieruchomosciDane => {
    const d = pusteDane();
    const wzor = wRoku[0]?.dane;
    if (!wzor) return { ...d, grunty: [pustyGrunt()] };
    return {
      ...d,
      organ: wzor.organ,
      doreczenia: { ...wzor.doreczenia },
      siedziba: {
        ...d.siedziba,
        kraj: wzor.siedziba.kraj,
        wojewodztwo: wzor.siedziba.wojewodztwo,
        powiat: wzor.siedziba.powiat,
        miejscowosc: wzor.siedziba.miejscowosc,
      },
      grunty: [{ ...pustyGrunt(), polozenie: wzor.grunty[0]?.polozenie ?? '', formaWladania: wzor.grunty[0]?.formaWladania ?? '' }],
      telefon: wzor.telefon,
      email: wzor.email,
      inne: wzor.inne,
      reprezentant: { imie: wzor.reprezentant.imie, nazwisko: wzor.reprezentant.nazwisko, dataWypelnienia: null },
    };
  }, [wRoku]);

  /** A community of Adresy opened without a declaration starts from what Adresy knows of it. */
  const adresOtwarty = nowyAdresId !== null ? adresy.find((a) => a.id === nowyAdresId) : undefined;
  const szablonOtwarty = useMemo((): PodatekNieruchomosciDane => {
    const ident = adresOtwarty?.identyfikacja;
    if (!adresOtwarty) return szablon;
    return {
      ...szablon,
      nazwaPelna: ident?.nazwaPelna || adresOtwarty.nazwa,
      regon: ident?.regon || szablon.regon,
      siedziba: ident && !czyAdresPusty(ident.siedziba) ? { ...ident.siedziba } : szablon.siedziba,
      telefon: ident?.telefon || szablon.telefon,
      email: ident?.email || szablon.email,
    };
  }, [adresOtwarty, szablon]);

  const importXlsx = async () => {
    setBusy('import');
    try {
      const result = await window.electronAPI.importPodatkiXlsx();
      if (!result) return;
      const { plikNazwa, dodane, istniejace, pominiete, lata: lataPliku } = result;
      if (dodane === 0) {
        notify.info(t.podImportNothing.replace('{file}', plikNazwa).replace('{n}', ileWspolnot(istniejace)));
      } else {
        notify.success(
          [
            t.podImported
              .replace('{file}', plikNazwa)
              .replace('{n}', ileWspolnotBiernik(dodane))
              .replace('{lata}', lataPliku.join(', ')),
            istniejace > 0 ? t.podImportedExisting.replace('{n}', ileWspolnotBiernik(istniejace)) : '',
            pominiete > 0 ? t.podImportedSkipped.replace('{n}', String(pominiete)) : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
      if (lataPliku.length > 0) setRokWybrany(Math.max(...lataPliku));
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podImportError);
    } finally {
      setBusy(null);
    }
  };

  const carry = async () => {
    setBusy('carry');
    try {
      const n = await window.electronAPI.przeniesPodatkiNaRok(rok - 1, rok);
      notify.success(t.podCarried.replace('{rok}', String(rok)).replace('{n}', ileWspolnotBiernik(n)));
      setRokWybrany(rok);
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.podCarryError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Signs the ticked declarations with one PIN. A rejection (wrong PIN, no card —
   * nothing signed) stays in the signing window; anything else closes it and
   * opens the summary.
   */
  const podpiszWiele = async (wybor: PodpisWybor) => {
    if (!podpisWiele) return;
    setPostepPodpisu(null);
    const wynik = await window.electronAPI.podpiszPodatkiPdf(rok, podpisWiele, wybor);
    setPodpisWiele(null);
    setPostepPodpisu(null);
    setPodsumowanie({ rok, wynik });
    if (wynik.podpisane.length > 0) setSelected(new Set());
    await load(true);
  };

  /** Every declaration of the year — or only the ticked ones — each to its own PDF. */
  const downloadAll = async (ids?: number[]) => {
    setBusy('all');
    try {
      const { folder, zapisane, pominiete } = await window.electronAPI.exportPodatkiPdfWszystkie(rok, ids);
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
      notify.error(err instanceof Error ? err.message : String(err), t.podDownloadError);
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

  // A declaration opened from the history that is gone by now shows the list.
  const rekordOtwarty = typeof detail === 'number' ? lista.find((r) => r.id === detail) ?? null : null;
  if (detail === 'nowy' || rekordOtwarty) {
    const rekord = rekordOtwarty;
    return (
      <DeklaracjaScreen
        key={navItem.item}
        language={language}
        locale={locale}
        rok={rekord?.rok ?? rok}
        rekord={rekord}
        szablon={szablonOtwarty}
        nipStart={tylkoCyfry(adresOtwarty?.identyfikacja?.nip)}
        stawki={stawki.find((s) => s.rok === (rekord?.rok ?? rok))}
        onBack={() => navItem.close()}
        onSaved={(saved) => {
          setLista((prev) => {
            const rest = prev.filter((r) => r.id !== saved.id);
            return [...rest, saved];
          });
          // A new one gets its id on save: the same history step, now naming it.
          navItem.replace(String(saved.id), saved.dane.nazwaPelna || saved.nip);
        }}
        onDeleted={() => {
          navItem.close();
          void load(true);
        }}
        onDownloaded={() => void load(true)}
        onSetDom={(booked) => rekord && void setDom([rekord.id], booked, true)}
        domBusy={!!rekord && domSaving.has(rekord.id)}
      />
    );
  }

  /** A community of Adresy with no declaration this year: its row opens one, started from what Adresy knows. */
  const renderBrak = (w: WierszDn1) => {
    const open = () => openDetail(w);
    const ident = w.adres?.identyfikacja;
    const ulica = ident ? ulicaZNumerem(ident.siedziba) : '';
    return (
      <li key={`brak:${w.adres?.id}`} className="pod-item">
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
              <span className="zeb-row__name">{nazwaWiersza(w)}</span>
              {(ident?.nip || ulica) && (
                <span className="zeb-row__meta">
                  {ident?.nip && (
                    <span>
                      <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', ident.nip)}
                    </span>
                  )}
                  {ulica && (
                    <span>
                      <Icon name="map-pin" size={13} /> {ulica}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="zeb-row__side">
              <span className="status-badge status-neutral" title={t.podRowNoneHint}>
                {t.podRowNone}
              </span>
            </div>
          </div>
        </div>
      </li>
    );
  };

  const renderRow = (w: WierszDn1) => {
    const rek = w.rek;
    if (!rek) return renderBrak(w);
    const { stan, problemy } = ocena.get(rek.id) ?? { stan: 'gotowa' as StanDeklaracji, problemy: [] };
    const wynik = obliczDN1(rek.dane, stawkiRoku?.stawki ?? null);
    const ostatnie = rek.dane.pobrania[rek.dane.pobrania.length - 1];
    const powierzchnie = GRUNT_RODZAJE.map((r) => {
      const plots = rek.dane.grunty.filter((g) => g.rodzaj === r && g.powierzchnia !== null);
      if (plots.length === 0) return '';
      const sum = plots.reduce((s, g) => s + (g.powierzchnia ?? 0), 0);
      return `${formatPowierzchnia(sum, r)} ${jednostka(r)}`;
    }).filter(Boolean);
    const bezPowierzchni = rek.dane.grunty.some((g) => g.powierzchnia === null);
    const ulica = ulicaZNumerem(rek.dane.siedziba);
    const kwota = wynik.kwota99 === null ? null : kwotaWBoksie(wynik.kwota99);
    const isSelected = selected.has(rek.id);
    const open = () => openDetail(w);
    return (
      <li key={rek.id} className="pod-item">
        {/* The tick sits left of the card, outside it — the card opens the
            declaration, and a control inside a clickable card fights it. */}
        <span className="ksieg-row__select">
          <label
            className={`ks-check${isSelected ? ' is-on' : ''}`}
            title={t.podSelectFor}
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
              aria-label={`${t.podSelectFor}: ${rek.dane.nazwaPelna || rek.nip}`}
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
            <div className="zeb-date pod-kwota" title={t.podCalc99}>
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
              <span className="zeb-row__name">{rek.dane.nazwaPelna || rek.nip}</span>
              <span className="zeb-row__meta">
                <span>
                  <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', rek.nip)}
                </span>
                {ulica && (
                  <span>
                    <Icon name="map-pin" size={13} /> {ulica}
                  </span>
                )}
                {powierzchnie.length > 0 && (
                  <span>
                    <Icon name="table" size={13} /> {powierzchnie.join(' + ')}
                  </span>
                )}
                {bezPowierzchni && (
                  <span className="pod-meta-warning">
                    <Icon name="alert-triangle" size={13} /> {t.podRowNoArea}
                  </span>
                )}
                {!w.adres && (
                  <span className="pod-meta-warning" title={t.podOrphanHint}>
                    <Icon name="alert-triangle" size={13} /> {t.podOrphanBadge}
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
              </span>
            </div>
            {/* Posted in DOM is said by the slot beside; the badge names the other states. */}
            {stan !== 'dom' && (
              <div className="zeb-row__side">
                <span
                  className={`status-badge ${
                    stan === 'braki' ? 'status-pending' : stan === 'pobrana' ? 'status-info' : 'status-accent'
                  }`}
                  title={problemy.map((p) => problemText(t, p, rok)).join('\n') || undefined}
                >
                  {stan === 'braki' ? t.podStatusMissing : stan === 'pobrana' ? t.podStatusDownloaded : t.podStatusReady}
                </span>
              </div>
            )}
          </div>
          <div className="pod-row__dom">
            <DomSlot
              t={t}
              locale={locale}
              dom={rek.dane.dom}
              busy={domSaving.has(rek.id)}
              onSet={(booked) => void setDom([rek.id], booked, false)}
              canMark={stan === 'pobrana'}
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
    waiting: t.podFilterWaiting,
    dom: t.podFilterDom,
    none: t.podFilterNone,
  };
  // Posted in DOM only once the PDF is made: a ticked declaration in another state is left out.
  const doZaksiegowania = zaznaczone.filter((r) => !r.dane.dom && ocena.get(r.id)?.stan === 'pobrana');
  const zaksiegowane = zaznaczone.filter((r) => r.dane.dom);

  const minRok = Math.min(...lata);
  const maxRok = Math.max(...lata);
  const kwoty = wRoku.map((r) => obliczDN1(r.dane, stawkiRoku?.stawki ?? null).kwota99);
  const podatekRazem = kwoty.reduce<number>((sum, k) => sum + (k ?? 0), 0);
  const wDom = wRoku.filter((r) => r.dane.dom).length;
  const procentDom = wRoku.length > 0 ? Math.round((wDom / wRoku.length) * 100) : 0;
  const fakty =
    wiersze.length === 0
      ? [t.podHeroEmpty]
      : [
          t.podHeroDeclarations.replace('{n}', String(wRoku.length)).replace('{total}', String(wiersze.length)),
          t.podHeroTax.replace('{kwota}', `${formatZl(podatekRazem)} zł`),
          ...(liczniki.errors > 0 ? [t.podHeroErrors.replace('{n}', String(liczniki.errors))] : []),
        ];

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
            <Icon name="landmark" size={13} /> {t.podTitle}
          </span>
          <h1 className="ksieg-hero__month">
            {rok}
            <span>{t.podHeroYear}</span>
          </h1>
          <p className="ksieg-hero__facts">{fakty.join(' · ')}</p>
        </div>

        <div className="ksieg-hero__nav">
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => zmienRok(rok - 1)}
            disabled={rok <= minRok}
            title={t.podYearPrev}
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
            title={t.podYearNext}
            aria-label={t.podYearNext}
          >
            <Icon name="chevron-right" size={17} />
          </button>
          <button
            type="button"
            className="ksieg-scan-btn"
            onClick={() => void downloadAll()}
            disabled={busy !== null || wRoku.length === 0}
            title={t.podDownloadAllHint.replace('{rok}', String(rok))}
          >
            <Icon name={busy === 'all' ? 'loader' : 'download'} size={15} />
            <span>{t.podDownloadAll}</span>
          </button>
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            title={t.zebraniaRefresh}
            aria-label={t.zebraniaRefresh}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        {wRoku.length > 0 && (
          <div className="ksieg-hero__progress">
            <div className="ksieg-progress__head">
              <span className="ksieg-progress__label">{t.ksProgressLabel}</span>
              <span className="ksieg-progress__value">
                {t.ksProgressDone.replace('{done}', String(wDom)).replace('{total}', String(wRoku.length))}
                <strong>{procentDom}%</strong>
              </span>
            </div>
            <div className="ksieg-progress__track">
              <div className="ksieg-progress__fill" style={{ width: `${procentDom}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="zeb-toolbar">
        <div className="ksieg-search">
          <Icon name="search" size={15} />
          <input type="text" placeholder={t.podSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim() && (
            <button type="button" onClick={() => setSearch('')} title={t.close} aria-label={t.close}>
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
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void importXlsx()}
            disabled={busy !== null}
            title={t.podImportHint}
          >
            <Icon name={busy === 'import' ? 'loader' : 'upload'} size={14} /> {t.podImport}
          </button>
          <button type="button" className="button button-primary" onClick={() => navItem.open('nowy', t.podNew)}>
            <Icon name="plus" size={14} /> {t.podAdd}
          </button>
        </div>
      </div>

      <div className="page-form pod-list-page">
        <StawkiSection
          language={language}
          locale={locale}
          rok={rok}
          wpis={stawkiRoku}
          uzyte={uzyteRodzaje}
          onSaved={() => void load(true)}
        />

        {wiersze.length === 0 ? (
          <div className="zeb-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="landmark" size={22} />
            </span>
            <strong>{t.podEmptyTitle.replace('{rok}', String(rok))}</strong>
            {poprzedni.length > 0 ? (
              <>
                <p>
                  {t.podEmptyCarry
                    .replace('{prev}', String(rok - 1))
                    .replace('{n}', ileWspolnot(poprzedni.length))
                    .replace('{rok}', String(rok))}
                </p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void carry()}
                  disabled={busy !== null}
                >
                  <Icon name={busy === 'carry' ? 'loader' : 'copy'} size={14} />{' '}
                  {t.podCarry.replace('{prev}', String(rok - 1))}
                </button>
              </>
            ) : (
              <>
                <p>{t.podEmptyText}</p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void importXlsx()}
                  disabled={busy !== null}
                >
                  <Icon name={busy === 'import' ? 'loader' : 'upload'} size={14} /> {t.podImport}
                </button>
              </>
            )}
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
                <ul className="zeb-list">{visible.map(renderRow)}</ul>
              </>
            )}
          </>
        )}

        {/* Ticked declarations, acted on together: floats at the bottom, as on the Pulpit. */}
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
            {zaksiegowane.length > 0 && (
              <button
                type="button"
                className="button button-small button-ghost"
                disabled={domSaving.size > 0}
                onClick={() =>
                  void setDom(
                    zaksiegowane.map((r) => r.id),
                    false,
                    true,
                  ).then((ok) => ok && setSelected(new Set()))
                }
              >
                {t.podBatchUndom.replace('{n}', String(zaksiegowane.length))}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void downloadAll(zaznaczone.map((r) => r.id))}
            >
              <Icon name="download" size={14} /> {t.podBatchPdf.replace('{n}', String(zaznaczone.length))}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null || podpisWiele !== null}
              onClick={() => setPodpisWiele(zaznaczone.map((r) => r.id))}
              title={t.podSignPdfHint}
            >
              <Icon name="signature" size={14} /> {t.podBatchSign.replace('{n}', String(zaznaczone.length))}
            </button>
            {doZaksiegowania.length > 0 && (
              <button
                type="button"
                className="ksieg-book ksieg-book--sm"
                disabled={domSaving.size > 0}
                onClick={() =>
                  void setDom(
                    doZaksiegowania.map((r) => r.id),
                    true,
                    true,
                  ).then((ok) => ok && setSelected(new Set()))
                }
              >
                <Icon name="check-circle" size={14} />
                <span>{t.podBatchDom.replace('{n}', String(doZaksiegowania.length))}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {podpisWiele && (
        <PodpisKartaModal
          language={language}
          title={t.podSignManyTitle}
          subtitle={t.podSignManySubtitle.replace('{rok}', String(rok)).replace('{n}', String(doPodpisu.length))}
          extra={(cert) => (
            <GotowoscPodpisu
              t={t}
              rok={rok}
              rekordy={doPodpisu}
              stawki={stawkiRoku?.stawki ?? null}
              cert={cert}
              pokazLiczbe
            />
          )}
          submitLabel={t.podSignManySubmit.replace('{n}', ileDeklaracji(gotoweDoPodpisu.length))}
          submitDisabled={gotoweDoPodpisu.length === 0}
          pinHint={t.podSignManyPinHint.replace('{n}', ileDeklaracji(gotoweDoPodpisu.length))}
          postep={postepPodpisu}
          onPrzerwij={() => void window.electronAPI.przerwijPodpisPodatkow()}
          onPodpisz={podpiszWiele}
          onClose={() => setPodpisWiele(null)}
        />
      )}
      {podsumowanie && (
        <PodsumowaniePodpisow
          t={t}
          rok={podsumowanie.rok}
          wynik={podsumowanie.wynik}
          onZaznacz={(ids) => {
            setSelected(new Set(ids));
            lastTickedRef.current = null;
          }}
          onClose={() => setPodsumowanie(null)}
        />
      )}
      {busy === 'import' && <BusyOverlay label={t.podImporting} />}
      {busy === 'all' && <BusyOverlay label={t.podDownloadingAll} />}
    </div>
  );
};

export default PodatkiNieruchomosci;
