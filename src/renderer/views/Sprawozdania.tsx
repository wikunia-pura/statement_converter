import React, { useEffect, useMemo, useState } from 'react';
import {
  Spotkanie,
  SpotkanieLokalizacja,
  SprawozdanieZapisane,
  Zebranie,
  ZebranieWersja,
} from '../../shared/types';
import { okresLabel } from '../../shared/sprawozdanie';
import { foldText, nazwaNieruchomosci } from '../../shared/plan-gospodarczy';
import { formatStamp } from '../../shared/calendar';
import { ZebranieDane, sortWersje, wersjaLabel, zebranieDane } from '../../shared/zebrania';
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
type PowiazanieFilter = 'all' | 'powiazane' | 'niezalezne';

/** A meeting that presents a statement: the entry, its particulars, and which of its versions link it. */
interface Powiazanie {
  zebranie: Zebranie;
  dane: ZebranieDane;
  wersje: ZebranieWersja[];
}

/** Every statement a meeting links, with the meetings — by library row. */
function powiazaniaWgSprawozdania(
  zebrania: Zebranie[],
  spotkania: Spotkanie[],
  lokalizacje: SpotkanieLokalizacja[]
): Map<number, Powiazanie[]> {
  const out = new Map<number, Powiazanie[]>();
  for (const zebranie of zebrania) {
    const bySpr = new Map<number, ZebranieWersja[]>();
    for (const w of sortWersje(zebranie.wersje)) {
      const id = w.sprawozdanie?.sprawozdanieId;
      if (id != null) bySpr.set(id, [...(bySpr.get(id) ?? []), w]);
    }
    if (bySpr.size === 0) continue;
    const dane = zebranieDane(zebranie, spotkania, lokalizacje);
    bySpr.forEach((wersje, id) => out.set(id, [...(out.get(id) ?? []), { zebranie, dane, wersje }]));
  }
  return out;
}

/** A period as a key: statements of one file share it. */
const okresKey = (s: Pick<SprawozdanieZapisane, 'okresOd' | 'okresDo'>) => `${s.okresOd}|${s.okresDo}`;

/** Newest period first, then the longer one (a full year before its first half). */
const byOkres = (a: SprawozdanieZapisane, b: SprawozdanieZapisane) =>
  b.okresDo.localeCompare(a.okresDo) || a.okresOd.localeCompare(b.okresOd);

const wspolnotaTytul = (nazwa: string) => `Wspólnota Mieszkaniowa ${nazwaNieruchomosci(nazwa)}`;

/** Whether a meeting presents the statement, as a badge — the same look as Zebrania's "z kalendarza". */
const PowiazanieBadge: React.FC<{ t: T; powiazane: boolean }> = ({ t, powiazane }) =>
  powiazane ? (
    <span className="status-badge zeb-link zeb-link--kal" title={t.sprawPowiazaneHint}>
      <Icon name="file-check" size={11} /> {t.sprawPowiazane}
    </span>
  ) : (
    <span className="status-badge zeb-link" title={t.sprawNiezalezneHint}>
      {t.sprawNiezalezne}
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
  powiazania: Powiazanie[];
  onOpen: (id: number) => void;
  onOpenZebranie: (zebranieId: number) => void;
  onBack: () => void;
  onDeleted: () => void;
}> = ({ language, locale, wpis, lista, powiazania, onOpen, onOpenZebranie, onBack, onDeleted }) => {
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
      await window.electronAPI.deleteSprawozdanie(wpis.id);
      notify.success(t.sprawDeleted);
      onDeleted();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const spr = full?.dane;
  const powiazane = powiazania.length > 0;
  const pochodzenie = t.sprawPochodzenie
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
              <PowiazanieBadge t={t} powiazane={powiazane} />
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
          <button
            type="button"
            className="button button-small button-ghost icon-danger"
            onClick={() => void remove()}
            // A statement a meeting presents stays: unlinking it is Zebrania's call.
            disabled={busy || powiazane}
            title={powiazane ? t.sprawDeleteLinked : undefined}
          >
            <Icon name="trash" size={13} /> {t.delete}
          </button>
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
              <div className="callout callout--muted">
                <Icon name="info" size={16} />
                <div className="callout__body">{pochodzenie}</div>
              </div>
            </FormSection>

            <FormSection
              icon="file-check"
              title={t.sprawPowiazaniaTitle}
              description={powiazane ? t.sprawPowiazaniaDesc : t.sprawPowiazaniaNone}
            >
              {powiazane && (
                <ul className="zfin-pick-list">
                  {powiazania.map((p) => (
                    <li key={p.zebranie.id}>
                      <button
                        type="button"
                        className="zfin-pick-item"
                        onClick={() => onOpenZebranie(p.zebranie.id)}
                        title={t.planyOpenInZebrania}
                      >
                        <span className="zfin-pick-item__main">
                          <strong>{p.dane.nazwa || p.dane.adresNazwa || '—'}</strong>
                          <span className="zeb-muted">
                            {[
                              p.dane.startsAt ? formatStamp(p.dane.startsAt, locale) : t.sprawPowiazanieBezTerminu,
                              p.dane.adresNazwa,
                              t.sprawPowiazanieWersje.replace('{v}', p.wersje.map(wersjaLabel).join(', ')),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <Icon name="chevron-right" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
 * "Sprawozdania" — every community's financial statement: the source of truth.
 *
 * vDom files are uploaded here and only here. A meeting in Zebrania links the
 * statement of its community (it never keeps its own copy), so a newer print
 * uploaded here shows in every meeting linked to it. The list tells the
 * statements a meeting presents ("powiązane z zebraniem") from the rest
 * ("niezależne"); only an independent one can be deleted.
 */
const Sprawozdania: React.FC<{
  language: Language;
  /** Zebrania, on one entry's statement tab. */
  onOpenZebranie: (zebranieId: number) => void;
}> = ({ language, onOpenZebranie }) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [lista, setLista] = useState<SprawozdanieZapisane[]>([]);
  const [zebrania, setZebrania] = useState<Zebranie[]>([]);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  /** A period key, or '' for every period; null = not chosen yet (the newest one). */
  const [okres, setOkres] = useState<string | null>(null);
  const [powiazanie, setPowiazanie] = useState<PowiazanieFilter>('all');
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
      const [sp, z, s, l] = await Promise.all([
        window.electronAPI.getSprawozdaniaLista(),
        window.electronAPI.getZebrania(),
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaLokalizacje(),
      ]);
      setLista(sp);
      setZebrania(z);
      setSpotkania(s);
      setLokalizacje(l);
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

  const powiazania = useMemo(
    () => powiazaniaWgSprawozdania(zebrania, spotkania, lokalizacje),
    [zebrania, spotkania, lokalizacje]
  );
  const isPowiazane = (s: SprawozdanieZapisane) => powiazania.has(s.id);

  const counts = useMemo(() => {
    const c = { all: wOkresie.length, powiazane: 0, niezalezne: 0 };
    for (const s of wOkresie) c[powiazania.has(s.id) ? 'powiazane' : 'niezalezne'] += 1;
    return c;
  }, [wOkresie, powiazania]);

  const visible = useMemo(() => {
    const query = foldText(search.trim());
    return wOkresie
      .filter((s) => powiazanie === 'all' || (powiazanie === 'powiazane') === powiazania.has(s.id))
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
  }, [wOkresie, powiazanie, powiazania, search]);

  const detail = detailId != null ? lista.find((s) => s.id === detailId) ?? null : null;

  // The history entry names the statement, for the Back/Forward tooltips — also
  // when it was opened by id from Zebrania.
  useEffect(() => {
    if (detail) navItem.replace(String(detail.id), labelOf(detail.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const upload = async () => {
    setImporting(true);
    try {
      const result = await window.electronAPI.importSprawozdania();
      if (!result) return;
      const { plikNazwa, zapisane } = result;
      if (zapisane.length === 0) {
        notify.info(t.sprawImportNone.replace('{file}', plikNazwa));
      } else {
        const added = plural(
          zapisane.length,
          language,
          ['sprawozdanie', 'sprawozdania', 'sprawozdań'],
          ['statement', 'statements']
        );
        notify.success(t.sprawImported.replace('{n}', added).replace('{file}', plikNazwa));
        // Show what the file held: its period, linked or not, nothing filtered out.
        setOkres(okresKey(zapisane[0]));
        setPowiazanie('all');
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
        powiazania={powiazania.get(detail.id) ?? []}
        onOpenZebranie={onOpenZebranie}
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

  const powiazanieOptions: { key: PowiazanieFilter; label: string; count: number }[] = [
    { key: 'all', label: t.sprawFilterAll, count: counts.all },
    { key: 'powiazane', label: t.sprawFilterPowiazane, count: counts.powiazane },
    { key: 'niezalezne', label: t.sprawFilterNiezalezne, count: counts.niezalezne },
  ];

  const renderRow = (s: SprawozdanieZapisane) => {
    const open = () => navItem.open(String(s.id), labelOf(s.id));
    return (
      <li key={s.id}>
        <div
          className={`zeb-row spr-row${isPowiazane(s) ? ' spr-row--powiazane' : ''}`}
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
            <PowiazanieBadge t={t} powiazane={isPowiazane(s)} />
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
            <div className="zad-seg" role="group" aria-label={t.sprawFilterPowiazanie}>
              {powiazanieOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`zad-seg__btn${powiazanie === o.key ? ' is-active' : ''}${
                    o.count === 0 ? ' is-empty' : ''
                  }`}
                  aria-pressed={powiazanie === o.key}
                  onClick={() => setPowiazanie(o.key)}
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
