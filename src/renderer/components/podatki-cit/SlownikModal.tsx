import React, { useEffect, useMemo, useState } from 'react';
import {
  CitAiPropozycja,
  CitKategoria,
  CitSlownikRegula,
  CitStrona,
  PodatkiCitUstawienia,
} from '../../../shared/types';
import {
  CitPrzegladPozycja,
  czyRegulaDomyslna,
  defaultCitSlownik,
  kategorieDlaStrony,
  regulaDlaNazwy,
  uzupelnijDomyslne,
} from '../../../shared/podatki-cit';
import { formatKwota } from '../../../shared/sprawozdanie';
import { foldText } from '../../../shared/plan-gospodarczy';
import { formatStamp } from '../../../shared/calendar';
import Tip from '../Tip';
import { AiWorking } from '../AiPanel';
import { nazwaInterEj } from '../../../shared/inter-ej';
import { translations, Language } from '../../translations';
import { plural } from '../../plural';
import { useNotify } from '../Notifications';
import { FormSection } from '../FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { bezPrefiksu } from '../PodpisKarta';
import Icon from '../Icon';
import Loader from '../Loader';
import Select from '../Select';
import { type T, newRuleId, kategoriaNazwy } from './citShared';

/* ================================ Dictionary ================================ */

/** The AI's own category for a row name that a rule already covers. */
interface OcenaAudytu {
  kategoria: CitKategoria;
  uzasadnienie: string;
}

/** A row name whose rule the AI disagrees with. */
interface Rozbieznosc {
  p: CitPrzegladPozycja;
  regula: CitSlownikRegula;
  nr: number;
  ai: OcenaAudytu;
}

/**
 * "Sprawdzenie AI": the AI sorts every library row name a rule covers, and only
 * the names where it disagrees with the rule are listed. Nothing changes by
 * itself — each disagreement is kept, taken (an exception on top, or the rule
 * itself when it is that very name), or opened in the rule list.
 */
const AudytSlownika: React.FC<{
  t: T;
  gotowy: boolean;
  blad: string | null;
  sprawdzono: boolean;
  rozbieznosci: Rozbieznosc[];
  aiBusy: boolean;
  onSprawdz: () => void;
  onPrzyjmij: (r: Rozbieznosc) => void;
  onZostaw: (r: Rozbieznosc) => void;
  onPokaz: (r: Rozbieznosc) => void;
}> = ({ t, gotowy, blad, sprawdzono, rozbieznosci, aiBusy, onSprawdz, onPrzyjmij, onZostaw, onPokaz }) => {
  const nazwy = kategoriaNazwy(t);
  return (
    <FormSection
      icon="sparkles"
      title={t.citAudTitle}
      description={t.citAudDesc}
      aside={
        <div className="form-section__actions">
          <button type="button" className="button button-small button-primary" onClick={onSprawdz} disabled={aiBusy || !gotowy}>
            <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {sprawdzono ? t.citAudRerun : t.citAudRun}
          </button>
        </div>
      }
    >
      {blad ? (
        <p className="zeb-muted">{blad}</p>
      ) : !gotowy ? (
        <Loader inline />
      ) : aiBusy ? (
        <AiWorking title={t.citAudWorking} hint={t.citAudWorkingHint} />
      ) : !sprawdzono ? (
        <p className="zeb-muted">{t.citAudNotRun}</p>
      ) : rozbieznosci.length === 0 ? (
        <p className="zeb-muted">{t.citAudNone}</p>
      ) : (
        <div className="table-scroll cit-rev">
          <table className="zfin-table cit-table">
            <thead>
              <tr>
                <th>{t.citColName}</th>
                <th>{t.citAudColRule}</th>
                <th>{t.citAudColAi}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rozbieznosci.map((r) => (
                <tr key={r.p.klucz}>
                  <td>
                    <div className="cit-pos__name">{r.p.nazwa}</div>
                    <div className="cit-pos__meta">
                      {r.p.strona === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt} ·{' '}
                      <Tip content={r.p.przyklady.join(', ') + (r.p.wspolnot > r.p.przyklady.length ? ' …' : '')}>
                        {t.citRevWhere.replace('{w}', String(r.p.wspolnot)).replace('{s}', String(r.p.sprawozdan))}
                      </Tip>
                    </div>
                  </td>
                  <td>
                    <div>{nazwy[r.regula.kategoria]}</div>
                    <div className="cit-pos__meta">
                      {t.citAudRuleRef.replace('{nr}', String(r.nr)).replace('{fraza}', r.regula.fraza)}
                    </div>
                  </td>
                  <td>
                    <Tip content={r.ai.uzasadnienie || t.citRevAiNoReason}>{nazwy[r.ai.kategoria]}</Tip>
                  </td>
                  <td>
                    <span className="row-actions">
                      <button type="button" className="button button-small button-subtle" onClick={() => onPrzyjmij(r)}>
                        {t.citAudTake}
                      </button>
                      <button type="button" className="button button-small button-ghost" onClick={() => onPokaz(r)}>
                        {t.citAudShow}
                      </button>
                      <button type="button" className="button button-small button-ghost" onClick={() => onZostaw(r)}>
                        {t.citAudKeep}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
};

/** What the AI's two passes said about a name they disagreed on — the hint of an uncertain row. */
export const WatpliwoscAi: React.FC<{ t: T; w: CitAiPropozycja }> = ({ t, w }) => {
  const nazwy = kategoriaNazwy(t);
  const odpowiedzi = [{ kategoria: w.kategoria, uzasadnienie: w.uzasadnienie }, ...(w.alternatywa ? [w.alternatywa] : [])];
  return (
    <div className="cit-unsure">
      <div>{w.alternatywa ? t.citRevUnsureTip : t.citRevUnsureOnce}</div>
      {odpowiedzi.map((o, i) => (
        <div key={i}>
          <b>{nazwy[o.kategoria]}</b>
          {o.uzasadnienie ? ` — ${o.uzasadnienie}` : ''}
        </div>
      ))}
    </div>
  );
};

/** A category picked in the dictionary review, with the AI's reason when the AI proposed it. */
interface WyborPrzegladu {
  kategoria: CitKategoria;
  ai?: string;
}

/**
 * One side of the dictionary review: the library's row names of that column no
 * rule covers, the category to give each, and the AI's proposal. Nothing here
 * touches the dictionary — "Dodaj do słownika" hands the picks to the modal,
 * which puts them among its unsaved rules.
 */
const PrzegladSlownika: React.FC<{
  t: T;
  strona: CitStrona;
  pozycje: CitPrzegladPozycja[] | null;
  blad: string | null;
  wybory: Record<string, WyborPrzegladu>;
  watpliwosci: Record<string, CitAiPropozycja>;
  aiBusy: boolean;
  onWybor: (klucz: string, wybor: WyborPrzegladu | null) => void;
  onAi: () => void;
  onDodaj: () => void;
  onOdswiez: () => void;
}> = ({ t, strona, pozycje, blad, wybory, watpliwosci, aiBusy, onWybor, onAi, onDodaj, onOdswiez }) => {
  const nazwy = kategoriaNazwy(t);
  const wybrane = (pozycje ?? []).filter((p) => wybory[p.klucz]).length;
  const options = [
    { value: '', label: t.citRevSkip },
    ...kategorieDlaStrony(strona).map((k) => ({ value: k, label: nazwy[k] })),
  ];
  return (
    <FormSection
      icon="search"
      title={strona === 'przychod' ? t.citRevIncomeTitle : t.citRevCostTitle}
      description={strona === 'przychod' ? t.citRevIncomeDesc : t.citRevCostDesc}
      aside={
        <div className="form-section__actions">
          <button type="button" className="button button-small button-subtle" onClick={onOdswiez} disabled={pozycje === null}>
            <Icon name="refresh" size={13} /> {t.citRevRefresh}
          </button>
          <button
            type="button"
            className="button button-small button-subtle"
            onClick={onAi}
            disabled={aiBusy || !pozycje || pozycje.length === 0}
          >
            <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {t.citRevAi}
          </button>
          <button type="button" className="button button-small button-primary" onClick={onDodaj} disabled={wybrane === 0}>
            <Icon name="plus" size={13} /> {t.citRevAdd.replace('{n}', String(wybrane))}
          </button>
        </div>
      }
    >
      {blad ? (
        <p className="zeb-muted">{blad}</p>
      ) : pozycje === null ? (
        <Loader inline />
      ) : aiBusy ? (
        <AiWorking title={t.citRevWorking} hint={t.citAiWorkingHint} />
      ) : pozycje.length === 0 ? (
        <p className="zeb-muted">{strona === 'przychod' ? t.citRevIncomeNone : t.citRevCostNone}</p>
      ) : (
        <div className="table-scroll cit-rev">
          <table className="zfin-table cit-table">
            <thead>
              <tr>
                <th>{t.citColName}</th>
                <th className="zfin-num">{t.citRevColAmount}</th>
                <th>{t.citColCategory}</th>
                <th>{t.citColSource}</th>
              </tr>
            </thead>
            <tbody>
              {pozycje.map((p) => {
                const w = wybory[p.klucz];
                return (
                  <tr key={p.klucz} className={strona === 'przychod' && !w ? 'cit-row--open' : undefined}>
                    <td>
                      <div className="cit-pos__name">{p.nazwa}</div>
                      <div className="cit-pos__meta">
                        {p.sekcja === 'fundusz' ? t.citSekcja_fundusz : t.citSekcja_eksploatacja} ·{' '}
                        <Tip content={p.przyklady.join(', ') + (p.wspolnot > p.przyklady.length ? ' …' : '')}>
                          {t.citRevWhere.replace('{w}', String(p.wspolnot)).replace('{s}', String(p.sprawozdan))}
                        </Tip>
                      </div>
                    </td>
                    <td className="zfin-num">{p.kwotaUkryta || nazwaInterEj(p.nazwa) ? '—' : formatKwota(p.kwota)}</td>
                    <td className="cit-pos__category">
                      <Select
                        overlay
                        size="sm"
                        value={w?.kategoria ?? null}
                        placeholder={t.citRevPick}
                        options={options}
                        onChange={(k) => onWybor(p.klucz, k ? { kategoria: k as CitKategoria } : null)}
                        ariaLabel={`${t.citColCategory}: ${p.nazwa}`}
                      />
                    </td>
                    <td>
                      {w?.ai !== undefined ? (
                        <Tip content={w.ai || t.citRevAiNoReason} className="status-badge status-info">
                          {t.citRevSourceAi}
                        </Tip>
                      ) : w ? (
                        <span className="status-badge status-success">{t.citZrodlo_reczne}</span>
                      ) : watpliwosci[p.klucz] ? (
                        <Tip content={<WatpliwoscAi t={t} w={watpliwosci[p.klucz]} />} className="status-badge status-pending">
                          {t.citRevSourceUnsure}
                        </Tip>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
};


/**
 * "Słownik pozycji CIT" — shared by every return: which statement rows are
 * taxed income, exempt income or a cost. The first matching rule wins, so the
 * order is part of what is saved.
 */
export const SlownikModal: React.FC<{
  language: Language;
  value: PodatkiCitUstawienia;
  onSaved: (value: PodatkiCitUstawienia) => void;
  onClose: () => void;
}> = ({ language, value, onSaved, onClose }) => {
  const t = translations[language];
  const notify = useNotify();
  const [rules, setRules] = useState<CitSlownikRegula[]>(value.slownik);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const zapisane = useMemo(() => new Map(value.slownik.map((r) => [r.id, r])), [value.slownik]);
  const [tab, setTab] = useState<'reguly' | 'bez' | CitStrona | 'audyt'>('reguly');
  const [audyt, setAudyt] = useState<Record<string, OcenaAudytu> | null>(null);
  const [zostawione, setZostawione] = useState<Set<string>>(new Set());
  const [przeglad, setPrzeglad] = useState<CitPrzegladPozycja[] | null>(null);
  const [przegladBlad, setPrzegladBlad] = useState<string | null>(null);
  const [wybory, setWybory] = useState<Record<string, WyborPrzegladu>>({});
  /** Names the AI's two passes answered differently: a hint beside the row, never a pick. */
  const [watpliwosci, setWatpliwosci] = useState<Record<string, CitAiPropozycja>>({});
  const [aiBusy, setAiBusy] = useState(false);

  const wczytajPrzeglad = async () => {
    setPrzeglad(null);
    setPrzegladBlad(null);
    try {
      setPrzeglad(await window.electronAPI.przegladPozycjiCit());
    } catch (err: unknown) {
      setPrzegladBlad(`${t.citRevLoadError}: ${bezPrefiksu(err)}`);
    }
  };
  // The library is read once per opening, in the background: the tabs' counts and the rules' hits come from it.
  useEffect(() => {
    void wczytajPrzeglad();
  }, []);

  /** The rules as they would be saved now — the review always matches against the unsaved list. */
  const aktywne = useMemo(() => rules.filter((r) => r.fraza.trim()), [rules]);
  const bezReguly = useMemo(() => {
    const out: Record<CitStrona, CitPrzegladPozycja[]> = { przychod: [], koszt: [] };
    for (const p of przeglad ?? []) if (!regulaDlaNazwy(p.nazwa, p.strona, aktywne)) out[p.strona].push(p);
    return out;
  }, [przeglad, aktywne]);
  /** How many of the library's row names each rule is the first match for. */
  const trafienia = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of przeglad ?? []) {
      const r = regulaDlaNazwy(p.nazwa, p.strona, aktywne);
      if (r) out.set(r.id, (out.get(r.id) ?? 0) + 1);
    }
    return out;
  }, [przeglad, aktywne]);

  const rozbieznosci = useMemo<Rozbieznosc[]>(() => {
    if (!audyt) return [];
    const out: Rozbieznosc[] = [];
    for (const p of przeglad ?? []) {
      const ai = audyt[p.klucz];
      const regula = regulaDlaNazwy(p.nazwa, p.strona, aktywne);
      if (!ai || !regula || ai.kategoria === regula.kategoria || zostawione.has(p.klucz)) continue;
      out.push({ p, regula, nr: rules.indexOf(regula) + 1, ai });
    }
    return out;
  }, [audyt, przeglad, aktywne, rules, zostawione]);

  const sprawdzRegulyAi = async () => {
    const cele = (przeglad ?? []).filter((p) => regulaDlaNazwy(p.nazwa, p.strona, aktywne));
    if (cele.length === 0) {
      notify.info(t.citAiNothing);
      return;
    }
    setAiBusy(true);
    try {
      // The rule's category goes along: the model keeps it unless it is clearly wrong,
      // so a second check does not flip ambiguous names the other way.
      const { propozycje, zapasowy } = await window.electronAPI.klasyfikujCitAi(
        cele.map((p) => ({
          klucz: p.klucz,
          nazwa: p.nazwa,
          strona: p.strona,
          sekcja: p.sekcja,
          kwota: p.kwota,
          ukryta: p.kwotaUkryta,
          regula: regulaDlaNazwy(p.nazwa, p.strona, aktywne)?.kategoria,
        })),
        // No dictionary as examples: the rules are what is being checked.
        [],
      );
      if (zapasowy) notify.warning(t.citAiFallback);
      const strony = new Map(cele.map((p) => [p.klucz, p.strona]));
      const wynik: Record<string, OcenaAudytu> = {};
      for (const w of propozycje) {
        const strona = strony.get(w.klucz);
        // Two passes that disagree are no case against the rule: one of them kept it.
        if (w.niepewne) continue;
        if (strona && kategorieDlaStrony(strona).includes(w.kategoria)) {
          wynik[w.klucz] = { kategoria: w.kategoria, uzasadnienie: w.uzasadnienie };
        }
      }
      setAudyt(wynik);
      setZostawione(new Set());
      if (Object.keys(wynik).length < cele.length) {
        notify.warning(t.citAiMissed.replace('{n}', String(cele.length - Object.keys(wynik).length)));
      }
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citAiError);
    } finally {
      setAiBusy(false);
    }
  };

  /** The AI's category wins: the rule itself when it is that very name, else an exception of the full name on top. */
  const przyjmijAudyt = (r: Rozbieznosc) => {
    if (foldText(r.regula.fraza) === foldText(r.p.nazwa)) {
      setRule(r.regula.id, { kategoria: r.ai.kategoria });
    } else {
      setRules((prev) => [{ id: newRuleId(), fraza: r.p.nazwa, strona: r.p.strona, kategoria: r.ai.kategoria }, ...prev]);
    }
    notify.success(t.citAudTaken.replace('{fraza}', r.p.nazwa));
  };

  const uzupelnij = async () => {
    const u = uzupelnijDomyslne(aktywne);
    const strona = (st: CitStrona) => (st === 'przychod' ? t.citStrona_przychod : t.citStrona_koszt);
    const zmienione = u.zmienione.length
      ? ' ' +
        t.citDictFillChanged.replace(
          '{lista}',
          u.zmienione
            .map((z) =>
              t.citDictFillChangedItem
                .replace('{fraza}', z.fraza)
                .replace('{kolumna}', strona(z.strona))
                .replace('{obecna}', nazwy[z.obecna])
                .replace('{domyslna}', nazwy[z.domyslna]),
            )
            .join('; '),
        )
      : '';
    if (u.dodane.length === 0) {
      notify.info(t.citDictFillNothing + zmienione);
      return;
    }
    const pytanie =
      t.citDictFillConfirm
        .replace('{n}', plural(u.dodane.length, language, ['regułę', 'reguły', 'reguł'], ['rule', 'rules']))
        .replace('{lista}', u.dodane.map((r) => `${t.citDictQuote.replace('{fraza}', r.fraza)} (${strona(r.strona)} → ${nazwy[r.kategoria]})`).join('; ')) + zmienione;
    if (await notify.confirm(pytanie, { confirmLabel: t.citDictFill })) setRules(u.slownik);
  };

  const przywrocWszystko = async () => {
    const wlasne = aktywne.filter((r) => !czyRegulaDomyslna(r)).length;
    const pytanie =
      wlasne > 0
        ? t.citDictRestoreConfirmLose.replace('{n}', plural(wlasne, language, ['własną regułę', 'własne reguły', 'własnych reguł'], ['own rule', 'own rules']))
        : t.citDictRestoreConfirm;
    if (await notify.confirm(pytanie, { danger: wlasne > 0, confirmLabel: t.citDictRestore })) setRules(defaultCitSlownik());
  };

  const setWybor = (klucz: string, w: WyborPrzegladu | null) =>
    setWybory((prev) => {
      const next = { ...prev };
      if (w) next[klucz] = w;
      else delete next[klucz];
      return next;
    });

  const zaproponujAi = async (strona: CitStrona) => {
    const cele = bezReguly[strona].filter((p) => !wybory[p.klucz]);
    if (cele.length === 0) {
      notify.info(t.citAiNothing);
      return;
    }
    setAiBusy(true);
    try {
      // The modal's rules as they stand, unsaved ones included, are the examples to follow.
      const { propozycje, zapasowy } = await window.electronAPI.klasyfikujCitAi(
        cele.map((p) => ({ klucz: p.klucz, nazwa: p.nazwa, strona: p.strona, sekcja: p.sekcja, kwota: p.kwota, ukryta: p.kwotaUkryta })),
        aktywne,
      );
      if (zapasowy) notify.warning(t.citAiFallback);
      const nowe: Record<string, WyborPrzegladu> = {};
      const niepewne: Record<string, CitAiPropozycja> = {};
      for (const w of propozycje) {
        if (!kategorieDlaStrony(strona).includes(w.kategoria)) continue;
        // A shared cost becomes a rule too, so the name is settled and leaves the list for good.
        if (w.niepewne) niepewne[w.klucz] = w;
        else nowe[w.klucz] = { kategoria: w.kategoria, ai: w.uzasadnienie };
      }
      setWybory((prev) => ({ ...prev, ...nowe }));
      setWatpliwosci((prev) => {
        const next = { ...prev, ...niepewne };
        for (const k of Object.keys(nowe)) delete next[k];
        return next;
      });
      const ile = Object.keys(nowe).length;
      const ileNiepewnych = Object.keys(niepewne).length;
      if (ile > 0) notify.success(t.citRevAiDone.replace('{n}', String(ile)));
      if (ileNiepewnych > 0) notify.warning(t.citAiUnsure.replace('{n}', String(ileNiepewnych)));
      if (ile + ileNiepewnych < cele.length) {
        notify.warning(t.citAiMissed.replace('{n}', String(cele.length - ile - ileNiepewnych)));
      }
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citAiError);
    } finally {
      setAiBusy(false);
    }
  };

  /** The picked names go on top of the list as rules of their full name — the most specific there are. */
  const dodajDoSlownika = async (strona: CitStrona) => {
    const lista = bezReguly[strona].filter((p) => wybory[p.klucz]);
    if (lista.length === 0) return;
    const ile = plural(lista.length, language, ['regułę', 'reguły', 'reguł'], ['rule', 'rules']);
    if (!(await notify.confirm(t.citRevAddConfirm.replace('{n}', ile), { confirmLabel: t.citRevAdd.replace('{n}', String(lista.length)) }))) {
      return;
    }
    setRules((prev) => [
      ...lista.map((p) => ({ id: newRuleId(), fraza: p.nazwa, strona: p.strona, kategoria: wybory[p.klucz].kategoria })),
      ...prev,
    ]);
    setWybory((prev) => {
      const next = { ...prev };
      for (const p of lista) delete next[p.klucz];
      return next;
    });
    setTab('reguly');
    notify.success(t.citRevAdded.replace('{n}', ile));
  };

  const nazwy = kategoriaNazwy(t);
  /** Who put the rule in — shown only for rules the built-in dictionary does not ship. */
  const autor = (r: CitSlownikRegula): string | null => {
    if (czyRegulaDomyslna(r)) return null;
    const z = zapisane.get(r.id);
    const zmieniona = !z || z.fraza !== r.fraza.trim() || z.strona !== r.strona || z.kategoria !== r.kategoria;
    if (zmieniona) return t.citDictAddedUnsaved;
    if (!r.dodano) return t.citDictAddedUnknown;
    return t.citDictAddedBy.replace('{kto}', r.dodal || '—').replace('{kiedy}', formatStamp(r.dodano, locale));
  };
  const stronaOptions = [
    { value: 'przychod', label: t.citStrona_przychod },
    { value: 'koszt', label: t.citStrona_koszt },
  ];
  const categoryOptions = (strona: CitStrona) =>
    kategorieDlaStrony(strona).map((k) => ({ value: k, label: nazwy[k] }));

  const q = foldText(filter);
  const bezTrafien = (r: CitSlownikRegula) => przeglad !== null && !!r.fraza.trim() && !trafienia.has(r.id);
  const ileBezTrafien = przeglad ? aktywne.filter(bezTrafien).length : 0;
  const visible = rules
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => tab !== 'bez' || bezTrafien(r))
    .filter(({ r }) => !q || foldText(r.fraza).includes(q) || foldText(nazwy[r.kategoria]).includes(q));

  const setRule = (id: string, patch: Partial<CitSlownikRegula>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // A rule keeps its category only when the new column allows it — otherwise saving would drop the row.
  const setStrona = (r: CitSlownikRegula, strona: CitStrona) =>
    setRule(r.id, {
      strona,
      kategoria: kategorieDlaStrony(strona).includes(r.kategoria) ? r.kategoria : kategorieDlaStrony(strona)[0],
    });
  const move = (index: number, by: number) =>
    setRules((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const save = async () => {
    // Picks of the review not yet added are what the user just worked on — saving without them would drop them silently.
    const czekajace = [...bezReguly.przychod, ...bezReguly.koszt].filter((p) => wybory[p.klucz]);
    let lista = rules;
    if (czekajace.length > 0) {
      const ile = plural(czekajace.length, language, ['wybraną pozycję', 'wybrane pozycje', 'wybranych pozycji'], ['picked item', 'picked items']);
      if (!(await notify.confirm(t.citRevSavePending.replace('{n}', ile), { confirmLabel: t.citRevSavePendingOk }))) return;
      lista = [
        ...czekajace.map((p) => ({ id: newRuleId(), fraza: p.nazwa, strona: p.strona, kategoria: wybory[p.klucz].kategoria })),
        ...rules,
      ];
      setRules(lista);
      setWybory({});
    }
    setSaving(true);
    try {
      const saved = await window.electronAPI.setPodatkiCitUstawienia({
        slownik: lista.filter((r) => r.fraza.trim()).map((r) => ({ ...r, fraza: r.fraza.trim() })),
      });
      notify.success(t.citDictSaved);
      onSaved(saved);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citDictSaveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="book" title={t.citDictTitle} subtitle={t.citDictSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <div className="zad-seg" role="group" aria-label={t.citDictTitle}>
            <button
              type="button"
              className={`zad-seg__btn${tab === 'reguly' ? ' is-active' : ''}`}
              aria-pressed={tab === 'reguly'}
              onClick={() => setTab('reguly')}
            >
              {t.citDictSection}
              <span className="zad-seg__count">{aktywne.length}</span>
            </button>
            {(['przychod', 'koszt'] as const).map((strona) => (
              <button
                key={strona}
                type="button"
                className={`zad-seg__btn${tab === strona ? ' is-active' : ''}`}
                aria-pressed={tab === strona}
                onClick={() => setTab(strona)}
              >
                {strona === 'przychod' ? t.citRevTabIncome : t.citRevTabCost}
                {przeglad && <span className="zad-seg__count">{bezReguly[strona].length}</span>}
              </button>
            ))}
            <button
              type="button"
              className={`zad-seg__btn${tab === 'bez' ? ' is-active' : ''}`}
              aria-pressed={tab === 'bez'}
              onClick={() => setTab('bez')}
            >
              {t.citDictNoHitsTab}
              {przeglad && <span className="zad-seg__count">{ileBezTrafien}</span>}
            </button>
            <button
              type="button"
              className={`zad-seg__btn${tab === 'audyt' ? ' is-active' : ''}`}
              aria-pressed={tab === 'audyt'}
              onClick={() => setTab('audyt')}
            >
              {t.citAudTab}
              {audyt && <span className="zad-seg__count">{rozbieznosci.length}</span>}
            </button>
          </div>
          {tab === 'audyt' ? (
            <AudytSlownika
              t={t}
              gotowy={przeglad !== null}
              blad={przegladBlad}
              sprawdzono={audyt !== null}
              rozbieznosci={rozbieznosci}
              aiBusy={aiBusy}
              onSprawdz={() => void sprawdzRegulyAi()}
              onPrzyjmij={przyjmijAudyt}
              onZostaw={(r) => setZostawione((prev) => new Set(prev).add(r.p.klucz))}
              onPokaz={(r) => {
                setFilter(r.regula.fraza);
                setTab('reguly');
              }}
            />
          ) : tab === 'przychod' || tab === 'koszt' ? (
            <PrzegladSlownika
              t={t}
              strona={tab}
              pozycje={przeglad ? bezReguly[tab] : null}
              blad={przegladBlad}
              wybory={wybory}
              watpliwosci={watpliwosci}
              aiBusy={aiBusy}
              onWybor={setWybor}
              onAi={() => void zaproponujAi(tab)}
              onDodaj={() => void dodajDoSlownika(tab)}
              onOdswiez={() => void wczytajPrzeglad()}
            />
          ) : (
          <FormSection
            icon="book"
            title={tab === 'bez' ? t.citDictNoHitsTitle : t.citDictSection}
            description={tab === 'bez' ? t.citDictNoHitsDesc : t.citDictDesc}
            aside={
              <div className="form-section__actions">
                <button type="button" className="button button-small button-subtle" onClick={() => void uzupelnij()}>
                  <Icon name="undo" size={13} /> {t.citDictFill}
                </button>
                <button type="button" className="button button-small button-ghost" onClick={() => void przywrocWszystko()}>
                  {t.citDictRestore}
                </button>
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() =>
                    setRules((prev) => [
                      { id: newRuleId(), fraza: '', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
                      ...prev,
                    ])
                  }
                >
                  <Icon name="plus" size={13} /> {t.citDictAdd}
                </button>
              </div>
            }
          >
            <div className="ksieg-search zset-search">
              <Icon name="search" size={15} />
              <input type="text" placeholder={t.citDictSearch} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="zset-rules">
              <div className="zset-rule cit-rule zset-rule--head">
                <span>#</span>
                <span>{t.citDictPhrase}</span>
                <span>{t.citDictSide}</span>
                <span>{t.citDictCategory}</span>
                <span />
              </div>
              {visible.map(({ r, index }) => (
                <div key={r.id} className="zset-rule cit-rule">
                  <span className="zeb-muted">{index + 1}</span>
                  <span className="cit-rule__fraza">
                    <input
                      type="text"
                      value={r.fraza}
                      placeholder={t.citDictPhrasePlaceholder}
                      onChange={(e) => setRule(r.id, { fraza: e.target.value })}
                      aria-label={t.citDictPhrase}
                    />
                    {autor(r) !== null && (
                      <Tip content={autor(r)} className="status-badge status-info">
                        {t.citDictAddedBadge}
                      </Tip>
                    )}
                    {bezTrafien(r) && (
                      <Tip
                        content={czyRegulaDomyslna(r) ? t.citDictNoHitsHintDefault : t.citDictNoHitsHint}
                        className={`status-badge ${czyRegulaDomyslna(r) ? 'status-neutral' : 'status-pending'}`}
                      >
                        {t.citDictNoHits}
                      </Tip>
                    )}
                  </span>
                  <Select
                    overlay
                    size="sm"
                    value={r.strona}
                    options={stronaOptions}
                    onChange={(s) => setStrona(r, s as CitStrona)}
                    ariaLabel={t.citDictSide}
                  />
                  <Select
                    overlay
                    size="sm"
                    value={r.kategoria}
                    options={categoryOptions(r.strona)}
                    onChange={(k) => setRule(r.id, { kategoria: k as CitKategoria })}
                    ariaLabel={t.citDictCategory}
                  />
                  <span className="row-actions">
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || tab === 'bez'}
                      data-tip={t.citDictMoveUp}
                      aria-label={t.citDictMoveUp}
                    >
                      <Icon name="arrow-up" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, 1)}
                      disabled={index === rules.length - 1 || tab === 'bez'}
                      data-tip={t.citDictMoveDown}
                      aria-label={t.citDictMoveDown}
                    >
                      <Icon name="arrow-down" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost icon-danger"
                      onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                      data-tip={t.citDictRemove}
                      aria-label={t.citDictRemove}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {visible.length === 0 && <p className="zeb-muted">{t.citDictNone}</p>}
            </div>
          </FormSection>
          )}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => void save()}
          submitLabel={t.save}
          submitIcon="save"
          busy={saving}
        />
      </div>
    </div>
  );
};
