import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  AdresPowierzchnie,
  PlanExpected,
  PlanGospodarczy,
  PlanPozycja,
  Sprawozdanie,
  PlanOkresZaliczki,
  PlanZaliczkaAiPropozycja,
  ZebraniaUstawienia,
  ZebranieWersja,
} from '../../shared/types';
import {
  miesiaceOkresu,
  naM2,
  newPozycja,
  newRemontFR,
  kosztyPoprawione,
  kwotaZerowa,
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
  miesiacZebraniaWRoku,
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
import { powierzchnieNieaktualne, zPowierzchniamiAdresu } from '../../shared/plany';
import { brakujacePowierzchnie, normalizePowierzchnie } from '../../shared/adres-powierzchnie';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { LeaveCheck, useLeaveGuard } from '../navigation';
import { useNotify } from './Notifications';
import { ipcErrorMessage, isIpcError } from '../ipcError';
import { FormField, FormRow, FormSection } from './FormSection';
import { ModalFooter } from './Modal';
import OverflowMenu from './OverflowMenu';
import Icon from './Icon';
import KwotaInput from './KwotaInput';
import Select from './Select';
import ZebranieDokumentActions, { DokumentZrodlo } from './ZebranieDokumentActions';
import { bezPrefiksu } from './PodpisKarta';
import MergedBadge from './MergedBadge';
import Tip from './Tip';
import { AiWorking, AiWskazowkiPanel } from './AiPanel';

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
            data-tip={t.zplanRemovePeriod}
            aria-label={t.zplanRemovePeriod}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </span>
    );
  };

  const miesiacZebrania = miesiacZebraniaWRoku(dataZebrania, rok);
  const poZebraniu = nowy != null && miesiacZebrania !== null && miesiacZebrania + 1 === nowy;

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
                <Select
                  overlay
                  size="sm"
                  className="zplan-month"
                  value={nowy}
                  options={wolne.map((m) => ({ value: String(m), label: nazwy[m - 1] }))}
                  onChange={(v) => setNowy(Number(v))}
                  ariaLabel={t.zplanPeriodFrom}
                />
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
 * the year's rates, then — right below them, as the statement's introduction
 * follows its figures — the AI: the guidance box is open while the rates have
 * no reasons yet, and a proposal changes the plan only when applied. Applied,
 * its reasons become the plan's (`uzasadnienieA` / `uzasadnienieB`), edited
 * like any field and stored by the plan's save bar. Then the computed rate
 * that balances the advance's part.
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
  /** The reasons kept with the rates; undefined = none. An empty string is a cleared field still on screen. */
  const uzasadnienie = B ? plan.uzasadnienieB : plan.uzasadnienieA;
  const [aiOpen, setAiOpen] = useState(false);
  const [wskazowki, setWskazowki] = useState('');
  const [generating, setGenerating] = useState(false);
  const [propozycja, setPropozycja] = useState<PlanZaliczkaAiPropozycja | null>(null);

  /** The plan with this advance's rates and reasons (undefined drops the reasons). */
  const zZaliczka = (o: PlanOkresZaliczki[], u: string | undefined): PlanGospodarczy => {
    const { uzasadnienieA: _a, uzasadnienieB: _b, ...rest } = plan;
    const a = B ? plan.uzasadnienieA : u;
    const b = B ? u : plan.uzasadnienieB;
    return {
      ...rest,
      ...(B ? { zaliczkaB: o } : { zaliczkaA: o }),
      ...(a != null ? { uzasadnienieA: a } : {}),
      ...(b != null ? { uzasadnienieB: b } : {}),
    };
  };
  const setOkresy = (o: PlanOkresZaliczki[]) => onChange(zZaliczka(o, uzasadnienie));
  const setUzasadnienie = (u: string | undefined) => onChange(zZaliczka(okresy, u));
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

  // The rates and their reasons go into the plan together — both editable from then on.
  const apply = () => {
    if (!propozycja) return;
    onChange(zZaliczka(propozycja.okresy, propozycja.uzasadnienie));
    setPropozycja(null);
  };

  const proposalLabels = propozycja ? okresyLabels(propozycja.okresy, plan.rok) : [];
  const ai = !readOnly && !!proponuj;
  // The guidance box: asked for, or offered while the rates have no reasons to read.
  const showAi = ai && !generating && (aiOpen || (!propozycja && uzasadnienie == null));
  /** Opens the guidance box again — over a proposal on screen it asks for another one. */
  const otworzAi = (label: string) =>
    ai &&
    !aiOpen &&
    !generating && (
      <button type="button" className="button button-small button-ghost" onClick={() => setAiOpen(true)}>
        <Icon name="sparkles" size={13} /> {label}
      </button>
    );

  return (
    <FormSection
      icon={B ? 'building' : 'coins'}
      title={(B ? t.zplanAdvBTitle : t.zplanAdvATitle).replace('{rok}', String(plan.rok))}
      description={readOnly ? undefined : B ? t.zplanAdvBHint : t.zplanAdvAHint}
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

      {generating && <AiWorking title={t.zplanAdvAiWorking} hint={t.zplanAdvAiWorkingHint} />}

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
            <p>{wynikZaliczki(t, zZaliczka(propozycja.okresy, undefined), x)}</p>
            <p>
              <strong>{t.zplanAdvAiReason}</strong>
              <span className="zplan-ai-text">{propozycja.uzasadnienie}</span>
            </p>
            <p className="zeb-muted">{t.zplanAdvAiProposalHint}</p>
            <div className="callout__actions">
              {otworzAi(t.zplanAdvAiRegenerate)}
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => setPropozycja(null)}
                disabled={generating}
              >
                {t.zplanAdvAiDismiss}
              </button>
              <button type="button" className="button button-small button-primary" onClick={apply} disabled={generating}>
                <Icon name="check" size={13} /> {t.zplanAdvAiApply}
              </button>
            </div>
          </div>
        </div>
      )}

      {uzasadnienie != null &&
        !propozycja &&
        (readOnly ? (
          uzasadnienie.trim() && (
            <div className="callout callout--info">
              <Icon name="sparkles" size={16} />
              <div className="callout__body">
                <strong>{t.zplanAdvAiReasonLabel}</strong>
                <span className="zplan-ai-text">{uzasadnienie}</span>
              </div>
            </div>
          )
        ) : (
          <FormField
            label={t.zplanAdvAiReasonLabel}
            htmlFor={`zplan-uzasadnienie-${x}`}
            hint={t.zplanAdvAiReasonHint}
            action={
              <>
                {otworzAi(t.zplanAdvAiOpen)}
                <Tip ariaLabel={t.zplanAdvAiReasonRemove} content={t.zplanAdvAiReasonRemove}>
                  <button
                    type="button"
                    className="button button-icon button-ghost"
                    onClick={() => setUzasadnienie(undefined)}
                    aria-label={t.zplanAdvAiReasonRemove}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </Tip>
              </>
            }
          >
            <textarea
              id={`zplan-uzasadnienie-${x}`}
              rows={7}
              value={uzasadnienie}
              placeholder={t.zplanAdvAiReasonPlaceholder}
              onChange={(e) => setUzasadnienie(e.target.value)}
            />
          </FormField>
        ))}

      {showAi && (
        <AiWskazowkiPanel
          id={`zplan-ai-wskazowki-${x}`}
          label={t.zfinIntroAiGuidance}
          hint={t.zplanAdvAiGuidanceHint}
          placeholder={B ? t.zplanAdvBAiGuidancePlaceholder : t.zplanAdvAiGuidancePlaceholder}
          value={wskazowki}
          onChange={setWskazowki}
          generateLabel={uzasadnienie != null || propozycja ? t.zplanAdvAiRegenerate : t.zplanAdvAiGenerate}
          onGenerate={() => void generate()}
          onCancel={aiOpen ? () => setAiOpen(false) : undefined}
          cancelLabel={t.cancel}
        />
      )}

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
                // The reasons stay: they may be the manager's own words now — the bin removes them.
                onClick={() => setOkresy(bilans.okresy)}
              >
                {t.zplanAdvASetBalance}
              </button>
            )}
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

/** The three areas as a plan prints them; the city's and the leased one 0 = "brak". */
const PowierzchnieFakty: React.FC<{ t: T; powierzchnia: number; miastoM2: number; pozytkiM2: number }> = ({
  t,
  powierzchnia,
  miastoM2,
  pozytkiM2,
}) => (
  <dl className="facts">
    <dt>{t.zplanArea}</dt>
    <dd>{formatKwota(powierzchnia)}</dd>
    <dt>{t.zplanCityArea}</dt>
    <dd>
      {miastoM2 > 0 ? (
        <>
          {formatKwota(miastoM2)}{' '}
          <span className="zeb-muted">
            ({t.zplanShare.replace('{p}', String(powierzchnia > 0 ? Math.round((miastoM2 / powierzchnia) * 100) : 0))})
          </span>
        </>
      ) : (
        t.adresPowBrak
      )}
    </dd>
    <dt>{t.zplanLeaseArea}</dt>
    <dd>{pozytkiM2 > 0 ? formatKwota(pozytkiM2) : t.adresPowBrak}</dd>
  </dl>
);

/**
 * The areas a plan prints, as its community's address gives them — shown, never
 * typed: they change in Adresy only. Says where they come from, and what is
 * missing there; with `onPobierz`, offers the address's areas when the plan
 * holds others.
 */
export const PowierzchniePlanu: React.FC<{
  t: T;
  /** The areas shown: the plan's, or what a new plan will get. */
  powierzchnia: number;
  miastoM2: number;
  pozytkiM2: number;
  /** The community's address; null = none linked. */
  adres: Adres | null;
  /** A new plan: without the address it takes the statement's total and no other areas. */
  nowy?: boolean;
  onOpenAdres?: (adresId: number) => void;
  /** Present when the address now says otherwise than the plan: puts its areas on the plan. */
  onPobierz?: () => void;
}> = ({ t, powierzchnia, miastoM2, pozytkiM2, adres, nowy = false, onOpenAdres, onPobierz }) => {
  const braki = adres
    ? brakujacePowierzchnie(adres).map((k) =>
        k === 'calkowita' ? t.adresMissingPowierzchnia : k === 'miasto' ? t.adresMissingMiasto : t.adresMissingPozytki
      )
    : [];
  const edytuj = adres && onOpenAdres && (
    <button type="button" className="button button-small button-secondary" onClick={() => onOpenAdres(adres.id)}>
      <Icon name="map-pin" size={13} /> {t.zplanAreasEdit}
    </button>
  );
  return (
    <>
      <PowierzchnieFakty t={t} powierzchnia={powierzchnia} miastoM2={miastoM2} pozytkiM2={pozytkiM2} />
      {!adres ? (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{nowy ? t.zplanAreasNoAdresNew : t.zplanAreasNoAdres}</div>
        </div>
      ) : onPobierz ? (
        <div className="callout callout--info">
          <Icon name="info" size={16} />
          <div className="callout__body">
            {t.zplanAreasStale.replace('{nazwa}', adres.nazwa)}
            <div className="callout__actions">
              <button type="button" className="button button-small button-secondary" onClick={onPobierz}>
                <Icon name="refresh" size={13} /> {t.zplanAreasPull}
              </button>
              {edytuj}
            </div>
          </div>
        </div>
      ) : braki.length > 0 ? (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            {t.zplanAreasMissing.replace('{nazwa}', adres.nazwa).replace('{list}', braki.join(', '))}
            {edytuj && <div className="callout__actions">{edytuj}</div>}
          </div>
        </div>
      ) : (
        <div className="callout callout--muted">
          <Icon name="map-pin" size={16} />
          <div className="callout__body">
            {t.zplanAreasFromAdres.replace('{nazwa}', adres.nazwa)}
            {edytuj && <div className="callout__actions">{edytuj}</div>}
          </div>
        </div>
      )}
    </>
  );
};

/**
 * "Nagłówek planu": the property, the resolution, the year and the areas — the
 * last from the community's address (see `PowierzchniePlanu`).
 */
const PlanNaglowek: React.FC<{
  t: T;
  plan: PlanGospodarczy;
  onChange: (plan: PlanGospodarczy) => void;
  readOnly?: boolean;
  adres: Adres | null;
  onOpenAdres?: (adresId: number) => void;
}> = ({ t, plan, onChange, readOnly = false, adres, onOpenAdres }) => {
  const s = planSumy(plan);
  const update = (fn: (p: PlanGospodarczy) => PlanGospodarczy) => onChange(fn(plan));
  const nieaktualne = !readOnly && !!adres && powierzchnieNieaktualne(plan, adres.powierzchnie);
  return (
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
        </dl>
      ) : (
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
        </FormRow>
      )}
      {/* A plan shown elsewhere (read-only) keeps the areas it was made with — no
          word about the address there. */}
      {readOnly ? (
        <PowierzchnieFakty t={t} powierzchnia={plan.powierzchnia} miastoM2={plan.miastoM2} pozytkiM2={plan.pozytkiM2} />
      ) : (
        <PowierzchniePlanu
          t={t}
          powierzchnia={plan.powierzchnia}
          miastoM2={plan.miastoM2}
          pozytkiM2={plan.pozytkiM2}
          adres={adres}
          onOpenAdres={onOpenAdres}
          onPobierz={
            nieaktualne && adres ? () => onChange(zPowierzchniamiAdresu(plan, adres.powierzchnie)) : undefined
          }
        />
      )}
      <p className="zeb-muted zplan-private">
        {t.zplanPrivateArea
          .replace('{m2}', formatKwota(s.osobyFizyczneM2))
          .replace('{p}', String(s.udzialOsobFizycznych))}
      </p>
    </FormSection>
  );
};

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
  // A line planned at zero is not shown, as the documents leave it out; the optional ones
  // the user fills in (a loan, other inflows) come back by their "+" until the editor closes.
  const [odsloniete, setOdsloniete] = useState<Set<'kredyt' | 'inne'>>(() => new Set());
  const widoczna = (pole: 'kredyt' | 'inne', value: number, oryg?: number) =>
    !kwotaZerowa(value) || (!readOnly && (odsloniete.has(pole) || !kwotaZerowa(oryg)));
  const odslon = (pole: 'kredyt' | 'inne', label: string) =>
    readOnly ? null : (
      <tr className="zplan-sub">
        <td />
        <td colSpan={3}>
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => setOdsloniete((prev) => new Set(prev).add(pole))}
          >
            <Icon name="plus" size={12} /> {label}
          </button>
        </td>
      </tr>
    );
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
                  data-tip={t.zplanRemoveItem}
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
  // Part II's numbers go to the lines shown; part I's line 4 likewise.
  const przeksiegowanie = !kwotaZerowa(s.przeksiegowanie);
  const pokazKredyt = widoczna('kredyt', plan.kredyt, oryginal?.kredyt);
  const pokazInne = widoczna('inne', plan.inneWplywyB);
  const pokazSaldoAKoszt = !kwotaZerowa(s.saldoAKoszt);
  let lpWplywyB = 2;
  let lpKosztyB = 0;

  return (
    <>
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
              {przeksiegowanie && (
                <tr>
                  <td className="zplan-lp">4.</td>
                  <td colSpan={2}>{s.saldoANaFundusz > 0 ? t.zplanTransferOut : t.zplanTransfer}</td>
                  <td className="zfin-num">{formatKwota(s.przeksiegowanie)}</td>
                </tr>
              )}
              <tr className="is-sum">
                <td className="zplan-lp">{przeksiegowanie ? '5.' : '4.'}</td>
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
                  <td className="zplan-lp">{++lpWplywyB}.</td>
                  <td colSpan={2}>{t.zplanSaldoAInFund}</td>
                  <td className="zfin-num">{formatKwota(s.saldoANaFundusz)}</td>
                </tr>
              )}
              {pokazInne ? (
                <tr>
                  <td className="zplan-lp">{++lpWplywyB}.</td>
                  <td colSpan={2}>{t.zplanOtherIncomeB}</td>
                  <td className="zfin-num">
                    {kwota(plan.inneWplywyB, (n) => update((p) => ({ ...p, inneWplywyB: n })), t.zplanOtherIncomeB)}
                  </td>
                </tr>
              ) : (
                odslon('inne', t.zplanAddOtherIncome)
              )}
              <tr className="is-sum">
                <td className="zplan-lp">{lpWplywyB + 1}.</td>
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
              {pokazKredyt ? (
                <tr>
                  <td className="zplan-lp">{++lpKosztyB}.</td>
                  <td>{t.zplanCredit}</td>
                  <td />
                  <td className="zfin-num">
                    {kwota(plan.kredyt, (n) => update((p) => ({ ...p, kredyt: n })), t.zplanCredit, {
                      value: oryginal?.kredyt,
                      hint: t.zplanRestoreStatement,
                    })}
                  </td>
                </tr>
              ) : (
                odslon('kredyt', t.zplanAddCredit)
              )}
              {pokazSaldoAKoszt && (
                <tr>
                  <td className="zplan-lp">{++lpKosztyB}.</td>
                  <td colSpan={2}>{t.zplanSaldoACost}</td>
                  <td className="zfin-num">{formatKwota(s.saldoAKoszt)}</td>
                </tr>
              )}
              <tr>
                <td className="zplan-lp">{++lpKosztyB}.</td>
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
                          data-tip={t.zplanRemoveRepair}
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
                <td className="zplan-lp">{lpKosztyB + 1}.</td>
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

/** What a new plan is drafted with besides the statement and the community's areas: the cost rise. */
export interface PlanZalozenia {
  wskaznik: number;
}

export const PlanZalozeniaFields: React.FC<{
  t: T;
  value: PlanZalozenia;
  onChange: (value: PlanZalozenia) => void;
}> = ({ t, value, onChange }) => (
  <FormRow>
    <FormField label={t.zplanIndex} hint={t.zplanIndexHint}>
      <KwotaInput
        value={value.wskaznik}
        onChange={(n) => onChange({ ...value, wskaznik: n })}
        ariaLabel={t.zplanIndex}
      />
    </FormField>
  </FormRow>
);

/**
 * The areas a new plan of this statement gets: the address's, else the
 * statement's total and no city's or leased area (as `planZeSprawozdania`).
 */
export const powierzchnieNowegoPlanu = (
  spr: Pick<Sprawozdanie, 'powierzchnia'>,
  adres: Adres | null
): { powierzchnia: number; miastoM2: number; pozytkiM2: number } => {
  const p = adres ? normalizePowierzchnie(adres.powierzchnie) : null;
  return {
    powierzchnia: p?.calkowita || spr.powierzchnia || 0,
    miastoM2: p?.miasto ?? 0,
    pozytkiM2: p?.pozytki ?? 0,
  };
};

/**
 * A new plan drafted from a statement with the given assumptions and the
 * community's areas (its address's); its positions follow `pogrupowane` (the
 * meeting version's merges and subcategories) when given.
 */
export const draftPlanu = (
  spr: Sprawozdanie,
  ustawienia: ZebraniaUstawienia,
  z: PlanZalozenia,
  pogrupowane?: Sprawozdanie | null,
  powierzchnie: AdresPowierzchnie | null = null
): PlanGospodarczy =>
  planZeSprawozdania(spr, ustawienia, {
    powierzchnie,
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

/** A new plan's first draft: the statement with the assumptions and the community's areas, the template's costs keeping their own growth. */
export const planNaStart = (
  spr: Sprawozdanie,
  ustawienia: ZebraniaUstawienia,
  z: PlanZalozenia,
  pogrupowane: Sprawozdanie | null | undefined,
  szablon: PlanSzablonu | null,
  adres: Adres | null
): PlanGospodarczy => {
  const plan = draftPlanu(spr, ustawienia, z, pogrupowane, adres?.powierzchnie ?? null);
  return szablon ? zachowajWzrosty(plan, szablon.plan.pozycje, ustawienia.zaokraglenie) : plan;
};

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
  /**
   * Store the plan, or with null remove it. Throws when that fails. `expected`
   * is the plan the edits started from: a plan saved since by somebody else is
   * refused (`concurrentEdit`), not overwritten.
   */
  persist: (plan: PlanGospodarczy | null, expected: PlanExpected) => Promise<void>;
  onChanged: () => Promise<void> | void;
  onOpenUstawienia: () => void;
  /**
   * Filled with the check the host runs before it leaves the plan: with unsaved
   * edits it asks to save, leave without saving or stay. Resolves false to stay.
   */
  leaveRef?: React.MutableRefObject<LeaveCheck | null>;
  /** The community's address — where the plan's areas come from. Null = none linked. */
  adres?: Adres | null;
  /** Opens the address in Adresy, the one place its areas change. */
  onOpenAdres?: (adresId: number) => void;
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
  leaveRef,
  adres = null,
  onOpenAdres,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [draft, setDraft] = useState<PlanGospodarczy>(stored);
  const [base, setBase] = useState<string>(contentOf(stored));
  // The stored plan the edits started from — what a save expects to still be
  // there. A plan somebody else saved meanwhile is a conflict, not overwritten.
  const [baseStamp, setBaseStamp] = useState<string | null>(stored.zmieniono);
  // After a conflict: the next stored plan becomes the base the edits now
  // knowingly go over, so "Zapisz" again saves them.
  const adoptNextStamp = useRef(false);
  const [busy, setBusy] = useState(false);
  const dirty = !readOnly && contentOf(draft) !== base;

  const resetToStored = () => {
    setDraft(stored);
    setBase(contentOf(stored));
    setBaseStamp(stored.zmieniono);
  };

  // A reload brings the stored plan; it replaces the screen unless there are unsaved edits.
  useEffect(() => {
    if (!dirty) {
      resetToStored();
    } else if (adoptNextStamp.current) {
      setBaseStamp(stored.zmieniono);
    }
    adoptNextStamp.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, stored.zmieniono]);

  const save = async (plan: PlanGospodarczy | null, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await persist(plan, { zmieniono: baseStamp });
      if (plan) setBase(contentOf(plan));
      await onChanged();
      notify.success(done);
      return true;
    } catch (err: unknown) {
      if (isIpcError(err, 'concurrentEdit')) {
        // Nothing was written; the edits stay on screen over the plan as it now is.
        notify.error(t.zplanConflict);
        adoptNextStamp.current = true;
        await onChanged();
      } else {
        notify.error(ipcErrorMessage(err, t.errorUnexpected));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmLeave = async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await notify.unsaved(t.zplanUnsavedConfirm, {
      saveLabel: t.podUnsavedSave,
      discardLabel: t.podUnsavedDiscard,
      keepLabel: t.podUnsavedKeep,
    });
    if (choice === 'keep') return false;
    return choice === 'discard' || (await save(draft, t.zplanSaved));
  };
  useEffect(() => {
    if (!leaveRef) return;
    leaveRef.current = confirmLeave;
    return () => {
      leaveRef.current = null;
    };
  });
  // The sidebar, Back/Forward and links to other modules ask the same.
  useLeaveGuard(dirty ? confirmLeave : null);

  const regenerate = async () => {
    if (!spr) return;
    if (!(await notify.confirm(t.zplanRegenerateConfirm, { confirmLabel: t.zplanRegenerate })))
      return;
    // The address's areas — the rates are worked out per its m². One it has not got
    // entered: the total is the statement's, the city's and the leased stay the plan's.
    const p = adres ? normalizePowierzchnie(adres.powierzchnie) : null;
    const fresh = draftPlanu(spr, ustawienia, { wskaznik: draft.wskaznik }, pogrupowane, {
      calkowita: p?.calkowita ?? null,
      miasto: p?.miasto ?? draft.miastoM2,
      pozytki: p?.pozytki ?? draft.pozytkiM2,
    });
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

  /**
   * The positions laid out anew from the statement — the planned amounts stay.
   * Saved at once: the notice is about the stored plan, and a draft left behind
   * by switching tabs would bring it back.
   */
  const regeneratePozycje = async () => {
    if (!spr) return;
    const r = przegenerujPozycje(draft, spr, pogrupowane, ustawienia);
    const lines = [t.zplanRegroupConfirm];
    if (r.nowe.length) lines.push(t.zplanRegroupNew.replace('{list}', r.nowe.join(', ')));
    if (r.usuniete.length) lines.push(t.zplanRegroupGone.replace('{list}', r.usuniete.join(', ')));
    if (!(await notify.confirm(lines.join('\n\n'), { confirmLabel: t.zplanRegroup }))) return;
    setDraft(r.plan);
    await save(r.plan, t.zplanRegroupSaved);
  };

  // The assumptions as typed, applied to the plan only by "Przelicz" — a discard or reload brings the plan's own.
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>({ wskaznik: draft.wskaznik });
  useEffect(() => {
    setZalozenia({ wskaznik: draft.wskaznik });
  }, [draft.wskaznik]);
  const zalozeniaZmienione = zalozenia.wskaznik !== draft.wskaznik;
  const wzrosty = wzrostyPlanu(draft);
  // What the costs without an own growth rise by with the index as typed — shown while some have their own.
  const pozostaleWpisane = wzrostPozostalych(draft.pozycje, zalozenia.wskaznik);

  /** A new cost rise on a drafted plan: the statement's costs are drafted again. */
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
      przeliczZalozenia(draft, { wskaznik: draft.wskaznik, wzrosty: nowe }, step)
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
    const fresh = draftPlanu(spr, ustawienia, { wskaznik: 0 }, pogrupowane);
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
            {/* While the layout notice is up, its "Przegeneruj pozycje" is the one way
                offered — it lays the positions out anew too, but keeps the amounts. */}
            {!readOnly && spr && !ukladZmieniony && (
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

      <PlanNaglowek
        t={t}
        plan={draft}
        onChange={setDraft}
        readOnly={readOnly}
        adres={adres}
        onOpenAdres={onOpenAdres}
      />

      {!readOnly && (
        <FormSection icon="coins" title={t.zplanAssumptions} description={t.zplanAssumptionsHint}>
          <PlanZalozeniaFields t={t} value={zalozenia} onChange={setZalozenia} />
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
          onCancel={dirty ? resetToStored : undefined}
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
  /** The meeting's community — the plan's areas come from it. Null = none linked. */
  adres: Adres | null;
  /** Opens the address in Adresy, the one place its areas change. */
  onOpenAdres?: (adresId: number) => void;
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
  /** The plan's unsaved-edits question, for the host's own exits (see PlanWorkspace). */
  leaveRef?: React.MutableRefObject<LeaveCheck | null>;
}> = ({
  language,
  locale,
  wersja,
  adres,
  onOpenAdres,
  ustawienia,
  dataZebrania,
  onChanged,
  statusBox,
  onGoToSprawozdania,
  onOpenUstawienia,
  szablon = null,
  leaveRef,
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
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>({ wskaznik: szablon?.plan.wskaznik ?? 0 });

  const persist = (plan: PlanGospodarczy | null, expected: PlanExpected) =>
    window.electronAPI.setZebranieWersjaPlan(wersja.id, plan, expected).then(() => undefined);

  const create = async () => {
    if (!spr) return;
    setBusy(true);
    try {
      // Only onto a version still without a plan: one drafted meanwhile elsewhere is not replaced.
      await persist(planNaStart(spr, ustawienia, zalozenia, pogrupowane, szablon, adres), { zmieniono: null });
      await onChanged();
      notify.success(t.zplanCreated);
    } catch (err: unknown) {
      if (isIpcError(err, 'concurrentEdit')) {
        notify.error(t.zplanCreateConflict);
        await onChanged();
      } else {
        notify.error(ipcErrorMessage(err, t.errorUnexpected));
      }
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
        leaveRef={leaveRef}
        adres={adres}
        onOpenAdres={onOpenAdres}
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
        <PowierzchniePlanu t={t} {...powierzchnieNowegoPlanu(spr, adres)} adres={adres} nowy onOpenAdres={onOpenAdres} />
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
