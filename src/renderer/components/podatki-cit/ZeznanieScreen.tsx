import React, { useMemo, useState } from 'react';
import {
  Adres,
  CitKlasyfikacja,
  CitSlownikRegula,
  PodatekAdres,
  PodatekCit,
  PodatekCitDane,
  PodatkiCitUstawienia,
  PodpisCertyfikat,
  PodpisWybor,
} from '../../../shared/types';
import { formatZl, nipPoprawny, tylkoCyfry, ulicaZNumerem, uwagiPodpisu } from '../../../shared/podatki';
import {
  citWzor,
  obliczCIT8,
  okresKlucz,
  problemyCIT8,
  problemyTylkoXmlCIT8,
  pozycjeZeSprawozdania,
} from '../../../shared/podatki-cit';
import { formatStamp } from '../../../shared/calendar';
import { nazwaUrzedu, urzedyOpcje } from '../../../shared/pit-urzedy';
import SearchableSelect from '../SearchableSelect';
import { czekaNaUpo } from '../../../shared/e-deklaracje';
import Tip from '../Tip';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import { FormField, FormRow, FormSection } from '../FormSection';
import { ModalFooter } from '../Modal';
import { PodpisKartaModal, PodpiszTezPdf, bezPrefiksu } from '../PodpisKarta';
import ScreenTitle from '../ScreenTitle';
import { structuralEqual } from '../../structuralEqual';
import Icon from '../Icon';
import Select from '../Select';
import {
  AdresFields,
  DomSlot,
  GotowoscPodpisuWiele,
  LiczbaInput,
  WpisGotowosci,
  baseName,
  etapWysylkiText,
} from '../../views/PodatkiNieruchomosci';
import { problemText, zlozoneLabels, zAdresu } from './citShared';
import { WyslijOpcja, WysylkiLista, sprawdzUpo, potwierdzKorekty } from './Wysylki';
import { SprawozdaniePodgladModal, SprawozdanieSekcja, PozycjeSekcja, WyliczenieSekcja } from './Sekcje';

const dzisIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A button's hover hint in the app's own tooltip — none when there is nothing to say. */
const PodpowiedzPrzycisku: React.FC<{ tresc: string | null; children: React.ReactNode }> = ({ tresc, children }) =>
  tresc ? <Tip content={tresc}>{children}</Tip> : <>{children}</>;

/* ================================ One return ================================ */

/**
 * What "unsaved changes" ignores: downloads and the filing mark are written at
 * once by their own calls, so they never make the form dirty.
 */
const CIT_NIE_EDYCJA = ['pobrania', 'zlozone'] as const;
/** Whether the form holds what was last loaded or saved — see structuralEqual. */
const sameDane = (a: PodatekCitDane, b: PodatekCitDane) => structuralEqual(a, b, CIT_NIE_EDYCJA);

/** Months that end a quarter — the only ones quarterly advances use. */
const KONIEC_KWARTALU = [2, 5, 8, 11];

/**
 * One community's CIT-8 for one year, as a page form: identification, the
 * attached statement and the decisions on its rows, the advances paid, and the
 * tax worked out live with the same code the PDF uses. A community without a
 * return yet opens on a draft (`szkic`) and gets its row on the first save.
 */
export const ZeznanieScreen: React.FC<{
  language: Language;
  locale: string;
  rok: number;
  /** The community — `Adres.nazwa`, which is what the return is kept under. */
  adresNazwa: string;
  /** Null when the community is gone from Adresy: its return stays, flagged. */
  adres: Adres | null;
  rekord: PodatekCit | null;
  /** What a community without a return starts from, and the year it was carried over from. */
  szkic: { dane: PodatekCitDane; zRoku: number | null };
  slownik: CitSlownikRegula[];
  vdomNr: number | null;
  /** The signed-in account — kept with an attached statement. */
  kto: string;
  onVdomNr: (nr: number) => void;
  onSlownik: (value: PodatkiCitUstawienia) => void;
  onBack: () => void;
  onSaved: (rek: PodatekCit) => void;
  onDeleted: () => void;
  onDownloaded: () => void;
  onSetZlozone: (filed: boolean) => void;
  zlozoneBusy: boolean;
}> = ({
  language,
  locale,
  rok,
  adresNazwa,
  adres,
  rekord,
  szkic,
  slownik,
  vdomNr,
  kto,
  onVdomNr,
  onSlownik,
  onBack,
  onSaved,
  onDeleted,
  onDownloaded,
  onSetZlozone,
  zlozoneBusy,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [dane, setDane] = useState<PodatekCitDane>(rekord?.dane ?? szkic.dane);
  // A draft counts as unchanged until it is edited, but it can still be saved as it is.
  const [baseline, setBaseline] = useState<PodatekCitDane>(() => rekord?.dane ?? szkic.dane);
  const [busy, setBusy] = useState<null | 'save' | 'pdf' | 'xml' | 'delete'>(null);
  const [podpisOpen, setPodpisOpen] = useState(false);
  const [pdfPodpisany, setPdfPodpisany] = useState(false);
  const [wyslij, setWyslij] = useState(false);
  const [upoBusy, setUpoBusy] = useState(false);
  const [podgladOpen, setPodgladOpen] = useState(false);

  // Walks only what an edit replaced — no serializing of the whole return
  // (attached statement included) on every key pressed.
  const dirty = useMemo(() => !sameDane(dane, baseline), [dane, baseline]);
  // The statement's rows and their categories depend on the statement, the
  // return's own decisions and the dictionary — not on the NIP being typed.
  const pozycje = useMemo(
    () => pozycjeZeSprawozdania(dane, slownik),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dane.sprawozdanie, dane.klasyfikacja, slownik],
  );
  const wynik = useMemo(() => obliczCIT8(dane, pozycje), [dane, pozycje]);
  const problemy = useMemo(() => problemyCIT8({ rok, dane }, slownik, pozycje), [rok, dane, slownik, pozycje]);
  /** The PDF's problems and those only the XML has — the XML is what is filed, and what gets signed. */
  const problemyXml = useMemo(() => [...problemy, ...problemyTylkoXmlCIT8({ rok, dane })], [problemy, rok, dane]);
  const wzor = citWzor(rok);
  const canAdd = dane.nip.length === 10 && dane.nazwaPelna.trim() !== '';
  const odswiez = () => {
    setDane((d) => zAdresu(d, adres?.identyfikacja));
    notify.success(t.citRefreshed);
  };
  /** "Refresh from Adresy" — in the return's section for the office, in the taxpayer's for the rest. */
  const przyciskOdswiez = (
    <Tip content={adres?.identyfikacja ? t.citRefreshHint : t.citRefreshNone}>
      <button
        type="button"
        className="button button-small button-secondary"
        onClick={odswiez}
        disabled={!adres?.identyfikacja}
      >
        <Icon name="refresh" size={13} /> {t.citRefresh}
      </button>
    </Tip>
  );
  /** Names a statement of this community may be filed under. */
  const nazwy = useMemo(() => [adresNazwa, ...(adres?.alternativeNames ?? [])], [adresNazwa, adres]);

  const set = <K extends keyof PodatekCitDane>(key: K, value: PodatekCitDane[K]) =>
    setDane((d) => ({ ...d, [key]: value }));
  const setAdres = (key: keyof PodatekAdres, value: string) =>
    setDane((d) => ({ ...d, siedziba: { ...d.siedziba, [key]: value } }));
  const kodyUrzedow = useMemo(() => [{ value: '', label: t.adresIdentKodUrzeduBrak }, ...urzedyOpcje(true)], [t]);
  /** As in Adresy: the code names its office — an empty name, or the one the previous code put there, follows the pick. */
  const setKodUrzedu = (kod: string) =>
    setDane((d) => {
      const nazwaKodu = nazwaUrzedu(kod);
      const zKodu = !d.urzad.trim() || d.urzad === nazwaUrzedu(d.kodUrzedu);
      return { ...d, kodUrzedu: kod, urzad: nazwaKodu && zKodu ? nazwaKodu : d.urzad };
    });
  const setZaliczka = (i: number, value: number | null) =>
    setDane((d) => ({ ...d, zaliczki: d.zaliczki.map((z, j) => (j === i ? value : z)) }));
  /** Null drops the return's own decision for the row, so the dictionary sorts it again. */
  const mergeKlasyfikacja = (patch: Record<string, CitKlasyfikacja | null>) =>
    setDane((d) => {
      const klasyfikacja = { ...d.klasyfikacja };
      for (const [klucz, v] of Object.entries(patch)) {
        if (v) klasyfikacja[klucz] = v;
        else delete klasyfikacja[klucz];
      }
      return { ...d, klasyfikacja };
    });

  /** The totals add up every month, so quarterly mode must not leave amounts in the months it does not use. */
  const setKwartalne = async (kwartalne: boolean) => {
    const tracone = kwartalne ? dane.zaliczki.filter((z, i) => z !== null && !KONIEC_KWARTALU.includes(i)).length : 0;
    if (tracone > 0 && !(await notify.confirm(t.citQuarterlyLose, { danger: true, confirmLabel: t.citQuarterly }))) return;
    setDane((d) => ({
      ...d,
      zaliczkiKwartalne: kwartalne,
      zaliczki: kwartalne ? d.zaliczki.map((z, i) => (KONIEC_KWARTALU.includes(i) ? z : null)) : d.zaliczki,
    }));
  };

  const back = async () => {
    if (dirty) {
      const canSave = !!rekord || canAdd;
      const choice = await notify.unsaved(canSave ? t.podUnsavedConfirm : t.podUnsavedNoSave, {
        saveLabel: t.podUnsavedSave,
        discardLabel: t.podUnsavedDiscard,
        keepLabel: t.podUnsavedKeep,
        canSave,
      });
      if (choice === 'keep' || (choice === 'save' && !(await save()))) return;
    }
    onBack();
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = rekord
        ? await window.electronAPI.setPodatekCit(rekord.id, dane)
        : await window.electronAPI.addPodatekCit(adresNazwa, rok, dane);
      setDane(saved.dane);
      setBaseline(saved.dane);
      notify.success(t.podSaved);
      onSaved(saved);
      return true;
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podSaveError);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!rekord) return;
    setBusy('pdf');
    try {
      const { filePath } = await window.electronAPI.exportPodatekCitPdf(rekord.id);
      notify.success(t.podDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podDownloadError);
    } finally {
      setBusy(null);
    }
  };

  const downloadXml = async () => {
    if (!rekord) return;
    setBusy('xml');
    try {
      const { filePath } = await window.electronAPI.exportPodatekCitXml(rekord.id);
      notify.success(t.citXmlDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citXmlError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * The signing run of the list with this one return: the XML with XAdES, the PDF next to it. Errors stay in
   * the signing modal (wrong PIN, card pulled out) — it shows them itself.
   */
  const podpisz = async (wybor: PodpisWybor) => {
    if (!rekord) return;
    const potwierdzoneKorekty = await potwierdzKorekty(t, notify, [rekord], wyslij);
    const wynik = await window.electronAPI.podpiszPodatkiCit(rok, [rekord.id], wybor, { pdfPodpisany, wyslij, potwierdzoneKorekty });
    setPodpisOpen(false);
    const xml = wynik.podpisane.find((p) => p.sciezka.endsWith('.xml'));
    if (xml) {
      notify.success(t.citSigned.replace('{file}', baseName(xml.sciezka)), { file: xml.sciezka });
      const w = wynik.wysylki?.[0];
      if (w) {
        const tekst = `${t.citSendOption} (${w.srodowisko === 'prod' ? t.citEnvProd : t.citEnvTest}): ${etapWysylkiText(t, w.status, w.refId, w.niepewna)}${
          w.refId ? ` — ${t.citSendRef.replace('{ref}', w.refId)}` : ''
        }${w.opis ? `. ${w.opis}` : ''}`;
        // A send whose record was lost, or with no answer at all, is never reported as a success.
        if (w.niezapisana) notify.error(tekst, t.citSendNotRecordedTitle);
        else if (w.refId && !w.niepewna) notify.success(tekst);
        else notify.warning(tekst);
      }
      onDownloaded();
    } else {
      const powod = wynik.przerwano ?? wynik.pominiete.map((p) => p.powod).join(' ');
      notify.error(t.citSignFailed.replace('{reason}', powod));
    }
  };

  const remove = async () => {
    if (!rekord) return;
    if (
      !(await notify.confirm(
        t.podDeleteConfirm.replace('{name}', adresNazwa).replace('{rok}', String(rok)),
        { danger: true, confirmLabel: t.delete },
      ))
    ) {
      return;
    }
    setBusy('delete');
    try {
      await window.electronAPI.deletePodatekCit(rekord.id);
      notify.success(t.podDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err));
      setBusy(null);
    }
  };

  const ulica = ulicaZNumerem(dane.siedziba);
  /** Why the file can't be made yet — the top bar's buttons say it on hover. */
  const pdfBlocked =
    !rekord || dirty
      ? t.podPdfSaveFirst
      : problemy.length > 0
        ? `${t.podPdfBlocked} ${problemy.map((p) => problemText(t, p, rok)).join(' ')}`
        : null;
  /** Why the XML — and with it the signature — can't be made yet. */
  const xmlBlocked =
    pdfBlocked ??
    (problemyXml.length > 0 ? `${t.citXmlBlocked} ${problemyXml.map((p) => problemText(t, p, rok)).join(' ')}` : null);

  const note = !rekord && !canAdd ? (
    <span className="action-note">
      <Icon name="info" size={13} /> {t.citNewNeeds}
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

  const miesiac = (i: number) => new Date(2000, i, 1).toLocaleString(locale, { month: 'long' });
  const zaliczkiPola = dane.zaliczkiKwartalne ? KONIEC_KWARTALU : dane.zaliczki.map((_, i) => i);
  const wpisGotowosci = (cert: PodpisCertyfikat | null): WpisGotowosci[] =>
    rekord
      ? [
          {
            nazwa: adresNazwa,
            problemy: problemyXml.map((p) => problemText(t, p, rok)),
            uwagi: uwagiPodpisu(rekord.dane, cert?.podmiot ?? null),
          },
        ]
      : [];

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.podBack}
            crumb={`${t.citTitle} · ${rok}`}
            onBack={() => void back()}
            title={adresNazwa}
            meta={
              <>
                <span>
                  <Icon name="calendar" size={13} /> {t.podMetaYear.replace('{rok}', String(rok))}
                </span>
                {dane.nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {t.podRowNip.replace('{nip}', dane.nip)}
                  </span>
                )}
                {ulica && (
                  <span>
                    <Icon name="map-pin" size={13} /> {ulica}
                  </span>
                )}
                {dane.cel === 2 && <span className="status-badge status-pending">{t.podMetaCorrection}</span>}
                {!adres && <span className="status-badge status-pending">{t.citOrphanBadge}</span>}
              </>
            }
          />
          {/* The return's actions, in the order of the work: the rare
              destructive one first and set apart, then the file — plain or
              signed — and last the "filed" tick, which closes the job. */}
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
              <PodpowiedzPrzycisku tresc={pdfBlocked}>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void download()}
                  disabled={pdfBlocked !== null || busy !== null}
                >
                  <Icon name={busy === 'pdf' ? 'loader' : 'download'} size={13} /> {t.podDownloadPdf}
                </button>
              </PodpowiedzPrzycisku>
              <PodpowiedzPrzycisku tresc={xmlBlocked}>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void downloadXml()}
                  disabled={xmlBlocked !== null || busy !== null}
                >
                  <Icon name={busy === 'xml' ? 'loader' : 'download'} size={13} /> {t.citDownloadXml}
                </button>
              </PodpowiedzPrzycisku>
              <PodpowiedzPrzycisku tresc={xmlBlocked ?? t.citSignHint}>
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() => setPodpisOpen(true)}
                  disabled={xmlBlocked !== null || busy !== null}
                >
                  <Icon name="signature" size={13} /> {t.citSignCard}
                </button>
              </PodpowiedzPrzycisku>
              <DomSlot
                t={t}
                locale={locale}
                dom={rekord.dane.zlozone}
                busy={zlozoneBusy}
                onSet={onSetZlozone}
                size="button"
                labels={zlozoneLabels(t)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="content-body">
        <div className="page-form">
          {!adres && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citOrphanHint}</div>
            </div>
          )}
          {wzor && !wzor.potwierdzony && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.citWzorUnconfirmed.replace('{rok}', String(rok))}</div>
            </div>
          )}
          {!rekord && szkic.zRoku !== null && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.citDraftFrom.replace('{rok}', String(szkic.zRoku))}</div>
            </div>
          )}
          <FormSection icon="landmark" title={t.citSecReturn} description={t.citSecReturnDesc} aside={przyciskOdswiez}>
            <FormRow>
              <FormField label={t.citUrzad} htmlFor="cit-urzad" required hint={t.citUrzadHint}>
                <input id="cit-urzad" type="text" value={dane.urzad} onChange={(e) => set('urzad', e.target.value)} />
              </FormField>
              <FormField label={t.citKodUrzedu} required hint={t.citKodUrzeduHint}>
                <SearchableSelect
                  overlay
                  value={dane.kodUrzedu}
                  options={kodyUrzedow}
                  onChange={setKodUrzedu}
                  ariaLabel={t.citKodUrzedu}
                  searchPlaceholder={t.adresIdentKodUrzeduSearch}
                  emptyText={t.adresIdentKodUrzeduEmpty}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={t.citCel}>
                <div className="zad-seg" role="radiogroup" aria-label={t.citCel}>
                  {([1, 2] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={dane.cel === c}
                      className={`zad-seg__btn${dane.cel === c ? ' is-active' : ''}`}
                      onClick={() =>
                        setDane((d) => ({ ...d, cel: c, rodzajKorekty: c === 2 ? d.rodzajKorekty ?? 1 : null }))
                      }
                    >
                      {c === 1 ? t.citCel1 : t.citCel2}
                    </button>
                  ))}
                </div>
              </FormField>
              {dane.cel === 2 && (
                <FormField label={t.citRodzajKorekty}>
                  <Select
                    value={String(dane.rodzajKorekty ?? 1)}
                    options={[
                      { value: '1', label: t.citKorekta1 },
                      { value: '2', label: t.citKorekta2 },
                    ]}
                    onChange={(v) => set('rodzajKorekty', v === '2' ? 2 : 1)}
                    ariaLabel={t.citRodzajKorekty}
                  />
                </FormField>
              )}
              <FormField label={t.citStawka}>
                <div className="zad-seg" role="radiogroup" aria-label={t.citStawka}>
                  {([9, 19] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={dane.stawka === s}
                      className={`zad-seg__btn${dane.stawka === s ? ' is-active' : ''}`}
                      onClick={() => set('stawka', s)}
                    >
                      {s === 9 ? t.citStawka9 : t.citStawka19}
                    </button>
                  ))}
                </div>
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection
            icon="building"
            title={t.citSecTaxpayer}
            description={t.citSecTaxpayerDesc}
            aside={przyciskOdswiez}
          >
            <FormField
              label={t.podNip}
              htmlFor="cit-nip"
              required
              hint={adres && !adres.identyfikacja?.nip ? t.citNoNipInAdresy : undefined}
              error={dane.nip.length === 10 && !nipPoprawny(dane.nip) ? t.podNipInvalid : null}
            >
              <input
                id="cit-nip"
                type="text"
                inputMode="numeric"
                className="input-mono"
                value={dane.nip}
                onChange={(e) => set('nip', tylkoCyfry(e.target.value).slice(0, 10))}
              />
            </FormField>
            <FormField label={t.podNazwaPelna} htmlFor="cit-nazwa" required>
              <input
                id="cit-nazwa"
                type="text"
                value={dane.nazwaPelna}
                onChange={(e) => set('nazwaPelna', e.target.value)}
              />
            </FormField>
          </FormSection>

          <FormSection icon="map-pin" title={t.podSecSeat} description={t.citSecSeatDesc}>
            <AdresFields t={t} idPrefix="cit-siedziba" value={dane.siedziba} onChange={setAdres} />
          </FormSection>

          <SprawozdanieSekcja
            t={t}
            locale={locale}
            rok={rok}
            dane={dane}
            nazwy={nazwy}
            vdomNr={vdomNr}
            kto={kto}
            onAttach={(s) => set('sprawozdanie', s)}
            onVdomNr={onVdomNr}
            onDetach={async () => {
              if (!(await notify.confirm(t.citStmtDetachConfirm, { danger: true, confirmLabel: t.citStmtDetach }))) {
                return false;
              }
              set('sprawozdanie', null);
              return true;
            }}
            onAkceptacja={(przyjety) =>
              setDane((d) => ({
                ...d,
                zaakceptowanyOkres: przyjety && d.sprawozdanie ? okresKlucz(d.sprawozdanie.dane) : null,
              }))
            }
            onPreview={() => setPodgladOpen(true)}
          />

          <PozycjeSekcja
            t={t}
            dane={dane}
            pozycje={pozycje}
            slownik={slownik}
            onKlasyfikacja={mergeKlasyfikacja}
            onSlownik={onSlownik}
          />

          <FormSection
            icon="wallet"
            title={t.citSecAdvances}
            description={t.citSecAdvancesDesc.replace('{rok}', String(rok))}
          >
            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">{t.citQuarterly}</span>
                <span className="switch-row__hint">{t.citQuarterlyHint}</span>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={dane.zaliczkiKwartalne}
                  onChange={(e) => void setKwartalne(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </span>
            </label>
            <div className="pod-grid">
              {zaliczkiPola.map((i) => (
                <div key={i} className={dane.zaliczkiKwartalne ? 'pod-span-3' : 'pod-span-1'}>
                  <FormField
                    label={
                      dane.zaliczkiKwartalne
                        ? t.citQuarter.replace('{n}', String((i + 1) / 3))
                        : miesiac(i)
                    }
                    htmlFor={`cit-zal-${i}`}
                  >
                    <LiczbaInput
                      id={`cit-zal-${i}`}
                      value={dane.zaliczki[i]}
                      onChange={(v) => setZaliczka(i, v === null ? null : Math.round(v))}
                      decimals={0}
                      unit="zł"
                    />
                  </FormField>
                </div>
              ))}
            </div>
            <p className="pod-note">{t.citAdvancesTotal.replace('{kwota}', formatZl(wynik.zaliczkiZaplacone))}</p>
          </FormSection>

          <WyliczenieSekcja t={t} rok={rok} dane={dane} wynik={wynik} problemy={problemy} problemyXml={problemyXml} />

          <FormSection icon="users" title={t.citSecSign} description={t.citSecSignDesc}>
            <FormRow>
              <FormField label={t.citImie} htmlFor="cit-imie">
                <input
                  id="cit-imie"
                  type="text"
                  value={dane.reprezentant.imie}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, imie: e.target.value })}
                />
              </FormField>
              <FormField label={t.citNazwisko} htmlFor="cit-nazwisko">
                <input
                  id="cit-nazwisko"
                  type="text"
                  value={dane.reprezentant.nazwisko}
                  onChange={(e) => set('reprezentant', { ...dane.reprezentant, nazwisko: e.target.value })}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField
                label={t.citData}
                htmlFor="cit-data"
                hint={t.podDataHint}
                action={
                  <button
                    type="button"
                    className="button button-small button-ghost"
                    onClick={() => set('reprezentant', { ...dane.reprezentant, dataWypelnienia: dzisIso() })}
                  >
                    {t.podToday}
                  </button>
                }
              >
                <input
                  id="cit-data"
                  type="date"
                  value={dane.reprezentant.dataWypelnienia ?? ''}
                  onChange={(e) =>
                    set('reprezentant', { ...dane.reprezentant, dataWypelnienia: e.target.value || null })
                  }
                />
              </FormField>
              <FormField label={t.citTelefon} htmlFor="cit-tel">
                <input id="cit-tel" type="text" value={dane.telefon} onChange={(e) => set('telefon', e.target.value)} />
              </FormField>
            </FormRow>
          </FormSection>

          {rekord && (
            <FormSection
              icon="mail"
              title={t.citSecSend}
              description={t.citSecSendDesc}
              aside={
                rekord.dane.wysylki.some(czekaNaUpo) ? (
                  <button
                    type="button"
                    className="button button-small button-secondary"
                    disabled={upoBusy}
                    onClick={() => {
                      setUpoBusy(true);
                      void sprawdzUpo(t, notify, rok, [rekord.id]).then(() => {
                        setUpoBusy(false);
                        onDownloaded();
                      });
                    }}
                  >
                    <Icon name={upoBusy ? 'loader' : 'refresh'} size={13} /> {t.citCheckUpo}
                  </button>
                ) : undefined
              }
            >
              {rekord.dane.wysylki.length === 0 ? (
                <div className="form-empty">{t.citSendNone}</div>
              ) : (
                <WysylkiLista t={t} locale={locale} id={rekord.id} wysylki={rekord.dane.wysylki} onZmiana={onDownloaded} />
              )}
            </FormSection>
          )}

          <FormSection icon="download" title={t.citSecPdf} description={t.citSecPdfDesc}>
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
                      <li key={i} data-tip={p.plik}>
                        {(p.podpis ? t.podPdfHistorySigned.replace('{signer}', p.podpis.podmiot) : t.podPdfHistoryItem)
                          .replace('{when}', formatStamp(p.at, locale))
                          .replace('{who}', p.by || '—')}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </FormSection>

          {rekord?.dane.zlozone && dirty && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.citFiledChangedHint
                  .replace('{when}', formatStamp(rekord.dane.zlozone.at, locale))
                  .replace('{who}', rekord.dane.zlozone.by || '—')}
              </div>
            </div>
          )}

          <ModalFooter
            className="page-action-bar"
            note={note}
            onSubmit={() => void save()}
            submitLabel={rekord ? t.podSave : t.citCreate}
            submitIcon={rekord ? 'save' : 'plus'}
            submitDisabled={rekord ? !dirty : !canAdd}
            submitTitle={!rekord && !canAdd ? t.citNewNeeds : undefined}
            busy={busy === 'save'}
          />
        </div>
      </div>
      {podpisOpen && rekord && (
        <PodpisKartaModal
          language={language}
          title={t.citSignTitle}
          subtitle={`CIT-8 ${rok} · ${adresNazwa}`}
          extra={(cert) => (
            <>
              <GotowoscPodpisuWiele t={t} wpisy={wpisGotowosci(cert)} cert={cert} pokazLiczbe={false} />
              <FormSection icon="file-check" title={t.citSignTitle} description={t.citSignXmlNote}>
                <PodpiszTezPdf
                  checked={pdfPodpisany}
                  onChange={setPdfPodpisany}
                  label={t.citSignPdfOption}
                  hint={t.citSignPdfOptionHint}
                />
                <WyslijOpcja t={t} checked={wyslij} onChange={setWyslij} />
              </FormSection>
            </>
          )}
          onPodpisz={podpisz}
          onClose={() => setPodpisOpen(false)}
        />
      )}
      {podgladOpen && dane.sprawozdanie && (
        <SprawozdaniePodgladModal
          t={t}
          nazwa={adresNazwa}
          spr={dane.sprawozdanie.dane}
          onClose={() => setPodgladOpen(false)}
        />
      )}
    </>
  );
};
