import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  PodatkiPitImportResult,
  PodatkiPitPlikiResult,
  PodatkiPitPostep,
  PodpisCertyfikat,
  PodpisWybor,
} from '../../shared/types';
import {
  MIESIACE_SKROT,
  OPIS_ZARZADU,
  PIT_RODZAJE_NR_ID,
  PIT_TYTULY,
  PitDane,
  PitMiesiace,
  PitOsoba,
  PitPit4R,
  PitProblem,
  PitStan,
  PitTytul,
  PodatekPit,
  URZAD_DOMYSLNY,
  dataZPesela,
  dokumentId,
  dokumentyWiersza,
  kluczOsoby,
  kosztyZlecenia,
  limitKosztow,
  maBlad,
  nazwaOsoby,
  normalizeDanePit,
  obliczOsobe,
  obliczPit4R,
  osobyRoku,
  rdzenWspolnoty,
  pitWzor,
  poprzedniaOsoba,
  poprzedniePit4R,
  problemyOsoby,
  problemyPit4R,
  pusteDanePit,
  nazwaPlatnikaZAdresu,
  pustaOsoba,
  pustePit4R,
  stanDokumentu,
  sumyZaliczek,
  tozsamoscOsoby,
  zaliczkaArt13,
} from '../../shared/podatki-pit';
import { urzedyOpcje } from '../../shared/pit-urzedy';
import { foldText } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { tylkoCyfry } from '../../shared/podatki';
import { Language, translations } from '../translations';
import { PIT_TEXTS, PitT } from './podatkiPitTexts';
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
import SearchableSelect from '../components/SearchableSelect';
import { DomSlot, LiczbaInput, baseName } from './PodatkiNieruchomosci';
import './podatkiPit.css';

/* ================================== Helpers =================================== */

const zl0 = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`;
const zl2 = (n: number) => `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const sub = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

type Filtr = 'all' | 'errors' | 'ready' | 'waiting' | 'filed';
const FILTRY: Filtr[] = ['all', 'errors', 'ready', 'waiting', 'filed'];

interface Ocena {
  problemy: PitProblem[];
  stan: PitStan;
}

/** Everything the list needs to know about each document of a row, worked out once per render of the year. */
function ocenDokumenty(wiersz: PodatekPit): Map<string, Ocena> {
  const m = new Map<string, Ocena>();
  for (const o of wiersz.dane.osoby) {
    const problemy = problemyOsoby(o, wiersz.rok);
    m.set(dokumentId(wiersz.id, o.klucz), { problemy, stan: stanDokumentu(problemy, o.zlozone) });
  }
  if (wiersz.dane.pit4r) {
    const problemy = problemyPit4R(wiersz.dane, wiersz.rok);
    m.set(dokumentId(wiersz.id, null), { problemy, stan: stanDokumentu(problemy, wiersz.dane.pit4r.zlozone) });
  }
  return m;
}

const nazwaWiersza = (w: PodatekPit) => w.dane.nazwa || w.nip;

const sumaZaliczekWiersza = (w: PodatekPit) => sumyZaliczek(w.dane.osoby).razem;

/* ============================== Number / money input ============================== */

/** A money field with last year's value under it. */
const KwotaPole: React.FC<{
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  decimals?: number;
  prev?: { rok: number; wartosc: number | null } | null;
  hint?: string;
  t: PitT;
  required?: boolean;
}> = ({ id, label, value, onChange, decimals = 2, prev, hint, t, required }) => (
  <FormField
    label={label}
    htmlFor={id}
    required={required}
    hint={
      <>
        {hint && <span>{hint} </span>}
        {prev && (
          <span className="pit-prev" title={sub(t.prevYear, { rok: prev.rok, kwota: '' })}>
            {prev.wartosc === null
              ? sub(t.prevYearNone, { rok: prev.rok })
              : sub(t.prevYear, { rok: prev.rok, kwota: decimals === 0 ? zl0(prev.wartosc) : zl2(prev.wartosc) })}
          </span>
        )}
      </>
    }
  >
    <LiczbaInput id={id} value={value} onChange={onChange} decimals={decimals} unit="zł" />
  </FormField>
);

/* ================================== One person ================================== */

const TYTUL_ETYKIETA = (t: PitT, k: PitTytul) =>
  ({ zarzad: t.tytul_zarzad, zlecenie: t.tytul_zlecenie, etat: t.tytul_etat, art13: t.tytul_art13 })[k];

const maTytul = (o: PitOsoba, k: PitTytul) => o[k] !== null;

const OsobaForm: React.FC<{
  t: PitT;
  locale: string;
  rok: number;
  osoba: PitOsoba;
  /** The same person in the nearest earlier year, for the "last year" hints. */
  prev: { rok: number; osoba: PitOsoba } | null;
  ocena: Ocena | undefined;
  wInnych: number;
  saved: boolean;
  /** Folded on first show (and after "Zwiń wszystkie", which remounts the card). */
  zwinieta: boolean;
  onChange: (patch: Partial<PitOsoba>) => void;
  onRemove: () => void;
  onApply: () => void;
  onFiles: () => void;
  onSign: () => void;
  onFiled: (zlozone: boolean) => void;
}> = ({ t, locale, osoba: o, prev, ocena, wInnych, saved, zwinieta, onChange, onRemove, onApply, onFiles, onSign, onFiled }) => {
  const id = `pit-${o.klucz}`;
  const k = obliczOsobe(o);
  const kp = prev ? obliczOsobe(prev.osoba) : null;
  const prevHint = (wartosc: number | null | undefined) => (prev ? { rok: prev.rok, wartosc: wartosc ?? null } : null);
  const setTytul = (key: PitTytul, on: boolean) => {
    if (key === 'zarzad') onChange({ zarzad: on ? { opis: OPIS_ZARZADU, kwota: null } : null });
    if (key === 'zlecenie') onChange({ zlecenie: on ? { przychod: null, koszty: null, zaliczka: null } : null });
    if (key === 'etat') onChange({ etat: on ? { przychod: null, koszty: null, zaliczka: null } : null });
    if (key === 'art13') onChange({ art13: on ? { przychod: null, zaliczka: null } : null });
  };
  const adres = (key: keyof PitOsoba['adres'], value: string) => onChange({ adres: { ...o.adres, [key]: value } });
  const nazwa = nazwaOsoby(o) || t.newPerson;
  const bledy = (ocena?.problemy ?? []).filter((p) => p.poziom === 'blad');
  const uwagi = (ocena?.problemy ?? []).filter((p) => p.poziom === 'uwaga');
  const tytuly = PIT_TYTULY.filter((x) => maTytul(o, x)).map((x) => TYTUL_ETYKIETA(t, x));
  const dataPesel = o.pesel ? dataZPesela(o.pesel) : null;
  const zlecenieRegula = o.zlecenie?.przychod != null ? kosztyZlecenia(o.zlecenie.przychod, o.kosztyPodwyzszone) : null;
  const limit = limitKosztow(o.kosztyPodwyzszone);

  return (
    <FormSection
      icon="users"
      title={nazwa}
      description={tytuly.join(' · ') || undefined}
      badge={
        o.zlozone ? (
          <span className="pit-tone-ok" title={filedTitle(t, o.zlozone, locale)}>
            {t.filedDone}
          </span>
        ) : bledy.length > 0 ? (
          <span className="pit-tone-warn">{t.statusError}</span>
        ) : uwagi.length > 0 ? (
          <span className="pit-tone-info">{t.statusWarn}</span>
        ) : undefined
      }
      aside={
        <span className="pit-aside">
          {saved && (
            <>
              <button type="button" className="button button-small button-secondary" onClick={onFiles}>
                <Icon name="download" size={13} /> {t.docDownload}
              </button>
              <button type="button" className="button button-small button-secondary" onClick={onSign}>
                <Icon name="signature" size={13} /> {t.docSign}
              </button>
              {o.zlozone ? (
                <button type="button" className="button button-small button-ghost" onClick={() => onFiled(false)}>
                  {t.filedUndo}
                </button>
              ) : (
                <button type="button" className="button button-small button-ghost" onClick={() => onFiled(true)}>
                  <Icon name="check-circle" size={13} /> {t.filedMark}
                </button>
              )}
            </>
          )}
          <button type="button" className="button button-small button-ghost icon-danger" onClick={onRemove} title={t.personRemove}>
            <Icon name="trash" size={13} />
          </button>
        </span>
      }
      collapsible
      defaultCollapsed={zwinieta}
      collapsedSummary={tytuly.join(' · ') || t.newPerson}
    >
      {o.przeglad.length > 0 && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            <strong>{t.review}.</strong> {t.reviewDesc}
            <ul className="pod-problems">
              {o.przeglad.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <button type="button" className="button button-small button-secondary" onClick={() => onChange({ przeglad: [] })}>
              <Icon name="check" size={13} /> {t.reviewDone}
            </button>
          </div>
        </div>
      )}
      {bledy.filter((p) => !p.tekst.startsWith('Do przeglądu')).length > 0 && (
        <div className="callout callout--warning">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            {t.problemsTitle}
            <ul className="pod-problems">
              {bledy
                .filter((p) => !p.tekst.startsWith('Do przeglądu'))
                .map((p, i) => (
                  <li key={i}>{p.tekst}</li>
                ))}
            </ul>
          </div>
        </div>
      )}
      {uwagi.length > 0 && (
        <div className="callout">
          <Icon name="info" size={16} />
          <div className="callout__body">
            {t.warningsTitle}
            <ul className="pod-problems">
              {uwagi.map((p, i) => (
                <li key={i}>{p.tekst}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="pit-sub">{t.identitySec}</div>
      <FormRow>
        <FormField label={t.nazwisko} htmlFor={`${id}-nazwisko`} required>
          <input id={`${id}-nazwisko`} type="text" value={o.nazwisko} onChange={(e) => onChange({ nazwisko: e.target.value })} />
        </FormField>
        <FormField label={t.imie} htmlFor={`${id}-imie`} required>
          <input id={`${id}-imie`} type="text" value={o.imie} onChange={(e) => onChange({ imie: e.target.value })} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.pesel} htmlFor={`${id}-pesel`} hint={t.peselHint}>
          <input
            id={`${id}-pesel`}
            type="text"
            className="input-mono"
            inputMode="numeric"
            value={o.pesel}
            onChange={(e) => onChange({ pesel: tylkoCyfry(e.target.value).slice(0, 11) })}
          />
        </FormField>
        <FormField label={t.nipOsoby} htmlFor={`${id}-nip`}>
          <input
            id={`${id}-nip`}
            type="text"
            className="input-mono"
            inputMode="numeric"
            value={o.nip}
            onChange={(e) => onChange({ nip: tylkoCyfry(e.target.value).slice(0, 10) })}
          />
        </FormField>
        <FormField
          label={t.dataUr}
          htmlFor={`${id}-data`}
          action={
            dataPesel && dataPesel !== o.dataUrodzenia ? (
              <button type="button" className="button button-small button-ghost" onClick={() => onChange({ dataUrodzenia: dataPesel })}>
                {t.dataFromPesel}
              </button>
            ) : undefined
          }
        >
          <input
            id={`${id}-data`}
            type="date"
            value={o.dataUrodzenia ?? ''}
            onChange={(e) => onChange({ dataUrodzenia: e.target.value || null })}
          />
        </FormField>
      </FormRow>
      <FormField label={t.urzadOsoby} hint={t.urzadOsobyHint}>
        <SearchableSelect
          overlay
          value={o.urzad}
          placeholder={t.urzadPick}
          options={urzedyOpcje(false)}
          onChange={(v) => onChange({ urzad: v })}
          ariaLabel={t.urzadOsoby}
                  searchPlaceholder={t.pickSearch}
                  emptyText={t.pickEmpty}
        />
      </FormField>
      <details className="pit-details" open={o.nrId !== ''}>
        <summary>{t.foreign}</summary>
        <FormRow>
          <FormField label={t.nrId} htmlFor={`${id}-nrid`}>
            <input id={`${id}-nrid`} type="text" value={o.nrId} onChange={(e) => onChange({ nrId: e.target.value })} />
          </FormField>
          <FormField label={t.rodzajNrId}>
            <Select
              overlay
              value={o.rodzajNrId === null ? '' : String(o.rodzajNrId)}
              options={[{ value: '', label: '—' }, ...PIT_RODZAJE_NR_ID.map((r) => ({ value: String(r.id), label: `${r.id} — ${r.opis}` }))]}
              onChange={(v) => onChange({ rodzajNrId: v === '' ? null : Number(v) })}
              ariaLabel={t.rodzajNrId}
            />
          </FormField>
          <FormField label={t.krajWydania} htmlFor={`${id}-kraj`}>
            <input
              id={`${id}-kraj`}
              type="text"
              className="input-mono"
              maxLength={2}
              value={o.krajWydania}
              onChange={(e) => onChange({ krajWydania: e.target.value.toUpperCase() })}
            />
          </FormField>
        </FormRow>
      </details>

      <div className="pit-sub">{t.addressSec}</div>
      <FormRow>
        <FormField label={t.ulica} htmlFor={`${id}-ulica`}>
          <input id={`${id}-ulica`} type="text" value={o.adres.ulica} onChange={(e) => adres('ulica', e.target.value)} />
        </FormField>
        <FormField label={t.nrDomu} htmlFor={`${id}-dom`}>
          <input id={`${id}-dom`} type="text" value={o.adres.nrDomu} onChange={(e) => adres('nrDomu', e.target.value)} />
        </FormField>
        <FormField label={t.nrLokalu} htmlFor={`${id}-lok`}>
          <input id={`${id}-lok`} type="text" value={o.adres.nrLokalu} onChange={(e) => adres('nrLokalu', e.target.value)} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.miejscowosc} htmlFor={`${id}-msc`}>
          <input id={`${id}-msc`} type="text" value={o.adres.miejscowosc} onChange={(e) => adres('miejscowosc', e.target.value)} />
        </FormField>
        <FormField label={t.kod} htmlFor={`${id}-kod`}>
          <input
            id={`${id}-kod`}
            type="text"
            className="input-mono"
            value={o.adres.kodPocztowy}
            onChange={(e) => adres('kodPocztowy', e.target.value)}
          />
        </FormField>
      </FormRow>
      {wInnych > 0 && (
        <div className="pit-apply">
          <button type="button" className="button button-small button-ghost" onClick={onApply} title={sub(t.applyHint, { n: wInnych })}>
            <Icon name="copy" size={13} /> {t.apply}
          </button>
        </div>
      )}

      <div className="pit-sub">{t.titlesSec}</div>
      <p className="pod-note">{t.titlesDesc}</p>
      <div className="pit-tytuly" role="group" aria-label={t.titlesSec}>
        {PIT_TYTULY.map((key) => (
          <label key={key} className={`pit-tytul${maTytul(o, key) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={maTytul(o, key)} onChange={(e) => setTytul(key, e.target.checked)} />
            <span>{TYTUL_ETYKIETA(t, key)}</span>
          </label>
        ))}
      </div>

      {o.zarzad && (
        <div className="pit-title-block">
          <FormRow>
            <FormField label={t.zarzadOpis} htmlFor={`${id}-zopis`}>
              <input
                id={`${id}-zopis`}
                type="text"
                value={o.zarzad.opis}
                onChange={(e) => onChange({ zarzad: { ...o.zarzad!, opis: e.target.value } })}
              />
            </FormField>
            <KwotaPole
              t={t}
              id={`${id}-zkwota`}
              label={t.zarzadKwota}
              required
              value={o.zarzad.kwota}
              onChange={(v) => onChange({ zarzad: { ...o.zarzad!, kwota: v } })}
              prev={prevHint(kp?.zarzad)}
            />
          </FormRow>
        </div>
      )}

      {o.zlecenie && (
        <div className="pit-title-block">
          <div className="pit-title-block__name">{t.tytul_zlecenie}</div>
          <FormRow>
            <KwotaPole
              t={t}
              id={`${id}-zl-przychod`}
              label={t.przychod}
              required
              value={o.zlecenie.przychod}
              onChange={(v) => onChange({ zlecenie: { ...o.zlecenie!, przychod: v } })}
              prev={prevHint(kp?.zlecenie?.przychod)}
            />
            <KwotaPole
              t={t}
              id={`${id}-zl-koszty`}
              label={t.koszty}
              value={o.zlecenie.koszty}
              onChange={(v) => onChange({ zlecenie: { ...o.zlecenie!, koszty: v } })}
              hint={zlecenieRegula !== null ? sub(t.kosztyHint, { kwota: zl2(zlecenieRegula), limit }) : undefined}
            />
            <KwotaPole
              t={t}
              id={`${id}-zl-zaliczka`}
              label={t.zaliczka}
              required
              decimals={0}
              value={o.zlecenie.zaliczka}
              onChange={(v) => onChange({ zlecenie: { ...o.zlecenie!, zaliczka: v === null ? null : Math.round(v) } })}
              hint={t.zaliczkaHintPayroll}
              prev={prevHint(kp?.zlecenie?.zaliczka)}
            />
          </FormRow>
          {k.zlecenie && <p className="pod-note">{sub(t.dochodLine, { koszty: zl2(k.zlecenie.koszty), dochod: zl2(k.zlecenie.dochod) })}</p>}
        </div>
      )}

      {o.etat && (
        <div className="pit-title-block">
          <div className="pit-title-block__name">{t.tytul_etat}</div>
          <FormRow>
            <KwotaPole
              t={t}
              id={`${id}-et-przychod`}
              label={t.przychod}
              required
              value={o.etat.przychod}
              onChange={(v) => onChange({ etat: { ...o.etat!, przychod: v } })}
              prev={prevHint(kp?.etat?.przychod)}
            />
            <KwotaPole
              t={t}
              id={`${id}-et-koszty`}
              label={t.koszty}
              value={o.etat.koszty}
              onChange={(v) => onChange({ etat: { ...o.etat!, koszty: v } })}
              hint={sub(t.kosztyHintEtat, { limit })}
            />
            <KwotaPole
              t={t}
              id={`${id}-et-zaliczka`}
              label={t.zaliczka}
              required
              decimals={0}
              value={o.etat.zaliczka}
              onChange={(v) => onChange({ etat: { ...o.etat!, zaliczka: v === null ? null : Math.round(v) } })}
              hint={t.zaliczkaHintPayroll}
              prev={prevHint(kp?.etat?.zaliczka)}
            />
          </FormRow>
          {k.etat && <p className="pod-note">{sub(t.dochodLine, { koszty: zl2(k.etat.koszty), dochod: zl2(k.etat.dochod) })}</p>}
        </div>
      )}

      {o.art13 && (
        <div className="pit-title-block">
          <div className="pit-title-block__name">{t.tytul_art13}</div>
          <FormRow>
            <KwotaPole
              t={t}
              id={`${id}-a13-przychod`}
              label={t.przychod}
              required
              value={o.art13.przychod}
              onChange={(v) => onChange({ art13: { ...o.art13!, przychod: v } })}
              prev={prevHint(kp?.art13?.przychod)}
            />
            <KwotaPole
              t={t}
              id={`${id}-a13-zaliczka`}
              label={t.zaliczka}
              decimals={0}
              value={o.art13.zaliczka}
              onChange={(v) => onChange({ art13: { ...o.art13!, zaliczka: v === null ? null : Math.round(v) } })}
              hint={k.art13 ? sub(t.zaliczkaHintArt13, { kwota: zaliczkaArt13(k.art13.dochod) }) : undefined}
              prev={prevHint(kp?.art13?.zaliczka)}
            />
          </FormRow>
          {k.art13 && <p className="pod-note">{sub(t.dochodLine, { koszty: zl2(k.art13.koszty), dochod: zl2(k.art13.dochod) })}</p>}
        </div>
      )}

      {(o.zlecenie || o.etat) && (
        <div className="pit-title-block">
          <FormRow>
            <KwotaPole
              t={t}
              id={`${id}-skladki`}
              label={t.skladki}
              value={o.skladki}
              onChange={(v) => onChange({ skladki: v })}
              prev={prevHint(kp?.skladki)}
            />
            <KwotaPole
              t={t}
              id={`${id}-zdrowotna`}
              label={t.zdrowotna}
              value={o.zdrowotna}
              onChange={(v) => onChange({ zdrowotna: v })}
              prev={prevHint(kp?.zdrowotna)}
            />
          </FormRow>
          <label className="pit-check">
            <input type="checkbox" checked={o.kosztyPodwyzszone} onChange={(e) => onChange({ kosztyPodwyzszone: e.target.checked })} />
            <span>{t.podwyzszone}</span>
          </label>
        </div>
      )}

      <div className="pit-sub">{t.correctionSec}</div>
      <FormRow>
        <FormField label={t.cel}>
          <div className="zad-seg" role="radiogroup" aria-label={t.cel}>
            {([1, 2] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={o.cel === c}
                className={`zad-seg__btn${o.cel === c ? ' is-active' : ''}`}
                onClick={() => onChange({ cel: c })}
              >
                {c === 1 ? t.cel1 : t.cel2}
              </button>
            ))}
          </div>
        </FormField>
      </FormRow>
      {o.cel === 2 && (
        <FormField label={t.przyczyna} htmlFor={`${id}-przyczyna`} hint={t.przyczynaHint} required>
          <textarea
            id={`${id}-przyczyna`}
            rows={2}
            maxLength={1000}
            value={o.przyczyna}
            onChange={(e) => onChange({ przyczyna: e.target.value })}
          />
        </FormField>
      )}
      <FormField label={t.uwagi} htmlFor={`${id}-uwagi`}>
        <input id={`${id}-uwagi`} type="text" value={o.uwagi} onChange={(e) => onChange({ uwagi: e.target.value })} />
      </FormField>
      {o.pobrania.length > 0 && (
        <div className="pod-pdf-history">
          <span className="pod-pdf-history__title">{t.historyTitle}</span>
          <ul>
            {[...o.pobrania]
              .reverse()
              .slice(0, 3)
              .map((p, i) => (
                <li key={i} title={p.plik}>
                  {sub(t.historyItem, { when: formatStamp(p.at, locale), who: p.by || '—', plik: p.plik })}
                </li>
              ))}
          </ul>
        </div>
      )}
    </FormSection>
  );
};

const filedTitle = (t: PitT, z: { at: string; by: string; numerRef: string }, locale: string) =>
  sub(t.filedBy, {
    when: formatStamp(z.at, locale),
    who: z.by || '—',
    ref: z.numerRef ? sub(t.filedRef, { ref: z.numerRef }) : '',
  });

/* ================================== PIT-4R grid ================================== */

const Pit4RForm: React.FC<{
  t: PitT;
  locale: string;
  rok: number;
  dane: PitDane;
  prev: { rok: number; pit4r: PitPit4R } | null;
  saved: boolean;
  zlozone: boolean;
  onChange: (p: PitPit4R | null) => void;
  onFiles: () => void;
  onSign: () => void;
  onFiled: (zlozone: boolean) => void;
}> = ({ t, locale, dane, prev, saved, onChange, onFiles, onSign, onFiled }) => {
  const p = dane.pit4r;
  const sumy = sumyZaliczek(dane.osoby);
  const k = p ? obliczPit4R(p) : null;
  const kPrev = prev ? obliczPit4R(prev.pit4r) : null;
  const wiersze: { key: 'etatLiczba' | 'etatKwota' | 'art41' | 'inne'; label: string; liczba: boolean }[] = [
    { key: 'etatLiczba', label: t.pit4rRowEtatLiczba, liczba: true },
    { key: 'etatKwota', label: t.pit4rRowEtatKwota, liczba: false },
    { key: 'art41', label: t.pit4rRowArt41, liczba: false },
    { key: 'inne', label: t.pit4rRowInne, liczba: false },
  ];
  const ustaw = (key: 'etatLiczba' | 'etatKwota' | 'art41' | 'inne', mies: number, v: number | null) => {
    if (!p) return;
    const nowe: PitMiesiace = [...p[key]];
    nowe[mies] = v === null ? null : Math.round(v);
    onChange({ ...p, [key]: nowe });
  };
  const razem = (a: PitMiesiace) => a.reduce<number>((s, v) => s + (v ?? 0), 0);
  const roznicaEtat = k ? k.rokEtat - sumy.etat : 0;
  const roznicaArt41 = k ? k.rokArt41 - sumy.art41 : 0;
  const [miesiacWstaw, setMiesiacWstaw] = useState('');

  return (
    <FormSection
      icon="table"
      title={t.pit4rSec}
      description={t.pit4rDesc}
      badge={
        p?.zlozone ? (
          <span className="pit-tone-ok" title={filedTitle(t, p.zlozone, locale)}>
            {t.filedDone}
          </span>
        ) : undefined
      }
      aside={
        <span className="pit-aside">
          {p && saved && (
            <>
              <button type="button" className="button button-small button-secondary" onClick={onFiles}>
                <Icon name="download" size={13} /> {t.docDownload}
              </button>
              <button type="button" className="button button-small button-secondary" onClick={onSign}>
                <Icon name="signature" size={13} /> {t.docSign}
              </button>
              {p.zlozone ? (
                <button type="button" className="button button-small button-ghost" onClick={() => onFiled(false)}>
                  {t.filedUndo}
                </button>
              ) : (
                <button type="button" className="button button-small button-ghost" onClick={() => onFiled(true)}>
                  <Icon name="check-circle" size={13} /> {t.filedMark}
                </button>
              )}
            </>
          )}
          {p ? (
            <button type="button" className="button button-small button-ghost icon-danger" onClick={() => onChange(null)}>
              <Icon name="trash" size={13} /> {t.pit4rRemove}
            </button>
          ) : (
            <button type="button" className="button button-small button-secondary" onClick={() => onChange(pustePit4R())}>
              <Icon name="plus" size={13} /> {t.pit4rAdd}
            </button>
          )}
        </span>
      }
      collapsible
      persistKey="podatki-pit-pit4r"
      collapsedSummary={p && k ? sub(t.rowPit4r, { kwota: zl0(k.rokSuma) }) : t.pit4rNone}
    >
      {!p || !k ? (
        <p className="pod-note">{t.pit4rNone}</p>
      ) : (
        <>
          {p.przeglad.length > 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                <strong>{t.review}.</strong> {t.reviewDesc}
                <ul className="pod-problems">
                  {p.przeglad.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <button type="button" className="button button-small button-secondary" onClick={() => onChange({ ...p, przeglad: [] })}>
                  <Icon name="check" size={13} /> {t.reviewDone}
                </button>
              </div>
            </div>
          )}
          <div className="pit-mies-wrap">
            <table className="pit-mies">
              <thead>
                <tr>
                  <th />
                  {MIESIACE_SKROT.map((m) => (
                    <th key={m}>{m}</th>
                  ))}
                  <th>{t.pit4rTotal}</th>
                </tr>
              </thead>
              <tbody>
                {wiersze.map((w) => (
                  <tr key={w.key}>
                    <th scope="row">{w.label}</th>
                    {p[w.key].map((v, i) => (
                      <td key={i}>
                        <LiczbaInput
                          value={v}
                          onChange={(x) => ustaw(w.key, i, x)}
                          decimals={0}
                          ariaLabel={`${w.label} ${MIESIACE_SKROT[i]}`}
                        />
                      </td>
                    ))}
                    <td className="pit-mies__sum">{w.liczba ? '' : zl0(razem(p[w.key]))}</td>
                  </tr>
                ))}
                <tr className="pit-mies__calc">
                  <th scope="row">{t.pit4rRowSuma}</th>
                  {k.suma.map((v, i) => (
                    <td key={i}>{v === 0 ? '' : v.toLocaleString('pl-PL')}</td>
                  ))}
                  <td className="pit-mies__sum">{zl0(k.rokSuma)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {prev && kPrev && <p className="pod-note">{sub(t.pit4rPrev, { rok: prev.rok, kwota: zl0(kPrev.rokSuma) })}</p>}

          <div className="pit-check-box">
            <strong>{t.pit4rCheckTitle}</strong>
            {roznicaEtat === 0 && roznicaArt41 === 0 ? (
              <p className="pit-ok">
                <Icon name="check-circle" size={14} /> {t.pit4rCheckOk}
              </p>
            ) : (
              <ul className="pod-problems">
                {roznicaEtat !== 0 && <li>{sub(t.pit4rCheckEtat, { pit4r: k.rokEtat, pit11: sumy.etat })}</li>}
                {roznicaArt41 !== 0 && <li>{sub(t.pit4rCheckArt41, { pit4r: k.rokArt41, pit11: sumy.art41 })}</li>}
              </ul>
            )}
            <div className="pit-fill">
              <Select
                overlay
                value={miesiacWstaw}
                placeholder={t.pit4rFillMonth}
                options={MIESIACE_SKROT.map((m, i) => ({ value: String(i), label: m }))}
                onChange={setMiesiacWstaw}
                ariaLabel={t.pit4rFill}
              />
              <button
                type="button"
                className="button button-small button-secondary"
                disabled={miesiacWstaw === ''}
                onClick={() => {
                  const i = Number(miesiacWstaw);
                  const nowe: PitPit4R = { ...p, art41: [...p.art41], etatKwota: [...p.etatKwota] };
                  nowe.art41[i] = sumy.art41;
                  nowe.etatKwota[i] = sumy.etat;
                  onChange(nowe);
                }}
              >
                {t.pit4rFill}
              </button>
            </div>
          </div>

          <div className="pit-sub">{t.correctionSec}</div>
          <FormRow>
            <FormField label={t.cel}>
              <div className="zad-seg" role="radiogroup" aria-label={t.cel}>
                {([1, 2] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={p.cel === c}
                    className={`zad-seg__btn${p.cel === c ? ' is-active' : ''}`}
                    onClick={() => onChange({ ...p, cel: c })}
                  >
                    {c === 1 ? t.cel1 : t.cel2}
                  </button>
                ))}
              </div>
            </FormField>
          </FormRow>
          {p.cel === 2 && (
            <FormField label={t.przyczyna} htmlFor="pit4r-przyczyna" hint={t.przyczynaHint} required>
              <textarea
                id="pit4r-przyczyna"
                rows={2}
                maxLength={1000}
                value={p.przyczyna}
                onChange={(e) => onChange({ ...p, przyczyna: e.target.value })}
              />
            </FormField>
          )}
          {p.pobrania.length > 0 && (
            <div className="pod-pdf-history">
              <span className="pod-pdf-history__title">{t.historyTitle}</span>
              <ul>
                {[...p.pobrania]
                  .reverse()
                  .slice(0, 3)
                  .map((x, i) => (
                    <li key={i} title={x.plik}>
                      {sub(t.historyItem, { when: formatStamp(x.at, locale), who: x.by || '—', plik: x.plik })}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </FormSection>
  );
};

/* ================================= One community ================================= */

const migawka = (nip: string, d: PitDane) =>
  JSON.stringify({
    nip,
    d: {
      ...d,
      osoby: d.osoby.map((o) => ({ ...o, zlozone: null, pobrania: [] })),
      pit4r: d.pit4r ? { ...d.pit4r, zlozone: null, pobrania: [] } : null,
    },
  });

/** A community of the Adresy list — the app's register of communities. */
interface Rejestr {
  /** The address's name ("Gotarda 8"). */
  nazwa: string;
  /** The payer's name as the forms print it. */
  platnik: string;
  /** Folded names (its own and the alternative ones) that tell it apart from the PIT rows' names. */
  rdzenie: string[];
  /** The NIP the community's PIT rows of other years carry; '' when it has none yet. */
  nip: string;
  /** The community's tax office code kept in Adresy; '' when none is set. */
  kodUrzedu: string;
}

const maPitRoku = (r: Rejestr, wiersze: PodatekPit[]) => wiersze.some((w) => r.rdzenie.includes(rdzenWspolnoty(w.dane.nazwa)));

const WspolnotaScreen: React.FC<{
  language: Language;
  t: PitT;
  locale: string;
  rok: number;
  rekord: PodatekPit | null;
  wszystkie: PodatekPit[];
  rejestr: Rejestr[];
  /** A community picked from the list's "no PIT yet" section — the new screen starts with it. */
  wstepnie: Rejestr | null;
  onBack: () => void;
  onSaved: (rek: PodatekPit) => void;
  onDeleted: () => void;
  onChangedElsewhere: () => void;
  onFiles: (ids: string[]) => void;
  onSign: (ids: string[]) => void;
  onFiled: (ids: string[], zlozone: boolean) => void;
}> = ({ language, t, locale, rok, rekord, wszystkie, rejestr, wstepnie, onBack, onSaved, onDeleted, onChangedElsewhere, onFiles, onSign, onFiled }) => {
  const notify = useNotify();
  const tMain = translations[language];
  const [nip, setNip] = useState(rekord?.nip ?? wstepnie?.nip ?? '');
  const [dane, setDane] = useState<PitDane>(
    rekord?.dane ?? { ...pusteDanePit(), nazwa: wstepnie?.platnik ?? '', urzadPlatnika: wstepnie?.kodUrzedu || URZAD_DOMYSLNY },
  );
  const [baseline, setBaseline] = useState(() => (rekord ? migawka(rekord.nip, rekord.dane) : ''));
  const [busy, setBusy] = useState<null | 'save' | 'delete' | 'apply'>(null);
  const [pickOsoba, setPickOsoba] = useState('');
  /** People start folded; "Rozwiń / Zwiń wszystkie" bumps `wersja`, which remounts the cards in the new state. */
  const [zwin, setZwin] = useState<{ wersja: number; wszystkie: boolean }>({ wersja: 0, wszystkie: true });
  /** People added on this screen start open — somebody is about to fill them in. */
  const noweKlucze = useRef<Set<string>>(new Set());

  const dirty = migawka(nip, dane) !== baseline;
  const canAdd = nip.length === 10 && dane.nazwa.trim() !== '';
  const wiersz: PodatekPit | null = rekord ? { ...rekord, nip, dane } : null;
  const oceny = useMemo(() => (wiersz ? ocenDokumenty(wiersz) : new Map<string, Ocena>()), [wiersz?.id, nip, dane, rok]);
  const prev4r = wiersz ? poprzedniePit4R(wszystkie, wiersz) : null;
  const innych = osobyRoku(wszystkie, rok, rekord?.id);
  const jestWTejWspolnocie = new Set(dane.osoby.map(kluczOsoby));
  const doWyboru = innych.filter((o) => !jestWTejWspolnocie.has(kluczOsoby(o)));
  const wzor = pitWzor(rok);

  const setOsoba = (klucz: string, patch: Partial<PitOsoba>) =>
    setDane((d) => ({ ...d, osoby: d.osoby.map((o) => (o.klucz === klucz ? { ...o, ...patch } : o)) }));

  const dodajOsobe = (z?: PitOsoba) => {
    const nowa = z ? { ...pustaOsoba(), ...tozsamoscOsoby(z) } : { ...pustaOsoba(), urzad: URZAD_DOMYSLNY, adres: { ...pustaOsoba().adres, miejscowosc: 'Warszawa' } };
    noweKlucze.current.add(nowa.klucz);
    setDane((d) => ({ ...d, osoby: [...d.osoby, nowa] }));
  };
  const back = async () => {
    if (dirty && !(await notify.confirm(t.unsavedConfirm, { danger: true, confirmLabel: t.unsavedDiscard }))) return;
    onBack();
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = rekord
        ? await window.electronAPI.setPodatekPit(rekord.id, nip, dane)
        : await window.electronAPI.addPodatekPit(nip, rok, dane);
      setNip(saved.nip);
      setDane(saved.dane);
      setBaseline(migawka(saved.nip, saved.dane));
      notify.success(t.saved);
      onSaved(saved);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.saveError);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!rekord) return;
    if (
      !(await notify.confirm(sub(t.deleteConfirm, { name: dane.nazwa || rekord.nip, rok }), {
        danger: true,
        confirmLabel: t.delete,
      }))
    ) {
      return;
    }
    setBusy('delete');
    try {
      await window.electronAPI.deletePodatekPit(rekord.id);
      notify.success(t.deleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  /** One person's identity copied into the same person of the year's other communities — one save each. */
  const zastosuj = async (osoba: PitOsoba) => {
    setBusy('apply');
    try {
      const klucz = kluczOsoby(osoba);
      let n = 0;
      for (const w of wszystkie.filter((x) => x.rok === rok && x.id !== rekord?.id)) {
        if (!w.dane.osoby.some((o) => kluczOsoby(o) === klucz)) continue;
        await window.electronAPI.setPodatekPit(
          w.id,
          w.nip,
          normalizeDanePit({
            ...w.dane,
            osoby: w.dane.osoby.map((o) => (kluczOsoby(o) === klucz ? { ...o, ...tozsamoscOsoby(osoba) } : o)),
          }),
        );
        n += 1;
      }
      notify.success(sub(t.applied, { n }));
      onChangedElsewhere();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.applyError);
    } finally {
      setBusy(null);
    }
  };

  const wInnych = (o: PitOsoba) =>
    wszystkie.filter((w) => w.rok === rok && w.id !== rekord?.id && w.dane.osoby.some((x) => kluczOsoby(x) === kluczOsoby(o))).length;

  const wszystkieDokumenty = wiersz ? dokumentyWiersza(wiersz).map((d) => d.id) : [];
  const note =
    !rekord && !canAdd ? (
      <span className="action-note">
        <Icon name="info" size={13} /> {t.newNeeds}
      </span>
    ) : dirty ? (
      <span className="action-note action-note--warning">
        <Icon name="alert-triangle" size={13} /> {t.unsaved}
      </span>
    ) : (
      <span className="action-note">
        <Icon name="check" size={13} /> {t.allSaved}
      </span>
    );
  const zablokowane = dirty || !rekord ? t.saveFirst : null;

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.back}
            crumb={`PIT · ${rok}`}
            onBack={() => void back()}
            title={dane.nazwa || t.new}
            meta={
              <>
                <span>
                  <Icon name="calendar" size={13} /> {sub(t.metaYear, { rok })}
                </span>
                {nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {sub(t.rowNip, { nip })}
                  </span>
                )}
                <span>
                  <Icon name="users" size={13} /> {sub(t.rowPeople, { n: dane.osoby.length })}
                </span>
              </>
            }
          />
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
                onClick={() => onFiles(wszystkieDokumenty)}
                disabled={zablokowane !== null || busy !== null}
                title={zablokowane ?? undefined}
              >
                <Icon name="download" size={13} /> {t.downloadAll}
              </button>
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => onSign(wszystkieDokumenty)}
                disabled={zablokowane !== null || busy !== null}
                title={zablokowane ?? undefined}
              >
                <Icon name="signature" size={13} /> {sub(t.batchSign, { n: wszystkieDokumenty.length })}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="content-body">
        <div className="page-form">
          {!wzor && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-circle" size={16} />
              <div className="callout__body">{sub(t.formMissing, { rok })}</div>
            </div>
          )}

          <FormSection icon="landmark" title={t.platnikTitle} description={t.platnikDesc}>
            {!rekord && rejestr.length > 0 && (
              <FormField label={t.platnikPick}>
                <SearchableSelect
                  overlay
                  value=""
                  placeholder={t.platnikPickPlaceholder}
                  options={rejestr
                    .filter((r) => !maPitRoku(r, wszystkie.filter((w) => w.rok === rok)))
                    .map((r) => ({ value: r.nazwa, label: r.nazwa }))}
                  onChange={(v) => {
                    const r = rejestr.find((x) => x.nazwa === v);
                    if (!r) return;
                    if (r.nip) setNip(r.nip);
                    setDane((d) => ({ ...d, nazwa: r.platnik, urzadPlatnika: r.kodUrzedu || d.urzadPlatnika }));
                  }}
                  ariaLabel={t.platnikPick}
                  searchPlaceholder={t.pickSearch}
                  emptyText={t.pickEmpty}
                />
              </FormField>
            )}
            <FormRow>
              <FormField label={t.nip} htmlFor="pit-nip" required>
                <input
                  id="pit-nip"
                  type="text"
                  className="input-mono"
                  inputMode="numeric"
                  value={nip}
                  disabled={!!rekord}
                  onChange={(e) => setNip(tylkoCyfry(e.target.value).slice(0, 10))}
                />
              </FormField>
              <FormField label={t.nazwa} htmlFor="pit-nazwa" required hint={t.nazwaHint}>
                <input id="pit-nazwa" type="text" value={dane.nazwa} onChange={(e) => setDane((d) => ({ ...d, nazwa: e.target.value }))} />
              </FormField>
            </FormRow>
            <FormField label={t.urzadPlatnika}>
              <SearchableSelect
                overlay
                value={dane.urzadPlatnika}
                options={urzedyOpcje(true)}
                onChange={(v) => setDane((d) => ({ ...d, urzadPlatnika: v }))}
                ariaLabel={t.urzadPlatnika}
                  searchPlaceholder={t.pickSearch}
                  emptyText={t.pickEmpty}
              />
            </FormField>
          </FormSection>

          <FormSection
            icon="users"
            title={t.osobyTitle}
            description={t.osobyDesc}
            aside={
              <span className="pit-aside">
                {doWyboru.length > 0 && (
                  <SearchableSelect
                    overlay
                    value={pickOsoba}
                    placeholder={t.addPersonFromPlaceholder}
                    options={doWyboru.map((o) => ({ value: kluczOsoby(o), label: nazwaOsoby(o) }))}
                    onChange={(v) => {
                      const o = doWyboru.find((x) => kluczOsoby(x) === v);
                      setPickOsoba('');
                      if (o) dodajOsobe(o);
                    }}
                    ariaLabel={t.addPersonFrom}
                  searchPlaceholder={t.pickSearch}
                  emptyText={t.pickEmpty}
                  />
                )}
                {dane.osoby.length > 1 && (
                  <>
                    <button type="button" className="button button-small button-ghost" onClick={() => setZwin((z) => ({ wersja: z.wersja + 1, wszystkie: false }))}>
                      <Icon name="chevron-down" size={13} /> {t.expandAll}
                    </button>
                    <button type="button" className="button button-small button-ghost" onClick={() => {
                        noweKlucze.current.clear();
                        setZwin((z) => ({ wersja: z.wersja + 1, wszystkie: true }));
                      }}>
                      <Icon name="chevron-right" size={13} /> {t.collapseAll}
                    </button>
                  </>
                )}
                <button type="button" className="button button-small button-secondary" onClick={() => dodajOsobe()}>
                  <Icon name="plus" size={13} /> {t.addPerson}
                </button>
              </span>
            }
          >
            {dane.osoby.length === 0 && <p className="pod-note">{t.noPeople}</p>}
          </FormSection>

          {[...dane.osoby]
            .sort((a, b) => nazwaOsoby(a).localeCompare(nazwaOsoby(b), 'pl'))
            .map((o) => {
              const id = rekord ? dokumentId(rekord.id, o.klucz) : '';
              return (
                <OsobaForm
                  key={`${o.klucz}-${zwin.wersja}`}
                  t={t}
                  locale={locale}
                  rok={rok}
                  osoba={o}
                  prev={wiersz ? poprzedniaOsoba(wszystkie, wiersz, o) : null}
                  ocena={oceny.get(id)}
                  wInnych={wInnych(o)}
                  saved={!!rekord && !dirty}
                  zwinieta={zwin.wszystkie && !noweKlucze.current.has(o.klucz)}
                  onChange={(patch) => setOsoba(o.klucz, patch)}
                  onRemove={async () => {
                    if (await notify.confirm(sub(t.personRemoveConfirm, { name: nazwaOsoby(o) || t.newPerson }), { danger: true, confirmLabel: t.delete })) {
                      setDane((d) => ({ ...d, osoby: d.osoby.filter((x) => x.klucz !== o.klucz) }));
                    }
                  }}
                  onApply={() => void zastosuj(o)}
                  onFiles={() => onFiles([id])}
                  onSign={() => onSign([id])}
                  onFiled={(z) => onFiled([id], z)}
                />
              );
            })}

          <Pit4RForm
            t={t}
            locale={locale}
            rok={rok}
            dane={dane}
            prev={prev4r}
            saved={!!rekord && !dirty}
            zlozone={!!dane.pit4r?.zlozone}
            onChange={(p) => setDane((d) => ({ ...d, pit4r: p }))}
            onFiles={() => rekord && onFiles([dokumentId(rekord.id, null)])}
            onSign={() => rekord && onSign([dokumentId(rekord.id, null)])}
            onFiled={(z) => rekord && onFiled([dokumentId(rekord.id, null)], z)}
          />

          <ModalFooter
            className="page-action-bar"
            note={note}
            onSubmit={() => void save()}
            submitLabel={rekord ? t.save : t.add}
            submitIcon={rekord ? 'save' : 'plus'}
            submitDisabled={!dirty || (!rekord && !canAdd)}
            submitTitle={!rekord && !canAdd ? t.newNeeds : undefined}
            busy={busy === 'save'}
          />
        </div>
      </div>
      {busy === 'apply' && <BusyOverlay label={tMain.loading} />}
    </>
  );
};

/* ================================ Result window ================================ */

const Licznik: React.FC<{ value: number; label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = ({ value, label, tone }) => (
  <div className={`podpis-sum__stat is-${value > 0 ? tone : 'neutral'}`}>
    <span className="podpis-sum__stat-value">{value}</span>
    <span className="podpis-sum__stat-label">{label}</span>
  </div>
);

/** After "Pobierz" or "Podpisz": what was written — each file one click from opening — and what was held back and why. */
const Podsumowanie: React.FC<{
  t: PitT;
  tMain: ReturnType<typeof useTMain>;
  rok: number;
  podpisano: boolean;
  wynik: PodatkiPitPlikiResult;
  onZaznacz: (ids: string[]) => void;
  onClose: () => void;
}> = ({ t, tMain, rok, podpisano, wynik, onZaznacz, onClose }) => {
  const notify = useNotify();
  const { folder, zapisane, pominiete, niepodpisane, przerwano, podpis } = wynik;
  const reszta = [...pominiete, ...niepodpisane].map((x) => x.id);
  const otworz = async (sciezka: string) => {
    if (!(await window.electronAPI.openFile(sciezka))) notify.error(t.sumFileMissing);
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={tMain.close} />
        <ModalHeader
          icon={zapisane.length > 0 && reszta.length === 0 ? 'check-circle' : 'alert-triangle'}
          tone={zapisane.length === 0 ? 'danger' : 'accent'}
          title={podpisano ? t.sumSigned : t.sumFiles}
          subtitle={podpisano && podpis ? sub(t.sumSignedSub, { rok, kto: podpis.podmiot }) : sub(t.sumFilesSub, { rok })}
        />
        <div className="modal-body modal-body--sectioned">
          <div className="podpis-sum__stats">
            <Licznik value={zapisane.length} label={t.sumSaved} tone="success" />
            <Licznik value={pominiete.length} label={t.sumSkipped} tone="warning" />
            {podpisano && <Licznik value={niepodpisane.length} label={t.sumUnsigned} tone="danger" />}
          </div>
          {zapisane.length === 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-circle" size={16} />
              <div className="callout__body">{t.sumNothing}</div>
            </div>
          )}
          {przerwano && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{sub(t.sumStopped, { reason: przerwano })}</div>
            </div>
          )}
          {zapisane.length > 0 && (
            <FormSection icon={podpisano ? 'signature' : 'download'} title={sub(t.sumSavedList, { n: zapisane.length })}>
              {folder && <div className="podpis-sum__folder">{sub(t.sumFolder, { folder })}</div>}
              <ul className="podpis-sum__list">
                {zapisane.slice(0, 60).map((p, i) => (
                  <li key={`${p.id}${i}`}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <button type="button" className="podpis-sum__file" onClick={() => void otworz(p.sciezka)}>
                      <Icon name="file-text" size={13} /> {baseName(p.sciezka)}
                    </button>
                  </li>
                ))}
                {zapisane.length > 60 && <li className="podpis-sum__name">{sub(t.signMore, { n: zapisane.length - 60 })}</li>}
              </ul>
            </FormSection>
          )}
          {pominiete.length > 0 && (
            <FormSection icon="alert-triangle" title={sub(t.sumSkippedList, { n: pominiete.length })}>
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
            <FormSection icon="clock" title={sub(t.sumUnsignedList, { n: niepodpisane.length })}>
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
          cancelLabel={tMain.close}
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
                <Icon name="check-circle" size={14} /> {sub(t.sumSelectRest, { n: reszta.length })}
              </button>
            ) : undefined
          }
          onSubmit={folder ? () => void otworz(folder) : undefined}
          submitLabel={t.sumOpenFolder}
          submitIcon="folder"
          autoFocus={folder ? 'submit' : 'cancel'}
        />
      </div>
    </div>
  );
};

const useTMain = (language: Language) => translations[language];

/** "Oznacz jako złożone": the gateway's reference number, one for the whole selection (or none). */
const ZlozoneModal: React.FC<{ t: PitT; tMain: ReturnType<typeof useTMain>; n: number; onSubmit: (ref: string) => void; onClose: () => void }> = ({
  t,
  tMain,
  n,
  onSubmit,
  onClose,
}) => {
  const [ref, setRef] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={tMain.close} />
        <ModalHeader icon="check-circle" tone="accent" title={t.filedTitle} subtitle={sub(t.filedSubtitle, { n })} />
        <div className="modal-body">
          <p className="pod-note">{t.filedDesc}</p>
          <FormField label={t.filedRefLabel} htmlFor="pit-ref" hint={t.filedRefHint}>
            <input id="pit-ref" type="text" className="input-mono" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />
          </FormField>
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={tMain.close} onSubmit={() => onSubmit(ref.trim())} submitLabel={t.filedSubmit} submitIcon="check" />
      </div>
    </div>
  );
};

/** "Zasil z XML": the year of the files to load, then the folder is picked. */
const ZasilModal: React.FC<{ t: PitT; tMain: ReturnType<typeof useTMain>; rok: number; onSubmit: (zRoku: number) => void; onClose: () => void }> = ({
  t,
  tMain,
  rok,
  onSubmit,
  onClose,
}) => {
  const [zRoku, setZRoku] = useState(String(Math.min(rok, 2024)));
  const wartosc = Number(zRoku);
  const ok = Number.isInteger(wartosc) && wartosc >= 2024 && wartosc <= rok;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={tMain.close} />
        <ModalHeader icon="upload" tone="accent" title={sub(t.seedTitle, { rok })} />
        <div className="modal-body">
          <p className="pod-note">{sub(t.seedDesc, { rok })}</p>
          <FormField label={t.seedYear} htmlFor="pit-seed-rok">
            <input id="pit-seed-rok" type="text" inputMode="numeric" className="input-mono" value={zRoku} onChange={(e) => setZRoku(tylkoCyfry(e.target.value).slice(0, 4))} />
          </FormField>
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={tMain.close}
          onSubmit={() => onSubmit(wartosc)}
          submitLabel={t.seedSubmit}
          submitIcon="upload"
          submitDisabled={!ok}
        />
      </div>
    </div>
  );
};

/* ================================== The tab ================================== */

const domyslnyRok = (lata: number[]) => (lata.length > 0 ? Math.max(...lata) : new Date().getFullYear());

const PodatkiPit: React.FC<{ language: Language }> = ({ language }) => {
  const t = PIT_TEXTS[language];
  const tMain = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [lista, setLista] = useState<PodatekPit[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  /** The community picked in the "no PIT yet" section, carried into the new-community screen. */
  const [nowaZ, setNowaZ] = useState<Rejestr | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<null | 'import' | 'carry' | 'files' | 'excel' | 'filed'>(null);
  const [rokWybrany, setRokWybrany] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filtr, setFiltr] = useState<Filtr>('all');
  const [rozwiniete, setRozwiniete] = useState<Set<number>>(new Set());
  const navItem = useNavItem();
  const detail: number | 'nowy' | null =
    navItem.item === 'nowy' ? 'nowy' : navItem.item && /^\d+$/.test(navItem.item) ? Number(navItem.item) : null;
  const openDetail = (w: PodatekPit, nazwa: string) => navItem.open(String(w.id), nazwa);
  /** Ticked documents by id (`dokumentId`) — what the batch bar acts on. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [podpisIds, setPodpisIds] = useState<string[] | null>(null);
  const [pdfPodpisany, setPdfPodpisany] = useState(false);
  const [postep, setPostep] = useState<PodatkiPitPostep | null>(null);
  const [podsumowanie, setPodsumowanie] = useState<{ rok: number; podpisano: boolean; wynik: PodatkiPitPlikiResult } | null>(null);
  const [zlozoneIds, setZlozoneIds] = useState<string[] | null>(null);
  const [zasilOtwarte, setZasilOtwarte] = useState(false);
  const lastTickedRef = useRef<string | null>(null);
  useEffect(() => window.electronAPI.onPodatkiPitPostep(setPostep), []);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [rows, adr] = await Promise.all([window.electronAPI.getPodatkiPit(), window.electronAPI.getAdresy().catch(() => [])]);
      setLista(rows);
      setAdresy(adr);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.loadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The register of communities is the Adresy list; a NIP is borrowed from the community's PIT rows of other years. */
  const rejestr = useMemo<Rejestr[]>(
    () =>
      adresy
        .map((a) => {
          const rdzenie = [a.nazwa, ...(a.alternativeNames ?? [])].map(rdzenWspolnoty).filter((x) => x !== '');
          return {
            nazwa: a.nazwa,
            platnik: nazwaPlatnikaZAdresu(a.nazwa),
            rdzenie,
            nip: lista.find((w) => rdzenie.includes(rdzenWspolnoty(w.dane.nazwa)))?.nip ?? '',
            kodUrzedu: a.identyfikacja?.kodUrzedu ?? '',
          };
        })
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true })),
    [adresy, lista],
  );

  const lataZDanymi = useMemo(() => [...new Set(lista.map((r) => r.rok))], [lista]);
  const rok = rokWybrany ?? domyslnyRok(lataZDanymi);
  const lata = useMemo(() => {
    const nastepny = (lataZDanymi.length > 0 ? Math.max(...lataZDanymi) : new Date().getFullYear()) + 1;
    return [...new Set<number>([...lataZDanymi, nastepny, rok])].sort((a, b) => b - a);
  }, [lataZDanymi, rok]);

  const wRoku = useMemo(() => lista.filter((r) => r.rok === rok), [lista, rok]);
  /** The nearest earlier year that has data — "last year" may be several years back (2024 → 2026). */
  const rokPoprzedni = useMemo(() => {
    const wczesniejsze = lataZDanymi.filter((r) => r < rok);
    return wczesniejsze.length > 0 ? Math.max(...wczesniejsze) : null;
  }, [lataZDanymi, rok]);
  const brakujace = useMemo(() => {
    if (rokPoprzedni === null) return [];
    const nips = new Set(wRoku.map((r) => r.nip));
    return lista.filter((r) => r.rok === rokPoprzedni && !nips.has(r.nip));
  }, [lista, wRoku, rokPoprzedni]);
  const wzor = pitWzor(rok);
  /** Communities of the Adresy list that have no PIT in the year on screen. */
  const bezPit = useMemo(() => rejestr.filter((r) => !maPitRoku(r, wRoku)), [rejestr, wRoku]);

  const oceny = useMemo(() => {
    const m = new Map<string, Ocena>();
    for (const w of wRoku) for (const [k, v] of ocenDokumenty(w)) m.set(k, v);
    return m;
  }, [wRoku]);

  const dokumentyRoku = useMemo(() => wRoku.flatMap((w) => dokumentyWiersza(w).map((d) => d.id)), [wRoku]);

  const stanWiersza = (w: PodatekPit): { blad: boolean; wszystkoZlozone: boolean; doPrzegladu: boolean; wszystkieGotowe: boolean } => {
    const dok = dokumentyWiersza(w);
    const o = dok.map((d) => oceny.get(d.id));
    return {
      blad: o.some((x) => x?.stan === 'blad'),
      wszystkoZlozone: dok.length > 0 && o.every((x) => x?.stan === 'zlozone'),
      doPrzegladu: w.dane.osoby.some((x) => x.przeglad.length > 0) || (w.dane.pit4r?.przeglad.length ?? 0) > 0,
      wszystkieGotowe: o.every((x) => x?.stan !== 'blad'),
    };
  };

  const wFiltrze = (w: PodatekPit, f: Filtr): boolean => {
    const s = stanWiersza(w);
    switch (f) {
      case 'all':
        return true;
      case 'errors':
        return s.blad;
      case 'ready':
        return !s.blad && !s.wszystkoZlozone;
      case 'waiting':
        return !s.wszystkoZlozone;
      case 'filed':
        return s.wszystkoZlozone;
    }
  };

  const liczniki = useMemo(() => {
    const c: Record<Filtr, number> = { all: 0, errors: 0, ready: 0, waiting: 0, filed: 0 };
    for (const w of wRoku) for (const f of FILTRY) if (wFiltrze(w, f)) c[f] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wRoku, oceny]);

  const visible = useMemo(() => {
    const query = foldText(search.trim());
    const digits = query.replace(/\D/g, '');
    return wRoku
      .filter((w) => wFiltrze(w, filtr))
      .filter(
        (w) =>
          !query ||
          foldText(nazwaWiersza(w)).includes(query) ||
          (digits !== '' && w.nip.includes(digits)) ||
          w.dane.osoby.some((o) => foldText(nazwaOsoby(o)).includes(query)),
      )
      .sort((a, b) => nazwaWiersza(a).localeCompare(nazwaWiersza(b), 'pl', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wRoku, search, filtr, oceny]);

  /* ----------------------------- Ticking documents ----------------------------- */

  const widoczneDokumenty = useMemo(() => visible.flatMap((w) => dokumentyWiersza(w).map((d) => d.id)), [visible]);
  // Ticks belong to the year on screen: a tick in another year would be acted on unseen.
  const zaznaczone = dokumentyRoku.filter((id) => selected.has(id));
  const wszystkieZaznaczone = widoczneDokumenty.length > 0 && widoczneDokumenty.every((id) => selected.has(id));
  const czesciowo = widoczneDokumenty.some((id) => selected.has(id)) && !wszystkieZaznaczone;

  const toggle = (ids: string[], range = false, kotwica?: string) => {
    const turnOn = !ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      let cel = ids;
      if (range && kotwica && lastTickedRef.current) {
        const od = widoczneDokumenty.indexOf(lastTickedRef.current);
        const doo = widoczneDokumenty.indexOf(kotwica);
        if (od >= 0 && doo >= 0) cel = widoczneDokumenty.slice(Math.min(od, doo), Math.max(od, doo) + 1);
      }
      for (const id of cel) {
        if (turnOn) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastTickedRef.current = kotwica ?? ids[0] ?? null;
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of widoczneDokumenty) {
        if (wszystkieZaznaczone) next.delete(id);
        else next.add(id);
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

  const ileWspolnot = (n: number) => plural(n, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities']);
  const ileWspolnotBiernik = (n: number) => plural(n, language, ['wspólnotę', 'wspólnoty', 'wspólnot'], ['community', 'communities']);
  const ileDokumentow = (n: number) => plural(n, language, ['dokument', 'dokumenty', 'dokumentów'], ['document', 'documents']);

  /* --------------------------------- Actions ---------------------------------- */

  const importXml = async () => {
    setBusy('import');
    try {
      const wynik: PodatkiPitImportResult | null = await window.electronAPI.importPitXml(rok);
      if (!wynik) return;
      const { folder, dodane, istniejace, osoby, plikow, doPrzegladu, pominiete } = wynik;
      if (dodane === 0) {
        notify.info(sub(t.importedNothing, { folder, n: ileWspolnot(istniejace) }));
      } else {
        notify.success(
          [
            sub(t.imported, { folder, n: ileWspolnotBiernik(dodane), osoby: `${osoby} PIT-11`, pliki: `${plikow} plików` }),
            doPrzegladu > 0 ? sub(t.importedReview, { n: doPrzegladu }) : '',
            pominiete.length > 0 ? sub(t.importedSkipped, { n: pominiete.length }) : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
      setRokWybrany(rok);
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.importError);
    } finally {
      setBusy(null);
    }
  };

  const carry = async () => {
    if (rokPoprzedni === null) return;
    setBusy('carry');
    try {
      const n = await window.electronAPI.przeniesPitNaRok(rokPoprzedni, rok);
      notify.success(sub(t.carried, { rok, n: ileWspolnotBiernik(n) }));
      setRokWybrany(rok);
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.carryError);
    } finally {
      setBusy(null);
    }
  };

  /** Loads the XML files as `zRoku` (a folder is picked), then carries the whole year over to the one on screen. */
  const zasil = async (zRoku: number) => {
    setZasilOtwarte(false);
    setBusy('import');
    try {
      const wynik = await window.electronAPI.importPitXml(zRoku);
      if (!wynik) return;
      if (zRoku !== rok) await window.electronAPI.przeniesPitNaRok(zRoku, rok);
      notify.success(sub(t.seedDone, { zrok: zRoku, rok, n: ileWspolnotBiernik(wynik.dodane + wynik.istniejace) }));
      if (wynik.doPrzegladu > 0) notify.warning(sub(t.importedReview, { n: wynik.doPrzegladu }));
      setRokWybrany(rok);
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.seedError);
    } finally {
      setBusy(null);
    }
  };

  const excelSzablon = async () => {
    setBusy('excel');
    try {
      const r = await window.electronAPI.pitExcelSzablon(rok);
      if (r) notify.success(sub(t.excelSaved, { file: baseName(r.filePath) }), { file: r.filePath });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.excelTemplateError);
    } finally {
      setBusy(null);
    }
  };

  const excelWczytaj = async () => {
    setBusy('excel');
    try {
      const r = await window.electronAPI.pitExcelWczytaj(rok);
      if (!r) return;
      const czesci = [
        r.zmienione > 0 ? sub(t.excelRead_ok, { file: r.plikNazwa, n: r.zmienione }) : sub(t.excelRead_none, { file: r.plikNazwa }),
        r.pominiete.length > 0 ? sub(t.excelRead_skipped, { n: r.pominiete.length }) : '',
        r.ostrzezenia.length > 0 ? sub(t.excelRead_warn, { list: r.ostrzezenia.slice(0, 3).join('; ') }) : '',
      ].filter(Boolean);
      const tekst = czesci.join(' ');
      if (r.pominiete.length > 0 || r.ostrzezenia.length > 0) notify.warning(tekst);
      else notify.success(tekst);
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.excelReadError);
    } finally {
      setBusy(null);
    }
  };

  /** Writes the XML and / or PDF of documents; the result window says what was held back and why. */
  const pliki = async (ids: string[], tryb: 'xml' | 'pdf' | 'oba' = 'oba') => {
    if (ids.length === 0) return;
    setBusy('files');
    try {
      const wynik = await window.electronAPI.pitPliki(rok, ids, tryb);
      setPodsumowanie({ rok, podpisano: false, wynik });
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.filesError);
    } finally {
      setBusy(null);
    }
  };

  const podpiszWiele = async (wybor: PodpisWybor) => {
    if (!podpisIds) return;
    setPostep(null);
    const wynik = await window.electronAPI.podpiszPit(rok, podpisIds, wybor, { pdfPodpisany });
    setPodpisIds(null);
    setPostep(null);
    setPodsumowanie({ rok, podpisano: true, wynik });
    if (wynik.zapisane.length > 0) setSelected(new Set());
    await load(true);
  };

  const ustawZlozone = async (ids: string[], zlozone: boolean, numerRef: string) => {
    setBusy('filed');
    try {
      const rows = await window.electronAPI.setPitZlozone(ids, zlozone, numerRef);
      const poId = new Map(rows.map((r) => [r.id, r]));
      setLista((prev) => prev.map((r) => poId.get(r.id) ?? r));
      notify.success(sub(zlozone ? t.filedMarked : t.filedUnmarked, { n: ids.length }));
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.filedError);
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  const zadajZlozone = (ids: string[], zlozone: boolean) => {
    if (zlozone) setZlozoneIds(ids);
    else void ustawZlozone(ids, false, '');
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={tMain.loading} />
      </div>
    );
  }

  /** The community open on its own screen; one that is gone by now shows the list. */
  const otwarty = typeof detail === 'number' ? lista.find((r) => r.id === detail) ?? null : null;

  const okna = (
    <>
      {podpisIds && (
        <PodpisKartaModal
          language={language}
          title={t.signTitle}
          subtitle={sub(t.signSubtitle, { rok, n: ileDokumentow(podpisIds.length) })}
          extra={(_cert: PodpisCertyfikat | null) => {
            const wiersze = new Map(lista.filter((w) => w.rok === rok).map((w) => [w.id, w]));
            const braki: string[] = [];
            let gotowe = 0;
            for (const id of podpisIds) {
              const o = oceny.get(id);
              if (o && !maBlad(o.problemy)) gotowe += 1;
              else {
                const wiersz = wiersze.get(Number(id.split(':')[0]));
                const osoba = wiersz?.dane.osoby.find((x) => dokumentId(wiersz.id, x.klucz) === id);
                braki.push(
                  `${wiersz ? nazwaWiersza(wiersz) : id}${osoba ? ` — ${nazwaOsoby(osoba)}` : ' — PIT-4R'}: ${(o?.problemy ?? [])
                    .filter((p) => p.poziom === 'blad')
                    .map((p) => p.tekst)
                    .join(' ')}`,
                );
              }
            }
            return (
              <FormSection icon="file-check" title={sub(t.signReady, { n: gotowe })} description={t.signXmlNote}>
                {gotowe === 0 && (
                  <div className="callout callout--danger" role="alert">
                    <Icon name="alert-circle" size={16} />
                    <div className="callout__body">{t.signNothing}</div>
                  </div>
                )}
                {braki.length > 0 && (
                  <div className="callout callout--warning">
                    <Icon name="alert-triangle" size={16} />
                    <div className="callout__body">
                      {sub(t.signSkipped, { n: braki.length })}
                      <ul className="podpis-gotowosc__list">
                        {(braki.length <= 6 ? braki : [...braki.slice(0, 5), sub(t.signMore, { n: braki.length - 5 })]).map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <label className="pit-check">
                  <input type="checkbox" checked={pdfPodpisany} onChange={(e) => setPdfPodpisany(e.target.checked)} />
                  <span>
                    {t.signPdfOption}
                    <small> — {t.signPdfOptionHint}</small>
                  </span>
                </label>
              </FormSection>
            );
          }}
          submitLabel={sub(t.signSubmit, {
            n: ileDokumentow(podpisIds.filter((id) => oceny.has(id) && !maBlad(oceny.get(id)!.problemy)).length),
          })}
          submitDisabled={podpisIds.every((id) => !oceny.has(id) || maBlad(oceny.get(id)!.problemy))}
          pinHint={sub(t.signPinHint, { n: ileDokumentow(podpisIds.length) })}
          postep={postep}
          onPrzerwij={() => void window.electronAPI.przerwijPodpisPit()}
          onPodpisz={podpiszWiele}
          onClose={() => setPodpisIds(null)}
        />
      )}
      {zasilOtwarte && <ZasilModal t={t} tMain={tMain} rok={rok} onSubmit={(z) => void zasil(z)} onClose={() => setZasilOtwarte(false)} />}
      {zlozoneIds && (
        <ZlozoneModal
          t={t}
          tMain={tMain}
          n={zlozoneIds.length}
          onClose={() => setZlozoneIds(null)}
          onSubmit={(ref) => {
            const ids = zlozoneIds;
            setZlozoneIds(null);
            void ustawZlozone(ids, true, ref);
          }}
        />
      )}
      {podsumowanie && (
        <Podsumowanie
          t={t}
          tMain={tMain}
          rok={podsumowanie.rok}
          podpisano={podsumowanie.podpisano}
          wynik={podsumowanie.wynik}
          onZaznacz={(ids) => {
            setSelected(new Set(ids));
            lastTickedRef.current = null;
          }}
          onClose={() => setPodsumowanie(null)}
        />
      )}
      {busy === 'import' && <BusyOverlay label={t.importing} />}
      {busy === 'files' && <BusyOverlay label={t.downloadingAll} />}
      {busy === 'excel' && <BusyOverlay label={t.excelReading} />}
    </>
  );

  if (detail === 'nowy' || otwarty) {
    return (
      <>
        <WspolnotaScreen
          key={detail}
          language={language}
          t={t}
          locale={locale}
          rok={otwarty?.rok ?? rok}
          rekord={otwarty}
          wszystkie={lista}
          rejestr={rejestr}
          wstepnie={nowaZ}
          onBack={() => navItem.close()}
          onSaved={(saved) => {
            setLista((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
            navItem.replace(String(saved.id), saved.dane.nazwa || saved.nip);
          }}
          onDeleted={() => {
            navItem.close();
            void load(true);
          }}
          onChangedElsewhere={() => void load(true)}
          onFiles={(ids) => void pliki(ids)}
          onSign={(ids) => setPodpisIds(ids)}
          onFiled={zadajZlozone}
        />
        {okna}
      </>
    );
  }

  /* ------------------------------------ List ------------------------------------ */

  const renderDokument = (w: PodatekPit, dok: { id: string; osoba: PitOsoba | null }) => {
    const o = oceny.get(dok.id);
    const stan: PitStan = o?.stan ?? 'gotowe';
    const zlozone = dok.osoba ? dok.osoba.zlozone : w.dane.pit4r?.zlozone ?? null;
    const k = dok.osoba ? obliczOsobe(dok.osoba) : null;
    const k4 = !dok.osoba && w.dane.pit4r ? obliczPit4R(w.dane.pit4r) : null;
    const korekta = dok.osoba ? dok.osoba.cel === 2 : w.dane.pit4r?.cel === 2;
    const doPrzegladu = dok.osoba ? dok.osoba.przeglad.length > 0 : (w.dane.pit4r?.przeglad.length ?? 0) > 0;
    const zaliczki = k ? (k.etat?.zaliczka ?? 0) + (k.art13?.zaliczka ?? 0) + (k.zlecenie?.zaliczka ?? 0) : (k4?.rokSuma ?? 0);
    const przychod = k ? (k.zarzad ?? 0) + (k.etat?.przychod ?? 0) + (k.art13?.przychod ?? 0) + (k.zlecenie?.przychod ?? 0) : null;
    const tytuly = dok.osoba ? PIT_TYTULY.filter((x) => maTytul(dok.osoba!, x)).map((x) => TYTUL_ETYKIETA(t, x)) : [];
    const isSelected = selected.has(dok.id);
    return (
      <li key={dok.id} className={`pit-doc${isSelected ? ' is-selected' : ''} pit-doc--${stan}`}>
        <span className="ksieg-row__select">
          <label
            className={`ks-check${isSelected ? ' is-on' : ''}`}
            title={t.selectFor}
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
          >
            <input
              type="checkbox"
              className="ks-check__input"
              checked={isSelected}
              onChange={(e) => toggle([dok.id], (e.nativeEvent as MouseEvent).shiftKey === true, dok.id)}
              aria-label={`${t.selectFor}: ${dok.osoba ? nazwaOsoby(dok.osoba) : 'PIT-4R'}`}
            />
            <span className="ks-check__box" aria-hidden="true">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
          </label>
        </span>
        <div
          className="pit-doc__main"
          role="button"
          tabIndex={0}
          onClick={() => openDetail(w, nazwaWiersza(w))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openDetail(w, nazwaWiersza(w));
            }
          }}
        >
          <span className="pit-doc__kind">{dok.osoba ? t.docPit11 : t.docPit4r}</span>
          <span className="pit-doc__name">{dok.osoba ? nazwaOsoby(dok.osoba) || t.newPerson : sub(t.rowPit4r, { kwota: zl0(zaliczki) })}</span>
          <span className="pit-doc__meta">
            {tytuly.join(' · ')}
            {przychod !== null && przychod > 0 && <> · {zl2(przychod)}</>}
            {dok.osoba && zaliczki > 0 && <> · {t.rowAdvances} {zl0(zaliczki)}</>}
            {korekta && <> · {t.docCorrection}</>}
            {doPrzegladu && (
              <span className="pod-meta-warning">
                {' '}
                · <Icon name="alert-triangle" size={12} /> {t.rowReview}
              </span>
            )}
          </span>
        </div>
        <span
          className={`status-badge ${stan === 'blad' ? 'status-pending' : stan === 'uwagi' ? 'status-info' : 'status-neutral'}`}
          title={(o?.problemy ?? []).map((p) => p.tekst).join('\n') || undefined}
          hidden={stan === 'zlozone'}
        >
          {stan === 'blad' ? t.statusError : stan === 'uwagi' ? t.statusWarn : t.statusReady}
        </span>
        <div className="pod-row__dom">
          <DomSlot
            t={tMain}
            locale={locale}
            dom={zlozone ? { at: zlozone.at, by: zlozone.by } : null}
            busy={busy === 'filed'}
            onSet={(z) => zadajZlozone([dok.id], z)}
            labels={{
              done: t.filedDone,
              mark: t.filedMark,
              undo: t.filedUndo,
              doneBy: zlozone ? filedTitle(t, zlozone, locale) : '',
            }}
          />
        </div>
      </li>
    );
  };

  const renderWiersz = (w: PodatekPit) => {
    const s = stanWiersza(w);
    const dok = dokumentyWiersza(w);
    const idy = dok.map((d) => d.id);
    const wszystkie = idy.every((id) => selected.has(id));
    const czesc = !wszystkie && idy.some((id) => selected.has(id));
    const rozw = rozwiniete.has(w.id);
    const nazwa = nazwaWiersza(w);
    const sumaZal = sumaZaliczekWiersza(w);
    const k4 = w.dane.pit4r ? obliczPit4R(w.dane.pit4r) : null;
    const stanKlasa = s.blad ? 'braki' : s.wszystkoZlozone ? 'zlozone' : 'gotowa';
    const zlozoneN = dok.filter((d) => oceny.get(d.id)?.stan === 'zlozone').length;
    return (
      <li key={w.id} className="pit-wsp">
        <div className="pod-item">
          <span className="ksieg-row__select">
            <label className={`ks-check${wszystkie ? ' is-on' : ''}${czesc ? ' is-mixed' : ''}`} title={t.selectFor}>
              <input
                type="checkbox"
                className="ks-check__input"
                checked={wszystkie}
                ref={(el) => {
                  if (el) el.indeterminate = czesc;
                }}
                onChange={() => toggle(idy)}
                aria-label={`${t.selectFor}: ${nazwa}`}
              />
              <span className="ks-check__box" aria-hidden="true">
                <Icon name={czesc ? 'minus' : 'check'} size={12} strokeWidth={3} />
              </span>
            </label>
          </span>
          <div className={`zeb-row pod-row pod-row--${stanKlasa}${wszystkie ? ' is-selected' : ''}`}>
            <div
              className="pod-row__open"
              role="button"
              tabIndex={0}
              onClick={() => openDetail(w, nazwa)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openDetail(w, nazwa);
                }
              }}
            >
              <div className="zeb-date pod-kwota" title={t.rowAdvances}>
                <span className="pod-kwota__label">{t.rowAdvances}</span>
                <span className={`pod-kwota__value${sumaZal >= 100000 ? ' is-s' : sumaZal >= 10000 ? ' is-m' : ''}`}>
                  {Math.round(sumaZal).toLocaleString('pl-PL').replace(/\s/g, ' ')}
                  <span className="pod-kwota__unit">zł</span>
                </span>
              </div>
              <div className="zeb-row__main">
                <span className="zeb-row__name">{nazwa}</span>
                <span className="zeb-row__meta">
                  <span>
                    <Icon name="file-text" size={13} /> {sub(t.rowNip, { nip: w.nip })}
                  </span>
                  <span>
                    <Icon name="users" size={13} /> {sub(t.rowPeople, { n: w.dane.osoby.length })}
                  </span>
                  <span>
                    <Icon name="table" size={13} /> {k4 ? sub(t.rowPit4r, { kwota: zl0(k4.rokSuma) }) : t.rowNoPit4r}
                  </span>
                  {s.doPrzegladu && (
                    <span className="pod-meta-warning">
                      <Icon name="alert-triangle" size={13} /> {t.rowReview}
                    </span>
                  )}
                </span>
              </div>
              <div className="zeb-row__side">
                <span className={`status-badge ${s.blad ? 'status-pending' : s.wszystkoZlozone ? 'status-success' : 'status-neutral'}`}>
                  {s.blad ? t.statusError : s.wszystkoZlozone ? t.filedDone : `${zlozoneN}/${dok.length} ${t.filterFiled.toLowerCase()}`}
                </span>
              </div>
            </div>
            <div className="pod-row__dom">
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() =>
                  setRozwiniete((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.id)) next.delete(w.id);
                    else next.add(w.id);
                    return next;
                  })
                }
                title={rozw ? t.rowCollapse : t.rowExpand}
                aria-expanded={rozw}
              >
                <Icon name={rozw ? 'chevron-down' : 'chevron-right'} size={14} /> {sub(t.rowDocsButton, { n: dok.length })}
              </button>
            </div>
          </div>
        </div>
        {rozw && <ul className="pit-docs">{dok.map((d) => renderDokument(w, { id: d.id, osoba: d.klucz ? w.dane.osoby.find((o) => o.klucz === d.klucz) ?? null : null }))}</ul>}
      </li>
    );
  };

  const filtrEtykieta: Record<Filtr, string> = {
    all: t.filterAll,
    errors: t.filterErrors,
    ready: t.filterReady,
    waiting: t.filterWaiting,
    filed: t.filterFiled,
  };
  const minRok = Math.min(...lata);
  const maxRok = Math.max(...lata);
  const zaliczkiRazem = wRoku.reduce((s, w) => s + sumaZaliczekWiersza(w), 0);
  const osoby = wRoku.reduce((n, w) => n + w.dane.osoby.length, 0);
  const doPrzegladu = wRoku.filter((w) => stanWiersza(w).doPrzegladu).length;
  const dokZlozone = dokumentyRoku.filter((id) => oceny.get(id)?.stan === 'zlozone').length;
  const procent = dokumentyRoku.length > 0 ? Math.round((dokZlozone / dokumentyRoku.length) * 100) : 0;
  const fakty =
    wRoku.length === 0
      ? [t.heroEmpty]
      : [
          sub(t.heroCount, { n: wRoku.length }),
          sub(t.heroPeople, { n: osoby }),
          sub(t.heroAdvances, { kwota: zl0(zaliczkiRazem) }),
          ...(doPrzegladu > 0 ? [sub(t.heroReview, { n: doPrzegladu })] : []),
        ];
  const zaznaczoneZlozone = zaznaczone.filter((id) => oceny.get(id)?.stan === 'zlozone');
  const zaznaczoneNiezlozone = zaznaczone.filter((id) => oceny.get(id)?.stan !== 'zlozone');

  return (
    <div className="content-body">
      <header className="ksieg-hero pod-hero">
        <div className="ksieg-hero__art">
          <span className="pod-hero__art" aria-hidden="true">
            <Icon name="briefcase" size={40} />
          </span>
        </div>
        <div className="ksieg-hero__id">
          <span className="ksieg-hero__eyebrow">
            <Icon name="briefcase" size={13} /> {t.title}
          </span>
          <h1 className="ksieg-hero__month">
            {rok}
            <span>{t.heroYear}</span>
          </h1>
          <p className="ksieg-hero__facts">{fakty.join(' · ')}</p>
        </div>
        <div className="ksieg-hero__nav">
          <button type="button" className="ksieg-nav-arrow" onClick={() => zmienRok(rok - 1)} disabled={rok <= minRok} title={t.yearPrev} aria-label={t.yearPrev}>
            <Icon name="chevron-left" size={17} />
          </button>
          <Select
            overlay
            value={String(rok)}
            options={lata.map((r) => ({ value: String(r), label: lataZDanymi.includes(r) ? String(r) : sub(t.yearNew, { rok: r }) }))}
            onChange={(v) => zmienRok(Number(v))}
            ariaLabel={t.year}
            className="ksieg-nav-select"
          />
          <button type="button" className="ksieg-nav-arrow" onClick={() => zmienRok(rok + 1)} disabled={rok >= maxRok} title={t.yearNext} aria-label={t.yearNext}>
            <Icon name="chevron-right" size={17} />
          </button>
          <button
            type="button"
            className="ksieg-scan-btn"
            onClick={() => void pliki(dokumentyRoku)}
            disabled={busy !== null || wRoku.length === 0}
            title={sub(t.downloadAllHint, { rok })}
          >
            <Icon name={busy === 'files' ? 'loader' : 'download'} size={15} />
            <span>{t.downloadAll}</span>
          </button>
          <button type="button" className="ksieg-nav-arrow" onClick={() => void load(true)} disabled={isRefreshing} title={t.refresh} aria-label={t.refresh}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
        {wRoku.length > 0 && (
          <div className="ksieg-hero__progress">
            <div className="ksieg-progress__head">
              <span className="ksieg-progress__label">{t.filterFiled}</span>
              <span className="ksieg-progress__value">
                {sub(t.heroFiled, { done: dokZlozone, total: dokumentyRoku.length })}
                <strong>{procent}%</strong>
              </span>
            </div>
            <div className="ksieg-progress__track">
              <div className="ksieg-progress__fill" style={{ width: `${procent}%` }} />
            </div>
          </div>
        )}
      </header>

      <div className="zeb-toolbar">
        <div className="ksieg-search">
          <Icon name="search" size={15} />
          <input type="text" placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim() && (
            <button type="button" onClick={() => setSearch('')} title={tMain.close} aria-label={tMain.close}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        {wRoku.length > 0 && (
          <div className="zad-seg" role="group" aria-label={t.filterLabel}>
            {FILTRY.map((f) => (
              <button
                key={f}
                type="button"
                className={`zad-seg__btn${filtr === f ? ' is-active' : ''}${liczniki[f] === 0 ? ' is-empty' : ''}`}
                aria-pressed={filtr === f}
                onClick={() => setFiltr(f)}
              >
                {filtrEtykieta[f]}
                <span className="zad-seg__count">{liczniki[f]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pod-toolbar-end">
          <button type="button" className="button button-secondary" onClick={() => void importXml()} disabled={busy !== null} title={t.importXmlHint}>
            <Icon name={busy === 'import' ? 'loader' : 'upload'} size={14} /> {t.importXml}
          </button>
          <button type="button" className="button button-secondary" onClick={() => void excelSzablon()} disabled={busy !== null || wRoku.length === 0} title={t.excelTemplateHint}>
            <Icon name="table" size={14} /> {t.excelTemplate}
          </button>
          <button type="button" className="button button-secondary" onClick={() => void excelWczytaj()} disabled={busy !== null || wRoku.length === 0} title={t.excelReadHint}>
            <Icon name="upload" size={14} /> {t.excelRead}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setNowaZ(null);
              navItem.open('nowy', t.new);
            }}
          >
            <Icon name="plus" size={14} /> {t.add}
          </button>
        </div>
      </div>

      <div className="page-form pod-list-page">
        {!wzor && (
          <div className="callout callout--danger" role="alert">
            <Icon name="alert-circle" size={16} />
            <div className="callout__body">{sub(t.formMissing, { rok })}</div>
          </div>
        )}

        {wRoku.length === 0 ? (
          <div className="zeb-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="briefcase" size={22} />
            </span>
            <strong>{sub(t.emptyTitle, { rok })}</strong>
            {rokPoprzedni !== null ? (
              <>
                <p>{sub(t.emptyCarry, { prev: rokPoprzedni, rok })}</p>
                <button type="button" className="button button-primary" onClick={() => void carry()} disabled={busy !== null}>
                  <Icon name={busy === 'carry' ? 'loader' : 'copy'} size={14} /> {sub(t.emptyCarryBtn, { prev: rokPoprzedni })}
                </button>
              </>
            ) : (
              <>
                <p>{t.emptyText}</p>
                <button type="button" className="button button-primary" onClick={() => setZasilOtwarte(true)} disabled={busy !== null}>
                  <Icon name={busy === 'import' ? 'loader' : 'upload'} size={14} /> {sub(t.seedBtn, { rok })}
                </button>
                <button type="button" className="button button-secondary" onClick={() => void importXml()} disabled={busy !== null}>
                  <Icon name="upload" size={14} /> {t.importXml}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {brakujace.length > 0 && rokPoprzedni !== null && (
              <div className="callout">
                <Icon name="info" size={16} />
                <div className="callout__body">{sub(t.carryMissing, { prev: rokPoprzedni, n: ileWspolnot(brakujace.length), rok })}</div>
                <button type="button" className="button button-small button-secondary" onClick={() => void carry()} disabled={busy !== null}>
                  <Icon name={busy === 'carry' ? 'loader' : 'copy'} size={13} /> {t.carryMissingBtn}
                </button>
              </div>
            )}
            {visible.length === 0 ? (
              <div className="zeb-nomatch">
                <Icon name="search" size={18} /> {t.noMatch}
              </div>
            ) : (
              <>
                <div className="ksieg-selall pod-selall">
                  <span className="ksieg-row__select">
                    <label className={`ks-check${wszystkieZaznaczone ? ' is-on' : ''}${czesciowo ? ' is-mixed' : ''}`}>
                      <input
                        type="checkbox"
                        className="ks-check__input"
                        checked={wszystkieZaznaczone}
                        ref={(el) => {
                          if (el) el.indeterminate = czesciowo;
                        }}
                        onChange={toggleAllVisible}
                        aria-label={tMain.ksSelectAll}
                      />
                      <span className="ks-check__box" aria-hidden="true">
                        <Icon name={czesciowo ? 'minus' : 'check'} size={12} strokeWidth={3} />
                      </span>
                    </label>
                  </span>
                  <button type="button" className="ksieg-selall__label" onClick={toggleAllVisible}>
                    {wszystkieZaznaczone ? tMain.ksSelectNone : tMain.ksSelectAll}
                  </button>
                  <span className="ksieg-selall__hint">{tMain.ksSelectRangeHint}</span>
                  <span className="pit-selall__expand">
                    <button type="button" className="button button-small button-ghost" onClick={() => setRozwiniete(new Set(visible.map((w) => w.id)))}>
                      <Icon name="chevron-down" size={13} /> {t.expandAll}
                    </button>
                    <button type="button" className="button button-small button-ghost" onClick={() => setRozwiniete(new Set())}>
                      <Icon name="chevron-right" size={13} /> {t.collapseAll}
                    </button>
                  </span>
                </div>
                <ul className="zeb-list">{visible.map(renderWiersz)}</ul>
              </>
            )}
            {bezPit.length > 0 && (
              <details className="pit-adresy">
                <summary>{sub(t.adresyBezPit, { n: bezPit.length, rok })}</summary>
                <p className="pod-note">{t.adresyBezPitHint}</p>
                <ul className="pit-adresy__list">
                  {bezPit.map((r) => (
                    <li key={r.nazwa}>
                      <span>{r.nazwa}</span>
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => {
                          setNowaZ(r);
                          navItem.open('nowy', r.nazwa);
                        }}
                      >
                        <Icon name="plus" size={13} /> {t.adresyDodaj}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {zaznaczone.length > 0 && (
          <div className="ksieg-selbar">
            <Icon name="check-circle" size={16} />
            <span className="ksieg-selbar__text">{sub(t.selectionBar, { n: zaznaczone.length })}</span>
            <button
              type="button"
              className="ksieg-selbar__clear"
              onClick={() => {
                setSelected(new Set());
                lastTickedRef.current = null;
              }}
            >
              {tMain.ksSelectClear}
            </button>
            {zaznaczoneZlozone.length > 0 && (
              <button type="button" className="button button-small button-ghost" disabled={busy !== null} onClick={() => void ustawZlozone(zaznaczoneZlozone, false, '')}>
                {sub(t.batchUnfiled, { n: zaznaczoneZlozone.length })}
              </button>
            )}
            <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => void pliki(zaznaczone)}>
              <Icon name="download" size={14} /> {sub(t.batchFiles, { n: zaznaczone.length })}
            </button>
            <button type="button" className="button button-secondary" disabled={busy !== null || podpisIds !== null} onClick={() => setPodpisIds(zaznaczone)}>
              <Icon name="signature" size={14} /> {sub(t.batchSign, { n: zaznaczone.length })}
            </button>
            {zaznaczoneNiezlozone.length > 0 && (
              <button type="button" className="ksieg-book ksieg-book--sm" disabled={busy !== null} onClick={() => setZlozoneIds(zaznaczoneNiezlozone)}>
                <Icon name="check-circle" size={14} />
                <span>{sub(t.batchFiled, { n: zaznaczoneNiezlozone.length })}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {okna}
    </div>
  );
};

export default PodatkiPit;
