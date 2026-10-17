import React, { useMemo } from 'react';
import { AdresIdentyfikacja, PodatekAdres } from '../../../shared/types';
import { nazwaNieruchomosci } from '../../../shared/plan-gospodarczy';
import { nipPoprawny, tylkoCyfry } from '../../../shared/podatki';
import { nazwaUrzedu, urzedyOpcje } from '../../../shared/pit-urzedy';
import { translations } from '../../translations';
import { FormField, FormRow, FormSection } from '../FormSection';
import SearchableSelect from '../SearchableSelect';
import { AdresFields } from '../../views/PodatkiNieruchomosci';

/**
 * "Dane identyfikacyjne (podatkowe)" of the address form — what the tax modules
 * read instead of asking again for every return. A wrong NIP checksum is only
 * pointed out: the data is the office's to keep, never blocked.
 */
export const IdentyfikacjaSection: React.FC<{
  t: (typeof translations)['pl'];
  nazwa: string;
  value: AdresIdentyfikacja;
  onChange: (value: AdresIdentyfikacja) => void;
  /** A saved address: always opens folded, the fold of the add form is not carried over. */
  editing: boolean;
}> = ({ t, nazwa, value, onChange, editing }) => {
  const set = <K extends keyof AdresIdentyfikacja>(key: K, v: AdresIdentyfikacja[K]) => onChange({ ...value, [key]: v });
  const setSiedziba = (key: keyof PodatekAdres, v: string) => set('siedziba', { ...value.siedziba, [key]: v });
  const kodyUrzedow = useMemo(() => [{ value: '', label: t.adresIdentKodUrzeduBrak }, ...urzedyOpcje(true)], [t]);
  // The code names its office: an empty name, or the one the previous code put there, follows the pick.
  const setKodUrzedu = (kod: string) => {
    const nazwaKodu = nazwaUrzedu(kod);
    const wpisanaZKodu = !value.urzadSkarbowy.trim() || value.urzadSkarbowy === nazwaUrzedu(value.kodUrzedu);
    onChange({ ...value, kodUrzedu: kod, urzadSkarbowy: nazwaKodu && wpisanaZKodu ? nazwaKodu : value.urzadSkarbowy });
  };
  const sugestia = nazwa.trim() ? `Wspólnota Mieszkaniowa ${nazwaNieruchomosci(nazwa)}` : 'Wspólnota Mieszkaniowa …';
  return (
    <FormSection
      icon="landmark"
      title={t.adresSectionIdent}
      description={t.adresSectionIdentDesc}
      collapsible
      defaultCollapsed
      persistKey={editing ? undefined : 'adres-identyfikacja'}
      collapsedSummary={value.nip ? `NIP ${value.nip}` : t.adresIdentCollapsedEmpty}
    >
      <FormRow>
        <FormField
          label={t.adresIdentNip}
          htmlFor="adres-ident-nip"
          hint={value.nip.length === 10 && !nipPoprawny(value.nip) ? t.adresIdentNipChecksum : undefined}
        >
          <input
            id="adres-ident-nip"
            type="text"
            inputMode="numeric"
            className="input-mono"
            value={value.nip}
            onChange={(e) => set('nip', tylkoCyfry(e.target.value).slice(0, 10))}
          />
        </FormField>
        <FormField label={t.adresIdentRegon} htmlFor="adres-ident-regon">
          <input
            id="adres-ident-regon"
            type="text"
            inputMode="numeric"
            className="input-mono"
            value={value.regon}
            onChange={(e) => set('regon', tylkoCyfry(e.target.value).slice(0, 14))}
          />
        </FormField>
      </FormRow>
      <FormField label={t.adresIdentNazwaPelna} htmlFor="adres-ident-nazwa">
        <input
          id="adres-ident-nazwa"
          type="text"
          value={value.nazwaPelna}
          placeholder={sugestia}
          onChange={(e) => set('nazwaPelna', e.target.value)}
        />
      </FormField>
      <FormField label={t.adresIdentSeat}>
        <AdresFields t={t} idPrefix="adres-ident-siedziba" value={value.siedziba} onChange={setSiedziba} />
      </FormField>
      <FormRow>
        <FormField label={t.adresIdentUrzad} htmlFor="adres-ident-urzad" hint={t.adresIdentUrzadHint}>
          <input
            id="adres-ident-urzad"
            type="text"
            value={value.urzadSkarbowy}
            onChange={(e) => set('urzadSkarbowy', e.target.value)}
          />
        </FormField>
        <FormField label={t.adresIdentKodUrzedu} hint={t.adresIdentKodUrzeduHint}>
          <SearchableSelect
            overlay
            value={value.kodUrzedu}
            options={kodyUrzedow}
            onChange={setKodUrzedu}
            ariaLabel={t.adresIdentKodUrzedu}
            searchPlaceholder={t.adresIdentKodUrzeduSearch}
            emptyText={t.adresIdentKodUrzeduEmpty}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.adresIdentTelefon} htmlFor="adres-ident-tel">
          <input id="adres-ident-tel" type="text" value={value.telefon} onChange={(e) => set('telefon', e.target.value)} />
        </FormField>
        <FormField label={t.adresIdentEmail} htmlFor="adres-ident-email">
          <input id="adres-ident-email" type="text" value={value.email} onChange={(e) => set('email', e.target.value)} />
        </FormField>
      </FormRow>
    </FormSection>
  );
};
