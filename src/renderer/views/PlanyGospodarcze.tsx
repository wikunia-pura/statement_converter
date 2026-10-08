import React, { useEffect, useMemo, useState } from 'react';
import {
  PlanGospodarczy,
  PlanWlasny,
  Spotkanie,
  SpotkanieLokalizacja,
  Sprawozdanie,
  SprawozdanieZapisane,
  ZebraniaUstawienia,
  ZebraniaWspolnota,
  Zebranie,
} from '../../shared/types';
import { PlanZZebran, planKey, planWZebraniach, planyZZebran } from '../../shared/plany';
import { defaultUstawienia, foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { okresLabel } from '../../shared/sprawozdanie';
import { wersjaLabel, zebranieDane } from '../../shared/zebrania';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { FormField, FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader from '../components/Loader';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import ZebraniaUstawieniaModal from '../components/ZebraniaUstawieniaModal';
import ScreenTitle from '../components/ScreenTitle';
import { useNavItem } from '../navigation';
import {
  PlanWorkspace,
  PlanZalozenia,
  PlanZalozeniaFields,
  draftPlanu,
  zapamietajUdzialy,
} from '../components/ZebraniePlan';

type T = (typeof translations)['pl'];
type ZrodloFilter = 'all' | 'zebrania' | 'wlasne';

/**
 * One plan on the list: a Zebrania entry's (the source of truth) or one made
 * here. A plan made here that Zebrania later made too is `zastapiony` — kept,
 * shown read-only, there to be deleted.
 */
type Wpis =
  | {
      kind: 'zebrania';
      id: string;
      nrWsp: number | null;
      rok: number;
      nazwa: string;
      plan: PlanGospodarczy;
      src: PlanZZebran;
      dataZebrania: string | null;
    }
  | {
      kind: 'wlasny';
      id: string;
      nrWsp: number;
      rok: number;
      nazwa: string;
      plan: PlanGospodarczy;
      wlasny: PlanWlasny;
      zastapiony: PlanZZebran | undefined;
    };

const byNazwa = (a: { nazwa: string }, b: { nazwa: string }) =>
  a.nazwa.localeCompare(b.nazwa, 'pl', { numeric: true });

/** Where a plan came from, as a badge — the same look as Sprawozdania's. */
const ZrodloBadge: React.FC<{ t: T; wpis: Wpis }> = ({ t, wpis }) =>
  wpis.kind === 'zebrania' ? (
    <span className="status-badge zeb-link zeb-link--kal" title={t.planyZrodloZebraniaHint}>
      <Icon name="file-check" size={11} /> {t.sprawZrodloZebrania}
    </span>
  ) : wpis.zastapiony ? (
    <span className="status-badge status-pending" title={t.planyZastapionyHint}>
      {t.planyZastapiony}
    </span>
  ) : (
    <span className="status-badge zeb-link" title={t.planyZrodloWlasneHint}>
      {t.sprawZrodloWlasne}
    </span>
  );

/* =============================== The new plan =============================== */

/**
 * "Nowy plan": a statement of the library and the assumptions to draft with.
 * A community and year Zebrania has a plan for cannot be made here — the
 * modal says so before the user fills anything in, and the main process
 * refuses it anyway.
 */
const NowyPlanModal: React.FC<{
  t: T;
  lista: SprawozdanieZapisane[];
  wspolnoty: ZebraniaWspolnota[];
  ustawienia: ZebraniaUstawienia;
  wpisy: Wpis[];
  onOpenWpis: (id: string) => void;
  onOpenUstawienia: () => void;
  onCreated: (plan: PlanWlasny) => void;
  onClose: () => void;
}> = ({ t, lista, wspolnoty, ustawienia, wpisy, onOpenWpis, onOpenUstawienia, onCreated, onClose }) => {
  const notify = useNotify();
  const [nr, setNr] = useState<string | null>(null);
  const [sprId, setSprId] = useState<string | null>(null);
  const [zalozenia, setZalozenia] = useState<PlanZalozenia>({ wskaznik: 0, miastoM2: 0, pozytkiM2: 0 });
  const [busy, setBusy] = useState(false);

  // Every community once, by its vDom number — under the newest name it was printed with.
  const spolki = useMemo(() => {
    const seen = new Map<number, SprawozdanieZapisane>();
    for (const s of [...lista].sort((a, b) => b.okresDo.localeCompare(a.okresDo))) {
      if (s.nrWsp != null && !seen.has(s.nrWsp)) seen.set(s.nrWsp, s);
    }
    return [...seen.values()].sort((a, b) =>
      nazwaNieruchomosci(a.nazwa).localeCompare(nazwaNieruchomosci(b.nazwa), 'pl', { numeric: true })
    );
  }, [lista]);

  const okresy = useMemo(
    () =>
      lista
        .filter((s) => String(s.nrWsp) === nr)
        .sort((a, b) => b.okresDo.localeCompare(a.okresDo) || a.okresOd.localeCompare(b.okresOd)),
    [lista, nr]
  );
  const spr = okresy.find((s) => String(s.id) === sprId) ?? null;
  const rok = spr ? Number(spr.okresDo.slice(0, 4)) + 1 : null;
  const existing =
    spr && rok != null
      ? wpisy.find((w) => planKey(w.nrWsp, w.rok) === planKey(spr.nrWsp, rok) && w.kind === 'zebrania') ??
        wpisy.find((w) => planKey(w.nrWsp, w.rok) === planKey(spr.nrWsp, rok))
      : undefined;

  const pickWspolnota = (value: string) => {
    setNr(value);
    const newest = lista
      .filter((s) => String(s.nrWsp) === value)
      .sort((a, b) => b.okresDo.localeCompare(a.okresDo))[0];
    setSprId(newest ? String(newest.id) : null);
    // The split remembered for the community, as its plans in Zebrania would get it.
    const w = wspolnoty.find((x) => String(x.vdomNr) === value);
    setZalozenia((z) => ({
      ...z,
      miastoM2: w?.udzialy?.miastoM2 ?? 0,
      pozytkiM2: w?.udzialy?.pozytkiM2 ?? 0,
    }));
  };

  const create = async () => {
    if (!spr || spr.nrWsp == null || existing) return;
    setBusy(true);
    try {
      const full = await window.electronAPI.getSprawozdanie(spr.id);
      if (!full?.dane) throw new Error(t.sprawLoadOneError);
      const plan = draftPlanu(full.dane, ustawienia, zalozenia);
      const created = await window.electronAPI.addPlanWlasny(spr.nrWsp, spr.nazwa, plan);
      const w = wspolnoty.find((x) => x.vdomNr === spr.nrWsp) ?? null;
      if (w) await zapamietajUdzialy(w.adresNazwa, w, created.plan);
      notify.success(t.zplanCreated);
      onCreated(created);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="coins" title={t.planyNewTitle} subtitle={t.planyNewSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="bar-chart" title={t.planyNewStatement} description={t.planyNewStatementHint}>
            {lista.length === 0 ? (
              <p className="form-empty">{t.planyNewNoStatements}</p>
            ) : (
              <>
                <FormField label={t.sprawSwitchWspolnota} required>
                  <SearchableSelect
                    overlay
                    value={nr}
                    options={spolki.map((s) => ({
                      value: String(s.nrWsp),
                      label: nazwaNieruchomosci(s.nazwa),
                      hint: t.sprawNr.replace('{nr}', String(s.nrWsp)),
                      keywords: `${s.nazwa} ${s.nrWsp}`,
                    }))}
                    onChange={pickWspolnota}
                    placeholder={t.planyNewPickWspolnota}
                    searchPlaceholder={t.sprawSearch}
                    emptyText={t.zfinNoMatch}
                    ariaLabel={t.sprawSwitchWspolnota}
                    disabled={busy}
                  />
                </FormField>
                <FormField
                  label={t.planyNewPeriod}
                  required
                  hint={rok != null ? t.planyNewYear.replace('{rok}', String(rok)) : undefined}
                >
                  <Select
                    overlay
                    value={sprId}
                    options={okresy.map((s) => ({
                      value: String(s.id),
                      label: okresLabel(s.okresOd, s.okresDo),
                    }))}
                    onChange={setSprId}
                    placeholder={t.planyNewPickPeriod}
                    ariaLabel={t.planyNewPeriod}
                    disabled={busy || okresy.length === 0}
                  />
                </FormField>
                {existing && (
                  <div
                    className={`callout ${existing.kind === 'zebrania' ? 'callout--warning' : 'callout--info'}`}
                  >
                    <Icon name={existing.kind === 'zebrania' ? 'alert-triangle' : 'info'} size={16} />
                    <div className="callout__body">
                      {existing.kind === 'zebrania'
                        ? t.planyNewInZebrania
                            .replace('{rok}', String(rok))
                            .replace('{zebranie}', existing.src.zebranie.nazwa || existing.nazwa)
                            .replace('{v}', wersjaLabel(existing.src.wersja))
                        : t.planyNewExists.replace('{rok}', String(rok))}{' '}
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => onOpenWpis(existing.id)}
                      >
                        {t.planyNewShow}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </FormSection>

          <FormSection
            icon="sparkles"
            title={t.planyNewAssumptions}
            description={t.zplanAreasHint}
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
          </FormSection>
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => void create()}
          submitLabel={t.zplanCreate}
          submitIcon="sparkles"
          submitDisabled={!spr || !!existing}
          busy={busy}
        />
      </div>
    </div>
  );
};

/* ================================= One plan ================================= */

const PlanScreen: React.FC<{
  language: Language;
  locale: string;
  wpis: Wpis;
  wpisy: Wpis[];
  lista: SprawozdanieZapisane[];
  wspolnoty: ZebraniaWspolnota[];
  ustawienia: ZebraniaUstawienia;
  onOpen: (id: string) => void;
  onBack: () => void;
  onReload: () => Promise<void>;
  onOpenUstawienia: () => void;
  onOpenZebranie: (zebranieId: number) => void;
}> = ({
  language,
  locale,
  wpis,
  wpisy,
  lista,
  wspolnoty,
  ustawienia,
  onOpen,
  onBack,
  onReload,
  onOpenUstawienia,
  onOpenZebranie,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [spr, setSpr] = useState<Sprawozdanie | null>(null);
  const [busy, setBusy] = useState(false);

  // The statement a plan made here was drafted from, for "Przelicz ze sprawozdania".
  const zrodloSpr =
    wpis.kind === 'wlasny'
      ? lista.find(
          (s) =>
            s.nrWsp === wpis.nrWsp &&
            s.okresOd === wpis.plan.sprawozdanieOkres.od &&
            s.okresDo === wpis.plan.sprawozdanieOkres.do
        )
      : undefined;
  useEffect(() => {
    let cancelled = false;
    setSpr(null);
    if (zrodloSpr) {
      window.electronAPI
        .getSprawozdanie(zrodloSpr.id)
        .then((row) => {
          if (!cancelled) setSpr(row?.dane ?? null);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [zrodloSpr?.id]);

  const wspolnotyPlanow = useMemo(() => {
    const seen = new Map<number, Wpis>();
    for (const w of wpisy) if (w.nrWsp != null && !seen.has(w.nrWsp)) seen.set(w.nrWsp, w);
    return [...seen.values()].sort(byNazwa);
  }, [wpisy]);
  const lata = useMemo(
    () => wpisy.filter((w) => w.nrWsp === wpis.nrWsp && wpis.nrWsp != null).sort((a, b) => b.rok - a.rok),
    [wpisy, wpis.nrWsp]
  );

  /** Another community: its plan of the same year, else its newest one. */
  const switchWspolnota = (nr: string) => {
    const hits = wpisy.filter((w) => String(w.nrWsp) === nr).sort((a, b) => b.rok - a.rok);
    const target = hits.find((w) => w.rok === wpis.rok) ?? hits[0];
    if (target && target.id !== wpis.id) onOpen(target.id);
  };

  const removeReplaced = async () => {
    if (wpis.kind !== 'wlasny') return;
    if (
      !(await notify.confirm(t.planyDeleteConfirm.replace('{rok}', String(wpis.rok)).replace('{name}', wpis.nazwa), {
        danger: true,
        confirmLabel: t.delete,
      }))
    )
      return;
    setBusy(true);
    try {
      await window.electronAPI.deletePlanWlasny(wpis.wlasny.id);
      notify.success(t.zplanDeleted);
      // Gone: back to the list, so the history does not keep a step to nothing.
      onBack();
      await onReload();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const wspolnota = wspolnoty.find((w) => w.vdomNr != null && w.vdomNr === wpis.nrWsp) ?? null;

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.planyBack}
            crumb={t.planyGospodarcze}
            onBack={onBack}
            title={t.planyScreenTitle.replace('{rok}', String(wpis.rok)).replace('{name}', wpis.nazwa)}
            meta={
              <>
              <ZrodloBadge t={t} wpis={wpis} />
              {wpis.nrWsp != null && (
                <span>
                  <Icon name="building" size={13} /> {t.sprawNr.replace('{nr}', String(wpis.nrWsp))}
                </span>
              )}
              {wpis.kind === 'zebrania' && (
                <span>
                  <Icon name="file-check" size={13} />{' '}
                  {t.planyZZebrania
                    .replace('{zebranie}', wpis.src.zebranie.nazwa || wpis.nazwa)
                    .replace('{v}', wersjaLabel(wpis.src.wersja))}
                </span>
              )}
              <span>
                <Icon name="bar-chart" size={13} />{' '}
                {t.planySprawozdanie.replace(
                  '{okres}',
                  okresLabel(wpis.plan.sprawozdanieOkres.od, wpis.plan.sprawozdanieOkres.do)
                )}
              </span>
              </>
            }
          />
          {wpis.kind === 'zebrania' ? (
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => onOpenZebranie(wpis.src.zebranie.id)}
            >
              <Icon name="file-check" size={13} /> {t.planyOpenInZebrania}
            </button>
          ) : (
            wpis.zastapiony && (
              <button
                type="button"
                className="button button-small button-ghost icon-danger"
                onClick={() => void removeReplaced()}
                disabled={busy}
              >
                <Icon name="trash" size={13} /> {t.delete}
              </button>
            )
          )}
        </div>

        <div className="spr-switch">
          <div className="spr-switch__field">
            <span className="spr-switch__label">{t.sprawSwitchWspolnota}</span>
            <SearchableSelect
              size="sm"
              value={wpis.nrWsp != null ? String(wpis.nrWsp) : null}
              options={wspolnotyPlanow.map((w) => ({
                value: String(w.nrWsp),
                label: w.nazwa,
                hint: t.sprawNr.replace('{nr}', String(w.nrWsp)),
                keywords: `${w.nazwa} ${w.nrWsp}`,
              }))}
              onChange={switchWspolnota}
              searchPlaceholder={t.sprawSearch}
              emptyText={t.zfinNoMatch}
              ariaLabel={t.sprawSwitchWspolnota}
              disabled={busy || wpis.nrWsp == null}
            />
          </div>
          <div className="spr-switch__field">
            <span className="spr-switch__label">{t.planyYear}</span>
            <Select
              size="sm"
              value={wpis.id}
              options={(lata.length > 0 ? lata : [wpis]).map((w) => ({
                value: w.id,
                label: String(w.rok),
              }))}
              onChange={onOpen}
              ariaLabel={t.planyYear}
              disabled={busy || lata.length < 2}
            />
          </div>
        </div>
      </div>

      <div className="content-body">
        {wpis.kind === 'zebrania' ? (
          <PlanWorkspace
            key={wpis.id}
            language={language}
            locale={locale}
            stored={wpis.plan}
            storeKey={wpis.id}
            spr={null}
            ustawienia={ustawienia}
            zrodlo={{ wersjaId: wpis.src.wersja.id, dokument: 'plan', dataZebrania: wpis.dataZebrania }}
            deleteConfirm=""
            readOnly
            notice={
              <div className="callout callout--info">
                <Icon name="info" size={16} />
                <div className="callout__body">
                  {t.planyZebraniaNotice.replace('{v}', wersjaLabel(wpis.src.wersja))}
                </div>
              </div>
            }
            persist={async () => undefined}
            onChanged={onReload}
            onOpenUstawienia={onOpenUstawienia}
          />
        ) : (
          <PlanWorkspace
            key={wpis.id}
            language={language}
            locale={locale}
            stored={wpis.plan}
            storeKey={wpis.id}
            spr={spr}
            ustawienia={ustawienia}
            zrodlo={{ planId: wpis.wlasny.id }}
            deleteConfirm={t.planyDeleteConfirm
              .replace('{rok}', String(wpis.rok))
              .replace('{name}', wpis.nazwa)}
            readOnly={!!wpis.zastapiony}
            notice={
              wpis.zastapiony ? (
                <div className="callout callout--warning">
                  <Icon name="alert-triangle" size={16} />
                  <div className="callout__body">
                    {t.planyZastapionyNotice
                      .replace('{rok}', String(wpis.rok))
                      .replace('{zebranie}', wpis.zastapiony.zebranie.nazwa || wpis.nazwa)
                      .replace('{v}', wersjaLabel(wpis.zastapiony.wersja))}
                  </div>
                </div>
              ) : undefined
            }
            persist={async (plan) => {
              if (!plan) {
                await window.electronAPI.deletePlanWlasny(wpis.wlasny.id);
                return;
              }
              await window.electronAPI.setPlanWlasny(wpis.wlasny.id, plan);
              if (wspolnota) await zapamietajUdzialy(wspolnota.adresNazwa, wspolnota, plan);
            }}
            onChanged={onReload}
            onOpenUstawienia={onOpenUstawienia}
          />
        )}
      </div>
    </>
  );
};

/* ================================== The view ================================== */

/**
 * "Plany gospodarcze" — every community's budget plan, outside any meeting.
 *
 * The plans in Zebrania are the source of truth: each entry's newest version
 * that has a plan is listed, read-only here and edited there. A plan can also
 * be made here from a library statement, but only for a community and year
 * Zebrania has no plan for; once Zebrania makes one, the plan made here is
 * marked as replaced.
 */
const PlanyGospodarcze: React.FC<{
  language: Language;
  onOpenZebranie: (zebranieId: number) => void;
}> = ({ language, onOpenZebranie }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [zebrania, setZebrania] = useState<Zebranie[]>([]);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [wlasne, setWlasne] = useState<PlanWlasny[]>([]);
  const [lista, setLista] = useState<SprawozdanieZapisane[]>([]);
  const [wspolnoty, setWspolnoty] = useState<ZebraniaWspolnota[]>([]);
  const [ustawienia, setUstawienia] = useState<ZebraniaUstawienia>(() => defaultUstawienia());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  /** A year, or '' for every year; null = not chosen yet (the newest one). */
  const [rokFilter, setRokFilter] = useState<string | null>(null);
  const [zrodlo, setZrodlo] = useState<ZrodloFilter>('all');
  /** The plan open on its own screen — a step of the app's history, so Back returns to the list. */
  const navItem = useNavItem();
  const detailId = navItem.item;
  const [creating, setCreating] = useState(false);
  const [ustawieniaOpen, setUstawieniaOpen] = useState(false);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [z, s, l, p, sp, w, u] = await Promise.all([
        window.electronAPI.getZebrania(),
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaLokalizacje(),
        window.electronAPI.getPlanyWlasne(),
        window.electronAPI.getSprawozdaniaLista(),
        window.electronAPI.getZebraniaWspolnoty(),
        window.electronAPI.getZebraniaUstawienia(),
      ]);
      setZebrania(z);
      setSpotkania(s);
      setLokalizacje(l);
      setWlasne(p);
      setLista(sp);
      setWspolnoty(w);
      setUstawienia(u);
    } catch {
      notify.error(t.planyLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wpisy = useMemo<Wpis[]>(() => {
    const zZebran = planyZZebran(zebrania, wspolnoty);
    const nameByNr = new Map(
      wspolnoty.filter((w) => w.vdomNr != null).map((w) => [w.vdomNr as number, w.adresNazwa])
    );
    const out: Wpis[] = zZebran.map((src) => {
      const dane = zebranieDane(src.zebranie, spotkania, lokalizacje);
      return {
        kind: 'zebrania',
        id: `z-${src.zebranie.id}`,
        nrWsp: src.nrWsp,
        rok: src.plan.rok,
        nazwa: dane.adresNazwa || src.plan.nieruchomosc || dane.nazwa,
        plan: src.plan,
        src,
        dataZebrania: dane.startsAt,
      };
    });
    for (const p of wlasne) {
      out.push({
        kind: 'wlasny',
        id: `w-${p.id}`,
        nrWsp: p.nrWsp,
        rok: p.rok,
        nazwa: nameByNr.get(p.nrWsp) || nazwaNieruchomosci(p.nazwa),
        plan: p.plan,
        wlasny: p,
        zastapiony: planWZebraniach(zZebran, p.nrWsp, p.rok),
      });
    }
    return out;
  }, [zebrania, spotkania, lokalizacje, wlasne, wspolnoty]);

  const lata = useMemo(() => [...new Set(wpisy.map((w) => w.rok))].sort((a, b) => b - a), [wpisy]);
  // Until somebody picks one, the list shows the newest year.
  const rokActive = rokFilter ?? (lata[0] != null ? String(lata[0]) : '');
  const wRoku = useMemo(
    () => wpisy.filter((w) => !rokActive || String(w.rok) === rokActive),
    [wpisy, rokActive]
  );
  const counts = useMemo(() => {
    const c = { all: wRoku.length, zebrania: 0, wlasne: 0 };
    for (const w of wRoku) c[w.kind === 'zebrania' ? 'zebrania' : 'wlasne'] += 1;
    return c;
  }, [wRoku]);

  const visible = useMemo(() => {
    const query = foldText(search.trim());
    return wRoku
      .filter((w) => zrodlo === 'all' || (zrodlo === 'zebrania') === (w.kind === 'zebrania'))
      .filter(
        (w) =>
          !query ||
          foldText(w.nazwa).includes(query) ||
          foldText(w.plan.nieruchomosc).includes(query) ||
          String(w.nrWsp ?? '') === query ||
          (w.kind === 'zebrania' && foldText(w.src.zebranie.nazwa).includes(query))
      )
      .sort((a, b) => b.rok - a.rok || byNazwa(a, b));
  }, [wRoku, zrodlo, search]);

  const detail = detailId ? wpisy.find((w) => w.id === detailId) ?? null : null;
  const labelOf = (id: string) => {
    const w = wpisy.find((x) => x.id === id);
    return w ? t.planyScreenTitle.replace('{rok}', String(w.rok)).replace('{name}', w.nazwa) : '';
  };

  // A plan opened before the list held it (just created) gets its name here.
  useEffect(() => {
    if (detail) navItem.replace(detail.id, labelOf(detail.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const modals = (
    <>
      {creating && (
        <NowyPlanModal
          t={t}
          lista={lista}
          wspolnoty={wspolnoty}
          ustawienia={ustawienia}
          wpisy={wpisy}
          onOpenWpis={(id) => {
            setCreating(false);
            navItem.open(id, labelOf(id));
          }}
          onOpenUstawienia={() => setUstawieniaOpen(true)}
          onCreated={(plan) => {
            setCreating(false);
            void load(true).then(() => navItem.open(`w-${plan.id}`, ''));
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {ustawieniaOpen && (
        <ZebraniaUstawieniaModal
          language={language}
          value={ustawienia}
          onSaved={(value) => {
            setUstawienia(value);
            setUstawieniaOpen(false);
          }}
          onClose={() => setUstawieniaOpen(false)}
        />
      )}
    </>
  );

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  if (detail) {
    return (
      <>
        <PlanScreen
          language={language}
          locale={locale}
          wpis={detail}
          wpisy={wpisy}
          lista={lista}
          wspolnoty={wspolnoty}
          ustawienia={ustawienia}
          // Another plan, picked in place: the same step, not a new one.
          onOpen={(id) => navItem.replace(id, labelOf(id))}
          onBack={() => navItem.close()}
          onReload={() => load(true)}
          onOpenUstawienia={() => setUstawieniaOpen(true)}
          onOpenZebranie={onOpenZebranie}
        />
        {modals}
      </>
    );
  }

  const zrodloOptions: { key: ZrodloFilter; label: string; count: number }[] = [
    { key: 'all', label: t.sprawFilterAll, count: counts.all },
    { key: 'zebrania', label: t.sprawFilterZebrania, count: counts.zebrania },
    { key: 'wlasne', label: t.sprawFilterWlasne, count: counts.wlasne },
  ];

  const renderRow = (w: Wpis) => {
    const open = () => navItem.open(w.id, labelOf(w.id));
    const zmieniono = w.plan.zmieniono
      ? t.zplanChanged
          .replace('{when}', formatStamp(w.plan.zmieniono, locale))
          .replace('{who}', w.plan.zmienil || '—')
      : '';
    return (
      <li key={w.id}>
        <div
          className={`zeb-row spr-row spr-row--${w.kind === 'zebrania' ? 'zebrania' : w.zastapiony ? 'zastapiony' : 'wlasny'}`}
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
          <div className="zeb-date spr-nr">
            <span className="zeb-date__month">{t.planyTileLabel}</span>
            <span className="zeb-date__day">{w.rok}</span>
          </div>
          <div className="zeb-row__main">
            <span className="zeb-row__name">{w.nazwa || '—'}</span>
            <span className="zeb-row__meta">
              {w.kind === 'zebrania' && (
                <span>
                  <Icon name="file-check" size={13} />{' '}
                  {t.planyZZebrania
                    .replace('{zebranie}', w.src.zebranie.nazwa || w.nazwa)
                    .replace('{v}', wersjaLabel(w.src.wersja))}
                </span>
              )}
              <span>
                <Icon name="bar-chart" size={13} />{' '}
                {t.planySprawozdanie.replace(
                  '{okres}',
                  okresLabel(w.plan.sprawozdanieOkres.od, w.plan.sprawozdanieOkres.do)
                )}
              </span>
              {zmieniono && (
                <span>
                  <Icon name="edit" size={13} /> {zmieniono}
                </span>
              )}
            </span>
          </div>
          <div className="zeb-row__side">
            <ZrodloBadge t={t} wpis={w} />
            <Icon name="chevron-right" size={16} />
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="content-body">
      <div className="zad-head zeb-head">
        <div className="zeb-head__id">
          <div>
            <h2 className="page-hero__title">{t.planyTitle}</h2>
            <p className="page-hero__text">{t.planyHint}</p>
          </div>
        </div>
        <div className="zeb-head__actions">
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
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setUstawieniaOpen(true)}
          >
            <Icon name="settings" size={14} /> {t.zplanDictionary}
          </button>
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> {t.planyAdd}
          </button>
        </div>
      </div>

      {wpisy.length === 0 ? (
        <div className="zeb-empty">
          <span className="zeb-tab-empty__icon">
            <Icon name="coins" size={22} />
          </span>
          <strong>{t.planyEmptyTitle}</strong>
          <p>{t.planyEmptyText}</p>
          <ul>
            <li>{t.planyEmptyWay1}</li>
            <li>{t.planyEmptyWay2}</li>
          </ul>
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> {t.planyAdd}
          </button>
        </div>
      ) : (
        <>
          <div className="zeb-toolbar">
            <div className="ksieg-search">
              <Icon name="search" size={15} />
              <input
                type="text"
                placeholder={t.sprawSearch}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && (
                <button type="button" onClick={() => setSearch('')} title={t.close} aria-label={t.close}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <Select
              value={rokActive}
              options={[
                ...lata.map((r) => ({ value: String(r), label: t.planyYearOption.replace('{rok}', String(r)) })),
                { value: '', label: t.planyAllYears },
              ]}
              onChange={setRokFilter}
              ariaLabel={t.planyYear}
              title={t.planyYear}
            />
            <div className="zad-seg" role="group" aria-label={t.sprawFilterZrodlo}>
              {zrodloOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`zad-seg__btn${zrodlo === o.key ? ' is-active' : ''}${
                    o.count === 0 ? ' is-empty' : ''
                  }`}
                  aria-pressed={zrodlo === o.key}
                  onClick={() => setZrodlo(o.key)}
                >
                  {o.label}
                  <span className="zad-seg__count">{o.count}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="zeb-nomatch">
              <Icon name="search" size={18} /> {t.planyNoMatch}
            </div>
          ) : (
            <ul className="zeb-list">{visible.map(renderRow)}</ul>
          )}
        </>
      )}

      {modals}
    </div>
  );
};

export default PlanyGospodarcze;
