import React, { useEffect, useMemo, useState } from 'react';
import {
  PlanGospodarczy,
  Sprawozdanie,
  PlanKategoriaKosztu,
  PlanKategoriaPrzychodu,
  PlanOkresZaliczki,
  ZebraniaUstawienia,
  ZebraniaWspolnota,
  ZebranieWersja,
} from '../../shared/types';
import {
  PLAN_KATEGORIA_NAZWA,
  domknijRemonty,
  miesiaceOkresu,
  newRemontFR,
  okresyLabels,
  planSumy,
  planZeSprawozdania,
} from '../../shared/plan-gospodarczy';
import { formatData, formatKwota, okresLabel } from '../../shared/sprawozdanie';
import { wersjaLabel } from '../../shared/zebrania';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import { FormField, FormRow, FormSection } from './FormSection';
import { ModalFooter } from './Modal';
import OverflowMenu from './OverflowMenu';
import Icon from './Icon';
import KwotaInput from './KwotaInput';
import ZebranieDokumentActions, { DokumentZrodlo } from './ZebranieDokumentActions';

type T = (typeof translations)['pl'];

/** What decides whether the plan on screen differs from the stored one. */
function contentOf(p: PlanGospodarczy | null): string {
  if (!p) return '';
  const { pobrania: _p, zmieniono: _z, zmienil: _w, ...rest } = p;
  return JSON.stringify(rest);
}

const zl = (n: number) => `${formatKwota(n)} zł`;

/* ============================= Advance periods ============================= */

/** "za okres I–III/2027: 3 mies. × 2,70 zł/m²" — one row per stretch of the year. */
const OkresyEditor: React.FC<{
  t: T;
  rok: number;
  okresy: PlanOkresZaliczki[];
  kwoty: number[];
  onChange: (okresy: PlanOkresZaliczki[]) => void;
  readOnly?: boolean;
}> = ({ t, rok, okresy, kwoty, onChange, readOnly }) => {
  const labels = okresyLabels(okresy, rok);
  const months = okresy.reduce((n, o) => n + o.miesiace, 0);
  const set = (i: number, patch: Partial<PlanOkresZaliczki>) =>
    onChange(okresy.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <>
      {okresy.map((o, i) => (
        <tr key={i} className="zplan-sub">
          <td />
          <td>
            <span className="zplan-okres">
              {t.zplanPeriod.replace('{label}', labels[i])}
              {readOnly ? (
                <span className="zplan-ro">{o.miesiace}</span>
              ) : (
                <KwotaInput
                  integer
                  min={1}
                  max={12}
                  className="zplan-input zplan-input--months"
                  value={o.miesiace}
                  onChange={(n) => set(i, { miesiace: n })}
                  ariaLabel={t.zplanMonths}
                />
              )}
              <span className="zeb-muted">{t.zplanMonths}</span>
              {!readOnly && okresy.length > 1 && (
                <button
                  type="button"
                  className="button button-icon button-ghost"
                  onClick={() => onChange(okresy.filter((_, j) => j !== i))}
                  title={t.zplanRemovePeriod}
                  aria-label={t.zplanRemovePeriod}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </span>
          </td>
          <td className="zfin-num">
            <span className="zplan-rate">
              {readOnly ? (
                <span className="zplan-ro">{formatKwota(o.stawka)}</span>
              ) : (
                <KwotaInput
                  className="zplan-input zplan-input--rate"
                  value={o.stawka}
                  onChange={(n) => set(i, { stawka: n })}
                  ariaLabel={t.zplanRate}
                />
              )}
              <span className="zeb-muted">{t.zplanRate}</span>
            </span>
          </td>
          <td className="zfin-num">{formatKwota(kwoty[i])}</td>
        </tr>
      ))}
      {!readOnly && (
        <tr className="zplan-sub">
          <td />
          <td colSpan={3}>
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => {
                const last = okresy[okresy.length - 1];
                // Split the last stretch: the new rate takes over its second part.
                if (last && last.miesiace > 1) {
                  const keep = Math.max(1, Math.ceil(last.miesiace / 4));
                  onChange([
                    ...okresy.slice(0, -1),
                    { ...last, miesiace: keep },
                    { miesiace: last.miesiace - keep, stawka: last.stawka },
                  ]);
                } else {
                  onChange([...okresy, { miesiace: 1, stawka: last?.stawka ?? 0 }]);
                }
              }}
            >
              <Icon name="plus" size={12} /> {t.zplanAddPeriod}
            </button>
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

/* ================================ The editor ================================ */

const KOSZTY_GLOWNE: PlanKategoriaKosztu[] = ['remonty', 'energia', 'porzadek', 'zarzadzanie'];
const KOSZTY_INNE: PlanKategoriaKosztu[] = ['zarzad', 'ubezpieczenie', 'pozostale'];
const PRZYCHODY: { k: PlanKategoriaPrzychodu; label: string }[] = [
  { k: 'reklamy', label: 'a) Reklamy' },
  { k: 'pozytki', label: 'b) Pożytki z wynajmu pow. wspólnej' },
  { k: 'inne', label: 'c) Inne' },
];

const PlanEditor: React.FC<{
  t: T;
  plan: PlanGospodarczy;
  onChange: (plan: PlanGospodarczy) => void;
  /** Figures as text, no fields or row actions — a plan kept elsewhere, or replaced. */
  readOnly?: boolean;
}> = ({ t, plan, onChange, readOnly = false }) => {
  const s = planSumy(plan);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const stan = formatData(plan.stanNaDzien);

  /** Every edit keeps "Remonty bieżące" closing the plan while that is switched on. */
  const update = (fn: (p: PlanGospodarczy) => PlanGospodarczy) => {
    const next = fn(plan);
    onChange(next.remontyDomykaja ? domknijRemonty(next) : next);
  };
  const setKoszt = (k: PlanKategoriaKosztu, n: number) =>
    update((p) => ({
      ...p,
      koszty: { ...p.koszty, [k]: n },
      // Typing the repairs yourself switches the automatic closing off.
      remontyDomykaja: k === 'remonty' ? false : p.remontyDomykaja,
    }));
  /** An amount: a field to type in, or — read-only — the figure itself. */
  const kwota = (value: number, onSet: (n: number) => void, label: string) =>
    readOnly ? (
      <span className="zplan-ro">{formatKwota(value)}</span>
    ) : (
      <KwotaInput className="zplan-input" value={value} onChange={onSet} ariaLabel={label} />
    );
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const costRow = (lp: string, k: PlanKategoriaKosztu, label: string, sub = false) => {
    const zrodla = plan.zrodla.filter((z) => z.kategoria === k);
    const bez = zrodla.filter((z) => z.bezReguly).length;
    const isOpen = open.has(k);
    return (
      <React.Fragment key={k}>
        <tr className={sub ? 'zplan-sub' : ''}>
          <td className="zplan-lp">{lp}</td>
          <td>
            <span className="zplan-label">
              {label}
              {k === 'remonty' && plan.remontyDomykaja && (
                <span className="status-badge zplan-closing" title={t.zplanClosingHint}>
                  {t.zplanClosing}
                </span>
              )}
              {zrodla.length > 0 && (
                <button
                  type="button"
                  className="zplan-src-toggle"
                  onClick={() => toggle(k)}
                  aria-expanded={isOpen}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                  {t.zplanSources} ({zrodla.length})
                </button>
              )}
              {bez > 0 && (
                <span className="cell-warning" title={t.zplanNoRuleHint}>
                  <Icon name="alert-triangle" size={12} />{' '}
                  {t.zplanNoRule.replace('{n}', String(bez))}
                </span>
              )}
            </span>
          </td>
          <td className="zfin-num zeb-muted">{formatKwota(s.kosztM2[k])}</td>
          <td className="zfin-num">
            {kwota(plan.koszty[k], (n) => setKoszt(k, n), label)}
          </td>
        </tr>
        {isOpen &&
          zrodla.map((z, i) => (
            <tr key={`${k}-${i}`} className="zplan-src">
              <td />
              <td>
                {z.nazwa}
                {z.bezReguly && <span className="zplan-src__flag">{t.zplanNoRuleShort}</span>}
              </td>
              <td />
              <td className="zfin-num">{formatKwota(z.kwotaRoczna)}</td>
            </tr>
          ))}
      </React.Fragment>
    );
  };

  const przychodRow = ({ k, label }: { k: PlanKategoriaPrzychodu; label: string }) => {
    const zrodla = plan.zrodla.filter((z) => z.kategoria === k);
    const key = `p-${k}`;
    return (
      <React.Fragment key={k}>
        <tr className="zplan-sub">
          <td />
          <td>
            <span className="zplan-label">
              {label}
              {zrodla.length > 0 && (
                <button
                  type="button"
                  className="zplan-src-toggle"
                  onClick={() => toggle(key)}
                  aria-expanded={open.has(key)}
                >
                  <Icon name={open.has(key) ? 'chevron-down' : 'chevron-right'} size={12} />
                  {t.zplanSources} ({zrodla.length})
                </button>
              )}
            </span>
          </td>
          <td />
          <td className="zfin-num">
            {kwota(
              plan.przychody[k],
              (n) => update((p) => ({ ...p, przychody: { ...p.przychody, [k]: n } })),
              label
            )}
          </td>
        </tr>
        {open.has(key) &&
          zrodla.map((z, i) => (
            <tr key={`${key}-${i}`} className="zplan-src">
              <td />
              <td>{z.nazwa}</td>
              <td />
              <td className="zfin-num">{formatKwota(z.kwotaRoczna)}</td>
            </tr>
          ))}
      </React.Fragment>
    );
  };

  return (
    <>
      <FormSection icon="file-text" title={t.zplanHeader} description={readOnly ? undefined : t.zplanAreasHint}>
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
            </FormRow>
            <FormRow>
              <FormField label={t.zplanArea}>
                <KwotaInput
                  value={plan.powierzchnia}
                  onChange={(n) => update((p) => ({ ...p, powierzchnia: n }))}
                  ariaLabel={t.zplanArea}
                />
              </FormField>
              <FormField
                label={t.zplanCityArea}
                hint={t.zplanShare.replace('{p}', String(s.udzialMiasta))}
              >
                <KwotaInput
                  value={plan.miastoM2}
                  onChange={(n) => update((p) => ({ ...p, miastoM2: n }))}
                  ariaLabel={t.zplanCityArea}
                />
              </FormField>
              <FormField label={t.zplanLeaseArea}>
                <KwotaInput
                  value={plan.pozytkiM2}
                  onChange={(n) => update((p) => ({ ...p, pozytkiM2: n }))}
                  ariaLabel={t.zplanLeaseArea}
                />
              </FormField>
            </FormRow>
          </>
        )}
        <p className="zeb-muted zplan-private">
          {t.zplanPrivateArea
            .replace('{m2}', formatKwota(s.osobyFizyczneM2))
            .replace('{p}', String(s.udzialOsobFizycznych))}
        </p>
      </FormSection>

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
                  {kwota(plan.saldoA, (n) => update((p) => ({ ...p, saldoA: n })), t.zplanSaldoA)}
                </td>
              </tr>
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
                readOnly={readOnly}
              />
              <tr>
                <td className="zplan-lp">3.</td>
                <td colSpan={2}>{t.zplanCommonIncome}</td>
                <td className="zfin-num">{formatKwota(s.przychodyRazem)}</td>
              </tr>
              {PRZYCHODY.map(przychodRow)}
              <tr>
                <td className="zplan-lp">4.</td>
                <td colSpan={2}>{t.zplanTransfer}</td>
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
              {KOSZTY_GLOWNE.map((k, i) => costRow(`${i + 1}.`, k, PLAN_KATEGORIA_NAZWA[k]))}
              <tr>
                <td className="zplan-lp">5.</td>
                <td colSpan={2}>{t.zplanOtherCosts}</td>
                <td className="zfin-num">
                  {formatKwota(
                    plan.koszty.zarzad + plan.koszty.ubezpieczenie + plan.koszty.pozostale
                  )}
                </td>
              </tr>
              {KOSZTY_INNE.map((k, i) =>
                costRow('', k, `${'abc'[i]}) ${PLAN_KATEGORIA_NAZWA[k]}`, true)
              )}
              <tr className="is-sum">
                <td className="zplan-lp">6.</td>
                <td>{t.zplanTotalCosts}</td>
                <td className="zfin-num">
                  {formatKwota(plan.powierzchnia > 0 ? s.kosztyA / 12 / plan.powierzchnia : 0)}
                </td>
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
        ) : (
          <div className="callout callout--warning zplan-balance">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">
              {t.zplanUnbalanced.replace('{kwota}', formatKwota(s.roznicaA))}
              {!readOnly && !plan.remontyDomykaja && (
                <button
                  type="button"
                  className="button button-small button-secondary zplan-balance__btn"
                  onClick={() => onChange(domknijRemonty({ ...plan, remontyDomykaja: true }))}
                >
                  {t.zplanCloseAgain}
                </button>
              )}
            </div>
          </div>
        )}
      </FormSection>

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
                  {kwota(plan.saldoB, (n) => update((p) => ({ ...p, saldoB: n })), t.zplanSaldoB)}
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
                readOnly={readOnly}
              />
              <tr>
                <td className="zplan-lp">3.</td>
                <td colSpan={2}>{t.zplanOtherIncomeB}</td>
                <td className="zfin-num">
                  {kwota(plan.inneWplywyB, (n) => update((p) => ({ ...p, inneWplywyB: n })), t.zplanOtherIncomeB)}
                </td>
              </tr>
              <tr className="is-sum">
                <td className="zplan-lp">4.</td>
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
                  {kwota(plan.kredyt, (n) => update((p) => ({ ...p, kredyt: n })), t.zplanCredit)}
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
}> = ({ t, value, onChange }) => (
  <FormRow>
    <FormField label={t.zplanIndex} hint={t.zplanIndexHint}>
      <KwotaInput
        value={value.wskaznik}
        onChange={(n) => onChange({ ...value, wskaznik: n })}
        ariaLabel={t.zplanIndex}
      />
    </FormField>
    <FormField label={t.zplanCityArea}>
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

/** A new plan drafted from a statement with the given assumptions. */
export const draftPlanu = (
  spr: Sprawozdanie,
  ustawienia: ZebraniaUstawienia,
  z: PlanZalozenia
): PlanGospodarczy =>
  planZeSprawozdania(spr, ustawienia, {
    udzialy: { miastoM2: z.miastoM2, pozytkiM2: z.pozytkiM2 },
    nieruchomosc: '',
    wskaznik: z.wskaznik,
    who: '',
  });

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
    const fresh = draftPlanu(spr, ustawienia, {
      wskaznik: draft.wskaznik,
      miastoM2: draft.miastoM2,
      pozytkiM2: draft.pozytkiM2,
    });
    // What the statement cannot know stays as the user typed it.
    setDraft(
      domknijRemonty({
        ...fresh,
        nieruchomosc: draft.nieruchomosc || fresh.nieruchomosc,
        uchwalaNr: draft.uchwalaNr || fresh.uchwalaNr,
        remontyFR: draft.remontyFR,
        inneWplywyB: draft.inneWplywyB,
        pobrania: draft.pobrania,
      })
    );
  };

  const remove = async () => {
    if (!(await notify.confirm(deleteConfirm, { danger: true, confirmLabel: t.delete }))) return;
    await save(null, t.zplanDeleted);
  };

  const outOfDate =
    spr &&
    (draft.sprawozdanieOkres.od !== spr.okresOd || draft.sprawozdanieOkres.do !== spr.okresDo);

  return (
    <div className="page-form zeb-page">
      {/* The plan itself: what it is drawn from, when it was last saved; the
          rare actions (recompute, the dictionary, delete) in its header. */}
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
                  { icon: 'settings', label: t.zplanDictionary, onClick: onOpenUstawienia },
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
            <div className="callout callout--muted">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.zplanIntro}</div>
            </div>
          ))}
      </FormSection>

      <PlanEditor t={t} plan={draft} onChange={setDraft} readOnly={readOnly} />

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
}) => {
  const t = translations[language];
  const notify = useNotify();
  const v = wersjaLabel(wersja);
  const spr = wersja.sprawozdanie?.dane ?? null;
  const stored = wersja.plan;

  const [busy, setBusy] = useState(false);
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>({
    wskaznik: 0,
    miastoM2: wspolnota?.udzialy?.miastoM2 ?? 0,
    pozytkiM2: wspolnota?.udzialy?.pozytkiM2 ?? 0,
  });

  useEffect(() => {
    setZalozenia((z) => ({
      ...z,
      miastoM2: wspolnota?.udzialy?.miastoM2 ?? 0,
      pozytkiM2: wspolnota?.udzialy?.pozytkiM2 ?? 0,
    }));
  }, [wspolnota?.udzialy?.miastoM2, wspolnota?.udzialy?.pozytkiM2]);

  /** Store the plan with the version; the ownership split is remembered for the community. */
  const persist = async (plan: PlanGospodarczy | null) => {
    await window.electronAPI.setZebranieWersjaPlan(wersja.id, plan);
    if (plan) await zapamietajUdzialy(adresNazwa, wspolnota, plan);
  };

  const create = async () => {
    if (!spr) return;
    setBusy(true);
    try {
      await persist(draftPlanu(spr, ustawienia, zalozenia));
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
            <Icon name="settings" size={13} /> {t.zplanDictionary}
          </button>
        }
      >
        <PlanZalozeniaFields t={t} value={zalozenia} onChange={setZalozenia} />
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
