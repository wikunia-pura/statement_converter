import React, { useState } from 'react';
import { AdresPowierzchnie } from '../../../shared/types';
import { formatKwota } from '../../../shared/format';
import { translations } from '../../translations';
import { FormField, FormRow, FormSection } from '../FormSection';
import { LiczbaInput } from '../../views/PodatkiNieruchomosci';

type T = (typeof translations)['pl'];

/** "812,50 m²", "brak" for a marked 0, "—" for not entered. */
export const m2Label = (t: T, v: number | null, zeroIsNone = false): string =>
  v === null ? '—' : zeroIsNone && v === 0 ? t.adresPowBrak : formatKwota(v, { suffix: 'm²' });

/** What the folded section says: each area, or that none is entered. */
export const powierzchnieSummary = (t: T, p: AdresPowierzchnie): string =>
  p.calkowita === null && p.miasto === null && p.pozytki === null
    ? t.adresPowCollapsedEmpty
    : [
        `${t.adresPowCalkowitaShort} ${m2Label(t, p.calkowita)}`,
        `${t.adresPowMiastoShort} ${m2Label(t, p.miasto, true)}`,
        `${t.adresPowPozytkiShort} ${m2Label(t, p.pozytki, true)}`,
      ].join(' · ');

/**
 * An area the community may not have at all: the switch marks it as none (0),
 * else its m². The mark is the switch's own state — a typed "0" on the way to
 * "0,75" must not fold the input away.
 */
const OpcjonalnaPowierzchnia: React.FC<{
  id: string;
  label: string;
  brakLabel: string;
  brakHint: string;
  value: number | null;
  onChange: (value: number | null) => void;
}> = ({ id, label, brakLabel, brakHint, value, onChange }) => {
  const [brak, setBrak] = useState(value === 0);
  return (
    <FormField label={label} htmlFor={brak ? undefined : id}>
      <label className="switch-row">
        <span className="switch-row__text">
          <span className="switch-row__label">{brakLabel}</span>
          <span className="switch-row__hint">{brakHint}</span>
        </span>
        <span className="toggle-switch">
          <input
            type="checkbox"
            checked={brak}
            onChange={(e) => {
              setBrak(e.target.checked);
              // Unmarked, the area is back to "not entered" — to be typed in.
              onChange(e.target.checked ? 0 : null);
            }}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>
      {!brak && (
        <LiczbaInput
          id={id}
          value={value}
          // A typed 0 is not a mark of none: kept as not entered, so the list still asks.
          onChange={(v) => onChange(v === 0 ? null : v)}
          decimals={2}
          unit="m²"
          ariaLabel={label}
        />
      )}
    </FormField>
  );
};

/**
 * "Powierzchnie" of the address form — the total, the city's and the leased
 * areas every budget plan of the community prints. The plan shows them and
 * never lets them be typed, so this is the one place they change.
 */
export const PowierzchnieSection: React.FC<{
  t: T;
  value: AdresPowierzchnie;
  onChange: (value: AdresPowierzchnie) => void;
  /** A saved address: opens folded, with the areas in the header. */
  editing: boolean;
}> = ({ t, value, onChange, editing }) => {
  const set = (key: keyof AdresPowierzchnie, v: number | null) => onChange({ ...value, [key]: v });
  return (
    <FormSection
      icon="home"
      title={t.adresSectionPow}
      description={t.adresSectionPowDesc}
      collapsible={editing}
      defaultCollapsed
      collapsedSummary={powierzchnieSummary(t, value)}
    >
      <FormField label={t.adresPowCalkowita} htmlFor="adres-pow-calkowita" hint={t.adresPowCalkowitaHint}>
        <LiczbaInput
          id="adres-pow-calkowita"
          value={value.calkowita}
          onChange={(v) => set('calkowita', v)}
          decimals={2}
          unit="m²"
          ariaLabel={t.adresPowCalkowita}
        />
      </FormField>
      <FormRow>
        <OpcjonalnaPowierzchnia
          id="adres-pow-miasto"
          label={t.adresPowMiasto}
          brakLabel={t.adresBezMiasta}
          brakHint={t.adresBezMiastaHint}
          value={value.miasto}
          onChange={(v) => set('miasto', v)}
        />
        <OpcjonalnaPowierzchnia
          id="adres-pow-pozytki"
          label={t.adresPowPozytki}
          brakLabel={t.adresBezPozytkow}
          brakHint={t.adresBezPozytkowHint}
          value={value.pozytki}
          onChange={(v) => set('pozytki', v)}
        />
      </FormRow>
    </FormSection>
  );
};
