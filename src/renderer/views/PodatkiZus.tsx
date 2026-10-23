import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  PodatkiZusImportResult,
  PodatkiZusPlikiOpcje,
  PodatkiZusPlikiResult,
  PodatkiZusWyslijResult,
} from '../../shared/types';
import { ZusWysylka, czekaNaPotwierdzenie, kluczWysylki, ostatniaWysylka } from '../../shared/zus-ewd';
import {
  NAZWA_DOKUMENTU,
  PodatekZusPlatnik,
  PodatekZusRozliczenie,
  STOPA_WYPADKOWA_DOMYSLNA,
  ZusCzlonek,
  ZusPlatnikDane,
  ZusProblem,
  ZusRodzajDokumentu,
  ZusRozliczenieDane,
  ZusStan,
  ZusTytul,
  ZusUbezpieczony,
  ZusZnak,
  biezaceRozliczenia,
  dataWyrejestrowania,
  dataZPesela,
  dniOkresu,
  idRozliczenia,
  kluczPozycji,
  kluczTozsamosci,
  kodPelny,
  maBladZus,
  nazwaSkroconaZAdresu,
  nazwaUbezpieczonego,
  obliczRozliczenie,
  ostatniDzien,
  plecZPesela,
  problemyCzlonka,
  problemyPlatnika,
  problemyRozliczenia,
  problemyWyrejestrowania,
  problemyZgloszenia,
  przesunOkres,
  pusteDaneZusPlatnika,
  pustyCzlonek,
  pustyTytul,
  pustyUbezpieczony,
  pustyWpisRsa,
  rdzenPlatnika,
  stanZus,
  szkicRozliczenia,
  terminRozliczenia,
  tytulPracowniczy,
  tytulWOkresie,
  tytulyWOkresie,
  zgloszeniaMiesiaca,
  zusParametry,
} from '../../shared/podatki-zus';
import {
  ZUS_KODY_WYGASNIECIA,
  ZUS_NFZ,
  ZUS_PODSTAWY_WYGASNIECIA,
  ZUS_POKREWIENSTWO,
  ZUS_PRZYCZYNY_WYREJESTROWANIA,
  ZUS_SWIADCZENIA_PRZERWY,
  ZUS_TYTULY,
} from '../../shared/zus-slowniki';
import { monthLabel } from '../../shared/bookings';
import { formatStamp } from '../../shared/calendar';
import { foldText } from '../../shared/text';
import { tylkoCyfry } from '../../shared/podatki';
import { Language, translations } from '../translations';
import { ipcErrorMessage } from '../ipcError';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import { FormField, FormRow, FormSection } from '../components/FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import ScreenTitle from '../components/ScreenTitle';
import { useLeaveGuard, useNavItem } from '../navigation';
import { structuralEqual } from '../structuralEqual';
import Icon from '../components/Icon';
import PodatkiPozostale, { PodatkiPozostaleGrupa } from '../components/PodatkiPozostale';
import ChoiceCards from '../components/ChoiceCards';
import {
  WysylkaZus,
  WysylkaZusPodsumowanie,
  WyslijZusModal,
  ZusWysylkiContext,
  ZusWysylkiKontekst,
  sprawdzPotwierdzenia,
  useWysylkaDokumentu,
  wysylkaTrwa,
} from '../components/podatki-zus/Wysylki';
import Loader, { BusyOverlay } from '../components/Loader';
import Select from '../components/Select';
import SearchableSelect, { SearchableOption } from '../components/SearchableSelect';
import { DomSlot, LiczbaInput, baseName } from './PodatkiNieruchomosci';
import './podatkiPit.css';
import './podatkiZus.css';

/* ================================== Helpers =================================== */

type T = (typeof translations)['pl'];

const zl2 = (n: number) =>
  `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const kw = (n: number) =>
  n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sub = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
const dataPl = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—';
const dzisOkres = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const OPCJE_TYTULOW: SearchableOption[] = ZUS_TYTULY.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v}`,
  keywords: v,
}));
const OPCJE_NFZ = ZUS_NFZ.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v.replace(/ ODDZIAŁ WOJEWÓDZKI NARODOWEGO FUNDUSZU ZDR(OWIA)?/, '')}`,
}));
const OPCJE_PRZYCZYN = ZUS_PRZYCZYNY_WYREJESTROWANIA.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v}`,
}));
const OPCJE_WYGASNIECIA: SearchableOption[] = ZUS_KODY_WYGASNIECIA.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v}`,
}));
const OPCJE_PODSTAW: SearchableOption[] = ZUS_PODSTAWY_WYGASNIECIA.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v}`,
}));
const OPCJE_POKREWIENSTWA = ZUS_POKREWIENSTWO.map(([k, v]) => ({ value: k, label: `${k} — ${v}` }));
const OPCJE_RSA: SearchableOption[] = ZUS_SWIADCZENIA_PRZERWY.map(([k, v]) => ({
  value: k,
  label: `${k} — ${v}`,
}));
const OPCJE_TERMINU = [
  { value: '6', label: '6 — do 20. dnia (pozostali płatnicy)' },
  { value: '3', label: '3 — do 15. dnia (osobowość prawna)' },
  { value: '1', label: '1 — do 5. dnia (jednostki budżetowe)' },
];

/** The occupation dictionary (~3 000 codes) — loaded the first time a card needs it. */
let zawodyCache: SearchableOption[] | null = null;
function useZawody(): SearchableOption[] {
  const [lista, setLista] = useState<SearchableOption[]>(zawodyCache ?? []);
  useEffect(() => {
    if (zawodyCache) return;
    let zywy = true;
    void import('../../shared/zus-zawody').then((m) => {
      zawodyCache = m.ZUS_ZAWODY.map(([k, v]) => ({ value: k, label: `${k} — ${v}`, keywords: v }));
      if (zywy) setLista(zawodyCache);
    });
    return () => {
      zywy = false;
    };
  }, []);
  return lista;
}

type Filtr = 'all' | 'errors' | 'ready' | 'waiting' | 'sent';
const FILTRY: Filtr[] = ['all', 'errors', 'ready', 'waiting', 'sent'];

/** One document of a payer's month, as the list shows it. */
interface DokListy {
  id: string;
  rodzaj: ZusRodzajDokumentu;
  /** Who / what — the person, or the month's set. */
  nazwa: string;
  meta: string;
  problemy: ZusProblem[];
  stan: ZusStan;
  wyslane: ZusZnak | null;
  /** The newest send of it to ZUS (EWD), if any. */
  wysylka: ZusWysylka | null;
}

const rodzajEtykieta = (t: T, r: ZusRodzajDokumentu, zdarzenie?: 'z' | 'w') =>
  r === 'zcna'
    ? `${NAZWA_DOKUMENTU.zcna}${zdarzenie === 'w' ? ` · ${t.zusZcnaOut}` : ''}`
    : NAZWA_DOKUMENTU[r];

/** Why a document cannot go to ZUS yet: its blocking errors, one per line. */
const powodBlokady = (t: T, problemy: ZusProblem[]) =>
  [
    t.zusSendBlockedTip,
    ...problemy.filter((p) => p.poziom === 'blad').map((p) => `• ${p.tekst}`),
  ].join('\n');

/** The month's documents of a payer: its DRA set (or the note that it is not prepared) and the registrations due. */
function dokumentyPlatnika(
  t: T,
  p: PodatekZusPlatnik,
  rozliczenia: PodatekZusRozliczenie[],
  okres: string,
  wysylki: ZusWysylka[]
): { lista: DokListy[]; doZaplaty: number; rozl: PodatekZusRozliczenie | null } {
  const lista: DokListy[] = [];
  const rozl = biezaceRozliczenia(rozliczenia, p.nip).find((r) => r.okres === okres) ?? null;
  let doZaplaty = 0;
  if (rozl) {
    const wynik = obliczRozliczenie(p.dane, rozl.dane, okres);
    const problemy = problemyRozliczenia(p.nip, p.dane, rozl, wynik);
    doZaplaty = wynik.dra.doZaplaty;
    lista.push({
      id: idRozliczenia(p.id, okres),
      rodzaj: 'rozliczenie',
      nazwa: sub(t.zusDocSet, { n: wynik.pozycje.length }),
      meta: [
        zl2(wynik.dra.doZaplaty),
        rozl.identyfikator > 1
          ? sub(t.zusDocCorrection, { id: String(rozl.identyfikator).padStart(2, '0') })
          : '',
        rozl.dane.rsa.length > 0 ? sub(t.zusDocRsa, { n: rozl.dane.rsa.length }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      problemy,
      stan: stanZus(problemy, rozl.dane.wyslane),
      wyslane: rozl.dane.wyslane,
      wysylka: ostatniaWysylka(
        wysylki,
        kluczWysylki(idRozliczenia(p.id, okres), rozl.identyfikator)
      ),
    });
  } else if (tytulyWOkresie(p.dane, okres).length > 0) {
    lista.push({
      id: idRozliczenia(p.id, okres),
      rodzaj: 'rozliczenie',
      nazwa: t.zusDocSetMissing,
      meta: sub(t.zusDocSetMissingMeta, { n: tytulyWOkresie(p.dane, okres).length }),
      problemy: [{ poziom: 'blad', tekst: t.zusDocSetMissingProblem }],
      stan: 'brak',
      wyslane: null,
      wysylka: null,
    });
  }
  const platnik = problemyPlatnika(p.nip, p.dane);
  for (const z of zgloszeniaMiesiaca(p.id, p.dane, okres)) {
    const problemy = [
      ...platnik,
      ...(z.rodzaj === 'zcna'
        ? problemyCzlonka(z.osoba, z.czlonek!, z.id.endsWith(':w') ? 'w' : 'z')
        : z.rodzaj === 'zwua'
          ? problemyWyrejestrowania(z.osoba, z.tytul!)
          : problemyZgloszenia(z.osoba, z.tytul!)),
    ];
    lista.push({
      id: z.id,
      rodzaj: z.rodzaj,
      nazwa: nazwaUbezpieczonego(z.osoba) || t.zusNewPerson,
      meta: [
        z.rodzaj === 'zcna'
          ? `${z.czlonek!.nazwisko} ${z.czlonek!.imie}`.trim()
          : kodPelny(z.tytul!),
        sub(z.rodzaj === 'zwua' || z.id.endsWith(':w') ? t.zusDocFromDateOut : t.zusDocFromDate, {
          data: dataPl(z.data),
        }),
      ]
        .filter(Boolean)
        .join(' · '),
      problemy,
      stan: stanZus(problemy, z.wyslane),
      wyslane: z.wyslane,
      wysylka: ostatniaWysylka(wysylki, kluczWysylki(z.id, null)),
    });
  }
  return { lista, doZaplaty, rozl };
}

/** A community of the Adresy list — the app's register of communities. */
interface Rejestr {
  nazwa: string;
  rdzen: string;
  nip: string;
  regon: string;
}

/* ============================== The month's set ============================== */

const RozliczenieForm: React.FC<{
  t: T;
  locale: string;
  okres: string;
  nip: string;
  platnik: ZusPlatnikDane;
  /** The month's newest version as stored; null when the month has none yet. */
  rekord: PodatekZusRozliczenie | null;
  /** Every version of the month, oldest first. */
  wersje: PodatekZusRozliczenie[];
  /** The payer's earlier months, for "copy the bases". */
  wczesniejsze: PodatekZusRozliczenie[];
  dane: ZusRozliczenieDane | null;
  saved: boolean;
  onChange: (d: ZusRozliczenieDane | null) => void;
  onFiles: () => void;
  onSent: (wyslane: boolean) => void;
  onKorekta: () => void;
  onOkres: (okres: string) => void;
  /** The month list's id of the set — its sends to ZUS, and "Podpisz i wyślij do ZUS". */
  dokument: string;
}> = ({
  t,
  locale,
  okres,
  nip,
  platnik,
  rekord,
  wersje,
  wczesniejsze,
  dane,
  saved,
  onChange,
  onFiles,
  onSent,
  onKorekta,
  onOkres,
  dokument,
}) => {
  const wysylka = useWysylkaDokumentu(rekord ? dokument : null, rekord?.identyfikator ?? null);
  const { wyslij } = useContext(ZusWysylkiContext);
  const wynik = useMemo(
    () => (dane ? obliczRozliczenie(platnik, dane, okres) : null),
    [platnik, dane, okres]
  );
  const problemy = useMemo(
    () =>
      dane && wynik
        ? problemyRozliczenia(
            nip,
            platnik,
            { okres, identyfikator: rekord?.identyfikator ?? 1, dane },
            wynik
          )
        : [],
    [dane, wynik, nip, platnik, okres, rekord?.identyfikator]
  );
  const wyslane = rekord?.dane.wyslane ?? null;
  const zablokowane = !!wyslane;
  const bledy = problemy.filter((p) => p.poziom === 'blad' && p.rodzaj !== 'przeglad');
  const uwagi = problemy.filter((p) => p.poziom === 'uwaga');
  const termin = terminRozliczenia(okres, platnik.terminDra);
  const brakujace = dane
    ? tytulyWOkresie(platnik, okres).filter(
        ({ osoba, tytul }) =>
          !dane.pozycje.some((p) => p.kluczOsoby === osoba.klucz && p.kluczTytulu === tytul.klucz)
      )
    : [];
  const osoby = new Map(platnik.ubezpieczeni.map((o) => [o.klucz, o]));
  const set = (patch: Partial<ZusRozliczenieDane>) => dane && onChange({ ...dane, ...patch });
  const setPozycja = (
    klucz: string,
    patch: {
      podstawa?: number | null;
      przychodZdrowotny?: number | null;
      zdrowotna?: number | null;
    }
  ) =>
    dane &&
    set({ pozycje: dane.pozycje.map((p) => (kluczPozycji(p) === klucz ? { ...p, ...patch } : p)) });
  const historia = wczesniejsze
    .filter((r) => r.okres < okres)
    .slice(-6)
    .reverse();
  const opcjePozycji = (wynik?.pozycje ?? []).map((w) => ({
    value: kluczPozycji(w.pozycja),
    label: `${nazwaUbezpieczonego(w.osoba)} · ${w.tytul.kod}`,
  }));

  return (
    <FormSection
      icon="table"
      title={sub(t.zusSetTitle, { okres: monthLabel(okres, locale) })}
      description={sub(t.zusSetDesc, { termin: dataPl(termin) })}
      badge={
        wyslane ? (
          <span className="pit-tone-ok">{t.zusSentDone}</span>
        ) : dane && maBladZus(problemy) ? (
          <span className="pit-tone-warn">{t.zusStatusError}</span>
        ) : dane && uwagi.length > 0 ? (
          <span className="pit-tone-info">{t.zusStatusWarn}</span>
        ) : undefined
      }
      aside={
        dane && rekord && saved ? (
          <span className="pit-aside">
            <WysylkaZus t={t} locale={locale} wysylka={wysylka} kompakt />
            {!wyslane && !wysylkaTrwa(wysylka) && (
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => wyslij([dokument])}
                disabled={maBladZus(problemy)}
                data-tip={maBladZus(problemy) ? powodBlokady(t, problemy) : t.zusSendOneHint}
              >
                <Icon name="upload" size={13} /> {t.zusSendOne}
              </button>
            )}
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={onFiles}
            >
              <Icon name="download" size={13} /> {t.zusDocDownload}
            </button>
            {wyslane ? (
              <>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={onKorekta}
                >
                  <Icon name="edit" size={13} /> {t.zusKorekta}
                </button>
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => onSent(false)}
                >
                  {t.zusSentUndo}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => onSent(true)}
              >
                <Icon name="check-circle" size={13} /> {t.zusSentMark}
              </button>
            )}
          </span>
        ) : undefined
      }
    >
      {!dane ? (
        <div className="zus-empty-set">
          <p className="pod-note">
            {tytulyWOkresie(platnik, okres).length > 0 ? t.zusSetNone : t.zusSetNoTitles}
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onChange(szkicRozliczenia(platnik, okres, wczesniejsze))}
            disabled={tytulyWOkresie(platnik, okres).length === 0}
          >
            <Icon name="plus" size={14} />{' '}
            {sub(t.zusSetCreate, { okres: monthLabel(okres, locale) })}
          </button>
        </div>
      ) : (
        <>
          {wersje.length > 1 && (
            <p className="pod-note">
              {t.zusVersions}{' '}
              {wersje
                .map(
                  (w) =>
                    `${String(w.identyfikator).padStart(2, '0')}${w.dane.wyslane ? ` (${t.zusSentDone.toLowerCase()} ${formatStamp(w.dane.wyslane.at, locale)})` : ''}`
                )
                .join(', ')}
            </p>
          )}
          {zablokowane && (
            <div className="callout">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.zusSetLocked}</div>
            </div>
          )}
          {dane.przeglad.length > 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                <strong>{t.zusReview}.</strong> {t.zusReviewDesc}
                <ul className="pod-problems">
                  {dane.przeglad.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => set({ przeglad: [] })}
              >
                <Icon name="check" size={13} /> {t.zusReviewDone}
              </button>
            </div>
          )}
          {bledy.length > 0 && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.zusProblemsTitle}
                <ul className="pod-problems">
                  {bledy.map((p, i) => (
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
                {t.zusWarningsTitle}
                <ul className="pod-problems">
                  {uwagi.map((p, i) => (
                    <li key={i}>{p.tekst}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="table-scroll form-table-frame">
            <table className="form-table form-table--edit zus-table">
              <thead>
                <tr>
                  <th>{t.zusColPerson}</th>
                  <th className="zus-num">{t.zusColBase}</th>
                  <th className="zus-num" data-tip={t.zusColSickPayHint}>
                    {t.zusColSickPay}
                  </th>
                  <th className="zus-num">{t.zusColPension}</th>
                  <th className="zus-num">{t.zusColDisability}</th>
                  <th className="zus-num">{t.zusColSickness}</th>
                  <th className="zus-num">{t.zusColAccident}</th>
                  <th className="zus-num">{t.zusColSocial}</th>
                  <th className="zus-num">{t.zusColHealth}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(wynik?.pozycje ?? []).map((w) => {
                  const k = kluczPozycji(w.pozycja);
                  const s = w.skladki;
                  return (
                    <tr key={k}>
                      {/* The person, and under the name the title's code (its own column only made the table scroll). */}
                      <td className="zus-osoba">
                        <span className="cell-title">
                          {nazwaUbezpieczonego(w.osoba) || t.zusNewPerson}
                        </span>
                        <span className="zus-osoba__meta">
                          <span data-tip={t.zusColTitle}>{kodPelny(w.tytul)}</span>
                          {w.tytul.schemat === 'zdrowotne' && <span>{t.zusHealthOnly}</span>}
                          {(wynik?.fpOsoby.get(w.osoba.klucz) ?? 0) > 0 && (
                            <span>FP {kw(wynik!.fpOsoby.get(w.osoba.klucz)!)}</span>
                          )}
                        </span>
                      </td>
                      <td className="zus-num zus-input">
                        <LiczbaInput
                          value={w.pozycja.podstawa}
                          onChange={(v) => setPozycja(k, { podstawa: v })}
                          decimals={2}
                          ariaLabel={t.zusColBase}
                          disabled={zablokowane}
                        />
                      </td>
                      <td className="zus-num zus-input">
                        <LiczbaInput
                          value={w.pozycja.przychodZdrowotny}
                          onChange={(v) => setPozycja(k, { przychodZdrowotny: v === 0 ? null : v })}
                          decimals={2}
                          ariaLabel={t.zusColSickPay}
                          disabled={zablokowane}
                        />
                      </td>
                      <td className="zus-num">
                        {kw(s.emU)}
                        <small>{kw(s.emP)}</small>
                      </td>
                      <td className="zus-num">
                        {kw(s.renU)}
                        <small>{kw(s.renP)}</small>
                      </td>
                      <td className="zus-num">{kw(s.chU)}</td>
                      <td className="zus-num">{kw(s.wypP)}</td>
                      <td className="zus-num zus-strong">{kw(s.razem)}</td>
                      <td className="zus-num zus-input">
                        <LiczbaInput
                          value={w.pozycja.zdrowotna ?? s.zdrowotnaRegula}
                          onChange={(v) =>
                            setPozycja(k, {
                              zdrowotna:
                                v === null || Math.abs(v - s.zdrowotnaRegula) < 0.005 ? null : v,
                            })
                          }
                          decimals={2}
                          ariaLabel={t.zusColHealth}
                          disabled={zablokowane}
                        />
                      </td>
                      <td>
                        {!zablokowane && (
                          <button
                            type="button"
                            className="button button-small button-ghost icon-danger"
                            onClick={() =>
                              set({
                                pozycje: dane.pozycje.filter((p) => kluczPozycji(p) !== k),
                                rsa: dane.rsa.filter((r) => kluczPozycji(r) !== k),
                              })
                            }
                            data-tip={t.zusRowRemove}
                            aria-label={t.zusRowRemove}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {wynik && (
                <tfoot>
                  <tr>
                    <td colSpan={3}>{t.zusTotalDra}</td>
                    <td className="zus-num">
                      {kw(wynik.dra.iv[4])}
                      <small>{kw(wynik.dra.iv[7])}</small>
                    </td>
                    <td className="zus-num">
                      {kw(wynik.dra.iv[5])}
                      <small>{kw(wynik.dra.iv[8])}</small>
                    </td>
                    <td className="zus-num">{kw(wynik.dra.iv[22])}</td>
                    <td className="zus-num">{kw(wynik.dra.iv[26])}</td>
                    <td className="zus-num zus-strong">{kw(wynik.dra.spoleczne)}</td>
                    <td className="zus-num zus-strong">{kw(wynik.dra.zdrowotna)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="pod-note">{t.zusTableHint}</p>
          {!zablokowane && brakujace.length > 0 && (
            <div className="pit-fill">
              <span className="pod-note">{sub(t.zusMissingTitles, { n: brakujace.length })}</span>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() =>
                  set({
                    pozycje: [
                      ...dane.pozycje,
                      ...brakujace.map(({ osoba, tytul }) => ({
                        kluczOsoby: osoba.klucz,
                        kluczTytulu: tytul.klucz,
                        podstawa: tytul.podstawa,
                        przychodZdrowotny: null,
                        zdrowotna: null,
                      })),
                    ],
                  })
                }
              >
                <Icon name="plus" size={13} /> {t.zusMissingTitlesAdd}
              </button>
            </div>
          )}

          <div className="zus-summary">
            <div>
              <span>{t.zusSumSocial}</span>
              <strong>{zl2(wynik!.dra.spoleczne)}</strong>
            </div>
            <div>
              <span>{t.zusSumHealth}</span>
              <strong>{zl2(wynik!.dra.zdrowotna)}</strong>
            </div>
            <div>
              <span>{t.zusSumFp}</span>
              <strong>{zl2(wynik!.dra.fp + wynik!.dra.fgsp)}</strong>
            </div>
            <div className="is-total">
              <span>{t.zusSumToPay}</span>
              <strong>{zl2(wynik!.dra.doZaplaty)}</strong>
            </div>
            <div>
              <span>{t.zusSumDeadline}</span>
              <strong>{dataPl(termin)}</strong>
            </div>
          </div>

          <div className="pit-sub">{t.zusRsaSec}</div>
          <p className="pod-note">{t.zusRsaDesc}</p>
          {dane.rsa.map((r) => {
            const kod = ZUS_SWIADCZENIA_PRZERWY.find(([k]) => k === r.kod);
            const dniAuto = r.od && r.do && r.do >= r.od ? dniOkresu(r.od, r.do) : null;
            const setRsa = (patch: Partial<typeof r>) =>
              set({ rsa: dane.rsa.map((x) => (x.klucz === r.klucz ? { ...x, ...patch } : x)) });
            return (
              <div key={r.klucz} className="pit-title-block">
                <FormRow>
                  <FormField label={t.zusRsaPerson}>
                    <Select
                      overlay
                      value={kluczPozycji(r)}
                      options={opcjePozycji}
                      onChange={(v) => {
                        const [kluczOsoby, kluczTytulu] = v.split('|');
                        setRsa({ kluczOsoby, kluczTytulu });
                      }}
                      ariaLabel={t.zusRsaPerson}
                      disabled={zablokowane}
                    />
                  </FormField>
                  <FormField label={t.zusRsaCode}>
                    <SearchableSelect
                      overlay
                      value={r.kod}
                      options={OPCJE_RSA}
                      onChange={(v) => setRsa({ kod: v })}
                      ariaLabel={t.zusRsaCode}
                      searchPlaceholder={t.zusPickSearch}
                      emptyText={t.zusPickEmpty}
                      disabled={zablokowane}
                      menuMaxWidth={560}
                    />
                  </FormField>
                </FormRow>
                <FormRow>
                  <FormField label={t.zusFrom}>
                    <input
                      type="date"
                      value={r.od ?? ''}
                      onChange={(e) => setRsa({ od: e.target.value || null })}
                      disabled={zablokowane}
                    />
                  </FormField>
                  <FormField label={t.zusTo}>
                    <input
                      type="date"
                      value={r.do ?? ''}
                      onChange={(e) => setRsa({ do: e.target.value || null })}
                      disabled={zablokowane}
                    />
                  </FormField>
                  <FormField
                    label={t.zusRsaDays}
                    hint={
                      dniAuto !== null && r.dni === null
                        ? sub(t.zusRsaDaysAuto, { n: dniAuto })
                        : undefined
                    }
                  >
                    <LiczbaInput
                      value={r.dni}
                      onChange={(v) => setRsa({ dni: v === null ? null : Math.round(v) })}
                      decimals={0}
                      ariaLabel={t.zusRsaDays}
                      disabled={zablokowane}
                    />
                  </FormField>
                  <FormField
                    label={t.zusRsaAmount}
                    hint={kod && kod[2] !== 'Y' ? t.zusRsaAmountNeeded : undefined}
                  >
                    <LiczbaInput
                      value={r.kwota}
                      onChange={(v) => setRsa({ kwota: v })}
                      decimals={2}
                      unit="zł"
                      ariaLabel={t.zusRsaAmount}
                      disabled={zablokowane}
                    />
                  </FormField>
                </FormRow>
                {!zablokowane && (
                  <div className="pit-apply">
                    <button
                      type="button"
                      className="button button-small button-ghost icon-danger"
                      onClick={() => set({ rsa: dane.rsa.filter((x) => x.klucz !== r.klucz) })}
                    >
                      <Icon name="trash" size={13} /> {t.zusRsaRemove}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!zablokowane && (wynik?.pozycje.length ?? 0) > 0 && (
            <div>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => {
                  const pierwsza = wynik!.pozycje[0].pozycja;
                  set({
                    rsa: [
                      ...dane.rsa,
                      {
                        ...pustyWpisRsa(pierwsza.kluczOsoby, pierwsza.kluczTytulu),
                        od: `${okres}-01`,
                        do: ostatniDzien(okres),
                      },
                    ],
                  });
                }}
              >
                <Icon name="plus" size={13} /> {t.zusRsaAdd}
              </button>
            </div>
          )}

          <details className="pit-details">
            <summary>{t.zusSetMore}</summary>
            <FormRow>
              <FormField
                label={t.zusCount}
                hint={sub(t.zusCountHint, {
                  n: new Set(dane.pozycje.map((p) => p.kluczOsoby)).size,
                })}
              >
                <LiczbaInput
                  value={dane.liczbaUbezpieczonych}
                  onChange={(v) => set({ liczbaUbezpieczonych: v === null ? null : Math.round(v) })}
                  decimals={0}
                  ariaLabel={t.zusCount}
                  disabled={zablokowane}
                />
              </FormField>
              <FormField label={t.zusFilledOn} hint={t.zusFilledOnHint}>
                <input
                  type="date"
                  value={dane.dataWypelnienia ?? ''}
                  onChange={(e) => set({ dataWypelnienia: e.target.value || null })}
                  disabled={zablokowane}
                />
              </FormField>
            </FormRow>
          </details>
          {!rekord && (
            <div className="pit-apply">
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => onChange(null)}
              >
                {t.zusSetDiscard}
              </button>
            </div>
          )}
          {dane.pozycje.some((p) => !osoby.has(p.kluczOsoby)) && (
            <p className="pod-note">{t.zusOrphans}</p>
          )}
        </>
      )}
      {historia.length > 0 && (
        <>
          <div className="pit-sub">{t.zusHistory}</div>
          <ul className="zus-history">
            {historia.map((r) => {
              const w = obliczRozliczenie(platnik, r.dane, r.okres);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="zus-history__open"
                    onClick={() => onOkres(r.okres)}
                  >
                    {monthLabel(r.okres, locale)}
                    {r.identyfikator > 1 ? ` · ${String(r.identyfikator).padStart(2, '0')}` : ''}
                  </button>
                  <span>{zl2(w.dra.doZaplaty)}</span>
                  <span className={r.dane.wyslane ? 'zus-ok' : 'zus-muted'}>
                    {r.dane.wyslane ? t.zusSentDone : t.zusNotSent}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FormSection>
  );
};

/* ================================== A title ================================== */

const ZnakDokumentu: React.FC<{
  t: T;
  locale: string;
  etykieta: string;
  znak: ZusZnak | null;
  problemy: ZusProblem[];
  saved: boolean;
  /** The month list's id of the document — its sends to ZUS, and "Podpisz i wyślij do ZUS". */
  dokument: string;
  onFiles: () => void;
  onSent: (wyslane: boolean) => void;
}> = ({ t, locale, etykieta, znak, problemy, saved, dokument, onFiles, onSent }) => {
  const stan = stanZus(problemy, znak);
  const wysylka = useWysylkaDokumentu(dokument);
  const { wyslij } = useContext(ZusWysylkiContext);
  return (
    <div className={`zus-docline zus-docline--${stan}`}>
      <span className="zus-docline__kind">{etykieta}</span>
      <span
        className={`status-badge ${stan === 'blad' ? 'status-pending' : stan === 'uwagi' ? 'status-info' : stan === 'wyslane' ? 'status-success' : 'status-neutral'}`}
        data-tip={problemy.map((p) => p.tekst).join('\n') || undefined}
      >
        {stan === 'wyslane'
          ? `${t.zusSentDone} ${formatStamp(znak!.at, locale)}`
          : stan === 'blad'
            ? t.zusStatusError
            : stan === 'uwagi'
              ? t.zusStatusWarn
              : t.zusStatusReady}
      </span>
      <WysylkaZus t={t} locale={locale} wysylka={wysylka} kompakt />
      {saved ? (
        <span className="pit-aside">
          {!znak && !wysylkaTrwa(wysylka) && (
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => wyslij([dokument])}
              disabled={stan === 'blad'}
              data-tip={stan === 'blad' ? powodBlokady(t, problemy) : t.zusSendOneHint}
            >
              <Icon name="upload" size={13} /> {t.zusSendOne}
            </button>
          )}
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={onFiles}
            data-tip={t.zusKeduHint}
          >
            <Icon name="download" size={13} /> KEDU
          </button>
          {znak ? (
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => onSent(false)}
            >
              {t.zusSentUndo}
            </button>
          ) : (
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => onSent(true)}
            >
              <Icon name="check-circle" size={13} /> {t.zusSentMark}
            </button>
          )}
        </span>
      ) : (
        <span className="pod-note">{t.zusSaveFirst}</span>
      )}
    </div>
  );
};

const TytulForm: React.FC<{
  t: T;
  locale: string;
  osoba: ZusUbezpieczony;
  tytul: ZusTytul;
  okres: string;
  saved: boolean;
  problemyPl: ZusProblem[];
  onChange: (patch: Partial<ZusTytul>) => void;
  onRemove: () => void;
  onFiles: (rodzaj: 'z' | 'w') => void;
  onSent: (rodzaj: 'z' | 'w', wyslane: boolean) => void;
  /** The list's id of its registration ('z') or deregistration ('w'). */
  dokument: (rodzaj: 'z' | 'w') => string;
}> = ({
  t,
  locale,
  osoba,
  tytul: x,
  okres,
  saved,
  problemyPl,
  onChange,
  onRemove,
  onFiles,
  onSent,
  dokument,
}) => {
  const pracowniczy = tytulPracowniczy(x.kod);
  const wyr = dataWyrejestrowania(x);
  const zmienKod = (kod: string) => {
    const prac = tytulPracowniczy(kod);
    onChange({
      kod,
      chorobowe: prac ? 'obowiazkowe' : x.chorobowe === 'obowiazkowe' ? 'brak' : x.chorobowe,
      wymiarLicznik: prac ? (x.wymiarLicznik ?? 1) : null,
      wymiarMianownik: prac ? (x.wymiarMianownik ?? 1) : null,
    });
  };
  return (
    <div className={`pit-title-block${tytulWOkresie(x, okres) ? ' is-active' : ''}`}>
      <div className="zus-title-head">
        <span className="pit-title-block__name">
          {kodPelny(x)} · {x.schemat === 'zdrowotne' ? 'ZZA' : 'ZUA'}
        </span>
        <span className="pod-note">
          {dataPl(x.od)} – {x.do ? dataPl(x.do) : t.zusOngoing}
        </span>
        <button
          type="button"
          className="button button-small button-ghost icon-danger"
          onClick={onRemove}
          data-tip={t.zusTitleRemove}
          aria-label={t.zusTitleRemove}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <FormField label={t.zusTitleCode} hint={t.zusTitleCodeHint}>
        <SearchableSelect
          overlay
          value={x.kod}
          options={OPCJE_TYTULOW}
          onChange={zmienKod}
          ariaLabel={t.zusTitleCode}
          searchPlaceholder={t.zusPickSearch}
          emptyText={t.zusPickEmpty}
          menuMaxWidth={640}
        />
      </FormField>
      <FormRow>
        <FormField label={t.zusEmRent}>
          <Select
            overlay
            value={x.emRent}
            options={[
              { value: '0', label: t.zusEmRent0 },
              { value: '1', label: t.zusEmRent1 },
              { value: '2', label: t.zusEmRent2 },
            ]}
            onChange={(v) => onChange({ emRent: v })}
            ariaLabel={t.zusEmRent}
          />
        </FormField>
        <FormField label={t.zusDisability}>
          <Select
            overlay
            value={x.niepelnosprawnosc}
            options={[
              { value: '0', label: t.zusDisability0 },
              { value: '1', label: t.zusDisability1 },
              { value: '2', label: t.zusDisability2 },
              { value: '3', label: t.zusDisability3 },
            ]}
            onChange={(v) => onChange({ niepelnosprawnosc: v })}
            ariaLabel={t.zusDisability}
          />
        </FormField>
        <FormField label={t.zusScheme}>
          <Select
            overlay
            value={x.schemat}
            options={[
              { value: 'spoleczne', label: t.zusSchemeSocial },
              { value: 'zdrowotne', label: t.zusSchemeHealth },
            ]}
            onChange={(v) => onChange({ schemat: v === 'zdrowotne' ? 'zdrowotne' : 'spoleczne' })}
            ariaLabel={t.zusScheme}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.zusTitleFrom} required>
          <input
            type="date"
            value={x.od ?? ''}
            onChange={(e) => onChange({ od: e.target.value || null })}
          />
        </FormField>
        <FormField
          label={t.zusTitleTo}
          hint={wyr ? sub(t.zusTitleToHint, { data: dataPl(wyr) }) : t.zusTitleToEmpty}
        >
          <input
            type="date"
            value={x.do ?? ''}
            onChange={(e) => onChange({ do: e.target.value || null })}
          />
        </FormField>
        <FormField label={t.zusUsualBase} hint={t.zusUsualBaseHint}>
          <LiczbaInput
            value={x.podstawa}
            onChange={(v) => onChange({ podstawa: v })}
            decimals={2}
            unit="zł"
            ariaLabel={t.zusUsualBase}
          />
        </FormField>
      </FormRow>
      {x.schemat === 'spoleczne' && (
        <div className="pit-tytuly" role="group" aria-label={t.zusInsurances}>
          {(
            [
              ['emerytalne', t.zusInsPension],
              ['rentowe', t.zusInsDisability],
              ['wypadkowe', t.zusInsAccident],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={`pit-tytul${x[k] ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={x[k]}
                onChange={(e) => onChange({ [k]: e.target.checked } as Partial<ZusTytul>)}
              />
              <span>{label}</span>
            </label>
          ))}
          <Select
            overlay
            value={x.chorobowe}
            options={[
              { value: 'obowiazkowe', label: t.zusSickCompulsory },
              { value: 'dobrowolne', label: t.zusSickVoluntary },
              { value: 'brak', label: t.zusSickNone },
            ]}
            onChange={(v) => onChange({ chorobowe: v as ZusTytul['chorobowe'] })}
            ariaLabel={t.zusInsSickness}
          />
          <label className={`pit-tytul${x.bezFp ? ' is-on' : ''}`} data-tip={t.zusNoFpHint}>
            <input
              type="checkbox"
              checked={x.bezFp}
              onChange={(e) => onChange({ bezFp: e.target.checked })}
            />
            <span>{t.zusNoFp}</span>
          </label>
        </div>
      )}
      {pracowniczy && (
        <FormRow>
          <FormField label={t.zusWorkTime} hint={t.zusWorkTimeHint}>
            <div className="zus-fraction">
              <LiczbaInput
                value={x.wymiarLicznik}
                onChange={(v) => onChange({ wymiarLicznik: v === null ? null : Math.round(v) })}
                decimals={0}
                ariaLabel={t.zusWorkTime}
              />
              <span>/</span>
              <LiczbaInput
                value={x.wymiarMianownik}
                onChange={(v) => onChange({ wymiarMianownik: v === null ? null : Math.round(v) })}
                decimals={0}
                ariaLabel={t.zusWorkTime}
              />
            </div>
          </FormField>
        </FormRow>
      )}
      {x.do && (
        <>
          <FormRow>
            <FormField label={t.zusReason}>
              <Select
                overlay
                value={x.przyczyna}
                options={OPCJE_PRZYCZYN}
                onChange={(v) => onChange({ przyczyna: v })}
                ariaLabel={t.zusReason}
              />
            </FormField>
            <label className="pit-check zus-check-inline">
              <input
                type="checkbox"
                checked={x.korektaWyrejestrowania}
                onChange={(e) => onChange({ korektaWyrejestrowania: e.target.checked })}
              />
              <span>
                {t.zusZwuaCorrection}
                <br />
                <small>{t.zusZwuaCorrectionHint}</small>
              </span>
            </label>
          </FormRow>
          {pracowniczy && (
            <>
              <p className="pod-note">{t.zusEndOfEmployment}</p>
              <FormRow>
                <FormField label={t.zusEndDate}>
                  <input
                    type="date"
                    value={x.dataRozwiazania ?? ''}
                    onChange={(e) => onChange({ dataRozwiazania: e.target.value || null })}
                  />
                </FormField>
                <FormField label={t.zusEndSide}>
                  <Select
                    overlay
                    value={x.stronaInicjujaca}
                    options={[
                      { value: '', label: '—' },
                      { value: '1', label: t.zusEndSide1 },
                      { value: '2', label: t.zusEndSide2 },
                    ]}
                    onChange={(v) => onChange({ stronaInicjujaca: v })}
                    ariaLabel={t.zusEndSide}
                  />
                </FormField>
              </FormRow>
              <FormRow>
                <FormField label={t.zusEndHow}>
                  <SearchableSelect
                    overlay
                    value={x.kodWygasniecia}
                    placeholder={t.zusPick}
                    options={OPCJE_WYGASNIECIA}
                    onChange={(v) => onChange({ kodWygasniecia: v })}
                    ariaLabel={t.zusEndHow}
                    searchPlaceholder={t.zusPickSearch}
                    emptyText={t.zusPickEmpty}
                    menuMaxWidth={640}
                  />
                </FormField>
                <FormField label={t.zusEndLaw}>
                  <SearchableSelect
                    overlay
                    value={x.kodPodstawyPrawnej}
                    placeholder={t.zusPick}
                    options={OPCJE_PODSTAW}
                    onChange={(v) => onChange({ kodPodstawyPrawnej: v })}
                    ariaLabel={t.zusEndLaw}
                    searchPlaceholder={t.zusPickSearch}
                    emptyText={t.zusPickEmpty}
                    menuMaxWidth={640}
                  />
                </FormField>
              </FormRow>
            </>
          )}
        </>
      )}
      <div className="zus-doclines">
        <ZnakDokumentu
          t={t}
          locale={locale}
          etykieta={x.schemat === 'zdrowotne' ? 'ZUS ZZA' : 'ZUS ZUA'}
          znak={x.zgloszenie}
          problemy={[...problemyPl, ...problemyZgloszenia(osoba, x)]}
          saved={saved}
          dokument={dokument('z')}
          onFiles={() => onFiles('z')}
          onSent={(w) => onSent('z', w)}
        />
        {x.do && (
          <ZnakDokumentu
            t={t}
            locale={locale}
            etykieta="ZUS ZWUA"
            znak={x.wyrejestrowanie}
            problemy={[...problemyPl, ...problemyWyrejestrowania(osoba, x)]}
            saved={saved}
            dokument={dokument('w')}
            onFiles={() => onFiles('w')}
            onSent={(w) => onSent('w', w)}
          />
        )}
      </div>
    </div>
  );
};

/* ============================== A family member ============================== */

const CzlonekForm: React.FC<{
  t: T;
  locale: string;
  osoba: ZusUbezpieczony;
  czlonek: ZusCzlonek;
  saved: boolean;
  problemyPl: ZusProblem[];
  onChange: (patch: Partial<ZusCzlonek>) => void;
  onRemove: () => void;
  onFiles: (z: 'z' | 'w') => void;
  onSent: (z: 'z' | 'w', wyslane: boolean) => void;
  /** The list's id of the member's registration ('z') or deregistration ('w'). */
  dokument: (z: 'z' | 'w') => string;
}> = ({
  t,
  locale,
  osoba,
  czlonek: c,
  saved,
  problemyPl,
  onChange,
  onRemove,
  onFiles,
  onSent,
  dokument,
}) => {
  const dataPesel = c.pesel ? dataZPesela(c.pesel) : null;
  return (
    <div className="pit-title-block">
      <div className="zus-title-head">
        <span className="pit-title-block__name">
          {`${c.nazwisko} ${c.imie}`.trim() || t.zusNewMember}
        </span>
        <button
          type="button"
          className="button button-small button-ghost icon-danger"
          onClick={onRemove}
          data-tip={t.zusMemberRemove}
          aria-label={t.zusMemberRemove}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <FormRow>
        <FormField label={t.zusSurname} required>
          <input
            type="text"
            value={c.nazwisko}
            onChange={(e) => onChange({ nazwisko: e.target.value })}
          />
        </FormField>
        <FormField label={t.zusName} required>
          <input type="text" value={c.imie} onChange={(e) => onChange({ imie: e.target.value })} />
        </FormField>
        <FormField label={t.zusPesel}>
          <input
            type="text"
            className="input-mono"
            inputMode="numeric"
            value={c.pesel}
            onChange={(e) => onChange({ pesel: tylkoCyfry(e.target.value).slice(0, 11) })}
          />
        </FormField>
        <FormField
          label={t.zusBirth}
          action={
            dataPesel && dataPesel !== c.dataUrodzenia ? (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => onChange({ dataUrodzenia: dataPesel })}
              >
                {t.zusFromPesel}
              </button>
            ) : undefined
          }
        >
          <input
            type="date"
            value={c.dataUrodzenia ?? ''}
            onChange={(e) => onChange({ dataUrodzenia: e.target.value || null })}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.zusRelation}>
          <Select
            overlay
            value={c.pokrewienstwo}
            options={OPCJE_POKREWIENSTWA}
            onChange={(v) => onChange({ pokrewienstwo: v })}
            ariaLabel={t.zusRelation}
          />
        </FormField>
        <FormField label={t.zusDisability}>
          <Select
            overlay
            value={c.niepelnosprawnosc}
            options={[
              { value: '', label: '—' },
              { value: '0', label: t.zusDisability0 },
              { value: '1', label: t.zusDisability1 },
              { value: '2', label: t.zusDisability2 },
              { value: '3', label: t.zusDisability3 },
            ]}
            onChange={(v) => onChange({ niepelnosprawnosc: v })}
            ariaLabel={t.zusDisability}
          />
        </FormField>
        <FormField label={t.zusMemberFrom}>
          <input
            type="date"
            value={c.od ?? ''}
            onChange={(e) => onChange({ od: e.target.value || null })}
          />
        </FormField>
        <FormField label={t.zusMemberTo}>
          <input
            type="date"
            value={c.do ?? ''}
            onChange={(e) => onChange({ do: e.target.value || null })}
          />
        </FormField>
      </FormRow>
      <label className="pit-check">
        <input
          type="checkbox"
          checked={c.wspolneGospodarstwo}
          onChange={(e) => onChange({ wspolneGospodarstwo: e.target.checked })}
        />
        <span>{t.zusHousehold}</span>
      </label>
      <label className="pit-check">
        <input
          type="checkbox"
          checked={c.adres === null}
          onChange={(e) => onChange({ adres: e.target.checked ? null : { ...osoba.adres } })}
        />
        <span>{t.zusMemberSameAddress}</span>
      </label>
      {c.adres && (
        <AdresPola
          t={t}
          id={`zus-c-${c.klucz}`}
          adres={c.adres}
          onChange={(a) => onChange({ adres: a })}
        />
      )}
      <div className="zus-doclines">
        {c.od && (
          <ZnakDokumentu
            t={t}
            locale={locale}
            etykieta="ZUS ZCNA"
            znak={c.zgloszenie}
            problemy={[...problemyPl, ...problemyCzlonka(osoba, c, 'z')]}
            saved={saved}
            dokument={dokument('z')}
            onFiles={() => onFiles('z')}
            onSent={(w) => onSent('z', w)}
          />
        )}
        {c.do && (
          <ZnakDokumentu
            t={t}
            locale={locale}
            etykieta={`ZUS ZCNA · ${t.zusZcnaOut}`}
            znak={c.wyrejestrowanie}
            problemy={[...problemyPl, ...problemyCzlonka(osoba, c, 'w')]}
            saved={saved}
            dokument={dokument('w')}
            onFiles={() => onFiles('w')}
            onSent={(w) => onSent('w', w)}
          />
        )}
      </div>
    </div>
  );
};

const AdresPola: React.FC<{
  t: T;
  id: string;
  adres: ZusUbezpieczony['adres'];
  onChange: (a: ZusUbezpieczony['adres']) => void;
}> = ({ t, id, adres, onChange }) => {
  const set = (k: keyof ZusUbezpieczony['adres'], v: string) => onChange({ ...adres, [k]: v });
  return (
    <>
      <FormRow>
        <FormField label={t.zusStreet} htmlFor={`${id}-ul`}>
          <input
            id={`${id}-ul`}
            type="text"
            maxLength={30}
            value={adres.ulica}
            onChange={(e) => set('ulica', e.target.value)}
          />
        </FormField>
        <FormField label={t.zusHouse} htmlFor={`${id}-dom`} required>
          <input
            id={`${id}-dom`}
            type="text"
            maxLength={7}
            value={adres.nrDomu}
            onChange={(e) => set('nrDomu', e.target.value)}
          />
        </FormField>
        <FormField label={t.zusFlat} htmlFor={`${id}-lok`}>
          <input
            id={`${id}-lok`}
            type="text"
            maxLength={7}
            value={adres.nrLokalu}
            onChange={(e) => set('nrLokalu', e.target.value)}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.zusPostcode} htmlFor={`${id}-kod`} required hint={t.zusPostcodeHint}>
          <input
            id={`${id}-kod`}
            type="text"
            className="input-mono"
            inputMode="numeric"
            value={
              adres.kodPocztowy.length === 5
                ? `${adres.kodPocztowy.slice(0, 2)}-${adres.kodPocztowy.slice(2)}`
                : adres.kodPocztowy
            }
            onChange={(e) => set('kodPocztowy', tylkoCyfry(e.target.value).slice(0, 5))}
          />
        </FormField>
        <FormField label={t.zusTown} htmlFor={`${id}-msc`} required>
          <input
            id={`${id}-msc`}
            type="text"
            maxLength={26}
            value={adres.miejscowosc}
            onChange={(e) => set('miejscowosc', e.target.value)}
          />
        </FormField>
        <FormField label={t.zusCommune} htmlFor={`${id}-gm`}>
          <input
            id={`${id}-gm`}
            type="text"
            maxLength={26}
            value={adres.gmina}
            onChange={(e) => set('gmina', e.target.value)}
          />
        </FormField>
        <FormField label={t.zusPhone} htmlFor={`${id}-tel`}>
          <input
            id={`${id}-tel`}
            type="text"
            maxLength={12}
            value={adres.telefon}
            onChange={(e) => set('telefon', e.target.value)}
          />
        </FormField>
      </FormRow>
    </>
  );
};

/* ================================ One person ================================= */

const OsobaForm: React.FC<{
  t: T;
  locale: string;
  osoba: ZusUbezpieczony;
  okres: string;
  saved: boolean;
  zwinieta: boolean;
  problemyPl: ZusProblem[];
  zawody: SearchableOption[];
  onChange: (patch: Partial<ZusUbezpieczony>) => void;
  onRemove: () => void;
  onFiles: (id: string) => void;
  onSent: (id: string, wyslane: boolean) => void;
  docId: (typ: 'z' | 'w' | 'c', klucz: string, zdarzenie?: 'z' | 'w') => string;
}> = ({
  t,
  locale,
  osoba: o,
  okres,
  saved,
  zwinieta,
  problemyPl,
  zawody,
  onChange,
  onRemove,
  onFiles,
  onSent,
  docId,
}) => {
  const id = `zus-${o.klucz}`;
  const dataPesel = o.pesel ? dataZPesela(o.pesel) : null;
  const plecPesel = o.pesel ? plecZPesela(o.pesel) : '';
  const aktywne = o.tytuly.filter((x) => tytulWOkresie(x, okres));
  const opis = [...new Set(o.tytuly.map((x) => x.kod))].join(', ');
  const setTytul = (klucz: string, patch: Partial<ZusTytul>) =>
    onChange({ tytuly: o.tytuly.map((x) => (x.klucz === klucz ? { ...x, ...patch } : x)) });
  const setCzlonek = (klucz: string, patch: Partial<ZusCzlonek>) =>
    onChange({ czlonkowie: o.czlonkowie.map((x) => (x.klucz === klucz ? { ...x, ...patch } : x)) });
  const notify = useNotify();
  return (
    <FormSection
      icon="users"
      title={nazwaUbezpieczonego(o) || t.zusNewPerson}
      description={[
        opis,
        aktywne.length > 0
          ? sub(t.zusActiveIn, { okres: monthLabel(okres, locale) })
          : t.zusNotActiveIn,
      ]
        .filter(Boolean)
        .join(' · ')}
      badge={
        o.przeglad.length > 0 ? <span className="pit-tone-warn">{t.zusRowReview}</span> : undefined
      }
      aside={
        <span className="pit-aside">
          <button
            type="button"
            className="button button-small button-ghost icon-danger"
            onClick={onRemove}
            data-tip={t.zusPersonRemove}
            aria-label={t.zusPersonRemove}
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      }
      collapsible
      defaultCollapsed={zwinieta}
      collapsedSummary={[opis, o.pesel].filter(Boolean).join(' · ') || t.zusNewPerson}
    >
      {o.przeglad.length > 0 && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            <strong>{t.zusReview}.</strong> {t.zusReviewDesc}
            <ul className="pod-problems">
              {o.przeglad.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => onChange({ przeglad: [] })}
          >
            <Icon name="check" size={13} /> {t.zusReviewDone}
          </button>
        </div>
      )}

      <div className="pit-sub">{t.zusIdentitySec}</div>
      <FormRow>
        <FormField label={t.zusSurname} htmlFor={`${id}-naz`} required>
          <input
            id={`${id}-naz`}
            type="text"
            maxLength={31}
            value={o.nazwisko}
            onChange={(e) => onChange({ nazwisko: e.target.value })}
          />
        </FormField>
        <FormField label={t.zusName} htmlFor={`${id}-imie`} required>
          <input
            id={`${id}-imie`}
            type="text"
            maxLength={22}
            value={o.imie}
            onChange={(e) => onChange({ imie: e.target.value })}
          />
        </FormField>
        <FormField label={t.zusSecondName} htmlFor={`${id}-imie2`}>
          <input
            id={`${id}-imie2`}
            type="text"
            maxLength={22}
            value={o.imieDrugie}
            onChange={(e) => onChange({ imieDrugie: e.target.value })}
          />
        </FormField>
        <FormField label={t.zusBirthName} htmlFor={`${id}-rod`}>
          <input
            id={`${id}-rod`}
            type="text"
            maxLength={31}
            value={o.nazwiskoRodowe}
            onChange={(e) => onChange({ nazwiskoRodowe: e.target.value })}
          />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label={t.zusPesel} htmlFor={`${id}-pesel`} hint={t.zusPeselHint}>
          <input
            id={`${id}-pesel`}
            type="text"
            className="input-mono"
            inputMode="numeric"
            value={o.pesel}
            onChange={(e) => onChange({ pesel: tylkoCyfry(e.target.value).slice(0, 11) })}
          />
        </FormField>
        <FormField
          label={t.zusBirth}
          htmlFor={`${id}-ur`}
          required
          action={
            dataPesel && dataPesel !== o.dataUrodzenia ? (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => onChange({ dataUrodzenia: dataPesel })}
              >
                {t.zusFromPesel}
              </button>
            ) : undefined
          }
        >
          <input
            id={`${id}-ur`}
            type="date"
            value={o.dataUrodzenia ?? ''}
            onChange={(e) => onChange({ dataUrodzenia: e.target.value || null })}
          />
        </FormField>
        <FormField
          label={t.zusSex}
          required
          action={
            plecPesel && plecPesel !== o.plec ? (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => onChange({ plec: plecPesel })}
              >
                {t.zusFromPesel}
              </button>
            ) : undefined
          }
        >
          <Select
            overlay
            value={o.plec}
            options={[
              { value: '', label: '—' },
              { value: 'K', label: t.zusSexK },
              { value: 'M', label: t.zusSexM },
            ]}
            onChange={(v) => onChange({ plec: v })}
            ariaLabel={t.zusSex}
          />
        </FormField>
        <FormField label={t.zusCitizenship} htmlFor={`${id}-ob`} required>
          <input
            id={`${id}-ob`}
            type="text"
            maxLength={22}
            value={o.obywatelstwo}
            onChange={(e) => onChange({ obywatelstwo: e.target.value })}
          />
        </FormField>
      </FormRow>
      {!o.pesel && (
        <FormRow>
          <FormField label={t.zusDocType}>
            <Select
              overlay
              value={o.rodzajDok}
              options={[
                { value: '', label: '—' },
                { value: '1', label: t.zusDocId },
                { value: '2', label: t.zusDocPassport },
              ]}
              onChange={(v) => onChange({ rodzajDok: v })}
              ariaLabel={t.zusDocType}
            />
          </FormField>
          <FormField label={t.zusDocNumber} htmlFor={`${id}-dok`}>
            <input
              id={`${id}-dok`}
              type="text"
              className="input-mono"
              maxLength={9}
              value={o.seriaNrDok}
              onChange={(e) =>
                onChange({ seriaNrDok: e.target.value.toUpperCase().replace(/\s/g, '') })
              }
            />
          </FormField>
        </FormRow>
      )}
      <FormRow>
        <FormField label={t.zusNfz} required>
          <SearchableSelect
            overlay
            value={o.kodNfz}
            placeholder={t.zusPick}
            options={OPCJE_NFZ}
            onChange={(v) => onChange({ kodNfz: v })}
            ariaLabel={t.zusNfz}
            searchPlaceholder={t.zusPickSearch}
            emptyText={t.zusPickEmpty}
          />
        </FormField>
        <FormField label={t.zusOccupation} required hint={t.zusOccupationHint}>
          <SearchableSelect
            overlay
            value={o.kodZawodu}
            placeholder={zawody.length === 0 ? t.loading : t.zusPick}
            options={zawody}
            onChange={(v) => onChange({ kodZawodu: v })}
            ariaLabel={t.zusOccupation}
            searchPlaceholder={t.zusPickSearch}
            emptyText={t.zusPickEmpty}
            menuMaxWidth={560}
          />
        </FormField>
      </FormRow>

      <div className="pit-sub">{t.zusAddressSec}</div>
      <AdresPola t={t} id={`${id}-a`} adres={o.adres} onChange={(a) => onChange({ adres: a })} />
      <label className="pit-check">
        <input
          type="checkbox"
          checked={o.adresZamieszkania !== null}
          onChange={(e) =>
            onChange({ adresZamieszkania: e.target.checked ? { ...o.adres } : null })
          }
        />
        <span>{t.zusOtherAddress}</span>
      </label>
      {o.adresZamieszkania && (
        <AdresPola
          t={t}
          id={`${id}-z`}
          adres={o.adresZamieszkania}
          onChange={(a) => onChange({ adresZamieszkania: a })}
        />
      )}

      <div className="pit-sub">{t.zusTitlesSec}</div>
      <p className="pod-note">{t.zusTitlesDesc}</p>
      {o.tytuly.map((x) => (
        <TytulForm
          key={x.klucz}
          t={t}
          locale={locale}
          osoba={o}
          tytul={x}
          okres={okres}
          saved={saved}
          problemyPl={problemyPl}
          onChange={(patch) => setTytul(x.klucz, patch)}
          onRemove={async () => {
            if (
              await notify.confirm(t.zusTitleRemoveConfirm, {
                danger: true,
                confirmLabel: t.zusDelete,
              })
            ) {
              onChange({ tytuly: o.tytuly.filter((y) => y.klucz !== x.klucz) });
            }
          }}
          onFiles={(r) => onFiles(docId(r, x.klucz))}
          onSent={(r, w) => onSent(docId(r, x.klucz), w)}
          dokument={(r) => docId(r, x.klucz)}
        />
      ))}
      <div className="pit-fill">
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() =>
            onChange({ tytuly: [...o.tytuly, { ...pustyTytul('0411'), od: `${okres}-01` }] })
          }
        >
          <Icon name="plus" size={13} /> {t.zusAddMandate}
        </button>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() =>
            onChange({ tytuly: [...o.tytuly, { ...pustyTytul('0110'), od: `${okres}-01` }] })
          }
        >
          <Icon name="plus" size={13} /> {t.zusAddEmployment}
        </button>
        <button
          type="button"
          className="button button-small button-ghost"
          onClick={() =>
            onChange({
              tytuly: [
                ...o.tytuly,
                {
                  ...pustyTytul('0411'),
                  schemat: 'zdrowotne',
                  emerytalne: false,
                  rentowe: false,
                  wypadkowe: false,
                  od: `${okres}-01`,
                },
              ],
            })
          }
        >
          <Icon name="plus" size={13} /> {t.zusAddHealthOnly}
        </button>
      </div>

      <div className="pit-sub">{t.zusFamilySec}</div>
      <p className="pod-note">{t.zusFamilyDesc}</p>
      {o.czlonkowie.map((c) => (
        <CzlonekForm
          key={c.klucz}
          t={t}
          locale={locale}
          osoba={o}
          czlonek={c}
          saved={saved}
          problemyPl={problemyPl}
          onChange={(patch) => setCzlonek(c.klucz, patch)}
          onRemove={async () => {
            if (
              await notify.confirm(t.zusMemberRemoveConfirm, {
                danger: true,
                confirmLabel: t.zusDelete,
              })
            ) {
              onChange({ czlonkowie: o.czlonkowie.filter((y) => y.klucz !== c.klucz) });
            }
          }}
          onFiles={(z) => onFiles(docId('c', c.klucz, z))}
          onSent={(z, w) => onSent(docId('c', c.klucz, z), w)}
          dokument={(z) => docId('c', c.klucz, z)}
        />
      ))}
      <div>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() =>
            onChange({ czlonkowie: [...o.czlonkowie, { ...pustyCzlonek(), od: `${okres}-01` }] })
          }
        >
          <Icon name="plus" size={13} /> {t.zusAddMember}
        </button>
      </div>
    </FormSection>
  );
};

/* ============================== The payer's screen ============================== */

/** Marks and downloads are written by their own calls — a form's equality leaves them out. */
const ZNAKI = ['zgloszenie', 'wyrejestrowanie', 'pobrania'] as const;
const takieSamePlatnik = (a: ZusPlatnikDane, b: ZusPlatnikDane): boolean => {
  if (a === b) return true;
  if (!structuralEqual(a, b, ['ubezpieczeni'])) return false;
  if (a.ubezpieczeni.length !== b.ubezpieczeni.length) return false;
  return a.ubezpieczeni.every((o, i) => {
    const p = b.ubezpieczeni[i];
    if (!structuralEqual(o, p, ['tytuly', 'czlonkowie'])) return false;
    if (o.tytuly.length !== p.tytuly.length || o.czlonkowie.length !== p.czlonkowie.length)
      return false;
    return (
      o.tytuly.every((x, j) => structuralEqual(x, p.tytuly[j], ZNAKI)) &&
      o.czlonkowie.every((x, j) => structuralEqual(x, p.czlonkowie[j], ZNAKI))
    );
  });
};
const takieSameRozl = (a: ZusRozliczenieDane | null, b: ZusRozliczenieDane | null) =>
  a === b || (!!a && !!b && structuralEqual(a, b, ['wyslane', 'pobrania']));

const PlatnikScreen: React.FC<{
  t: T;
  locale: string;
  okres: string;
  rekord: PodatekZusPlatnik | null;
  rozliczenia: PodatekZusRozliczenie[];
  wszyscy: PodatekZusPlatnik[];
  rejestr: Rejestr[];
  wstepnie: Rejestr | null;
  onBack: () => void;
  onSaved: (p: PodatekZusPlatnik, r: PodatekZusRozliczenie | null) => void;
  onDeleted: () => void;
  onFiles: (ids: string[]) => void;
  onSent: (ids: string[], wyslane: boolean) => void;
  onKorekta: (rozliczenieId: number) => void;
  onOkres: (okres: string) => void;
}> = ({
  t,
  locale,
  okres,
  rekord,
  rozliczenia,
  wszyscy,
  rejestr,
  wstepnie,
  onBack,
  onSaved,
  onDeleted,
  onFiles,
  onSent,
  onKorekta,
  onOkres,
}) => {
  const notify = useNotify();
  const zawody = useZawody();
  const [nip, setNip] = useState(rekord?.nip ?? wstepnie?.nip ?? '');
  const [dane, setDane] = useState<ZusPlatnikDane>(
    rekord?.dane ?? {
      ...pusteDaneZusPlatnika(),
      nazwaSkrocona: wstepnie ? nazwaSkroconaZAdresu(wstepnie.nazwa) : '',
      regon: wstepnie?.regon ?? '',
    }
  );
  const wersje = useMemo(
    () =>
      rekord
        ? rozliczenia
            .filter((r) => r.nip === rekord.nip && r.okres === okres)
            .sort((a, b) => a.identyfikator - b.identyfikator)
        : [],
    [rozliczenia, rekord, okres]
  );
  const rozlRekord = wersje[wersje.length - 1] ?? null;
  const [rozl, setRozl] = useState<ZusRozliczenieDane | null>(rozlRekord?.dane ?? null);
  const [baseline, setBaseline] = useState<{
    nip: string;
    dane: ZusPlatnikDane;
    rozl: ZusRozliczenieDane | null;
  } | null>(() =>
    rekord ? { nip: rekord.nip, dane: rekord.dane, rozl: rozlRekord?.dane ?? null } : null
  );
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [pickOsoba, setPickOsoba] = useState('');
  const [zwin, setZwin] = useState<{ wersja: number; wszystkie: boolean }>({
    wersja: 0,
    wszystkie: true,
  });
  const noweKlucze = useRef<Set<string>>(new Set());

  // The marks and downloads written meanwhile by their own calls reach the draft without touching the edits.
  useEffect(() => {
    if (!rekord) return;
    const osoby = new Map(rekord.dane.ubezpieczeni.map((o) => [o.klucz, o]));
    setDane((d) => ({
      ...d,
      ubezpieczeni: d.ubezpieczeni.map((o) => {
        const r = osoby.get(o.klucz);
        if (!r) return o;
        const tyt = new Map(r.tytuly.map((x) => [x.klucz, x]));
        const czl = new Map(r.czlonkowie.map((x) => [x.klucz, x]));
        return {
          ...o,
          tytuly: o.tytuly.map((x) => {
            const s = tyt.get(x.klucz);
            return s
              ? {
                  ...x,
                  zgloszenie: s.zgloszenie,
                  wyrejestrowanie: s.wyrejestrowanie,
                  pobrania: s.pobrania,
                }
              : x;
          }),
          czlonkowie: o.czlonkowie.map((x) => {
            const s = czl.get(x.klucz);
            return s
              ? {
                  ...x,
                  zgloszenie: s.zgloszenie,
                  wyrejestrowanie: s.wyrejestrowanie,
                  pobrania: s.pobrania,
                }
              : x;
          }),
        };
      }),
    }));
  }, [rekord]);
  // A new version of the month (a correction made from this screen) replaces the form's set and its baseline;
  // the same version only brings its mark and downloads.
  const rozlId = useRef(rozlRekord?.id ?? null);
  useEffect(() => {
    if (!rozlRekord) return;
    if (rozlRekord.id !== rozlId.current) {
      rozlId.current = rozlRekord.id;
      setRozl(rozlRekord.dane);
      setBaseline((b) => (b ? { ...b, rozl: rozlRekord.dane } : b));
      return;
    }
    setRozl((d) =>
      d ? { ...d, wyslane: rozlRekord.dane.wyslane, pobrania: rozlRekord.dane.pobrania } : d
    );
  }, [rozlRekord]);

  const dirty = useMemo(
    () =>
      !baseline ||
      baseline.nip !== nip ||
      !takieSamePlatnik(dane, baseline.dane) ||
      !takieSameRozl(rozl, baseline.rozl),
    [baseline, nip, dane, rozl]
  );
  const canAdd = /^\d{10}$/.test(nip) && dane.nazwaSkrocona.trim() !== '';
  const problemyPl = useMemo(() => problemyPlatnika(nip, dane), [nip, dane]);
  const saved = !!rekord && !dirty;
  const wczesniejsze = useMemo(
    () => (rekord ? biezaceRozliczenia(rozliczenia, rekord.nip) : []),
    [rozliczenia, rekord]
  );

  /** People of the other payers, one entry each, to add a caretaker who works for several communities. */
  const zInnych = useMemo(() => {
    const tu = new Set(dane.ubezpieczeni.map(kluczTozsamosci));
    const m = new Map<string, ZusUbezpieczony>();
    for (const p of wszyscy) {
      if (p.id === rekord?.id) continue;
      for (const o of p.dane.ubezpieczeni)
        if (!tu.has(kluczTozsamosci(o)) && !m.has(kluczTozsamosci(o))) m.set(kluczTozsamosci(o), o);
    }
    return [...m.values()].sort((a, b) =>
      nazwaUbezpieczonego(a).localeCompare(nazwaUbezpieczonego(b), 'pl')
    );
  }, [wszyscy, rekord?.id, dane.ubezpieczeni]);

  const setOsoba = (klucz: string, patch: Partial<ZusUbezpieczony>) =>
    setDane((d) => ({
      ...d,
      ubezpieczeni: d.ubezpieczeni.map((o) => (o.klucz === klucz ? { ...o, ...patch } : o)),
    }));
  const dodajOsobe = (z?: ZusUbezpieczony) => {
    const nowa: ZusUbezpieczony = z
      ? {
          ...pustyUbezpieczony(),
          ...z,
          klucz: pustyUbezpieczony().klucz,
          tytuly: [],
          czlonkowie: [],
          przeglad: [],
        }
      : { ...pustyUbezpieczony(), tytuly: [{ ...pustyTytul('0411'), od: `${okres}-01` }] };
    noweKlucze.current.add(nowa.klucz);
    setDane((d) => ({ ...d, ubezpieczeni: [...d.ubezpieczeni, nowa] }));
  };

  const save = async (): Promise<boolean> => {
    setBusy('save');
    try {
      const p = rekord
        ? await window.electronAPI.setPodatekZus(rekord.id, dane)
        : await window.electronAPI.addPodatekZus(nip, dane);
      let r: PodatekZusRozliczenie | null = rozlRekord;
      if (rozl && !takieSameRozl(rozl, baseline?.rozl ?? null)) {
        r = rozlRekord
          ? await window.electronAPI.setZusRozliczenie(rozlRekord.id, rozl)
          : await window.electronAPI.addZusRozliczenie(p.nip, okres, 1, rozl);
      }
      if (!rozl && rozlRekord && !rozlRekord.dane.wyslane) {
        await window.electronAPI.deleteZusRozliczenie(rozlRekord.id);
        r = null;
      }
      setNip(p.nip);
      setDane(p.dane);
      setRozl(r?.dane ?? null);
      setBaseline({ nip: p.nip, dane: p.dane, rozl: r?.dane ?? null });
      notify.success(t.zusSaved);
      onSaved(p, r);
      return true;
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusSaveError);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirmLeave = async (): Promise<boolean> => {
    if (!dirty) return true;
    const canSave = !!rekord || canAdd;
    const choice = await notify.unsaved(canSave ? t.zusUnsavedConfirm : t.zusUnsavedNoSave, {
      saveLabel: t.zusUnsavedSave,
      discardLabel: t.zusUnsavedDiscard,
      keepLabel: t.zusUnsavedKeep,
      canSave,
    });
    if (choice === 'keep') return false;
    return choice === 'discard' || (await save());
  };
  useLeaveGuard(dirty ? confirmLeave : null);

  const remove = async () => {
    if (!rekord) return;
    if (
      !(await notify.confirm(sub(t.zusDeleteConfirm, { name: dane.nazwaSkrocona || rekord.nip }), {
        danger: true,
        confirmLabel: t.zusDelete,
      }))
    )
      return;
    setBusy('delete');
    try {
      await window.electronAPI.deletePodatekZus(rekord.id);
      notify.success(t.zusDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
      setBusy(null);
    }
  };

  const docId = (osoba: string) => (typ: 'z' | 'w' | 'c', klucz: string, zdarzenie?: 'z' | 'w') =>
    rekord
      ? typ === 'c'
        ? `c:${rekord.id}:${osoba}:${klucz}:${zdarzenie}`
        : `${typ}:${rekord.id}:${osoba}:${klucz}`
      : '';
  const { wysylki, wyslij } = useContext(ZusWysylkiContext);
  const listaMiesiaca = rekord
    ? dokumentyPlatnika(t, { ...rekord, dane }, rozliczenia, okres, wysylki).lista
    : [];
  const dokumentyMiesiaca = listaMiesiaca.filter((d) => d.stan !== 'brak').map((d) => d.id);
  /** The month's documents "Podpisz i wyślij do ZUS" takes — as the list's selection bar has it. */
  const doZusMiesiaca = listaMiesiaca
    .filter((d) => (d.stan === 'gotowe' || d.stan === 'uwagi') && !wysylkaTrwa(d.wysylka))
    .map((d) => d.id);
  const zablokowane = dirty || !rekord ? t.zusSaveFirst : null;
  const parametry = zusParametry(okres);

  const note =
    !rekord && !canAdd ? (
      <span className="action-note">
        <Icon name="info" size={13} /> {t.zusNewNeeds}
      </span>
    ) : dirty ? (
      <span className="action-note action-note--warning">
        <Icon name="alert-triangle" size={13} /> {t.zusUnsaved}
      </span>
    ) : (
      <span className="action-note">
        <Icon name="check" size={13} /> {t.zusAllSaved}
      </span>
    );

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.zusBack}
            crumb={`ZUS · ${monthLabel(okres, locale)}`}
            onBack={() => void (async () => (await confirmLeave()) && onBack())()}
            title={dane.nazwaSkrocona || t.zusNew}
            meta={
              <>
                {nip && (
                  <span>
                    <Icon name="file-text" size={13} /> {sub(t.zusRowNip, { nip })}
                  </span>
                )}
                <span>
                  <Icon name="users" size={13} />{' '}
                  {sub(t.zusRowPeople, { n: dane.ubezpieczeni.length })}
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
                <Icon name="trash" size={13} /> {t.zusDelete}
              </button>
              <span className="toolbar-divider" aria-hidden="true" />
              {doZusMiesiaca.length > 0 && (
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => wyslij(doZusMiesiaca)}
                  disabled={zablokowane !== null || busy !== null}
                  data-tip={zablokowane ?? t.zusSendBatchHint}
                >
                  <Icon name="upload" size={13} /> {sub(t.zusSendBatch, { n: doZusMiesiaca.length })}
                </button>
              )}
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => onFiles(dokumentyMiesiaca)}
                disabled={zablokowane !== null || busy !== null || dokumentyMiesiaca.length === 0}
                data-tip={zablokowane ?? undefined}
              >
                <Icon name="download" size={13} />{' '}
                {sub(t.zusDownloadMonth, { n: dokumentyMiesiaca.length })}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="content-body">
        <div className="page-form">
          <FormSection
            icon="landmark"
            title={t.zusPayerTitle}
            description={t.zusPayerDesc}
            collapsible={!!rekord}
            defaultCollapsed={!!rekord && problemyPl.length === 0}
            collapsedSummary={`NIP ${nip} · REGON ${dane.regon || '—'}`}
          >
            {!rekord && rejestr.length > 0 && (
              <FormField label={t.zusPayerPick}>
                <SearchableSelect
                  overlay
                  value=""
                  placeholder={t.zusPayerPickPlaceholder}
                  options={rejestr
                    .filter((r) => !wszyscy.some((p) => p.nip === r.nip && r.nip))
                    .map((r) => ({ value: r.nazwa, label: r.nazwa }))}
                  onChange={(v) => {
                    const r = rejestr.find((x) => x.nazwa === v);
                    if (!r) return;
                    if (r.nip) setNip(r.nip);
                    setDane((d) => ({
                      ...d,
                      nazwaSkrocona: d.nazwaSkrocona || nazwaSkroconaZAdresu(r.nazwa),
                      regon: d.regon || r.regon,
                    }));
                  }}
                  ariaLabel={t.zusPayerPick}
                  searchPlaceholder={t.zusPickSearch}
                  emptyText={t.zusPickEmpty}
                />
              </FormField>
            )}
            <FormRow>
              <FormField label={t.zusNip} htmlFor="zus-nip" required>
                <input
                  id="zus-nip"
                  type="text"
                  className="input-mono"
                  inputMode="numeric"
                  value={nip}
                  disabled={!!rekord}
                  onChange={(e) => setNip(tylkoCyfry(e.target.value).slice(0, 10))}
                />
              </FormField>
              <FormField label={t.zusRegon} htmlFor="zus-regon" required>
                <input
                  id="zus-regon"
                  type="text"
                  className="input-mono"
                  inputMode="numeric"
                  value={dane.regon}
                  onChange={(e) =>
                    setDane((d) => ({ ...d, regon: tylkoCyfry(e.target.value).slice(0, 14) }))
                  }
                />
              </FormField>
              <FormField
                label={t.zusShortName}
                htmlFor="zus-nazwa"
                required
                hint={t.zusShortNameHint}
              >
                <input
                  id="zus-nazwa"
                  type="text"
                  maxLength={31}
                  value={dane.nazwaSkrocona}
                  onChange={(e) => setDane((d) => ({ ...d, nazwaSkrocona: e.target.value }))}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={t.zusAccidentRate} hint={t.zusAccidentRateHint}>
                <LiczbaInput
                  value={dane.stopaWypadkowa}
                  onChange={(v) => setDane((d) => ({ ...d, stopaWypadkowa: v }))}
                  decimals={2}
                  unit="%"
                  ariaLabel={t.zusAccidentRate}
                />
              </FormField>
              <FormField label={t.zusDeadlineCode}>
                <Select
                  overlay
                  value={dane.terminDra}
                  options={OPCJE_TERMINU}
                  onChange={(v) => setDane((d) => ({ ...d, terminDra: v }))}
                  ariaLabel={t.zusDeadlineCode}
                />
              </FormField>
              <FormField label={t.zusAccount} htmlFor="zus-nrs" hint={t.zusAccountHint}>
                <input
                  id="zus-nrs"
                  type="text"
                  className="input-mono"
                  inputMode="numeric"
                  value={dane.rachunek}
                  onChange={(e) =>
                    setDane((d) => ({ ...d, rachunek: tylkoCyfry(e.target.value).slice(0, 26) }))
                  }
                />
              </FormField>
            </FormRow>
            <label className="pit-check">
              <input
                type="checkbox"
                checked={dane.fp}
                onChange={(e) => setDane((d) => ({ ...d, fp: e.target.checked }))}
              />
              <span>
                {t.zusPaysFp}
                <br />
                <small>{sub(t.zusPaysFpHint, { placa: zl2(parametry.placaMinimalna) })}</small>
              </span>
            </label>
            <label className="pit-check">
              <input
                type="checkbox"
                checked={dane.fgsp}
                onChange={(e) => setDane((d) => ({ ...d, fgsp: e.target.checked }))}
              />
              <span>
                {t.zusPaysFgsp}
                <br />
                <small>{t.zusPaysFgspHint}</small>
              </span>
            </label>
            {dane.stopaWypadkowa === null && (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => setDane((d) => ({ ...d, stopaWypadkowa: STOPA_WYPADKOWA_DOMYSLNA }))}
              >
                {sub(t.zusAccidentRateDefault, { stopa: STOPA_WYPADKOWA_DOMYSLNA })}
              </button>
            )}
          </FormSection>

          {rekord ? (
            <RozliczenieForm
              t={t}
              locale={locale}
              okres={okres}
              nip={nip}
              platnik={dane}
              rekord={rozlRekord}
              wersje={wersje}
              wczesniejsze={wczesniejsze.filter((r) => r.okres !== okres)}
              dane={rozl}
              saved={saved}
              onChange={setRozl}
              onFiles={() => onFiles([idRozliczenia(rekord.id, okres)])}
              onSent={(w) => onSent([idRozliczenia(rekord.id, okres)], w)}
              dokument={idRozliczenia(rekord.id, okres)}
              onKorekta={() => rozlRekord && onKorekta(rozlRekord.id)}
              onOkres={(o) => void (async () => (await confirmLeave()) && onOkres(o))()}
            />
          ) : (
            <p className="pod-note">{t.zusSetAfterSave}</p>
          )}

          <FormSection
            icon="users"
            title={t.zusPeopleTitle}
            description={t.zusPeopleDesc}
            aside={
              <span className="pit-aside">
                {zInnych.length > 0 && (
                  <SearchableSelect
                    overlay
                    value={pickOsoba}
                    placeholder={t.zusAddPersonFrom}
                    options={zInnych.map((o) => ({
                      value: kluczTozsamosci(o),
                      label: nazwaUbezpieczonego(o),
                      hint: o.pesel || undefined,
                    }))}
                    onChange={(v) => {
                      setPickOsoba('');
                      const o = zInnych.find((x) => kluczTozsamosci(x) === v);
                      if (o) dodajOsobe(o);
                    }}
                    ariaLabel={t.zusAddPersonFrom}
                    searchPlaceholder={t.zusPickSearch}
                    emptyText={t.zusPickEmpty}
                  />
                )}
                {dane.ubezpieczeni.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      onClick={() => setZwin((z) => ({ wersja: z.wersja + 1, wszystkie: false }))}
                    >
                      <Icon name="chevron-down" size={13} /> {t.zusExpandAll}
                    </button>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      onClick={() => {
                        noweKlucze.current.clear();
                        setZwin((z) => ({ wersja: z.wersja + 1, wszystkie: true }));
                      }}
                    >
                      <Icon name="chevron-right" size={13} /> {t.zusCollapseAll}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => dodajOsobe()}
                >
                  <Icon name="plus" size={13} /> {t.zusAddPerson}
                </button>
              </span>
            }
          >
            {dane.ubezpieczeni.length === 0 && <p className="pod-note">{t.zusNoPeople}</p>}
          </FormSection>

          {[...dane.ubezpieczeni]
            .sort(
              (a, b) =>
                Number(b.tytuly.some((x) => tytulWOkresie(x, okres))) -
                  Number(a.tytuly.some((x) => tytulWOkresie(x, okres))) ||
                nazwaUbezpieczonego(a).localeCompare(nazwaUbezpieczonego(b), 'pl')
            )
            .map((o) => (
              <OsobaForm
                key={`${o.klucz}-${zwin.wersja}`}
                t={t}
                locale={locale}
                osoba={o}
                okres={okres}
                saved={saved}
                zwinieta={zwin.wszystkie && !noweKlucze.current.has(o.klucz)}
                problemyPl={problemyPl}
                zawody={zawody}
                onChange={(patch) => setOsoba(o.klucz, patch)}
                onRemove={async () => {
                  if (
                    await notify.confirm(
                      sub(t.zusPersonRemoveConfirm, {
                        name: nazwaUbezpieczonego(o) || t.zusNewPerson,
                      }),
                      { danger: true, confirmLabel: t.zusDelete }
                    )
                  ) {
                    setDane((d) => ({
                      ...d,
                      ubezpieczeni: d.ubezpieczeni.filter((x) => x.klucz !== o.klucz),
                    }));
                  }
                }}
                onFiles={(id) => id && onFiles([id])}
                onSent={(id, w) => id && onSent([id], w)}
                docId={docId(o.klucz)}
              />
            ))}

          <ModalFooter
            className="page-action-bar"
            note={note}
            onSubmit={() => void save()}
            submitLabel={rekord ? t.zusSave : t.zusAdd}
            submitIcon={rekord ? 'save' : 'plus'}
            submitDisabled={!dirty || (!rekord && !canAdd)}
            submitTitle={!rekord && !canAdd ? t.zusNewNeeds : undefined}
            busy={busy === 'save'}
          />
        </div>
      </div>
    </>
  );
};

/* ================================ Result window ================================ */

const PlikiModal: React.FC<{
  t: T;
  n: number;
  onSubmit: (o: PodatkiZusPlikiOpcje) => void;
  onClose: () => void;
}> = ({ t, n, onSubmit, onClose }) => {
  const [kedu, setKedu] = useState<PodatkiZusPlikiOpcje['kedu']>(n > 1 ? 'razem' : 'osobno');
  const [pdf, setPdf] = useState(true);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="download"
          tone="accent"
          title={t.zusFilesTitle}
          subtitle={sub(t.zusFilesSubtitle, { n })}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="file-text" title={t.zusFilesKeduSection} description={t.zusFilesDesc}>
            <ChoiceCards
              single
              stacked
              options={[
                { value: 'razem', label: t.zusFilesTogether, hint: t.zusFilesTogetherHint },
                { value: 'osobno', label: t.zusFilesSeparate, hint: t.zusFilesSeparateHint },
                { value: 'brak', label: t.zusFilesNoKedu, hint: t.zusFilesNoKeduHint },
              ]}
              selected={[kedu]}
              onToggle={setKedu}
            />
          </FormSection>
          <FormSection icon="file-check" title={t.zusFilesPdfSection}>
            <ChoiceCards
              stacked
              options={[{ value: 'pdf', label: t.zusFilesPdf, hint: t.zusFilesPdfHint }]}
              selected={pdf ? ['pdf'] : []}
              onToggle={() => setPdf((v) => !v)}
            />
          </FormSection>
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          onSubmit={() => onSubmit({ kedu, pdf })}
          submitLabel={t.zusFilesSubmit}
          submitIcon="download"
          submitDisabled={kedu === 'brak' && !pdf}
        />
      </div>
    </div>
  );
};

const Podsumowanie: React.FC<{
  t: T;
  wynik: PodatkiZusPlikiResult;
  onZaznacz: (ids: string[]) => void;
  onClose: () => void;
}> = ({ t, wynik, onZaznacz, onClose }) => {
  const notify = useNotify();
  const { folder, zapisane, pominiete } = wynik;
  const otworz = async (sciezka: string) => {
    if (!(await window.electronAPI.openFile(sciezka))) notify.error(t.zusSumFileMissing);
  };
  const pliki = [...new Map(zapisane.map((p) => [p.sciezka, p])).values()];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon={zapisane.length > 0 && pominiete.length === 0 ? 'check-circle' : 'alert-triangle'}
          tone={zapisane.length === 0 ? 'danger' : 'accent'}
          title={t.zusSumTitle}
          subtitle={t.zusSumSubtitle}
        />
        <div className="modal-body modal-body--sectioned">
          {zapisane.length === 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-circle" size={16} />
              <div className="callout__body">{t.zusSumNothing}</div>
            </div>
          )}
          {pliki.length > 0 && (
            <FormSection icon="download" title={sub(t.zusSumSaved, { n: pliki.length })}>
              {folder && (
                <div className="podpis-sum__folder">{sub(t.zusSumFolder, { folder })}</div>
              )}
              <ul className="podpis-sum__list">
                {pliki.slice(0, 60).map((p, i) => (
                  <li key={`${p.sciezka}${i}`}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <button
                      type="button"
                      className="podpis-sum__file"
                      onClick={() => void otworz(p.sciezka)}
                    >
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
              title={sub(t.zusSumSkipped, { n: pominiete.length })}
            >
              {/* One card per document: its name, then each blocking error on a line of its own. */}
              <ul className="podpis-sum__list podpis-sum__list--skipped">
                {pominiete.map((p) => (
                  <li key={p.id}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    {p.powod.split('\n').map((r, i) => (
                      <span key={i} className="podpis-sum__reason">
                        <Icon name="alert-circle" size={13} /> {r}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </FormSection>
          )}
          {zapisane.length > 0 && <p className="pod-note">{t.zusSumNext}</p>}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          secondaryAction={
            pominiete.length > 0 ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onZaznacz(pominiete.map((p) => p.id));
                  onClose();
                }}
              >
                <Icon name="check-circle" size={14} />{' '}
                {sub(t.zusSumSelectRest, { n: pominiete.length })}
              </button>
            ) : undefined
          }
          onSubmit={folder ? () => void otworz(folder) : undefined}
          submitLabel={t.zusSumOpenFolder}
          submitIcon="folder"
          autoFocus={folder ? 'submit' : 'cancel'}
        />
      </div>
    </div>
  );
};

/* ================================== The tab ================================== */

const PodatkiZus: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [platnicy, setPlatnicy] = useState<PodatekZusPlatnik[]>([]);
  const [rozliczenia, setRozliczenia] = useState<PodatekZusRozliczenie[]>([]);
  const [wysylki, setWysylki] = useState<ZusWysylka[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<null | 'import' | 'prepare' | 'files' | 'sent' | 'confirm'>(
    null
  );
  const [okres, setOkres] = useState(dzisOkres());
  const [search, setSearch] = useState('');
  const [filtr, setFiltr] = useState<Filtr>('all');
  const [rozwiniete, setRozwiniete] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plikiIds, setPlikiIds] = useState<string[] | null>(null);
  const [podsumowanie, setPodsumowanie] = useState<PodatkiZusPlikiResult | null>(null);
  /** "Podpisz i wyślij do ZUS" open for these documents. */
  const [wyslijIds, setWyslijIds] = useState<string[] | null>(null);
  const [wynikWysylki, setWynikWysylki] = useState<PodatkiZusWyslijResult | null>(null);
  const [nowyZ, setNowyZ] = useState<Rejestr | null>(null);
  const lastTickedRef = useRef<string | null>(null);
  const navItem = useNavItem();
  const detail: number | 'nowy' | null =
    navItem.item === 'nowy'
      ? 'nowy'
      : navItem.item && /^\d+$/.test(navItem.item)
        ? Number(navItem.item)
        : null;

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [lista, adr] = await Promise.all([
        window.electronAPI.getPodatkiZus(),
        window.electronAPI.getAdresy().catch(() => []),
      ]);
      setPlatnicy(lista.platnicy);
      setRozliczenia(lista.rozliczenia);
      setWysylki(lista.wysylki);
      setAdresy(adr);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sends that changed (a confirmation, a settlement) swapped in by id. */
  const podmienWysylki = (zmienione: ZusWysylka[]) => {
    if (zmienione.length === 0) return;
    const poId = new Map(zmienione.map((w) => [w.id, w]));
    setWysylki((prev) => prev.map((w) => poId.get(w.id) ?? w));
  };

  // Confirmations the automat fetched in the background: the sends and the marks reloaded, and a word about it.
  useEffect(
    () =>
      window.electronAPI.onZusPotwierdzenie((wynik) => {
        const ok = wynik.wyniki.filter((w) => w.etap === 'przyjeta').length;
        const odrzucone = wynik.wyniki.filter((w) => w.etap === 'odrzucona');
        const msg = sub(t.zusConfirmPush, { ok, odrz: odrzucone.length });
        if (odrzucone.length > 0) {
          notify.warning(
            `${msg} ${sub(t.zusConfirmPushRejected, { list: odrzucone.map((w) => w.nazwa).join('; ') })}`,
            wynik.folder ? { file: wynik.folder } : undefined
          );
        } else if (ok > 0) {
          notify.success(msg, wynik.folder ? { file: wynik.folder } : undefined);
        }
        void load(true);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language]
  );
  /** Communities of Adresy; a payer is matched by NIP (Adresy → identyfikacja), else by the name's core. */
  const rejestr = useMemo<Rejestr[]>(
    () =>
      adresy
        .map((a) => ({
          nazwa: a.nazwa,
          rdzen: rdzenPlatnika(a.nazwa),
          nip: a.identyfikacja?.nip ?? '',
          regon: a.identyfikacja?.regon ?? '',
        }))
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true })),
    [adresy]
  );
  const bezPlatnika = useMemo(
    () =>
      rejestr.filter(
        (r) =>
          !platnicy.some(
            (p) => (r.nip && p.nip === r.nip) || rdzenPlatnika(p.dane.nazwaSkrocona) === r.rdzen
          )
      ),
    [rejestr, platnicy]
  );

  const miesiac = useMemo(
    () =>
      platnicy.map((p) => {
        const d = dokumentyPlatnika(t, p, rozliczenia, okres, wysylki);
        const ubezpieczonych = new Set(tytulyWOkresie(p.dane, okres).map((x) => x.osoba.klucz))
          .size;
        return { p, ...d, ubezpieczonych };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platnicy, rozliczenia, okres, wysylki, language]
  );
  const aktywni = miesiac.filter((m) => m.lista.length > 0);
  const nieaktywni = miesiac.filter((m) => m.lista.length === 0);
  const dokumentyMiesiaca = aktywni.flatMap((m) => m.lista);
  const poId = useMemo(() => new Map(dokumentyMiesiaca.map((d) => [d.id, d])), [dokumentyMiesiaca]);

  const wFiltrze = (m: (typeof miesiac)[number], f: Filtr): boolean => {
    const stany = m.lista.map((d) => d.stan);
    switch (f) {
      case 'all':
        return true;
      case 'errors':
        return stany.some((s) => s === 'blad' || s === 'brak');
      case 'ready':
        return stany.some((s) => s === 'gotowe' || s === 'uwagi');
      case 'waiting':
        return stany.some((s) => s !== 'wyslane');
      case 'sent':
        return stany.length > 0 && stany.every((s) => s === 'wyslane');
    }
  };
  const liczniki = useMemo(() => {
    const c: Record<Filtr, number> = { all: 0, errors: 0, ready: 0, waiting: 0, sent: 0 };
    for (const m of aktywni) for (const f of FILTRY) if (wFiltrze(m, f)) c[f] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktywni]);

  const visible = useMemo(() => {
    const q = foldText(search.trim());
    const cyfry = q.replace(/\D/g, '');
    return aktywni
      .filter((m) => wFiltrze(m, filtr))
      .filter(
        (m) =>
          !q ||
          foldText(m.p.dane.nazwaSkrocona).includes(q) ||
          (cyfry !== '' && m.p.nip.includes(cyfry)) ||
          m.p.dane.ubezpieczeni.some((o) => foldText(nazwaUbezpieczonego(o)).includes(q))
      )
      .sort((a, b) =>
        a.p.dane.nazwaSkrocona.localeCompare(b.p.dane.nazwaSkrocona, 'pl', { numeric: true })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktywni, search, filtr]);

  const widoczne = visible.flatMap((m) => m.lista.map((d) => d.id));
  const zaznaczone = widoczne.filter((id) => selected.has(id));
  const wszystkieZaznaczone = widoczne.length > 0 && widoczne.every((id) => selected.has(id));
  const czesciowo = widoczne.some((id) => selected.has(id)) && !wszystkieZaznaczone;

  const toggle = (ids: string[], range = false, kotwica?: string) => {
    const turnOn = !ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      let cel = ids;
      if (range && kotwica && lastTickedRef.current) {
        const a = widoczne.indexOf(lastTickedRef.current);
        const b = widoczne.indexOf(kotwica);
        if (a >= 0 && b >= 0) cel = widoczne.slice(Math.min(a, b), Math.max(a, b) + 1);
      }
      for (const id of cel) {
        if (turnOn) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastTickedRef.current = kotwica ?? ids[0] ?? null;
  };
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of widoczne) {
        if (wszystkieZaznaczone) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    lastTickedRef.current = null;
  };
  const zmienOkres = (o: string) => {
    setOkres(o);
    setSelected(new Set());
    lastTickedRef.current = null;
  };

  /** The months worth picking: every one with a settlement, plus this and next month and the one on screen; the arrows reach the rest. */
  const okresy = useMemo(
    () =>
      [
        ...new Set([
          ...rozliczenia.map((r) => r.okres),
          okres,
          dzisOkres(),
          przesunOkres(dzisOkres(), 1),
        ]),
      ]
        .sort((a, b) => b.localeCompare(a))
        .map((o) => ({ value: o, label: monthLabel(o, locale) })),
    [rozliczenia, okres, locale]
  );

  const ilePlatnikow = (n: number) =>
    plural(n, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities']);

  /* --------------------------------- Actions ---------------------------------- */

  const importuj = async () => {
    setBusy('import');
    try {
      const w: PodatkiZusImportResult | null = await window.electronAPI.importZusKedu();
      if (!w) return;
      const tekst = [
        sub(t.zusImported, { dok: w.dokumentow, pliki: w.plikow }),
        sub(t.zusImportedPayers, {
          nowi: w.dodaniPlatnicy,
          zm: w.zmienieniPlatnicy,
          osoby: w.osoby,
        }),
        sub(t.zusImportedMonths, { n: w.dodaneRozliczenia, ist: w.istniejaceRozliczenia }),
        w.doPrzegladu > 0 ? sub(t.zusImportedReview, { n: w.doPrzegladu }) : '',
        w.pominiete.length > 0 ? sub(t.zusImportedSkipped, { n: w.pominiete.length }) : '',
        ...w.ostrzezenia,
      ]
        .filter(Boolean)
        .join(' ');
      if (w.doPrzegladu > 0 || w.pominiete.length > 0) notify.warning(tekst);
      else notify.success(tekst);
      await load(true);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusImportError);
    } finally {
      setBusy(null);
    }
  };

  const przygotuj = async (nips?: string[]) => {
    setBusy('prepare');
    try {
      const n = await window.electronAPI.przygotujZus(okres, nips);
      notify.success(sub(t.zusPrepared, { n, okres: monthLabel(okres, locale) }));
      await load(true);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusPrepareError);
    } finally {
      setBusy(null);
    }
  };

  const pliki = async (ids: string[], opcje: PodatkiZusPlikiOpcje) => {
    setPlikiIds(null);
    setBusy('files');
    try {
      const w = await window.electronAPI.zusPliki(okres, ids, opcje);
      setPodsumowanie(w);
      await load(true);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusFilesError);
    } finally {
      setBusy(null);
    }
  };

  const ustawWyslane = async (ids: string[], wyslane: boolean) => {
    setBusy('sent');
    try {
      const w = await window.electronAPI.setZusWyslane(ids, wyslane);
      const p = new Map(w.platnicy.map((x) => [x.id, x]));
      const r = new Map(w.rozliczenia.map((x) => [x.id, x]));
      setPlatnicy((prev) => prev.map((x) => p.get(x.id) ?? x));
      setRozliczenia((prev) => prev.map((x) => r.get(x.id) ?? x));
      notify.success(sub(wyslane ? t.zusSentMarked : t.zusSentUnmarked, { n: ids.length }));
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusSentError);
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  /** "Sprawdź potwierdzenia" — then the list again, since a confirmation may have marked documents sent. */
  const potwierdzenia = async () => {
    setBusy('confirm');
    podmienWysylki(await sprawdzPotwierdzenia(t, notify));
    setBusy(null);
    await load(true);
  };

  const kontekstWysylek: ZusWysylkiKontekst = {
    wysylki,
    wyslij: (ids) => setWyslijIds(ids),
    zmiana: (w) => {
      podmienWysylki([w]);
      // Settled as arrived: on production the document is marked sent now.
      if (w.rozstrzygnieta?.jak === 'dotarla') void load(true);
    },
  };

  const korekta = async (rozliczenieId: number) => {
    if (!(await notify.confirm(t.zusKorektaConfirm, { confirmLabel: t.zusKorekta }))) return;
    try {
      const r = await window.electronAPI.korektaZus(rozliczenieId);
      setRozliczenia((prev) => [...prev, r]);
      notify.success(sub(t.zusKorektaDone, { id: String(r.identyfikator).padStart(2, '0') }));
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusKorektaError);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  /** "WM LIPOWA 8 · DRA + RCA · …" — a document of the month as the send window names it. */
  const nazwaDoWysylki = (id: string): string => {
    for (const m of aktywni) {
      const d = m.lista.find((x) => x.id === id);
      if (d) {
        const zdarzenie = d.id.startsWith('c:') ? (d.id.endsWith(':w') ? 'w' : 'z') : undefined;
        return `${m.p.dane.nazwaSkrocona || m.p.nip} · ${rodzajEtykieta(t, d.rodzaj, zdarzenie)} · ${d.nazwa}`;
      }
    }
    return id;
  };

  const okna = (
    <>
      {plikiIds && (
        <PlikiModal
          t={t}
          n={plikiIds.length}
          onSubmit={(o) => void pliki(plikiIds, o)}
          onClose={() => setPlikiIds(null)}
        />
      )}
      {podsumowanie && (
        <Podsumowanie
          t={t}
          wynik={podsumowanie}
          onZaznacz={(ids) => {
            setSelected(new Set(ids));
            lastTickedRef.current = null;
          }}
          onClose={() => setPodsumowanie(null)}
        />
      )}
      {wyslijIds && (
        <WyslijZusModal
          language={language}
          okres={okres}
          okresEtykieta={monthLabel(okres, locale)}
          dokumenty={wyslijIds.map((id) => ({ id, nazwa: nazwaDoWysylki(id) }))}
          onWynik={(w) => {
            setWyslijIds(null);
            setWynikWysylki(w);
            if (w.wysylki.some((x) => x.wysylkaId !== null)) setSelected(new Set());
            void load(true);
          }}
          onClose={() => setWyslijIds(null)}
        />
      )}
      {wynikWysylki && (
        <WysylkaZusPodsumowanie
          t={t}
          wynik={wynikWysylki}
          onZaznacz={(ids) => {
            setSelected(new Set(ids));
            lastTickedRef.current = null;
          }}
          onClose={() => setWynikWysylki(null)}
        />
      )}
      {busy === 'import' && <BusyOverlay label={t.zusImporting} />}
      {busy === 'files' && <BusyOverlay label={t.zusWriting} />}
    </>
  );

  const otwarty =
    typeof detail === 'number' ? (platnicy.find((p) => p.id === detail) ?? null) : null;
  if (detail === 'nowy' || otwarty) {
    return (
      <ZusWysylkiContext.Provider value={kontekstWysylek}>
        <PlatnikScreen
          key={`${detail}-${okres}`}
          t={t}
          locale={locale}
          okres={okres}
          rekord={otwarty}
          rozliczenia={rozliczenia}
          wszyscy={platnicy}
          rejestr={rejestr}
          wstepnie={nowyZ}
          onBack={() => navItem.close()}
          onSaved={(p, r) => {
            setPlatnicy((prev) => [...prev.filter((x) => x.id !== p.id), p]);
            if (r) setRozliczenia((prev) => [...prev.filter((x) => x.id !== r.id), r]);
            else void load(true);
            navItem.replace(String(p.id), p.dane.nazwaSkrocona || p.nip);
          }}
          onDeleted={() => {
            navItem.close();
            void load(true);
          }}
          onFiles={(ids) => setPlikiIds(ids)}
          onSent={(ids, w) => void ustawWyslane(ids, w)}
          onKorekta={(id) => void korekta(id)}
          onOkres={zmienOkres}
        />
        {okna}
      </ZusWysylkiContext.Provider>
    );
  }

  /* ------------------------------------ List ------------------------------------ */

  const renderDokument = (m: (typeof miesiac)[number], d: DokListy) => {
    const isSelected = selected.has(d.id);
    const otworz = () => navItem.open(String(m.p.id), m.p.dane.nazwaSkrocona || m.p.nip);
    return (
      <li
        key={d.id}
        className={`pit-doc${isSelected ? ' is-selected' : ''} pit-doc--${d.stan === 'wyslane' ? 'zlozone' : d.stan === 'brak' ? 'blad' : d.stan}`}
      >
        <span className="ksieg-row__select">
          <label
            className={`ks-check${isSelected ? ' is-on' : ''}`}
            data-tip={t.zusSelectFor}
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
          >
            <input
              type="checkbox"
              className="ks-check__input"
              checked={isSelected}
              onChange={(e) =>
                toggle([d.id], (e.nativeEvent as MouseEvent).shiftKey === true, d.id)
              }
              aria-label={`${t.zusSelectFor}: ${d.nazwa}`}
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
          onClick={otworz}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              otworz();
            }
          }}
        >
          <span className="pit-doc__kind">
            {rodzajEtykieta(
              t,
              d.rodzaj,
              d.id.startsWith('c:') ? (d.id.endsWith(':w') ? 'w' : 'z') : undefined
            )}
          </span>
          <span className="pit-doc__name">{d.nazwa}</span>
          <span className="pit-doc__meta">{d.meta}</span>
        </div>
        <span
          className={`status-badge ${d.stan === 'blad' || d.stan === 'brak' ? 'status-pending' : d.stan === 'uwagi' ? 'status-info' : 'status-neutral'}`}
          data-tip={d.problemy.map((p) => p.tekst).join('\n') || undefined}
          hidden={d.stan === 'wyslane'}
        >
          {d.stan === 'brak'
            ? t.zusStatusMissing
            : d.stan === 'blad'
              ? t.zusStatusError
              : d.stan === 'uwagi'
                ? t.zusStatusWarn
                : t.zusStatusReady}
        </span>
        <WysylkaZus t={t} locale={locale} wysylka={d.wysylka} kompakt />
        <div className="pod-row__dom zus-row-actions">
          {/* "Podpisz i wyślij do ZUS" beside the mark — a document with errors shows it off, the errors on hover. */}
          {d.stan !== 'brak' && !d.wyslane && !wysylkaTrwa(d.wysylka) && (
            <button
              type="button"
              className="button button-small button-primary"
              disabled={busy !== null || d.stan === 'blad'}
              onClick={() => setWyslijIds([d.id])}
              data-tip={d.stan === 'blad' ? powodBlokady(t, d.problemy) : t.zusSendOneHint}
            >
              <Icon name="upload" size={13} /> {t.zusSendRow}
            </button>
          )}
          {d.stan === 'brak' ? (
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => void przygotuj([m.p.nip])}
              disabled={busy !== null}
            >
              <Icon name="plus" size={13} /> {t.zusPrepareOne}
            </button>
          ) : (
            <DomSlot
              t={t}
              locale={locale}
              dom={d.wyslane ? { at: d.wyslane.at, by: d.wyslane.by } : null}
              busy={busy === 'sent'}
              onSet={(w) => void ustawWyslane([d.id], w)}
              labels={{
                done: t.zusSentDone,
                mark: t.zusSentMark,
                undo: t.zusSentUndo,
                doneBy: t.zusSentBy,
              }}
            />
          )}
        </div>
      </li>
    );
  };

  const renderPlatnik = (m: (typeof miesiac)[number]) => {
    const idy = m.lista.map((d) => d.id);
    const wszystkie = idy.every((id) => selected.has(id));
    const czesc = !wszystkie && idy.some((id) => selected.has(id));
    const rozw = rozwiniete.has(m.p.id);
    const blad = m.lista.some((d) => d.stan === 'blad' || d.stan === 'brak');
    const wyslane = m.lista.every((d) => d.stan === 'wyslane');
    const nWyslanych = m.lista.filter((d) => d.stan === 'wyslane').length;
    const przeglad =
      m.p.dane.ubezpieczeni.some((o) => o.przeglad.length > 0) ||
      m.p.dane.przeglad.length > 0 ||
      (m.rozl?.dane.przeglad.length ?? 0) > 0;
    const nazwa = m.p.dane.nazwaSkrocona || m.p.nip;
    const otworz = () => navItem.open(String(m.p.id), nazwa);
    return (
      <li key={m.p.id} className="pit-wsp">
        <div className="pod-item">
          <span className="ksieg-row__select">
            <label
              className={`ks-check${wszystkie ? ' is-on' : ''}${czesc ? ' is-mixed' : ''}`}
              data-tip={t.zusSelectFor}
            >
              <input
                type="checkbox"
                className="ks-check__input"
                checked={wszystkie}
                ref={(el) => {
                  if (el) el.indeterminate = czesc;
                }}
                onChange={() => toggle(idy)}
                aria-label={`${t.zusSelectFor}: ${nazwa}`}
              />
              <span className="ks-check__box" aria-hidden="true">
                <Icon name={czesc ? 'minus' : 'check'} size={12} strokeWidth={3} />
              </span>
            </label>
          </span>
          <div
            className={`zeb-row pod-row pod-row--${blad ? 'braki' : wyslane ? 'zlozone' : 'gotowa'}${wszystkie ? ' is-selected' : ''}`}
          >
            <div
              className="pod-row__open"
              role="button"
              tabIndex={0}
              onClick={otworz}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  otworz();
                }
              }}
            >
              <div className="zeb-date pod-kwota" data-tip={t.zusSumToPay}>
                <span className="pod-kwota__label">{t.zusSumToPay}</span>
                <span
                  className={`pod-kwota__value${m.doZaplaty >= 10000 ? ' is-s' : m.doZaplaty >= 1000 ? ' is-m' : ''}`}
                >
                  {Math.round(m.doZaplaty).toLocaleString('pl-PL').replace(/\s/g, ' ')}
                  <span className="pod-kwota__unit">zł</span>
                </span>
              </div>
              <div className="zeb-row__main">
                <span className="zeb-row__name">{nazwa}</span>
                <span className="zeb-row__meta">
                  <span>
                    <Icon name="file-text" size={13} /> {sub(t.zusRowNip, { nip: m.p.nip })}
                  </span>
                  <span>
                    <Icon name="users" size={13} /> {sub(t.zusRowInsured, { n: m.ubezpieczonych })}
                  </span>
                  {przeglad && (
                    <span className="pod-meta-warning">
                      <Icon name="alert-triangle" size={13} /> {t.zusRowReview}
                    </span>
                  )}
                </span>
              </div>
              <div className="zeb-row__side">
                <span
                  className={`status-badge ${blad ? 'status-pending' : wyslane ? 'status-success' : 'status-neutral'}`}
                >
                  {blad
                    ? t.zusStatusError
                    : wyslane
                      ? t.zusSentDone
                      : `${nWyslanych}/${m.lista.length} ${t.zusFilterSent.toLowerCase()}`}
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
                    if (next.has(m.p.id)) next.delete(m.p.id);
                    else next.add(m.p.id);
                    return next;
                  })
                }
                aria-expanded={rozw}
              >
                <Icon name={rozw ? 'chevron-down' : 'chevron-right'} size={14} />{' '}
                {sub(t.zusRowDocs, { n: m.lista.length })}
              </button>
            </div>
          </div>
        </div>
        {rozw && <ul className="pit-docs">{m.lista.map((d) => renderDokument(m, d))}</ul>}
      </li>
    );
  };

  const filtrEtykieta: Record<Filtr, string> = {
    all: t.zusFilterAll,
    errors: t.zusFilterErrors,
    ready: t.zusFilterReady,
    waiting: t.zusFilterWaiting,
    sent: t.zusFilterSent,
  };
  const doZaplatyRazem = aktywni.reduce((s, m) => s + m.doZaplaty, 0);
  const ubezpieczonych = aktywni.reduce((n, m) => n + m.ubezpieczonych, 0);
  const brakRozliczen = aktywni.filter((m) => m.lista.some((d) => d.stan === 'brak')).length;
  const wyslanych = dokumentyMiesiaca.filter((d) => d.stan === 'wyslane').length;
  const procent =
    dokumentyMiesiaca.length > 0 ? Math.round((wyslanych / dokumentyMiesiaca.length) * 100) : 0;
  const termin = terminRozliczenia(okres, '6');
  const fakty =
    aktywni.length === 0
      ? [t.zusHeroEmpty]
      : [
          sub(t.zusHeroPayers, { n: aktywni.length }),
          sub(t.zusHeroInsured, { n: ubezpieczonych }),
          sub(t.zusHeroToPay, { kwota: zl2(doZaplatyRazem) }),
          sub(t.zusHeroDeadline, { data: dataPl(termin) }),
        ];
  const zaznaczoneWyslane = zaznaczone.filter((id) => poId.get(id)?.stan === 'wyslane');
  const zaznaczoneDoWyslania = zaznaczone.filter(
    (id) => poId.get(id)?.stan !== 'wyslane' && poId.get(id)?.stan !== 'brak'
  );
  const zaznaczoneDoPlikow = zaznaczone.filter((id) => poId.get(id)?.stan !== 'brak');
  /** What "Podpisz i wyślij do ZUS" takes: not sent, nothing missing, no blocking error, nothing of it still in the air. */
  const zaznaczoneDoZus = zaznaczone.filter((id) => {
    const d = poId.get(id);
    return !!d && (d.stan === 'gotowe' || d.stan === 'uwagi') && !wysylkaTrwa(d.wysylka);
  });
  /** Ticked, not sent, but held back by errors — named on the button, so it is clear why they do not go. */
  const zaznaczoneZBledami = zaznaczone
    .map((id) => poId.get(id))
    .filter((d): d is DokListy => !!d && d.stan === 'blad');
  const czekaPotwierdzen = wysylki.some(czekaNaPotwierdzenie);

  return (
    <ZusWysylkiContext.Provider value={kontekstWysylek}>
    <div className="content-body">
      <header className="ksieg-hero pod-hero">
        <div className="ksieg-hero__art">
          <span className="pod-hero__art" aria-hidden="true">
            <Icon name="shield" size={40} />
          </span>
        </div>
        <div className="ksieg-hero__id">
          <span className="ksieg-hero__eyebrow">
            <Icon name="shield" size={13} /> {t.zusTitle}
          </span>
          <h1 className="ksieg-hero__month">
            {monthLabel(okres, locale)}
            <span>{t.zusHeroPeriod}</span>
          </h1>
          <p className="ksieg-hero__facts">{fakty.join(' · ')}</p>
        </div>
        <div className="ksieg-hero__nav">
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => zmienOkres(przesunOkres(okres, -1))}
            data-tip={t.zusPrevMonth}
            aria-label={t.zusPrevMonth}
          >
            <Icon name="chevron-left" size={17} />
          </button>
          <Select
            overlay
            value={okres}
            options={okresy}
            onChange={zmienOkres}
            ariaLabel={t.zusHeroPeriod}
            className="ksieg-nav-select"
          />
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => zmienOkres(przesunOkres(okres, 1))}
            data-tip={t.zusNextMonth}
            aria-label={t.zusNextMonth}
          >
            <Icon name="chevron-right" size={17} />
          </button>
          <button
            type="button"
            className="ksieg-nav-today"
            onClick={() => zmienOkres(dzisOkres())}
            disabled={okres === dzisOkres()}
          >
            {t.zusThisMonth}
          </button>
          <button
            type="button"
            className="ksieg-scan-btn"
            onClick={() =>
              setPlikiIds(dokumentyMiesiaca.filter((d) => d.stan !== 'brak').map((d) => d.id))
            }
            disabled={busy !== null || dokumentyMiesiaca.length === 0}
            data-tip={t.zusDownloadAllHint}
          >
            <Icon name={busy === 'files' ? 'loader' : 'download'} size={15} />
            <span>{t.zusDownloadAll}</span>
          </button>
          {czekaPotwierdzen && (
            <button
              type="button"
              className="ksieg-scan-btn"
              onClick={() => void potwierdzenia()}
              disabled={busy !== null}
              data-tip={t.zusConfirmCheckHint}
            >
              <Icon name={busy === 'confirm' ? 'loader' : 'refresh'} size={15} />
              <span>{t.zusConfirmCheck}</span>
            </button>
          )}
          <button
            type="button"
            className="ksieg-nav-arrow"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            data-tip={t.zusRefresh}
            aria-label={t.zusRefresh}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
        {dokumentyMiesiaca.length > 0 && (
          <div className="ksieg-hero__progress">
            <div className="ksieg-progress__head">
              <span className="ksieg-progress__label">{t.zusFilterSent}</span>
              <span className="ksieg-progress__value">
                {sub(t.zusHeroSent, { done: wyslanych, total: dokumentyMiesiaca.length })}
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
          <input
            type="text"
            placeholder={t.zusSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim() && (
            <button
              type="button"
              onClick={() => setSearch('')}
              data-tip={t.close}
              aria-label={t.close}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        {aktywni.length > 0 && (
          <div className="zad-seg" role="group" aria-label={t.zusFilterLabel}>
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
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void importuj()}
            disabled={busy !== null}
            data-tip={t.zusImportHint}
          >
            <Icon name={busy === 'import' ? 'loader' : 'upload'} size={14} /> {t.zusImport}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void przygotuj()}
            disabled={busy !== null || brakRozliczen === 0}
            data-tip={t.zusPrepareHint}
          >
            <Icon name={busy === 'prepare' ? 'loader' : 'copy'} size={14} />{' '}
            {brakRozliczen > 0 ? sub(t.zusPrepareN, { n: brakRozliczen }) : t.zusPrepare}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setNowyZ(null);
              navItem.open('nowy', t.zusNew);
            }}
          >
            <Icon name="plus" size={14} /> {t.zusAdd}
          </button>
        </div>
      </div>

      <div className="page-form pod-list-page">
        {platnicy.length === 0 ? (
          <div className="zeb-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="shield" size={22} />
            </span>
            <strong>{t.zusEmptyTitle}</strong>
            <p>{t.zusEmptyText}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void importuj()}
              disabled={busy !== null}
            >
              <Icon name="upload" size={14} /> {t.zusImport}
            </button>
          </div>
        ) : aktywni.length === 0 ? (
          <div className="zeb-nomatch">
            <Icon name="info" size={18} />{' '}
            {sub(t.zusMonthEmpty, { okres: monthLabel(okres, locale) })}
          </div>
        ) : visible.length === 0 ? (
          <div className="zeb-nomatch">
            <Icon name="search" size={18} /> {t.zusNoMatch}
          </div>
        ) : (
          <>
            {brakRozliczen > 0 && (
              <div className="callout">
                <Icon name="info" size={16} />
                <div className="callout__body">
                  {sub(t.zusPrepareCallout, {
                    n: ilePlatnikow(brakRozliczen),
                    okres: monthLabel(okres, locale),
                  })}
                </div>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => void przygotuj()}
                  disabled={busy !== null}
                >
                  <Icon name="copy" size={13} /> {t.zusPrepare}
                </button>
              </div>
            )}
            <div className="ksieg-selall pod-selall">
              <span className="ksieg-row__select">
                <label
                  className={`ks-check${wszystkieZaznaczone ? ' is-on' : ''}${czesciowo ? ' is-mixed' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="ks-check__input"
                    checked={wszystkieZaznaczone}
                    ref={(el) => {
                      if (el) el.indeterminate = czesciowo;
                    }}
                    onChange={toggleAll}
                    aria-label={t.ksSelectAll}
                  />
                  <span className="ks-check__box" aria-hidden="true">
                    <Icon name={czesciowo ? 'minus' : 'check'} size={12} strokeWidth={3} />
                  </span>
                </label>
              </span>
              <button type="button" className="ksieg-selall__label" onClick={toggleAll}>
                {wszystkieZaznaczone ? t.ksSelectNone : t.ksSelectAll}
              </button>
              <span className="ksieg-selall__hint">{t.ksSelectRangeHint}</span>
              <span className="pit-selall__expand">
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => setRozwiniete(new Set(visible.map((m) => m.p.id)))}
                >
                  <Icon name="chevron-down" size={13} /> {t.zusExpandAll}
                </button>
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => setRozwiniete(new Set())}
                >
                  <Icon name="chevron-right" size={13} /> {t.zusCollapseAll}
                </button>
              </span>
            </div>
            <ul className="zeb-list">{visible.map(renderPlatnik)}</ul>
          </>
        )}

        {(nieaktywni.length > 0 || bezPlatnika.length > 0) && (
          <PodatkiPozostaleGrupa label={t.podRest}>
            {nieaktywni.length > 0 && (
              <PodatkiPozostale
                icon="calendar"
                title={sub(t.zusInactive, {
                  okres: monthLabel(okres, locale).toLocaleLowerCase(locale),
                })}
                description={t.zusInactiveHint}
                persistKey="podatki-zus-nieaktywni"
                wpisy={nieaktywni.map((m) => ({
                  key: String(m.p.id),
                  nazwa: m.p.dane.nazwaSkrocona || m.p.nip,
                }))}
                actionLabel={t.zusOpen}
                actionIcon="edit"
                onAction={(id) => {
                  const m = nieaktywni.find((x) => String(x.p.id) === id);
                  if (m) navItem.open(id, m.p.dane.nazwaSkrocona || m.p.nip);
                }}
              />
            )}
            {bezPlatnika.length > 0 && (
              <PodatkiPozostale
                icon="users"
                title={t.zusAdresyBez}
                description={t.zusAdresyBezHint}
                persistKey="podatki-zus-bez-platnika"
                wpisy={bezPlatnika.map((r) => ({ key: r.nazwa, nazwa: r.nazwa }))}
                actionLabel={t.zusAdresyDodaj}
                actionIcon="plus"
                onAction={(nazwa) => {
                  const r = bezPlatnika.find((x) => x.nazwa === nazwa);
                  if (!r) return;
                  setNowyZ(r);
                  navItem.open('nowy', r.nazwa);
                }}
              />
            )}
          </PodatkiPozostaleGrupa>
        )}

        {zaznaczone.length > 0 && (
          <div className="ksieg-selbar">
            <Icon name="check-circle" size={16} />
            <span className="ksieg-selbar__text">
              {sub(t.zusSelectionBar, { n: zaznaczone.length })}
            </span>
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
            {zaznaczoneWyslane.length > 0 && (
              <button
                type="button"
                className="button button-small button-ghost"
                disabled={busy !== null}
                onClick={() => void ustawWyslane(zaznaczoneWyslane, false)}
              >
                {sub(t.zusBatchUnsent, { n: zaznaczoneWyslane.length })}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null || zaznaczoneDoPlikow.length === 0}
              onClick={() => setPlikiIds(zaznaczoneDoPlikow)}
            >
              <Icon name="download" size={14} />{' '}
              {sub(t.zusBatchFiles, { n: zaznaczoneDoPlikow.length })}
            </button>
            {(zaznaczoneDoZus.length > 0 || zaznaczoneZBledami.length > 0) && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy !== null || zaznaczoneDoZus.length === 0}
                onClick={() => setWyslijIds(zaznaczoneDoZus)}
                data-tip={
                  zaznaczoneZBledami.length > 0
                    ? `${sub(t.zusSendBatchBlocked, { n: zaznaczoneZBledami.length })}\n${zaznaczoneZBledami
                        .slice(0, 8)
                        .map((d) => `• ${d.nazwa}: ${d.problemy.find((p) => p.poziom === 'blad')?.tekst ?? ''}`)
                        .join('\n')}`
                    : t.zusSendBatchHint
                }
              >
                <Icon name="upload" size={14} /> {sub(t.zusSendBatch, { n: zaznaczoneDoZus.length })}
              </button>
            )}
            {zaznaczoneDoWyslania.length > 0 && (
              <button
                type="button"
                className="ksieg-book ksieg-book--sm"
                disabled={busy !== null}
                onClick={() => void ustawWyslane(zaznaczoneDoWyslania, true)}
              >
                <Icon name="check-circle" size={14} />
                <span>{sub(t.zusBatchSent, { n: zaznaczoneDoWyslania.length })}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {okna}
    </div>
    </ZusWysylkiContext.Provider>
  );
};

export default PodatkiZus;
