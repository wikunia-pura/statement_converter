import React, { useEffect, useMemo, useState } from 'react';
import {
  AdresUdzialy,
  PlanGospodarczy,
  PlanPozycja,
  Sprawozdanie,
  PlanOkresZaliczki,
  PlanZaliczkaAiPropozycja,
  ZebraniaUstawienia,
  ZebraniaWspolnota,
  ZebranieWersja,
} from '../../shared/types';
import {
  miesiaceOkresu,
  naM2,
  newPozycja,
  newRemontFR,
  kosztyPoprawione,
  kwotyWyliczone,
  okresyLabels,
  dodajZmianeStawki,
  domyslnyMiesiacZmiany,
  okresyZPoczatkow,
  poczatkiOkresow,
  wolneMiesiaceZmiany,
  planSumy,
  przeliczZalozenia,
  wzrostPozostalych,
  wzrostyPlanu,
  zachowajWzrosty,
  liczbaWlasnychWzrostow,
  planZeSprawozdania,
  pozycjePlanu,
  przegenerujPozycje,
  ukladPozycji,
  wierszePlanu,
  zaliczkaBilansujaca,
  ZaliczkaRodzaj,
} from '../../shared/plan-gospodarczy';
import { formatData, formatKwota, okresLabel, sprawozdanieWersji } from '../../shared/sprawozdanie';
import { wersjaLabel } from '../../shared/zebrania';
import { planyZZebran, udzialyDlaNowegoPlanu } from '../../shared/plany';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import { FormField, FormRow, FormSection } from './FormSection';
import { ModalFooter } from './Modal';
import OverflowMenu from './OverflowMenu';
import Icon from './Icon';
import KwotaInput from './KwotaInput';
import ZebranieDokumentActions, { DokumentZrodlo } from './ZebranieDokumentActions';
import { bezPrefiksu } from './PodpisKarta';
import MergedBadge from './MergedBadge';
import Tip from './Tip';

type T = (typeof translations)['pl'];

/** What decides whether the plan on screen differs from the stored one. */
function contentOf(p: PlanGospodarczy | null): string {
  if (!p) return '';
  const { pobrania: _p, zmieniono: _z, zmienil: _w, ...rest } = p;
  return JSON.stringify(rest);
}

const zl = (n: number) => `${formatKwota(n)} zł`;

/** "10%", "10,3%", "-2,5%" — a growth to one decimal. */
const procent = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')}%`;

/* ============================= Advance periods ============================= */

/**
 * The year's advance rate: one rate for the whole year, until the user adds a
 * change of rate from a month picked in a list (by default the month after
 * the meeting) — each change starts a new stretch, so the stretches always
 * make up the 12 months.
 */
const OkresyEditor: React.FC<{
  t: T;
  rok: number;
  okresy: PlanOkresZaliczki[];
  kwoty: number[];
  onChange: (okresy: PlanOkresZaliczki[]) => void;
  readOnly?: boolean;
  /** The meeting adopting the plan — a new rate is offered from the month after it. */
  dataZebrania?: string | null;
}> = ({ t, rok, okresy, kwoty, onChange, readOnly, dataZebrania = null }) => {
  const nazwy = t.zplanMonthNames.split(',');
  const labels = okresyLabels(okresy, rok);
  const starts = poczatkiOkresow(okresy);
  const months = okresy.reduce((n, o) => n + o.miesiace, 0);
  const caly = okresy.length === 1 && months === 12;
  const wolne = wolneMiesiaceZmiany(okresy);
  /** The month picked for a new rate; null = the picker is closed. */
  const [nowy, setNowy] = useState<number | null>(null);

  const setStawka = (i: number, stawka: number) =>
    onChange(okresy.map((o, j) => (j === i ? { ...o, stawka } : o)));
  // A stretch removed: the one before takes its months (the first: the next one starts in January).
  const remove = (i: number) =>
    onChange(
      okresyZPoczatkow(
        starts.filter((_, j) => j !== i),
        okresy.map((o) => o.stawka).filter((_, j) => j !== i)
      )
    );
  const dodaj = () => {
    if (nowy != null) onChange(dodajZmianeStawki(okresy, nowy));
    setNowy(null);
  };

  const okres = (i: number) => {
    if (caly) return <span>{t.zplanWholeYear.replace('{rok}', String(rok))}</span>;
    const od = starts[i];
    const koniec = (i + 1 < starts.length ? starts[i + 1] : 13) - 1;
    return (
      <span className="zplan-okres">
        <span>{koniec > od ? `${nazwy[od - 1]} – ${nazwy[koniec - 1]}` : nazwy[od - 1]}</span>
        <span className="zeb-muted">
          · {readOnly ? labels[i] : `${okresy[i].miesiace} ${t.zplanMonths}`}
        </span>
        {!readOnly && (
          <button
            type="button"
            className="button button-icon button-ghost"
            onClick={() => remove(i)}
            title={t.zplanRemovePeriod}
            aria-label={t.zplanRemovePeriod}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </span>
    );
  };

  const poZebraniu =
    nowy != null && dataZebrania?.startsWith(String(rok)) && Number(dataZebrania.slice(5, 7)) + 1 === nowy;

  return (
    <>
      {okresy.map((o, i) => (
        <tr key={i} className="zplan-sub">
          <td />
          <td>{okres(i)}</td>
          <td className="zfin-num">
            <span className="zplan-rate">
              {readOnly ? (
                <span className="zplan-ro">{formatKwota(o.stawka)}</span>
              ) : (
                <KwotaInput
                  className="zplan-input zplan-input--rate"
                  value={o.stawka}
                  onChange={(n) => setStawka(i, n)}
                  ariaLabel={t.zplanRate}
                />
              )}
              <span className="zeb-muted">{t.zplanRate}</span>
            </span>
          </td>
          <td className="zfin-num">{formatKwota(kwoty[i])}</td>
        </tr>
      ))}
      {!readOnly && (wolne.length > 0 || months !== 12) && (
        <tr className="zplan-sub">
          <td />
          <td colSpan={3}>
            {nowy == null ? (
              wolne.length > 0 && (
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => setNowy(domyslnyMiesiacZmiany(okresy, rok, dataZebrania))}
                >
                  <Icon name="plus" size={12} /> {caly ? t.zplanSplitYear : t.zplanAddPeriod}
                </button>
              )
            ) : (
              <span className="zplan-okres">
                <span>{t.zplanPeriodFrom}</span>
                <select
                  className="zplan-month"
                  value={nowy}
                  onChange={(e) => setNowy(Number(e.target.value))}
                  aria-label={t.zplanPeriodFrom}
                  autoFocus
                >
                  {wolne.map((m) => (
                    <option key={m} value={m}>
                      {nazwy[m - 1]}
                    </option>
                  ))}
                </select>
                <button type="button" className="button button-small button-primary" onClick={dodaj}>
                  <Icon name="check" size={12} /> {t.zplanPeriodAdd}
                </button>
                <button type="button" className="button button-small button-ghost" onClick={() => setNowy(null)}>
                  {t.cancel}
                </button>
                {poZebraniu && <span className="zeb-muted">{t.zplanPeriodAfterMeeting}</span>}
              </span>
            )}
            {months !== 12 && (
              <span className="cell-warning zplan-warn">
                <Icon name="alert-triangle" size={13} />{' '}
                {t.zplanMonthsWarn.replace('{n}', String(months))}
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

/* ============================== Advance boxes ============================== */

/**
 * What a plan with the given advance comes to, as one line: for "A" the total
 * and how part I balances, for "B" the total and the fund at the year's end.
 */
const wynikZaliczki = (t: T, plan: PlanGospodarczy, x: ZaliczkaRodzaj): string => {
  const s = planSumy(plan);
  if (x === 'B') {
    return t.zplanAdvBResult
      .replace('{kwota}', formatKwota(s.zaliczkaBRazem))
      .replace('{fundusz}', formatKwota(s.saldoBKoniec));
  }
  const bilans =
    Math.abs(s.roznicaA) < 0.01
      ? t.zplanAdvAiBalanced
      : s.roznicaA > 0
        ? t.zplanAdvAiSurplus.replace('{kwota}', formatKwota(s.roznicaA))
        : t.zplanAdvAiShortfall.replace('{kwota}', formatKwota(-s.roznicaA));
  return t.zplanAdvAiResult.replace('{kwota}', formatKwota(s.zaliczkaARazem)).replace('{bilans}', bilans);
};

/**
 * An advance on its own — "A" for the running costs, "B" for the repair fund:
 * the year's rates, the rate that balances its part (computed), and a rate
 * proposed by the AI with its reasons — a proposal changes the plan only when
 * applied.
 */
const ZaliczkaBox: React.FC<{
  t: T;
  x: ZaliczkaRodzaj;
  plan: PlanGospodarczy;
  onChange: (plan: PlanGospodarczy) => void;
  readOnly: boolean;
  dataZebrania: string | null;
  /** Asks the AI for a rate; null = it failed (already reported). Absent = no AI here. */
  proponuj?: (x: ZaliczkaRodzaj, wskazowki: string) => Promise<PlanZaliczkaAiPropozycja | null>;
}> = ({ t, x, plan, onChange, readOnly, dataZebrania, proponuj }) => {
  const s = planSumy(plan);
  const bilans = zaliczkaBilansujaca(plan, x);
  const okresy = x === 'A' ? plan.zaliczkaA : plan.zaliczkaB;
  const B = x === 'B';
  const [aiOpen, setAiOpen] = useState(false);
  const [wskazowki, setWskazowki] = useState('');
  const [generating, setGenerating] = useState(false);
  const [propozycja, setPropozycja] = useState<PlanZaliczkaAiPropozycja | null>(null);
  /** The reasons of the proposal last applied, kept on screen next to its rates. */
  const [uzasadnienie, setUzasadnienie] = useState<string | null>(null);

  const setOkresy = (o: PlanOkresZaliczki[]) => onChange(B ? { ...plan, zaliczkaB: o } : { ...plan, zaliczkaA: o });
  // A split year stays split: the balancing rate is the last stretch's, the earlier ones keep theirs.
  const last = okresy.length - 1;
  const labels = okresyLabels(okresy, plan.rok);
  const juzBilansuje = okresy[last]?.stawka === bilans.stawka;

  const generate = async () => {
    if (!proponuj) return;
    setGenerating(true);
    try {
      const p = await proponuj(x, wskazowki);
      if (p) {
        setPropozycja(p);
        setAiOpen(false);
      }
    } finally {
      setGenerating(false);
    }
  };

  const apply = () => {
    if (!propozycja) return;
    setOkresy(propozycja.okresy);
    setUzasadnienie(propozycja.uzasadnienie);
    setPropozycja(null);
  };

  const proposalLabels = propozycja ? okresyLabels(propozycja.okresy, plan.rok) : [];

  return (
    <FormSection
      icon={B ? 'building' : 'coins'}
      title={(B ? t.zplanAdvBTitle : t.zplanAdvATitle).replace('{rok}', String(plan.rok))}
      description={readOnly ? undefined : B ? t.zplanAdvBHint : t.zplanAdvAHint}
      aside={
        !readOnly &&
        proponuj &&
        !aiOpen &&
        !generating && (
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => setAiOpen(true)}
          >
            <Icon name="sparkles" size={13} /> {t.zplanAdvAiOpen}
          </button>
        )
      }
    >
      <div className="table-scroll">
        <table className="zfin-table zplan-table">
          <thead>
            <tr>
              <th className="zplan-lp" />
              <th>{t.zplanAdvance.replace('{x}', x)}</th>
              <th className="zfin-num">{t.zplanPerM2Rate}</th>
              <th className="zfin-num">{t.zplanAmount}</th>
            </tr>
          </thead>
          <tbody>
            <OkresyEditor
              t={t}
              rok={plan.rok}
              okresy={okresy}
              kwoty={B ? s.zaliczkaB : s.zaliczkaA}
              onChange={setOkresy}
              readOnly={readOnly}
              dataZebrania={dataZebrania}
            />
            <tr className="is-sum">
              <td />
              <td colSpan={2}>{t.zplanAdvTotal.replace('{x}', x)}</td>
              <td className="zfin-num">{formatKwota(B ? s.zaliczkaBRazem : s.zaliczkaARazem)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {!readOnly && !(plan.powierzchnia > 0) && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.zplanAdvNoArea}</div>
        </div>
      )}

      {!readOnly && (
        <div className="callout callout--muted">
          <Icon name="info" size={16} />
          <div className="callout__body">
            <p className="zplan-adv-result">{wynikZaliczki(t, plan, x)}</p>
            {bilans.potrzebne <= 0
              ? B
                ? t.zplanAdvBBalanceNone
                : t.zplanAdvABalanceNone
              : last === 0
                ? (B ? t.zplanAdvBBalance : t.zplanAdvABalance)
                    .replace('{kwota}', formatKwota(bilans.potrzebne))
                    .replace('{stawka}', formatKwota(bilans.stawka))
                : `${(B ? t.zplanAdvBBalanceNeed : t.zplanAdvABalanceNeed).replace(
                    '{kwota}',
                    formatKwota(bilans.potrzebne)
                  )} ${t.zplanAdvBalanceSplit
                    .replace('{przed}', labels.slice(0, last).join(', '))
                    .replace('{wczesniej}', formatKwota(bilans.wczesniej))
                    .replace('{okres}', labels[last])
                    .replace('{stawka}', formatKwota(bilans.stawka))}`}
            {bilans.potrzebne > 0 && !juzBilansuje && (
              <button
                type="button"
                className="button button-small button-secondary zplan-balance__btn"
                onClick={() => {
                  setOkresy(bilans.okresy);
                  setUzasadnienie(null);
                }}
              >
                {t.zplanAdvASetBalance}
              </button>
            )}
          </div>
        </div>
      )}

      {uzasadnienie && !propozycja && (
        <div className="callout callout--info">
          <Icon name="sparkles" size={16} />
          <div className="callout__body">
            <strong>{t.zplanAdvAiApplied}</strong> {uzasadnienie}
          </div>
          <button
            type="button"
            className="button button-icon button-ghost"
            onClick={() => setUzasadnienie(null)}
            title={t.zplanAdvAiHide}
            aria-label={t.zplanAdvAiHide}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {aiOpen && !generating && (
        <div className="zfin-ai-panel">
          <FormField label={t.zfinIntroAiGuidance} htmlFor={`zplan-ai-wskazowki-${x}`} hint={t.zplanAdvAiGuidanceHint}>
            <textarea
              id={`zplan-ai-wskazowki-${x}`}
              rows={3}
              value={wskazowki}
              maxLength={2000}
              placeholder={B ? t.zplanAdvBAiGuidancePlaceholder : t.zplanAdvAiGuidancePlaceholder}
              onChange={(e) => setWskazowki(e.target.value)}
            />
          </FormField>
          <div className="section-actions">
            <button type="button" className="button button-small button-secondary" onClick={() => setAiOpen(false)}>
              {t.cancel}
            </button>
            <button type="button" className="button button-small button-primary" onClick={() => void generate()}>
              <Icon name="sparkles" size={13} /> {t.zplanAdvAiGenerate}
            </button>
          </div>
        </div>
      )}

      {generating && (
        <div className="zlacz-ai-working" role="status" aria-live="polite">
          <div className="zlacz-ai-working__head">
            <span className="loader-spinner zlacz-ai-working__spinner" aria-hidden="true" />
            <span className="zlacz-ai-working__text">
              <strong>{t.zplanAdvAiWorking}</strong>
              <span>{t.zplanAdvAiWorkingHint}</span>
            </span>
          </div>
          <div className="zlacz-ai-working__skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {propozycja && (
        <div className="callout callout--info zplan-adv-proposal">
          <Icon name="sparkles" size={16} />
          <div className="callout__body">
            <strong>{t.zplanAdvAiProposal}</strong>
            <ul>
              {propozycja.okresy.map((o, i) => (
                <li key={i}>
                  {t.zplanPeriod.replace('{label}', proposalLabels[i])} {o.miesiace} {t.zplanMonths} ×{' '}
                  <strong>{formatKwota(o.stawka)}</strong> {t.zplanRate}
                </li>
              ))}
            </ul>
            <p>
              {wynikZaliczki(
                t,
                B ? { ...plan, zaliczkaB: propozycja.okresy } : { ...plan, zaliczkaA: propozycja.okresy },
                x
              )}
            </p>
            <p>
              <strong>{t.zplanAdvAiReason}</strong> {propozycja.uzasadnienie}
            </p>
            <div className="callout__actions">
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => setPropozycja(null)}
              >
                {t.zplanAdvAiDismiss}
              </button>
              <button type="button" className="button button-small button-primary" onClick={apply}>
                <Icon name="check" size={13} /> {t.zplanAdvAiApply}
              </button>
            </div>
          </div>
        </div>
      )}
    </FormSection>
  );
};

/* ============================ A position's growth ============================ */

/**
 * A statement cost's growth over last year, right at the position: the chip
 * shows it (the others' share of the index, or its own), a click opens a field
 * to give it its own — 0% for none — or to put it back on the shared one.
 */
const WzrostPozycji: React.FC<{
  t: T;
  nazwa: string;
  /** Its own growth; absent = it shares the index. */
  wlasny: number | undefined;
  /** What the costs without an own growth rise by; null = there are none such. */
  pozostale: number | null;
  /** Absent = shown only. */
  onSet?: (wzrost: number | null) => void;
}> = ({ t, nazwa, wlasny, pozostale, onSet }) => {
  const [edit, setEdit] = useState<number | null>(null);
  if (wlasny == null && pozostale == null) return null;

  if (edit != null && onSet) {
    const apply = () => {
      onSet(edit);
      setEdit(null);
    };
    return (
      <span
        className="zplan-growth-edit"
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
          if (e.key === 'Escape') setEdit(null);
        }}
      >
        <KwotaInput
          className="zplan-input zplan-input--pct"
          value={edit}
          onChange={setEdit}
          ariaLabel={t.zplanGrowthOwnInput.replace('{nazwa}', nazwa)}
        />
        <span className="zeb-muted">%</span>
        <button type="button" className="button button-small button-primary" onClick={apply}>
          <Icon name="check" size={12} /> {t.zplanGrowthApply}
        </button>
        {wlasny != null && (
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => {
              onSet(null);
              setEdit(null);
            }}
          >
            {t.zplanGrowthReset}
          </button>
        )}
        <button
          type="button"
          className="button button-icon button-ghost"
          onClick={() => setEdit(null)}
          aria-label={t.cancel}
        >
          <Icon name="x" size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`zplan-growth${wlasny != null ? ' is-own' : ''}`}
      onClick={onSet ? () => setEdit(wlasny ?? 0) : undefined}
      disabled={!onSet}
      aria-label={wlasny != null ? t.zplanGrowthOwnTitle : t.zplanGrowthSharedTitle}
    >
      {wlasny != null
        ? t.zplanGrowthOwn.replace('{p}', procent(wlasny))
        : t.zplanGrowthShared.replace('{p}', procent(pozostale ?? 0))}
    </button>
  );
};

/* ============================ Back to the original ============================ */

/**
 * An amount's way back to where it came from — the statement's figure or what
 * the plan drafts — shown only while the amount differs from it.
 */
const PrzywrocKwote: React.FC<{ hint: string; onRestore: () => void }> = ({ hint, onRestore }) => (
  <Tip className="zplan-restore" ariaLabel={hint} content={hint}>
    <button type="button" className="button button-icon button-ghost" onClick={onRestore} aria-label={hint}>
      <Icon name="undo" size={13} />
    </button>
  </Tip>
);

/** What the plan's amounts were before anyone typed over them. */
export interface PlanOryginal {
  /** Each position's drafted amount, by index in `pozycje`; null = typed in by hand. */
  pozycje: (number | null)[];
  /** The statement's figures; absent when the statement is not the plan's own. */
  saldoA?: number;
  saldoB?: number;
  kredyt?: number;
}

/* ================================ The editor ================================ */

const PlanEditor: React.FC<{
  t: T;
  plan: PlanGospodarczy;
  onChange: (plan: PlanGospodarczy) => void;
  /** Figures as text, no fields or row actions — a plan kept elsewhere, or replaced. */
  readOnly?: boolean;
  /** Asks the AI for an advance rate; absent = no AI offered. */
  proponujZaliczke?: (x: ZaliczkaRodzaj, wskazowki: string) => Promise<PlanZaliczkaAiPropozycja | null>;
  /** The meeting adopting the plan — a change of rate is offered from the month after it. */
  dataZebrania?: string | null;
  /** A statement cost's own growth set (null = back to the shared one). Absent = the growth is only shown. */
  onWzrost?: (pozycjaId: string, wzrost: number | null) => void;
  /** The amounts as drafted from the statement — each amount typed over can go back to it. Absent = no way back. */
  oryginal?: PlanOryginal | null;
}> = ({ t, plan, onChange, readOnly = false, proponujZaliczke, dataZebrania = null, onWzrost, oryginal = null }) => {
  const s = planSumy(plan);
  const stan = formatData(plan.stanNaDzien);
  // What a statement cost without a growth of its own rises by — the others' share of the index.
  const pozostale = useMemo(() => wzrostPozostalych(plan.pozycje, plan.wskaznik), [plan.pozycje, plan.wskaznik]);
  const update = (fn: (p: PlanGospodarczy) => PlanGospodarczy) => onChange(fn(plan));
  const setPozycja = (index: number, patch: Partial<PlanPozycja>) =>
    update((p) => ({ ...p, pozycje: p.pozycje.map((z, j) => (j === index ? { ...z, ...patch } : z)) }));

  /**
   * An amount: a field to type in, or — read-only — the figure itself. With the
   * original figure given, an amount typed over offers to go back to it.
   */
  const kwota = (
    value: number,
    onSet: (n: number) => void,
    label: string,
    wstecz?: { value: number | null | undefined; hint: string }
  ) => {
    if (readOnly) return <span className="zplan-ro">{formatKwota(value)}</span>;
    const back = wstecz?.value;
    return (
      <span className="zplan-amount">
        {back != null && Math.abs(back - value) >= 0.005 && (
          <PrzywrocKwote
            hint={`${wstecz!.hint.replace('{kwota}', formatKwota(back))} — ${label}`}
            onRestore={() => onSet(back)}
          />
        )}
        <KwotaInput className="zplan-input" value={value} onChange={onSet} ariaLabel={label} />
      </span>
    );
  };

  /**
   * One side's positions as the statement lists them: a subcategory is a heading
   * with its sum, its items under it. Costs are numbered and show the m² rate.
   */
  const pozycjeRows = (strona: PlanPozycja['strona']) => {
    const koszt = strona === 'koszt';
    let lp = 0;
    const rows = wierszePlanu(plan, strona).map((w, n) => {
      if (w.typ === 'grupa') {
        return (
          <tr key={`g-${n}-${w.nazwa}`} className={`zplan-group${koszt ? '' : ' zplan-sub'}`}>
            <td className="zplan-lp">{koszt ? `${++lp}.` : ''}</td>
            <td>{w.nazwa}</td>
            <td className="zfin-num zeb-muted">{koszt ? formatKwota(naM2(plan, w.kwota)) : ''}</td>
            <td className="zfin-num">{formatKwota(w.kwota)}</td>
          </tr>
        );
      }
      const z = w.pozycja;
      const reczna = z.wiersze.length === 0;
      const zWydruku = !reczna && (z.wiersze.length > 1 || z.wiersze[0] !== z.nazwa);
      const deep = w.wGrupie || !koszt;
      return (
        <tr key={z.id} className={deep ? `zplan-sub${w.wGrupie && !koszt ? ' zplan-sub--deep' : ''}` : ''}>
          <td className="zplan-lp">{koszt && !w.wGrupie ? `${++lp}.` : ''}</td>
          <td>
            {reczna && !readOnly ? (
              <span className="zplan-repair">
                <input
                  type="text"
                  value={z.nazwa}
                  placeholder={t.zplanItemPlaceholder}
                  onChange={(e) => setPozycja(w.index, { nazwa: e.target.value })}
                />
                <button
                  type="button"
                  className="button button-icon button-ghost icon-danger"
                  onClick={() => update((p) => ({ ...p, pozycje: p.pozycje.filter((x) => x.id !== z.id) }))}
                  title={t.zplanRemoveItem}
                  aria-label={t.zplanRemoveItem}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            ) : (
              <span className="zplan-label">
                {z.nazwa || '—'}
                {zWydruku && (
                  <MergedBadge label={t.zfinMergedOf} wiersze={z.wiersze} />
                )}
                {!reczna && (
                  <span className="zplan-src__last">
                    {t.zplanLastYear.replace('{kwota}', formatKwota(z.kwotaRoczna))}
                  </span>
                )}
                {!reczna && koszt && (
                  <WzrostPozycji
                    t={t}
                    nazwa={z.nazwa}
                    wlasny={z.wzrost}
                    pozostale={pozostale}
                    onSet={onWzrost && !readOnly ? (w) => onWzrost(z.id, w) : undefined}
                  />
                )}
              </span>
            )}
          </td>
          <td className="zfin-num zeb-muted">{koszt ? formatKwota(naM2(plan, z.kwota)) : ''}</td>
          <td className="zfin-num">
            {kwota(z.kwota, (v) => setPozycja(w.index, { kwota: v }), z.nazwa || t.zplanAmount, {
              value: oryginal?.pozycje[w.index],
              hint: koszt ? t.zplanRestoreDrafted : t.zplanRestoreStatement,
            })}
          </td>
        </tr>
      );
    });
    return { rows, lp };
  };

  const dodaj = (strona: PlanPozycja['strona']) =>
    !readOnly && (
      <tr className="zplan-sub">
        <td />
        <td colSpan={3}>
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => update((p) => ({ ...p, pozycje: [...p.pozycje, newPozycja(strona)] }))}
          >
            <Icon name="plus" size={12} /> {t.zplanAddItem}
          </button>
        </td>
      </tr>
    );

  const przychody = pozycjeRows('przychod');
  const koszty = pozycjeRows('koszt');

  return (
    <>
      <FormSection icon="file-text" title={t.zplanHeader}>
        {readOnly ? (
          <dl className="facts">
            <dt>{t.zplanProperty}</dt>
            <dd>
              <strong>{plan.nieruchomosc || '—'}</strong>
            </dd>
            <dt>{t.zplanResolution}</dt>
            <dd>{plan.uchwalaNr || '—'}</dd>
            <dt>{t.zplanYear}</dt>
            <dd>{plan.rok}</dd>
            <dt>{t.zplanArea}</dt>
            <dd>{formatKwota(plan.powierzchnia)}</dd>
            <dt>{t.zplanCityArea}</dt>
            <dd>
              {formatKwota(plan.miastoM2)}{' '}
              <span className="zeb-muted">({t.zplanShare.replace('{p}', String(s.udzialMiasta))})</span>
            </dd>
            <dt>{t.zplanLeaseArea}</dt>
            <dd>{formatKwota(plan.pozytkiM2)}</dd>
          </dl>
        ) : (
          <>
            <FormRow>
              <FormField label={t.zplanProperty} htmlFor="zplan-nier">
                <input
                  id="zplan-nier"
                  type="text"
                  value={plan.nieruchomosc}
                  onChange={(e) => update((p) => ({ ...p, nieruchomosc: e.target.value }))}
                />
              </FormField>
              <FormField label={t.zplanResolution} htmlFor="zplan-uchw">
                <input
                  id="zplan-uchw"
                  type="text"
                  value={plan.uchwalaNr}
                  onChange={(e) => update((p) => ({ ...p, uchwalaNr: e.target.value }))}
                />
              </FormField>
              <FormField label={t.zplanYear}>
                <KwotaInput
                  integer
                  value={plan.rok}
                  onChange={(n) => update((p) => ({ ...p, rok: n }))}
                  ariaLabel={t.zplanYear}
                />
              </FormField>
              <FormField label={t.zplanArea}>
                <KwotaInput
                  value={plan.powierzchnia}
                  onChange={(n) => update((p) => ({ ...p, powierzchnia: n }))}
                  ariaLabel={t.zplanArea}
                />
              </FormField>
            </FormRow>
            {/* The cost rise and the ownership split are edited in "Założenia planu" above. */}
            <dl className="facts">
              <dt>{t.zplanCityArea}</dt>
              <dd>
                {formatKwota(plan.miastoM2)}{' '}
                <span className="zeb-muted">({t.zplanShare.replace('{p}', String(s.udzialMiasta))})</span>
              </dd>
              <dt>{t.zplanLeaseArea}</dt>
              <dd>{formatKwota(plan.pozytkiM2)}</dd>
            </dl>
          </>
        )}
        <p className="zeb-muted zplan-private">
          {t.zplanPrivateArea
            .replace('{m2}', formatKwota(s.osobyFizyczneM2))
            .replace('{p}', String(s.udzialOsobFizycznych))}
        </p>
      </FormSection>

      <ZaliczkaBox
        t={t}
        x="A"
        plan={plan}
        onChange={onChange}
        readOnly={readOnly}
        dataZebrania={dataZebrania}
        proponuj={proponujZaliczke}
      />

      <FormSection icon="wallet" title={t.zplanPartI}>
        <div className="table-scroll">
          <table className="zfin-table zplan-table">
            <thead>
              <tr>
                <th className="zplan-lp">Lp.</th>
                <th>{t.zplanIncome}</th>
                <th className="zfin-num">{t.zplanPerM2Rate}</th>
                <th className="zfin-num">{t.zplanAmount}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="zplan-lp">1.</td>
                <td>{t.zplanSaldoA.replace('{date}', stan)}</td>
                <td />
                <td className="zfin-num">
                  {kwota(plan.saldoA, (n) => update((p) => ({ ...p, saldoA: n })), t.zplanSaldoA.replace('{date}', stan), {
                    value: oryginal?.saldoA,
                    hint: t.zplanRestoreStatement,
                  })}
                </td>
              </tr>
              {plan.saldoA > 0 && (!readOnly || plan.saldoANaFundusz) && (
                <tr className="zplan-sub">
                  <td />
                  <td colSpan={3}>
                    {readOnly ? (
                      <span className="zeb-muted">{t.zplanSaldoAToFundOn}</span>
                    ) : (
                      <label className="zplan-toggle">
                        <span className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={!!plan.saldoANaFundusz}
                            onChange={(e) => update((p) => ({ ...p, saldoANaFundusz: e.target.checked }))}
                          />
                          <span className="toggle-slider"></span>
                        </span>
                        <span>
                          {t.zplanSaldoAToFund}
                          <span className="zeb-muted"> — {t.zplanSaldoAToFundHint}</span>
                        </span>
                      </label>
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td className="zplan-lp">2.</td>
                <td colSpan={2}>{t.zplanAdvance.replace('{x}', 'A')}</td>
                <td className="zfin-num">{formatKwota(s.zaliczkaARazem)}</td>
              </tr>
              <OkresyEditor
                t={t}
                rok={plan.rok}
                okresy={plan.zaliczkaA}
                kwoty={s.zaliczkaA}
                onChange={(okresy) => update((p) => ({ ...p, zaliczkaA: okresy }))}
                // Edited in its own box above; here as the plan prints it.
                readOnly
              />
              <tr>
                <td className="zplan-lp">3.</td>
                <td colSpan={2}>{t.zplanCommonIncome}</td>
                <td className="zfin-num">{formatKwota(s.przychodyRazem)}</td>
              </tr>
              {przychody.rows}
              {dodaj('przychod')}
              <tr>
                <td className="zplan-lp">4.</td>
                <td colSpan={2}>{s.saldoANaFundusz > 0 ? t.zplanTransferOut : t.zplanTransfer}</td>
                <td className="zfin-num">{formatKwota(s.przeksiegowanie)}</td>
              </tr>
              <tr className="is-sum">
                <td className="zplan-lp">5.</td>
                <td colSpan={2}>{t.zplanTotalIncome}</td>
                <td className="zfin-num">{formatKwota(s.wplywyA)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="table-scroll">
          <table className="zfin-table zplan-table">
            <thead>
              <tr>
                <th className="zplan-lp">Lp.</th>
                <th>{t.zplanCosts.replace('{rok}', String(plan.rok))}</th>
                <th className="zfin-num">{t.zplanPerM2}</th>
                <th className="zfin-num">{t.zplanAmount}</th>
              </tr>
            </thead>
            <tbody>
              {koszty.rows}
              {dodaj('koszt')}
              <tr className="is-sum">
                <td className="zplan-lp">{koszty.lp > 0 ? `${koszty.lp + 1}.` : ''}</td>
                <td>{t.zplanTotalCosts}</td>
                <td className="zfin-num">{formatKwota(naM2(plan, s.kosztyA))}</td>
                <td className="zfin-num">{formatKwota(s.kosztyA)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {Math.abs(s.roznicaA) < 0.01 ? (
          <div className="callout callout--success zplan-balance">
            <Icon name="check-circle" size={16} />
            <div className="callout__body">{t.zplanBalanced}</div>
          </div>
        ) : s.roznicaA > 0 ? (
          <div className="callout callout--success zplan-balance">
            <Icon name="check-circle" size={16} />
            <div className="callout__body">{t.zplanSurplus.replace('{kwota}', formatKwota(s.roznicaA))}</div>
          </div>
        ) : (
          <div className="callout callout--warning zplan-balance">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{t.zplanShortfall.replace('{kwota}', formatKwota(-s.roznicaA))}</div>
          </div>
        )}
      </FormSection>

      <ZaliczkaBox
        t={t}
        x="B"
        plan={plan}
        onChange={onChange}
        readOnly={readOnly}
        dataZebrania={dataZebrania}
        proponuj={proponujZaliczke}
      />

      <FormSection icon="building" title={t.zplanPartII}>
        <div className="table-scroll">
          <table className="zfin-table zplan-table">
            <thead>
              <tr>
                <th className="zplan-lp">Lp.</th>
                <th>{t.zplanIncome}</th>
                <th className="zfin-num">{t.zplanPerM2Rate}</th>
                <th className="zfin-num">{t.zplanAmount}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="zplan-lp">1.</td>
                <td>{t.zplanSaldoB.replace('{date}', stan)}</td>
                <td />
                <td className="zfin-num">
                  {kwota(plan.saldoB, (n) => update((p) => ({ ...p, saldoB: n })), t.zplanSaldoB.replace('{date}', stan), {
                    value: oryginal?.saldoB,
                    hint: t.zplanRestoreStatement,
                  })}
                </td>
              </tr>
              <tr>
                <td className="zplan-lp">2.</td>
                <td colSpan={2}>{t.zplanAdvance.replace('{x}', 'B')}</td>
                <td className="zfin-num">{formatKwota(s.zaliczkaBRazem)}</td>
              </tr>
              <OkresyEditor
                t={t}
                rok={plan.rok}
                okresy={plan.zaliczkaB}
                kwoty={s.zaliczkaB}
                onChange={(okresy) => update((p) => ({ ...p, zaliczkaB: okresy }))}
                // Edited in its own box above; here as the plan prints it.
                readOnly
              />
              {s.saldoANaFundusz > 0 && (
                <tr>
                  <td className="zplan-lp">3.</td>
                  <td colSpan={2}>{t.zplanSaldoAInFund}</td>
                  <td className="zfin-num">{formatKwota(s.saldoANaFundusz)}</td>
                </tr>
              )}
              <tr>
                <td className="zplan-lp">{s.saldoANaFundusz > 0 ? '4.' : '3.'}</td>
                <td colSpan={2}>{t.zplanOtherIncomeB}</td>
                <td className="zfin-num">
                  {kwota(plan.inneWplywyB, (n) => update((p) => ({ ...p, inneWplywyB: n })), t.zplanOtherIncomeB)}
                </td>
              </tr>
              <tr className="is-sum">
                <td className="zplan-lp">{s.saldoANaFundusz > 0 ? '5.' : '4.'}</td>
                <td colSpan={2}>{t.zplanTotalIncome}</td>
                <td className="zfin-num">{formatKwota(s.wplywyB)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="table-scroll">
          <table className="zfin-table zplan-table">
            <thead>
              <tr>
                <th className="zplan-lp">Lp.</th>
                <th>{t.zplanFundCosts}</th>
                <th />
                <th className="zfin-num">{t.zplanAmount}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="zplan-lp">1.</td>
                <td>{t.zplanCredit}</td>
                <td />
                <td className="zfin-num">
                  {kwota(plan.kredyt, (n) => update((p) => ({ ...p, kredyt: n })), t.zplanCredit, {
                    value: oryginal?.kredyt,
                    hint: t.zplanRestoreStatement,
                  })}
                </td>
              </tr>
              <tr>
                <td className="zplan-lp">2.</td>
                <td colSpan={2}>{t.zplanSaldoACost}</td>
                <td className="zfin-num">{formatKwota(s.saldoAKoszt)}</td>
              </tr>
              <tr>
                <td className="zplan-lp">3.</td>
                <td colSpan={2}>{t.zplanRepairs}</td>
                <td className="zfin-num">{formatKwota(s.remontyFR)}</td>
              </tr>
              {plan.remontyFR.map((r) => (
                <tr key={r.id} className="zplan-sub">
                  <td />
                  <td colSpan={2}>
                    {readOnly ? (
                      r.opis || '—'
                    ) : (
                      <span className="zplan-repair">
                        <input
                          type="text"
                          value={r.opis}
                          placeholder={t.zplanRepairPlaceholder}
                          onChange={(e) =>
                            update((p) => ({
                              ...p,
                              remontyFR: p.remontyFR.map((x) =>
                                x.id === r.id ? { ...x, opis: e.target.value } : x
                              ),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="button button-icon button-ghost icon-danger"
                          onClick={() =>
                            update((p) => ({
                              ...p,
                              remontyFR: p.remontyFR.filter((x) => x.id !== r.id),
                            }))
                          }
                          title={t.zplanRemoveRepair}
                          aria-label={t.zplanRemoveRepair}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="zfin-num">
                    {kwota(
                      r.kwota,
                      (n) =>
                        update((p) => ({
                          ...p,
                          remontyFR: p.remontyFR.map((x) => (x.id === r.id ? { ...x, kwota: n } : x)),
                        })),
                      r.opis || t.zplanRepairs
                    )}
                  </td>
                </tr>
              ))}
              {!readOnly && (
                <tr className="zplan-sub">
                  <td />
                  <td colSpan={3}>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      onClick={() =>
                        update((p) => ({ ...p, remontyFR: [...p.remontyFR, newRemontFR()] }))
                      }
                    >
                      <Icon name="plus" size={12} /> {t.zplanAddRepair}
                    </button>
                  </td>
                </tr>
              )}
              <tr className="is-sum">
                <td className="zplan-lp">4.</td>
                <td colSpan={2}>{t.zplanTotalCosts}</td>
                <td className="zfin-num">{formatKwota(s.kosztyB)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={`zplan-fund${s.saldoBKoniec < 0 ? ' is-negative' : ''}`}>
          {t.zplanFundEnd} <strong>{zl(s.saldoBKoniec)}</strong>
        </p>
      </FormSection>
    </>
  );
};

/* ============================== Shared pieces ============================== */

/** The ownership split is remembered for the community, as the default of its next plan. */
export async function zapamietajUdzialy(
  adresNazwa: string,
  wspolnota: ZebraniaWspolnota | null,
  plan: PlanGospodarczy
): Promise<void> {
  const u = wspolnota?.udzialy;
  if (!adresNazwa || (u && u.miastoM2 === plan.miastoM2 && u.pozytkiM2 === plan.pozytkiM2)) return;
  try {
    await window.electronAPI.setZebraniaWspolnota(adresNazwa, {
      udzialy: { miastoM2: plan.miastoM2, pozytkiM2: plan.pozytkiM2 },
    });
  } catch {
    // The plan is saved; only the default for the next plan is missing.
  }
}

/** What a new plan is drafted with besides the statement: the cost rise and the ownership split. */
export interface PlanZalozenia {
  wskaznik: number;
  miastoM2: number;
  pozytkiM2: number;
}

export const PlanZalozeniaFields: React.FC<{
  t: T;
  value: PlanZalozenia;
  onChange: (value: PlanZalozenia) => void;
  /** The plan's total area — when known, the city's share is shown as a percentage. */
  powierzchnia?: number;
}> = ({ t, value, onChange, powierzchnia }) => (
  <FormRow>
    <FormField label={t.zplanIndex} hint={t.zplanIndexHint}>
      <KwotaInput
        value={value.wskaznik}
        onChange={(n) => onChange({ ...value, wskaznik: n })}
        ariaLabel={t.zplanIndex}
      />
    </FormField>
    <FormField
      label={t.zplanCityArea}
      hint={
        powierzchnia
          ? t.zplanShare.replace('{p}', String(Math.round(((value.miastoM2 || 0) / powierzchnia) * 100)))
          : undefined
      }
    >
      <KwotaInput
        value={value.miastoM2}
        onChange={(n) => onChange({ ...value, miastoM2: n })}
        ariaLabel={t.zplanCityArea}
      />
    </FormField>
    <FormField label={t.zplanLeaseArea}>
      <KwotaInput
        value={value.pozytkiM2}
        onChange={(n) => onChange({ ...value, pozytkiM2: n })}
        ariaLabel={t.zplanLeaseArea}
      />
    </FormField>
  </FormRow>
);

/**
 * A new plan drafted from a statement with the given assumptions; its positions
 * follow `pogrupowane` (the meeting version's merges and subcategories) when given.
 */
export const draftPlanu = (
  spr: Sprawozdanie,
  ustawienia: ZebraniaUstawienia,
  z: PlanZalozenia,
  pogrupowane?: Sprawozdanie | null
): PlanGospodarczy =>
  planZeSprawozdania(spr, ustawienia, {
    udzialy: { miastoM2: z.miastoM2, pozytkiM2: z.pozytkiM2 },
    nieruchomosc: '',
    wskaznik: z.wskaznik,
    who: '',
    pogrupowane,
  });

/** The template meeting's plan a new plan starts from ("Zebranie-szablon"). */
export interface PlanSzablonu {
  plan: PlanGospodarczy;
  nazwa: string;
}

/** A new plan's first draft: the statement with the assumptions, the template's costs keeping their own growth. */
export const planNaStart = (
  spr: Sprawozdanie,
  ustawienia: ZebraniaUstawienia,
  z: PlanZalozenia,
  pogrupowane: Sprawozdanie | null | undefined,
  szablon: PlanSzablonu | null
): PlanGospodarczy => {
  const plan = draftPlanu(spr, ustawienia, z, pogrupowane);
  return szablon ? zachowajWzrosty(plan, szablon.plan.pozycje, ustawienia.zaokraglenie) : plan;
};

/**
 * The ownership split a new plan of the community starts with: its previous
 * plan's (in Zebrania or the Plany module), else the one remembered for it.
 */
export async function udzialyNaStart(
  nrWsp: number | null,
  rok: number,
  wspolnota: ZebraniaWspolnota | null
): Promise<AdresUdzialy> {
  let plany: { nrWsp: number | null; plan: PlanGospodarczy }[] = [];
  if (nrWsp != null) {
    try {
      const [zebrania, wlasne] = await Promise.all([window.electronAPI.getZebrania(), window.electronAPI.getPlanyWlasne()]);
      plany = [...planyZZebran(zebrania, wspolnota ? [wspolnota] : []), ...wlasne];
    } catch {
      // The remembered split stays as the default.
    }
  }
  return udzialyDlaNowegoPlanu(plany, nrWsp, rok, wspolnota?.udzialy);
}

/* ================================ The workspace ================================ */

/**
 * A stored plan on screen: what it is drawn from, the editor, the downloads
 * and the save bar. Shared by a meeting version's tab and the Plany
 * gospodarcze module — each says where the plan is kept.
 */
export const PlanWorkspace: React.FC<{
  language: Language;
  locale: string;
  stored: PlanGospodarczy;
  /** Another plan shown in the same place drops the edits of the previous one. */
  storeKey: string;
  /** The statement it was drafted from, for "Przelicz ze sprawozdania"; null = not at hand. */
  spr: Sprawozdanie | null;
  /** The statement as the meeting version groups it — what the positions follow. Absent = the printed rows. */
  pogrupowane?: Sprawozdanie | null;
  ustawienia: ZebraniaUstawienia;
  zrodlo: DokumentZrodlo;
  deleteConfirm: string;
  /** A plan kept elsewhere, or replaced: shown and downloaded, never edited. */
  readOnly?: boolean;
  /** Replaces the usual note on where the figures come from. */
  notice?: React.ReactNode;
  /** Header actions placed before the plan's own. */
  actions?: React.ReactNode;
  /** A box below the plan (the version's final status). */
  bottom?: React.ReactNode;
  /** Store the plan, or with null remove it. Throws when that fails. */
  persist: (plan: PlanGospodarczy | null) => Promise<void>;
  onChanged: () => Promise<void> | void;
  onOpenUstawienia: () => void;
}> = ({
  language,
  locale,
  stored,
  storeKey,
  spr,
  pogrupowane,
  ustawienia,
  zrodlo,
  deleteConfirm,
  readOnly = false,
  notice,
  actions,
  bottom,
  persist,
  onChanged,
  onOpenUstawienia,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [draft, setDraft] = useState<PlanGospodarczy>(stored);
  const [base, setBase] = useState<string>(contentOf(stored));
  const [busy, setBusy] = useState(false);
  const dirty = !readOnly && contentOf(draft) !== base;

  // A reload brings the stored plan; it replaces the screen unless there are unsaved edits.
  useEffect(() => {
    if (!dirty) {
      setDraft(stored);
      setBase(contentOf(stored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, stored.zmieniono]);

  const save = async (plan: PlanGospodarczy | null, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await persist(plan);
      if (plan) setBase(contentOf(plan));
      await onChanged();
      notify.success(done);
      return true;
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!spr) return;
    if (!(await notify.confirm(t.zplanRegenerateConfirm, { confirmLabel: t.zplanRegenerate })))
      return;
    const fresh = draftPlanu(
      spr,
      ustawienia,
      { wskaznik: draft.wskaznik, miastoM2: draft.miastoM2, pozytkiM2: draft.pozytkiM2 },
      pogrupowane
    );
    // What the statement cannot know stays as the user typed it; a position's own growth stays with it.
    const regenerated = zachowajWzrosty(fresh, draft.pozycje, ustawienia.zaokraglenie);
    setDraft({
      ...regenerated,
      nieruchomosc: draft.nieruchomosc || fresh.nieruchomosc,
      uchwalaNr: draft.uchwalaNr || fresh.uchwalaNr,
      // Positions typed in by hand are not in the statement — they stay.
      pozycje: [...regenerated.pozycje, ...draft.pozycje.filter((z) => z.wiersze.length === 0)],
      saldoANaFundusz: draft.saldoANaFundusz,
      remontyFR: draft.remontyFR,
      inneWplywyB: draft.inneWplywyB,
      pobrania: draft.pobrania,
    });
  };

  /** The positions laid out anew from the statement — the planned amounts stay. */
  const regeneratePozycje = async () => {
    if (!spr) return;
    const r = przegenerujPozycje(draft, spr, pogrupowane, ustawienia);
    const lines = [t.zplanRegroupConfirm];
    if (r.nowe.length) lines.push(t.zplanRegroupNew.replace('{list}', r.nowe.join(', ')));
    if (r.usuniete.length) lines.push(t.zplanRegroupGone.replace('{list}', r.usuniete.join(', ')));
    if (!(await notify.confirm(lines.join('\n\n'), { confirmLabel: t.zplanRegroup }))) return;
    setDraft(r.plan);
  };

  // The assumptions as typed, applied to the plan only by "Przelicz" — a discard or reload brings the plan's own.
  const zalozeniaPlanu: PlanZalozenia = {
    wskaznik: draft.wskaznik,
    miastoM2: draft.miastoM2,
    pozytkiM2: draft.pozytkiM2,
  };
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>(zalozeniaPlanu);
  useEffect(() => {
    setZalozenia(zalozeniaPlanu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.wskaznik, draft.miastoM2, draft.pozytkiM2]);
  const zalozeniaZmienione =
    zalozenia.wskaznik !== draft.wskaznik ||
    zalozenia.miastoM2 !== draft.miastoM2 ||
    zalozenia.pozytkiM2 !== draft.pozytkiM2;
  const wzrosty = wzrostyPlanu(draft);
  // What the costs without an own growth rise by with the index as typed — shown while some have their own.
  const pozostaleWpisane = wzrostPozostalych(draft.pozycje, zalozenia.wskaznik);

  /** New cost rise and ownership split on a drafted plan: the statement's costs are drafted again. */
  const przelicz = async () => {
    const step = ustawienia.zaokraglenie;
    if (zalozenia.wskaznik !== draft.wskaznik) {
      const poprawione = kosztyPoprawione(draft, step);
      const lines = [t.zplanRecalcConfirm.replace('{p}', String(zalozenia.wskaznik || 0))];
      if (poprawione.length) lines.push(t.zplanRecalcEdited.replace('{list}', poprawione.join(', ')));
      if (!(await notify.confirm(lines.join('\n\n'), { confirmLabel: t.zplanRecalc }))) return;
    }
    setDraft(przeliczZalozenia(draft, { ...zalozenia, wzrosty }, step));
  };

  /**
   * A position's own growth set at its row (null = back to the shared one): the
   * statement's costs are drafted again at once, by the plan's index, so the
   * others make up the total. Costs typed over by hand are named first.
   */
  const ustawWzrost = async (id: string, wzrost: number | null) => {
    const step = ustawienia.zaokraglenie;
    const { [id]: _old, ...inne } = wzrosty;
    const nowe = wzrost == null ? inne : { ...inne, [id]: wzrost };
    const poprawione = kosztyPoprawione(draft, step);
    if (poprawione.length) {
      const lines = [
        t.zplanGrowthConfirm.replace('{w}', procent(draft.wskaznik || 0)),
        t.zplanRecalcEdited.replace('{list}', poprawione.join(', ')),
      ];
      if (!(await notify.confirm(lines.join('\n\n'), { confirmLabel: t.zplanRecalc }))) return;
    }
    setDraft(
      przeliczZalozenia(
        draft,
        { wskaznik: draft.wskaznik, miastoM2: draft.miastoM2, pozytkiM2: draft.pozytkiM2, wzrosty: nowe },
        step
      )
    );
  };

  /** The AI's advance rate for the plan as on screen; the meeting's date tells when a new rate can start. */
  const dataZebrania = 'dataZebrania' in zrodlo ? zrodlo.dataZebrania : null;
  const proponujZaliczke = async (
    x: ZaliczkaRodzaj,
    wskazowki: string
  ): Promise<PlanZaliczkaAiPropozycja | null> => {
    try {
      return await window.electronAPI.proponujZaliczkeAi(draft, x, wskazowki, dataZebrania);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.zplanAdvAiError);
      return null;
    }
  };

  const remove = async () => {
    if (!(await notify.confirm(deleteConfirm, { danger: true, confirmLabel: t.delete }))) return;
    await save(null, t.zplanDeleted);
  };

  const outOfDate =
    spr &&
    (draft.sprawozdanieOkres.od !== spr.okresOd || draft.sprawozdanieOkres.do !== spr.okresDo);

  // The balances and repayments as the plan's own statement gives them — none from another period.
  const zeSprawozdania = useMemo(() => {
    if (readOnly || !spr || outOfDate) return null;
    const fresh = draftPlanu(spr, ustawienia, { wskaznik: 0, miastoM2: 0, pozytkiM2: 0 }, pogrupowane);
    return { saldoA: fresh.saldoA, saldoB: fresh.saldoB, kredyt: fresh.kredyt };
  }, [readOnly, spr, outOfDate, ustawienia, pogrupowane]);
  const oryginal = useMemo<PlanOryginal | null>(
    () => (readOnly ? null : { pozycje: kwotyWyliczone(draft, ustawienia.zaokraglenie), ...zeSprawozdania }),
    [readOnly, draft, ustawienia.zaokraglenie, zeSprawozdania]
  );
  // The statement's rows were grouped (or renamed) since the positions were laid
  // out — offered as a regenerate that keeps the amounts.
  const ukladZmieniony = useMemo(
    () => !readOnly && !!spr && ukladPozycji(pozycjePlanu(spr, pogrupowane)) !== ukladPozycji(draft.pozycje),
    [readOnly, spr, pogrupowane, draft.pozycje]
  );

  return (
    <div className="page-form zeb-page">
      {/* The plan itself: what it is drawn from, when it was last saved; the
          rare actions (recompute, the settings, delete) in its header. */}
      <FormSection
        icon="wallet"
        title={t.zplanTitle.replace('{rok}', String(draft.rok))}
        description={[
          t.zplanSource.replace(
            '{okres}',
            okresLabel(draft.sprawozdanieOkres.od, draft.sprawozdanieOkres.do)
          ),
          stored.zmieniono
            ? t.zplanChanged
                .replace('{when}', formatStamp(stored.zmieniono, locale))
                .replace('{who}', stored.zmienil || '—')
            : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        badge={dirty ? t.zplanUnsavedBadge : undefined}
        aside={
          <div className="form-section__actions">
            {actions}
            {!readOnly && spr && (
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void regenerate()}
                disabled={busy}
              >
                <Icon name="refresh" size={13} /> {t.zplanRegenerate}
              </button>
            )}
            {!readOnly && (
              <OverflowMenu
                label={t.convMoreActions}
                disabled={busy}
                items={[
                  { icon: 'settings', label: t.zplanSettings, onClick: onOpenUstawienia },
                  { icon: 'trash', label: t.zplanDelete, onClick: () => void remove(), danger: true },
                ]}
              />
            )}
          </div>
        }
      >
        {notice ??
          (outOfDate ? (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.zplanStatementChanged}</div>
            </div>
          ) : (
            !ukladZmieniony && (
              <div className="callout callout--muted">
                <Icon name="info" size={16} />
                <div className="callout__body">{t.zplanIntro}</div>
              </div>
            )
          ))}
        {ukladZmieniony && (
          <div className="callout callout--info">
            <Icon name="info" size={16} />
            <div className="callout__body">
              {t.zplanRegroupNotice}
              <div className="callout__actions">
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void regeneratePozycje()}
                  disabled={busy}
                >
                  <Icon name="refresh" size={13} /> {t.zplanRegroup}
                </button>
              </div>
            </div>
          </div>
        )}
      </FormSection>

      {!readOnly && (
        <FormSection icon="coins" title={t.zplanAssumptions} description={t.zplanAssumptionsHint}>
          <PlanZalozeniaFields
            t={t}
            value={zalozenia}
            onChange={setZalozenia}
            powierzchnia={draft.powierzchnia}
          />
          {Object.keys(wzrosty).length > 0 && (
            <p className="zeb-muted zplan-own-growth__note">
              {pozostaleWpisane == null
                ? t.zplanGrowthAllOwn
                : t.zplanGrowthOthers
                    .replace('{n}', String(Object.keys(wzrosty).length))
                    .replace('{p}', procent(pozostaleWpisane))
                    .replace('{w}', procent(zalozenia.wskaznik || 0))}
            </p>
          )}
          <div className="zplan-create">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void przelicz()}
              disabled={busy || !zalozeniaZmienione}
            >
              <Icon name="refresh" size={14} /> {t.zplanRecalc}
            </button>
          </div>
        </FormSection>
      )}

      <PlanEditor
        t={t}
        plan={draft}
        onChange={setDraft}
        readOnly={readOnly}
        proponujZaliczke={proponujZaliczke}
        dataZebrania={dataZebrania}
        onWzrost={(id, w) => void ustawWzrost(id, w)}
        oryginal={oryginal}
      />

      <FormSection icon="download" title={t.zfinDownloadTitle} description={t.zplanDownloadDesc}>
        {dirty ? (
          <div className="callout callout--info">
            <Icon name="info" size={16} />
            <div className="callout__body">{t.zplanUnsaved}</div>
          </div>
        ) : (
          <ZebranieDokumentActions
            language={language}
            locale={locale}
            zrodlo={zrodlo}
            pobrania={stored.pobrania}
            disabled={busy}
            onDownloaded={() => void onChanged()}
          />
        )}
      </FormSection>

      {bottom}

      {/* The page's one action, closing the form — not sticky. */}
      {!readOnly && (
        <ModalFooter
          className="page-action-bar"
          note={dirty ? t.zplanUnsavedBadge : t.zplanAllSaved}
          onCancel={dirty ? () => setDraft(stored) : undefined}
          cancelLabel={t.zplanDiscard}
          onSubmit={() => void save(draft, t.zplanSaved)}
          submitLabel={t.zplanSave}
          submitDisabled={!dirty}
          busy={busy}
        />
      )}
    </div>
  );
};

/* ================================== The tab ================================== */

/**
 * "Plan gospodarczy" of one version: drafted from the version's statement,
 * edited here, saved with the version, downloaded as PDF or Excel.
 */
const ZebraniePlan: React.FC<{
  language: Language;
  locale: string;
  wersja: ZebranieWersja;
  adresNazwa: string;
  wspolnota: ZebraniaWspolnota | null;
  ustawienia: ZebraniaUstawienia;
  dataZebrania: string | null;
  onChanged: () => Promise<void>;
  /** The version's status box, shown below the plan, also before there is one. */
  statusBox?: React.ReactNode;
  onGoToSprawozdania: () => void;
  onOpenUstawienia: () => void;
  /**
   * The template meeting's plan ("Zebranie-szablon"): a new plan starts from its
   * cost rise and its costs' own growth. Absent = no template, or it has no plan.
   */
  szablon?: PlanSzablonu | null;
}> = ({
  language,
  locale,
  wersja,
  adresNazwa,
  wspolnota,
  ustawienia,
  dataZebrania,
  onChanged,
  statusBox,
  onGoToSprawozdania,
  onOpenUstawienia,
  szablon = null,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const v = wersjaLabel(wersja);
  // The printed statement gives the balances and rates; the version's merges and
  // subcategories give the plan's positions (sorted to lines by their printed rows).
  const spr = wersja.sprawozdanie?.dane ?? null;
  const pogrupowane = useMemo(
    () => (wersja.sprawozdanie ? sprawozdanieWersji(wersja.sprawozdanie) : null),
    [wersja.sprawozdanie]
  );
  const stored = wersja.plan;

  const [busy, setBusy] = useState(false);
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>({
    wskaznik: szablon?.plan.wskaznik ?? 0,
    miastoM2: wspolnota?.udzialy?.miastoM2 ?? 0,
    pozytkiM2: wspolnota?.udzialy?.pozytkiM2 ?? 0,
  });

  // Before there is a plan, the areas carry over from the community's previous plan (in
  // Zebrania or the Plany module), else as remembered for it — editable from there.
  const nrWsp = spr?.nrWsp ?? wspolnota?.vdomNr ?? null;
  const rokNowego = spr ? Number(spr.okresDo.slice(0, 4)) + 1 : null;
  useEffect(() => {
    if (stored || rokNowego == null) return;
    let cancelled = false;
    const fill = (plany: { nrWsp: number | null; plan: PlanGospodarczy }[]) => {
      if (cancelled) return;
      const u = udzialyDlaNowegoPlanu(plany, nrWsp, rokNowego, wspolnota?.udzialy);
      setZalozenia((z) => ({ ...z, ...u }));
    };
    fill([]);
    if (nrWsp != null) {
      Promise.all([window.electronAPI.getZebrania(), window.electronAPI.getPlanyWlasne()])
        .then(([zebrania, wlasne]) =>
          fill([...planyZZebran(zebrania, wspolnota ? [wspolnota] : []), ...wlasne])
        )
        .catch(() => {
          // The remembered split stays as the default.
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored == null, nrWsp, rokNowego, wspolnota?.udzialy?.miastoM2, wspolnota?.udzialy?.pozytkiM2]);

  /** Store the plan with the version; the ownership split is remembered for the community. */
  const persist = async (plan: PlanGospodarczy | null) => {
    await window.electronAPI.setZebranieWersjaPlan(wersja.id, plan);
    if (plan) await zapamietajUdzialy(adresNazwa, wspolnota, plan);
  };

  const create = async () => {
    if (!spr) return;
    setBusy(true);
    try {
      await persist(planNaStart(spr, ustawienia, zalozenia, pogrupowane, szablon));
      await onChanged();
      notify.success(t.zplanCreated);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const okresSpr = useMemo(() => (spr ? okresLabel(spr.okresOd, spr.okresDo) : ''), [spr]);

  if (stored) {
    return (
      <PlanWorkspace
        language={language}
        locale={locale}
        stored={stored}
        storeKey={`wersja-${wersja.id}`}
        spr={spr}
        pogrupowane={pogrupowane}
        ustawienia={ustawienia}
        zrodlo={{ wersjaId: wersja.id, dokument: 'plan', dataZebrania }}
        deleteConfirm={t.zplanDeleteConfirm.replace('{v}', v)}
        persist={persist}
        onChanged={onChanged}
        onOpenUstawienia={onOpenUstawienia}
        bottom={statusBox}
      />
    );
  }

  if (!spr) {
    return (
      <div className="page-form zeb-page">
        <FormSection icon="wallet" title={t.zebraniaTabPlan}>
          <div className="uch-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="wallet" size={22} />
            </span>
            <strong>{t.zplanNeedStatement}</strong>
            <p>{t.zplanNeedStatementText}</p>
            <button type="button" className="button button-primary" onClick={onGoToSprawozdania}>
              <Icon name="bar-chart" size={14} /> {t.zplanGoToStatement}
            </button>
          </div>
        </FormSection>
        {statusBox}
      </div>
    );
  }

  const months = miesiaceOkresu(spr.okresOd, spr.okresDo);
  const rok = Number(spr.okresDo.slice(0, 4)) + 1;
  return (
    <div className="page-form zeb-page">
      <FormSection
        icon="wallet"
        title={t.zplanCreateTitle.replace('{rok}', String(rok))}
        description={t.zplanCreateHint
          .replace('{okres}', okresSpr)
          .replace('{scaled}', months < 12 ? t.zplanScaled : '')}
        aside={
          <button
            type="button"
            className="button button-small button-subtle"
            onClick={onOpenUstawienia}
          >
            <Icon name="settings" size={13} /> {t.zplanSettings}
          </button>
        }
      >
        <PlanZalozeniaFields t={t} value={zalozenia} onChange={setZalozenia} />
        {szablon && (
          <p className="zeb-szablon-note">
            <Icon name="copy" size={13} />
            {t.zebSzablonPlanNote
              .replace('{nazwa}', szablon.nazwa)
              .replace('{p}', String(szablon.plan.wskaznik || 0))
              .replace('{n}', String(liczbaWlasnychWzrostow(szablon.plan)))}
          </p>
        )}
        <div className="zplan-create">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void create()}
            disabled={busy}
          >
            <Icon name={busy ? 'loader' : 'sparkles'} size={14} /> {t.zplanCreate}
          </button>
        </div>
      </FormSection>

      {statusBox}
    </div>
  );
};

export default ZebraniePlan;
