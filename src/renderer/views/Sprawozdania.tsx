import React, { useEffect, useMemo, useState } from 'react';
import { SprawozdanieZapisane, SprawozdanieZrodlo } from '../../shared/types';
import { okresLabel } from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import ZebranieDokumentActions from '../components/ZebranieDokumentActions';
import ScreenTitle from '../components/ScreenTitle';
import { useNavItem } from '../navigation';
import {
  SprawozdanieFakty,
  SprawozdaniePodglad,
  SprawozdanieWstepSection,
} from '../components/ZebranieSprawozdanie';

type T = (typeof translations)['pl'];
type ZrodloFilter = 'all' | SprawozdanieZrodlo;

/** A period as a key: statements of one file share it. */
const okresKey = (s: Pick<SprawozdanieZapisane, 'okresOd' | 'okresDo'>) => `${s.okresOd}|${s.okresDo}`;

/** Newest period first, then the longer one (a full year before its first half). */
const byOkres = (a: SprawozdanieZapisane, b: SprawozdanieZapisane) =>
  b.okresDo.localeCompare(a.okresDo) || a.okresOd.localeCompare(b.okresOd);

const wspolnotaTytul = (nazwa: string) => `Wspólnota Mieszkaniowa ${nazwaNieruchomosci(nazwa)}`;

/** Where a statement came from, as a badge — the same look as Zebrania's "z kalendarza". */
const ZrodloBadge: React.FC<{ t: T; zrodlo: SprawozdanieZrodlo }> = ({ t, zrodlo }) =>
  zrodlo === 'zebrania' ? (
    <span className="status-badge zeb-link zeb-link--kal" title={t.sprawZrodloZebraniaHint}>
      <Icon name="file-check" size={11} /> {t.sprawZrodloZebrania}
    </span>
  ) : (
    <span className="status-badge zeb-link" title={t.sprawZrodloWlasneHint}>
      {t.sprawZrodloWlasne}
    </span>
  );

/* =============================== One statement =============================== */

/**
 * One statement on its own screen — the same sections as a meeting's
 * "Sprawozdania finansowe" tab, read straight from the library. The community
 * and the period can be switched in place, so the whole library reads like
 * one document.
 */
const SprawozdanieScreen: React.FC<{
  language: Language;
  locale: string;
  wpis: SprawozdanieZapisane;
  lista: SprawozdanieZapisane[];
  onOpen: (id: number) => void;
  onBack: () => void;
  onDeleted: () => void;
}> = ({ language, locale, wpis, lista, onOpen, onBack, onDeleted }) => {
  const t = translations[language];
  const notify = useNotify();
  const [full, setFull] = useState<SprawozdanieZapisane | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wstep, setWstep] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFull(null);
    setLoadError(false);
    window.electronAPI
      .getSprawozdanie(wpis.id)
      .then((row) => {
        if (cancelled) return;
        if (row?.dane) setFull(row);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wpis.id]);

  // Every community once, by its vDom number — the newest name it was printed under.
  const wspolnoty = useMemo(() => {
    const seen = new Map<number, SprawozdanieZapisane>();
    for (const s of [...lista].sort(byOkres)) {
      if (s.nrWsp != null && !seen.has(s.nrWsp)) seen.set(s.nrWsp, s);
    }
    return [...seen.values()].sort((a, b) =>
      nazwaNieruchomosci(a.nazwa).localeCompare(nazwaNieruchomosci(b.nazwa), 'pl', { numeric: true })
    );
  }, [lista]);

  const okresy = useMemo(
    () => lista.filter((s) => s.nrWsp === wpis.nrWsp).sort(byOkres),
    [lista, wpis.nrWsp]
  );

  /** Another community: its statement of the same period, else its newest one. */
  const switchWspolnota = (nr: string) => {
    const hits = lista.filter((s) => String(s.nrWsp) === nr).sort(byOkres);
    const target = hits.find((s) => okresKey(s) === okresKey(wpis)) ?? hits[0];
    if (target && target.id !== wpis.id) onOpen(target.id);
  };

  const remove = async () => {
    if (
      !(await notify.confirm(
        t.sprawDeleteConfirm
          .replace('{name}', nazwaNieruchomosci(wpis.nazwa))
          .replace('{okres}', okresLabel(wpis.okresOd, wpis.okresDo)),
        { danger: true, confirmLabel: t.delete }
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await window.electronAPI.deleteSprawozdanieWlasne(wpis.id);
      notify.success(t.sprawDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const spr = full?.dane;
  const pochodzenie = (wpis.zrodlo === 'zebrania' ? t.sprawZrodloZebraniaText : t.sprawZrodloWlasneText)
    .replace('{file}', wpis.plikNazwa || '—')
    .replace('{when}', formatStamp(wpis.importedAt, locale))
    .replace('{who}', wpis.importedBy || '—');

  return (
    <>
      <div className="zeb-screen-head">
        <div className="zeb-screen-head__row">
          <ScreenTitle
            backLabel={t.sprawBack}
            crumb={t.sprawozdania}
            onBack={onBack}
            title={wspolnotaTytul(wpis.nazwa)}
            meta={
              <>
              <ZrodloBadge t={t} zrodlo={wpis.zrodlo} />
              <span>
                <Icon name="calendar" size={13} /> {okresLabel(wpis.okresOd, wpis.okresDo)}
              </span>
              {wpis.nrWsp != null && (
                <span>
                  <Icon name="building" size={13} /> {t.sprawNr.replace('{nr}', String(wpis.nrWsp))}
                </span>
              )}
              <span>
                <Icon name="file-text" size={13} /> {wpis.plikNazwa || '—'}
              </span>
              </>
            }
          />
          {wpis.zrodlo === 'sprawozdania' && (
            <button
              type="button"
              className="button button-small button-ghost icon-danger"
              onClick={() => void remove()}
              disabled={busy}
            >
              <Icon name="trash" size={13} /> {t.delete}
            </button>
          )}
        </div>

        <div className="spr-switch">
          <div className="spr-switch__field">
            <span className="spr-switch__label">{t.sprawSwitchWspolnota}</span>
            <SearchableSelect
              size="sm"
              value={wpis.nrWsp != null ? String(wpis.nrWsp) : null}
              options={wspolnoty.map((s) => ({
                value: String(s.nrWsp),
                label: nazwaNieruchomosci(s.nazwa),
                hint: t.sprawNr.replace('{nr}', String(s.nrWsp)),
                keywords: `${s.nazwa} ${s.nrWsp}`,
              }))}
              onChange={switchWspolnota}
              searchPlaceholder={t.sprawSearch}
              emptyText={t.zfinNoMatch}
              ariaLabel={t.sprawSwitchWspolnota}
              disabled={busy}
            />
          </div>
          <div className="spr-switch__field">
            <span className="spr-switch__label">{t.sprawSwitchOkres}</span>
            <Select
              size="sm"
              value={String(wpis.id)}
              options={okresy.map((s) => ({
                value: String(s.id),
                label: okresLabel(s.okresOd, s.okresDo),
              }))}
              onChange={(id) => onOpen(Number(id))}
              ariaLabel={t.sprawSwitchOkres}
              disabled={busy || okresy.length < 2}
            />
          </div>
        </div>
      </div>

      <div className="content-body">
        {loadError ? (
          <div className="zeb-tab-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="alert-triangle" size={22} />
            </span>
            <strong>{t.sprawLoadOneError}</strong>
            <button type="button" className="button button-secondary" onClick={onBack}>
              <Icon name="chevron-left" size={14} /> {t.sprawBack}
            </button>
          </div>
        ) : !spr ? (
          <Loader label={t.loading} />
        ) : (
          <div className="page-form zeb-page">
            <FormSection
              icon="bar-chart"
              title={t.sprawFactsTitle}
              description={t.zfinStatementDesc
                .replace('{okres}', okresLabel(spr.okresOd, spr.okresDo))
                .replace('{wydruk}', spr.wydruk || '—')}
            >
              <SprawozdanieFakty t={t} spr={spr} />
              <div className={`callout ${wpis.zrodlo === 'zebrania' ? 'callout--info' : 'callout--muted'}`}>
                <Icon name="info" size={16} />
                <div className="callout__body">{pochodzenie}</div>
              </div>
            </FormSection>

            <SprawozdanieWstepSection
              t={t}
              spr={spr}
              tekst={null}
              busy={busy}
              readOnlyHint={t.sprawIntroHint}
            />

            <FormSection icon="download" title={t.zfinDownloadTitle} description={t.zfinZeroHint}>
              <label className="switch-row">
                <span className="switch-row__text">
                  <span className="switch-row__label">{t.zfinIntroInPdf}</span>
                  <span className="switch-row__hint">{t.zfinIntroInPdfHint}</span>
                </span>
                <span className="toggle-switch">
                  <input type="checkbox" checked={wstep} onChange={(e) => setWstep(e.target.checked)} />
                  <span className="toggle-slider"></span>
                </span>
              </label>
              <ZebranieDokumentActions
                language={language}
                locale={locale}
                zrodlo={{ sprawozdanieId: wpis.id }}
                wstep={wstep}
                disabled={busy}
              />
            </FormSection>

            <SprawozdaniePodglad key={wpis.id} t={t} spr={spr} />
          </div>
        )}
      </div>
    </>
  );
};

/* ================================== The view ================================== */

/**
 * "Sprawozdania" — every community's financial statement, outside any meeting.
 *
 * The library is the one Zebrania fills: a vDom file uploaded there is the
 * source of truth. A file can also be uploaded here, but only the communities
 * and periods Zebrania does not have are added — and a later Zebrania upload
 * of the same period takes such a statement over.
 */
const Sprawozdania: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [lista, setLista] = useState<SprawozdanieZapisane[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  /** A period key, or '' for every period; null = not chosen yet (the newest one). */
  const [okres, setOkres] = useState<string | null>(null);
  const [zrodlo, setZrodlo] = useState<ZrodloFilter>('all');
  /** The statement open on its own screen — a step of the app's history, so Back returns to the list. */
  const navItem = useNavItem();
  const detailId = navItem.item && /^\d+$/.test(navItem.item) ? Number(navItem.item) : null;
  const labelOf = (id: number) => {
    const s = lista.find((x) => x.id === id);
    return s ? `${nazwaNieruchomosci(s.nazwa)} · ${okresLabel(s.okresOd, s.okresDo)}` : '';
  };

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      setLista(await window.electronAPI.getSprawozdaniaLista());
    } catch {
      notify.error(t.sprawLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const okresy = useMemo(() => {
    const seen = new Map<string, SprawozdanieZapisane>();
    for (const s of [...lista].sort(byOkres)) if (!seen.has(okresKey(s))) seen.set(okresKey(s), s);
    return [...seen.entries()].map(([key, s]) => ({
      key,
      label: okresLabel(s.okresOd, s.okresDo),
      count: lista.filter((x) => okresKey(x) === key).length,
    }));
  }, [lista]);

  // Until somebody picks one, the list shows the newest period — one file's worth.
  const okresActive = okres ?? okresy[0]?.key ?? '';

  const wOkresie = useMemo(
    () => lista.filter((s) => !okresActive || okresKey(s) === okresActive),
    [lista, okresActive]
  );

  const counts = useMemo(() => {
    const c = { all: wOkresie.length, zebrania: 0, sprawozdania: 0 };
    for (const s of wOkresie) c[s.zrodlo] += 1;
    return c;
  }, [wOkresie]);

  const visible = useMemo(() => {
    const query = foldText(search.trim());
    return wOkresie
      .filter((s) => zrodlo === 'all' || s.zrodlo === zrodlo)
      .filter(
        (s) =>
          !query ||
          foldText(s.nazwa).includes(query) ||
          String(s.nrWsp ?? '') === query ||
          foldText(s.plikNazwa).includes(query)
      )
      .sort(
        (a, b) =>
          byOkres(a, b) ||
          nazwaNieruchomosci(a.nazwa).localeCompare(nazwaNieruchomosci(b.nazwa), 'pl', { numeric: true })
      );
  }, [wOkresie, zrodlo, search]);

  const detail = detailId != null ? lista.find((s) => s.id === detailId) ?? null : null;

  const upload = async () => {
    setImporting(true);
    try {
      const result = await window.electronAPI.importSprawozdaniaWlasne();
      if (!result) return;
      const { plikNazwa, zapisane, pominiete } = result;
      const skipped = plural(
        pominiete,
        language,
        ['sprawozdanie', 'sprawozdania', 'sprawozdań'],
        ['statement', 'statements']
      );
      if (zapisane.length === 0) {
        notify.info(t.sprawImportAllSkipped.replace('{file}', plikNazwa).replace('{n}', skipped));
      } else {
        const added = plural(
          zapisane.length,
          language,
          ['sprawozdanie', 'sprawozdania', 'sprawozdań'],
          ['statement', 'statements']
        );
        notify.success(
          t.sprawImported.replace('{n}', added).replace('{file}', plikNazwa) +
            (pominiete > 0 ? ` ${t.sprawImportedSkipped.replace('{n}', skipped)}` : '')
        );
        // Show what the file held: its period, every source, nothing filtered out.
        setOkres(okresKey(zapisane[0]));
        setZrodlo('all');
        setSearch('');
      }
      await load(true);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinImportError);
    } finally {
      setImporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  if (detail) {
    return (
      <SprawozdanieScreen
        language={language}
        locale={locale}
        wpis={detail}
        lista={lista}
        // Another community or period, picked in place: the same step, not a new one.
        onOpen={(id) => navItem.replace(String(id), labelOf(id))}
        onBack={() => navItem.close()}
        onDeleted={() => {
          navItem.close();
          void load(true);
        }}
      />
    );
  }

  const zrodloOptions: { key: ZrodloFilter; label: string; count: number }[] = [
    { key: 'all', label: t.sprawFilterAll, count: counts.all },
    { key: 'zebrania', label: t.sprawFilterZebrania, count: counts.zebrania },
    { key: 'sprawozdania', label: t.sprawFilterWlasne, count: counts.sprawozdania },
  ];

  const renderRow = (s: SprawozdanieZapisane) => {
    const open = () => navItem.open(String(s.id), labelOf(s.id));
    return (
      <li key={s.id}>
        <div
          className={`zeb-row spr-row spr-row--${s.zrodlo}`}
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
          <div className="zeb-date spr-nr" title={t.zfinNr}>
            <span className="zeb-date__month">{t.sprawNrShort}</span>
            <span className="zeb-date__day">{s.nrWsp ?? '—'}</span>
          </div>
          <div className="zeb-row__main">
            <span className="zeb-row__name">{wspolnotaTytul(s.nazwa)}</span>
            <span className="zeb-row__meta">
              <span>
                <Icon name="calendar" size={13} /> {okresLabel(s.okresOd, s.okresDo)}
              </span>
              <span title={s.plikNazwa}>
                <Icon name="file-text" size={13} /> {s.plikNazwa || '—'}
              </span>
              <span>
                <Icon name="upload" size={13} />{' '}
                {t.zfinImportedBy
                  .replace('{when}', formatStamp(s.importedAt, locale))
                  .replace('{who}', s.importedBy || '—')}
              </span>
            </span>
          </div>
          <div className="zeb-row__side">
            <ZrodloBadge t={t} zrodlo={s.zrodlo} />
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
            <h2 className="page-hero__title">{t.sprawTitle}</h2>
            <p className="page-hero__text">{t.sprawHint}</p>
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
            className="button button-primary"
            onClick={() => void upload()}
            disabled={importing}
            title={t.sprawUploadHint}
          >
            <Icon name={importing ? 'loader' : 'upload'} size={14} /> {t.zfinUpload}
          </button>
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="zeb-empty">
          <span className="zeb-tab-empty__icon">
            <Icon name="book" size={22} />
          </span>
          <strong>{t.sprawEmptyTitle}</strong>
          <p>{t.sprawEmptyText}</p>
          <ul>
            <li>{t.sprawEmptyWay1}</li>
            <li>{t.sprawEmptyWay2}</li>
          </ul>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void upload()}
            disabled={importing}
          >
            <Icon name={importing ? 'loader' : 'upload'} size={14} /> {t.zfinUpload}
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
              value={okresActive}
              options={[
                ...okresy.map((o) => ({ value: o.key, label: o.label })),
                { value: '', label: t.sprawAllPeriods },
              ]}
              onChange={setOkres}
              ariaLabel={t.sprawSwitchOkres}
              title={t.sprawSwitchOkres}
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
              <Icon name="search" size={18} /> {t.sprawNoMatch}
            </div>
          ) : (
            <ul className="zeb-list">{visible.map(renderRow)}</ul>
          )}
        </>
      )}

      {importing && <BusyOverlay label={t.sprawImporting} />}
    </div>
  );
};

export default Sprawozdania;
