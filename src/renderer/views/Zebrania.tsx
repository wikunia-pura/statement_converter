import React, { useEffect, useMemo, useState } from 'react';
import {
  Adres,
  Spotkanie,
  SpotkanieLokalizacja,
  Zebranie,
  ZebranieInput,
  ZebranieStatus,
  ZebranieWersja,
} from '../../shared/types';
import {
  latestWersja,
  nextWersjaNumber,
  sortWersje,
  wersjaLabel,
  zawiadomienieOf,
  zebranieDane,
  ZebranieDane,
} from '../../shared/zebrania';
import { formatStamp, formatTime, partsToIso, toParts } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader from '../components/Loader';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import MeetingsIllustration from '../components/MeetingsIllustration';
import ZawiadomienieModal from '../components/ZawiadomienieModal';

type T = (typeof translations)['pl'];

interface Props {
  language: Language;
  userEmail: string;
  /**
   * Open this entry — Kalendarz's "Otwórz w Zebraniach" asked for it. A fresh
   * `nonce` makes the same entry open again.
   */
  openRequest?: { id: number; nonce: number } | null;
  /** The request has landed, so a later visit is not pulled back to it. */
  onOpenRequestHandled?: () => void;
  /** Show a linked entry's meeting in the Kalendarz. */
  onOpenSpotkanie?: (spotkanie: Spotkanie) => void;
  /** Open a linked entry's meeting in the Kalendarz's edit form — its data lives there. */
  onEditSpotkanie?: (spotkanie: Spotkanie) => void;
  /** "Mailing → Szablony", for the notice flow when no notice template exists yet. */
  onOpenSzablony?: () => void;
}

type StatusFilter = 'all' | ZebranieStatus;
type SortMode = 'nearest' | 'latest';

export function zebranieStatusLabel(t: T, status: ZebranieStatus): string {
  return status === 'przygotowane' ? t.zebraniaStatusPrzygotowane : t.zebraniaStatusW;
}

/** The value a time compares by; an entry with no date sorts after every dated one. */
function timeOf(dane: ZebranieDane): number | null {
  if (!dane.startsAt) return null;
  const ms = new Date(dane.startsAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* ============================ Standalone entry form ============================ */

const PLACE_CUSTOM = '__custom';

/**
 * A standalone entry's own data — a meeting that is not in the Kalendarz.
 * Location from the dictionary when it is a known place (its address comes
 * along), or typed in by hand for a one-off.
 */
const ZebranieFormModal: React.FC<{
  language: Language;
  editing: Zebranie | null;
  adresy: Adres[];
  lokalizacje: SpotkanieLokalizacja[];
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: ZebranieInput) => void;
  onCancel: () => void;
}> = ({ language, editing, adresy, lokalizacje, isSaving, error, onSubmit, onCancel }) => {
  const t = translations[language];
  const start = toParts(editing?.startsAt ?? null);
  const [nazwa, setNazwa] = useState(editing?.nazwa ?? '');
  const [adresId, setAdresId] = useState(editing?.adresId != null ? String(editing.adresId) : '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time || '18:00');
  // A place that was typed by hand (or whose dictionary entry is gone) reopens as typed.
  const initialPlace =
    editing?.lokalizacjaId != null && lokalizacje.some((l) => l.id === editing.lokalizacjaId)
      ? String(editing.lokalizacjaId)
      : editing && (editing.lokalizacjaNazwa || editing.lokalizacjaAdres)
        ? PLACE_CUSTOM
        : '';
  const [place, setPlace] = useState(initialPlace);
  const [placeNazwa, setPlaceNazwa] = useState(
    initialPlace === PLACE_CUSTOM ? editing?.lokalizacjaNazwa ?? '' : '',
  );
  const [placeAdres, setPlaceAdres] = useState(
    initialPlace === PLACE_CUSTOM ? editing?.lokalizacjaAdres ?? '' : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const adresOptions = useMemo(
    () => [
      { value: '', label: t.zebraniaFieldAdresNone },
      ...[...adresy]
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
        .map((a) => ({ value: String(a.id), label: a.nazwa })),
    ],
    [adresy, t],
  );
  const placeOptions = useMemo(
    () => [
      { value: '', label: t.zebraniaFieldPlaceNone },
      ...lokalizacje.map((l) => ({
        value: String(l.id),
        label: l.adres ? `${l.nazwa} — ${l.adres}` : l.nazwa,
        triggerLabel: l.nazwa,
      })),
      { value: PLACE_CUSTOM, label: t.zebraniaFieldPlaceCustom },
    ],
    [lokalizacje, t],
  );

  const handleSubmit = () => {
    if (!nazwa.trim()) {
      setLocalError(t.zebraniaNameRequired);
      return;
    }
    const adres = adresId ? adresy.find((a) => String(a.id) === adresId) : undefined;
    const lok = place && place !== PLACE_CUSTOM ? lokalizacje.find((l) => String(l.id) === place) : undefined;
    onSubmit({
      nazwa: nazwa.trim(),
      adresId: adres?.id ?? null,
      adresNazwa: adres?.nazwa ?? '',
      lokalizacjaId: lok?.id ?? null,
      // Snapshotted with the id: the letter needs the words even if the entry goes.
      lokalizacjaNazwa: lok ? lok.nazwa : place === PLACE_CUSTOM ? placeNazwa.trim() : '',
      lokalizacjaAdres: lok ? lok.adres : place === PLACE_CUSTOM ? placeAdres.trim() : '',
      startsAt: date ? partsToIso(date, time) : null,
    });
  };

  const shownError = localError ?? error;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="file-check"
          title={editing ? t.zebraniaFormEdit : t.zebraniaFormNew}
          subtitle={editing ? editing.nazwa : t.zebraniaFormHint}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="file-check" title={t.zebraniaSectionEntry} description={t.zebraniaSectionEntryDesc}>
            <FormField label={t.zebraniaFieldName} htmlFor="zeb-name" required error={shownError}>
              <input
                id="zeb-name"
                type="text"
                value={nazwa}
                placeholder={t.zebraniaFieldNamePlaceholder}
                autoFocus
                onChange={(e) => {
                  setNazwa(e.target.value);
                  if (localError) setLocalError(null);
                }}
              />
            </FormField>
            <FormField label={t.zebraniaFieldAdres}>
              <SearchableSelect
                overlay
                value={adresId}
                options={adresOptions}
                onChange={setAdresId}
                placeholder={t.zebraniaFieldAdresNone}
                searchPlaceholder={t.zebraniaFieldAdresSearch}
                emptyText={t.zebraniaNoAdresFound}
                ariaLabel={t.zebraniaFieldAdres}
              />
            </FormField>
          </FormSection>
          <FormSection icon="clock" title={t.zebraniaSectionWhen} description={t.zebraniaSectionWhenDesc}>
            <FormRow>
              <FormField label={t.zebraniaFieldDate} htmlFor="zeb-date">
                <input id="zeb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label={t.zebraniaFieldTime} htmlFor="zeb-time">
                <input id="zeb-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </FormField>
            </FormRow>
            <FormField label={t.zebraniaFieldPlace}>
              <Select overlay value={place} options={placeOptions} onChange={setPlace} ariaLabel={t.zebraniaFieldPlace} />
            </FormField>
            {place === PLACE_CUSTOM && (
              <FormRow>
                <FormField label={t.zebraniaFieldPlaceName} htmlFor="zeb-place-name">
                  <input
                    id="zeb-place-name"
                    type="text"
                    value={placeNazwa}
                    placeholder={t.zebraniaFieldPlaceNamePlaceholder}
                    onChange={(e) => setPlaceNazwa(e.target.value)}
                  />
                </FormField>
                <FormField label={t.zebraniaFieldPlaceAddress} htmlFor="zeb-place-address">
                  <input
                    id="zeb-place-address"
                    type="text"
                    value={placeAdres}
                    placeholder={t.zebraniaFieldPlaceAddressPlaceholder}
                    onChange={(e) => setPlaceAdres(e.target.value)}
                  />
                </FormField>
              </FormRow>
            )}
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zebraniaFormNew}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!nazwa.trim()}
          submitTitle={t.zebraniaNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

/* ================================ One version ================================ */

const WersjaCard: React.FC<{
  language: Language;
  locale: string;
  wersja: ZebranieWersja;
  current: boolean;
  busy: boolean;
  onStatus: (status: ZebranieStatus) => void;
  onSaveOpis: (opis: string) => void;
  onOpenNotice: () => void;
}> = ({ language, locale, wersja, current, busy, onStatus, onSaveOpis, onOpenNotice }) => {
  const t = translations[language];
  const [opis, setOpis] = useState(wersja.opis);
  // A reload (someone else's edit, or our own save) resets the box to what is stored.
  useEffect(() => setOpis(wersja.opis), [wersja.opis]);
  const notice = zawiadomienieOf(wersja);
  const lastDownload = notice && notice.pobrania.length > 0 ? notice.pobrania[notice.pobrania.length - 1] : null;
  const first = wersja.major === 1 && wersja.minor === 0;

  return (
    <li className={`zeb-wersja${current ? ' is-current' : ''}`}>
      <div className="zeb-wersja__head">
        <span className="zeb-wersja__label">
          {t.zebraniaVersionTitle.replace('{v}', wersjaLabel(wersja))}
        </span>
        {current && <span className="status-badge zeb-current">{t.zebraniaCurrent}</span>}
        <div className="zad-seg zeb-wersja__status" role="group" aria-label={t.zawStatus}>
          {(['w_przygotowaniu', 'przygotowane'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`zad-seg__btn${wersja.status === s ? ' is-active' : ''}`}
              aria-pressed={wersja.status === s}
              disabled={busy || wersja.status === s}
              onClick={() => onStatus(s)}
            >
              {s === 'przygotowane' && <Icon name="check" size={12} />}
              {zebranieStatusLabel(t, s)}
            </button>
          ))}
        </div>
      </div>

      <div className="zeb-notice">
        <div className="zeb-notice__info">
          <span className="zeb-notice__title">
            <Icon name="mail" size={14} /> {t.zebraniaNotice}
          </span>
          {notice ? (
            <>
              {notice.szablonNazwa && (
                <span>{t.zebraniaNoticeFrom.replace('{name}', notice.szablonNazwa)}</span>
              )}
              {notice.updatedAt && (
                <span className="zeb-muted">
                  {t.zebraniaNoticeChanged
                    .replace('{when}', formatStamp(notice.updatedAt, locale))
                    .replace('{who}', notice.updatedBy || '—')}
                </span>
              )}
              <span className="zeb-muted">
                {lastDownload
                  ? t.zebraniaNoticeLastDownload
                      .replace('{when}', formatStamp(lastDownload.at, locale))
                      .replace('{who}', lastDownload.by || '—')
                  : t.zebraniaNoticeNeverDownloaded}
              </span>
            </>
          ) : (
            <span className="zeb-muted">{t.zebraniaNoticeNone}</span>
          )}
        </div>
        <button
          type="button"
          className={`button button-small ${notice ? 'button-secondary' : 'button-primary'}`}
          onClick={onOpenNotice}
          disabled={busy}
        >
          <Icon name={notice ? 'edit' : 'plus'} size={13} />{' '}
          {notice ? t.zebraniaNoticeOpen : t.zebraniaNoticePrepare}
        </button>
      </div>

      <div className="zeb-opis">
        <label>{t.zebraniaOpis}</label>
        <textarea
          rows={2}
          value={opis}
          placeholder={first ? t.zebraniaOpisFirstPlaceholder : t.zebraniaOpisPlaceholder}
          onChange={(e) => setOpis(e.target.value)}
          disabled={busy}
        />
        {opis.trim() !== wersja.opis.trim() && (
          <div className="zeb-opis__actions">
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => setOpis(wersja.opis)}
              disabled={busy}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="button button-small button-success"
              onClick={() => onSaveOpis(opis)}
              disabled={busy}
            >
              <Icon name="save" size={12} /> {t.zebraniaOpisSave}
            </button>
          </div>
        )}
      </div>

      <span className="zeb-muted zeb-wersja__stamp">
        {t.zebraniaCreatedBy
          .replace('{when}', formatStamp(wersja.createdAt, locale))
          .replace('{who}', wersja.createdBy || '—')}
      </span>
    </li>
  );
};

/* ================================ Entry details ================================ */

const ZebranieDetailModal: React.FC<{
  language: Language;
  locale: string;
  zebranie: Zebranie;
  dane: ZebranieDane;
  spotkanie: Spotkanie | null;
  busy: boolean;
  onClose: () => void;
  onEditData: () => void;
  onOpenSpotkanie?: () => void;
  onEditSpotkanie?: () => void;
  onStatus: (wersja: ZebranieWersja, status: ZebranieStatus) => void;
  onSaveOpis: (wersja: ZebranieWersja, opis: string) => void;
  onAddRevision: () => void;
  onDelete: () => void;
  onOpenNotice: (wersja: ZebranieWersja) => void;
}> = ({
  language,
  locale,
  zebranie,
  dane,
  spotkanie,
  busy,
  onClose,
  onEditData,
  onOpenSpotkanie,
  onEditSpotkanie,
  onStatus,
  onSaveOpis,
  onAddRevision,
  onDelete,
  onOpenNotice,
}) => {
  const t = translations[language];
  const current = latestWersja(zebranie);
  // Newest first: the version being worked on is the one the user came for.
  const wersje = [...sortWersje(zebranie.wersje)].reverse();
  const next = nextWersjaNumber(zebranie.wersje);
  const place = [dane.lokalizacjaNazwa, dane.lokalizacjaAdres].filter(Boolean).join(', ');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl zeb-detail" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="file-check"
          title={dane.nazwa || '—'}
          subtitle={
            <span className="modal-header__meta">
              {dane.zKalendarza ? (
                <span className="form-section__badge is-accent">
                  <Icon name="calendar" size={11} /> {t.zebraniaLinked}
                </span>
              ) : (
                <span className="form-section__badge is-neutral">{t.zebraniaStandalone}</span>
              )}
              <span>
                {t.zebraniaCreatedBy
                  .replace('{when}', formatStamp(zebranie.createdAt, locale))
                  .replace('{who}', zebranie.createdBy || '—')}
              </span>
            </span>
          }
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection
            icon="calendar"
            title={t.zebraniaDetailData}
            aside={
              dane.zKalendarza ? (
                <div className="form-section__actions">
                  {spotkanie && onOpenSpotkanie && (
                    <button type="button" className="button button-small button-subtle" onClick={onOpenSpotkanie}>
                      <Icon name="calendar" size={13} /> {t.zebraniaShowInCalendar}
                    </button>
                  )}
                  {spotkanie && onEditSpotkanie && (
                    <button type="button" className="button button-small button-secondary" onClick={onEditSpotkanie}>
                      <Icon name="edit" size={13} /> {t.zebraniaEditInCalendar}
                    </button>
                  )}
                </div>
              ) : (
                <button type="button" className="button button-small button-secondary" onClick={onEditData} disabled={busy}>
                  <Icon name="edit" size={13} /> {t.zebraniaEditData}
                </button>
              )
            }
          >
            <dl className="facts">
              <dt>{t.zebraniaFieldWhen}</dt>
              <dd>{dane.startsAt ? formatStamp(dane.startsAt, locale) : t.zebraniaNoDate}</dd>
              <dt>{t.zebraniaFieldAdres}</dt>
              <dd>{dane.adresNazwa || t.zebraniaNoAdres}</dd>
              <dt>{t.zebraniaFieldPlace}</dt>
              <dd>{place || '—'}</dd>
            </dl>
            {dane.zKalendarza && (
              <div className="callout callout--info">
                <Icon name="info" size={16} />
                <div className="callout__body">{t.zebraniaFromCalendarNote}</div>
              </div>
            )}
          </FormSection>

          <FormSection
            icon="copy"
            title={t.zebraniaVersions}
            description={t.zebraniaVersionsHint}
            aside={
              <button
                type="button"
                className="button button-primary"
                onClick={onAddRevision}
                disabled={busy || !current}
                title={
                  current
                    ? t.zebraniaAddRevisionHint
                        .replace('{v}', `${next.major}.${next.minor}`)
                        .replace('{from}', wersjaLabel(current))
                    : undefined
                }
              >
                <Icon name="copy" size={14} /> {t.zebraniaAddRevision}
              </button>
            }
          >
            <ul className="zeb-wersje">
              {wersje.map((w) => (
                <WersjaCard
                  key={w.id}
                  language={language}
                  locale={locale}
                  wersja={w}
                  current={current?.id === w.id}
                  busy={busy}
                  onStatus={(status) => onStatus(w, status)}
                  onSaveOpis={(opis) => onSaveOpis(w, opis)}
                  onOpenNotice={() => onOpenNotice(w)}
                />
              ))}
            </ul>
          </FormSection>
        </div>
        <ModalFooter
          note={
            <button type="button" className="button button-small button-ghost icon-danger" onClick={onDelete} disabled={busy}>
              <Icon name="trash" size={13} /> {t.zebraniaDelete}
            </button>
          }
          onCancel={onClose}
          cancelLabel={t.close}
        />
      </div>
    </div>
  );
};

/* ================================== The view ================================== */

/**
 * "Zebrania" — the materials for each meeting, version by version.
 *
 * An entry is either a Kalendarz meeting's (made by "Przygotuj materiały" on
 * its card, its date and place read live from the meeting) or a standalone one
 * typed in here for a meeting the calendar does not have. Each entry holds
 * versions — 1.0, then 1.1 … for corrections after the meeting — and each
 * version its own notice and its own "W przygotowaniu" / "Przygotowane". The
 * newest version and the meeting's materials status are kept in step by the
 * main process; this view only reloads after it asks for a change.
 */
const Zebrania: React.FC<Props> = ({
  language,
  userEmail,
  openRequest = null,
  onOpenRequestHandled,
  onOpenSpotkanie,
  onEditSpotkanie,
  onOpenSzablony,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [zebrania, setZebrania] = useState<Zebranie[]>([]);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('nearest');
  /** The entry open in the details window — by id, so a reload shows its new state. */
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState<{ editing: Zebranie | null } | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ zebranie: Zebranie; wersjaId: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [z, s, l, a] = await Promise.all([
        window.electronAPI.getZebrania(),
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaLokalizacje(),
        window.electronAPI.getAdresy(),
      ]);
      setZebrania(z);
      setSpotkania(s);
      setLokalizacje(l);
      setAdresy(a);
    } catch {
      notify.error(t.zebraniaLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // "Otwórz w Zebraniach" from a meeting card: open that entry once it is loaded.
  useEffect(() => {
    if (!openRequest || isLoading) return;
    if (zebrania.some((z) => z.id === openRequest.id)) setDetailId(openRequest.id);
    else notify.warning(t.zebraniaMissing);
    onOpenRequestHandled?.();
    // Only a new request opens an entry; later reloads must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest, isLoading]);

  /* -------------------------------- Derived -------------------------------- */

  const rows = useMemo(
    () =>
      zebrania.map((z) => ({
        zebranie: z,
        dane: zebranieDane(z, spotkania, lokalizacje),
        wersja: latestWersja(z),
      })),
    [zebrania, spotkania, lokalizacje],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, w_przygotowaniu: 0, przygotowane: 0 };
    for (const r of rows) if (r.wersja) c[r.wersja.status] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (statusFilter !== 'all' && r.wersja?.status !== statusFilter) return false;
      if (!q) return true;
      return [r.dane.nazwa, r.dane.adresNazwa, r.dane.lokalizacjaNazwa, r.dane.lokalizacjaAdres]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    // "Nearest first": what is coming up, soonest first, then what is behind
    // us, most recent first — the order the office works through them in.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = startOfToday.getTime();
    return filtered.sort((a, b) => {
      const ta = timeOf(a.dane);
      const tb = timeOf(b.dane);
      if (ta === null || tb === null) {
        if (ta === tb) return b.zebranie.id - a.zebranie.id;
        return ta === null ? 1 : -1;
      }
      if (sortMode === 'latest') return tb - ta;
      const fa = ta >= today;
      const fb = tb >= today;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? ta - tb : tb - ta;
    });
  }, [rows, search, statusFilter, sortMode]);

  const detail = detailId != null ? rows.find((r) => r.zebranie.id === detailId) ?? null : null;
  const spotkanieOf = (z: Zebranie): Spotkanie | null =>
    z.spotkanieId != null ? spotkania.find((s) => s.id === z.spotkanieId) ?? null : null;

  /* -------------------------------- Actions -------------------------------- */

  const handleFormSubmit = async (input: ZebranieInput) => {
    if (!form) return;
    setFormSaving(true);
    setFormError(null);
    try {
      if (form.editing) {
        await window.electronAPI.updateZebranie(form.editing.id, input);
        notify.success(t.zebraniaSaved);
      } else {
        const created = await window.electronAPI.addZebranie(input);
        setDetailId(created.id);
        notify.success(t.zebraniaCreated);
      }
      setForm(null);
      await load(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t.zebraniaSaveError);
    } finally {
      setFormSaving(false);
    }
  };

  /** Busy, write, reload, report — the same shape for every small action. */
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      await load(true);
      notify.success(done);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = (wersja: ZebranieWersja, status: ZebranieStatus) =>
    run(() => window.electronAPI.setZebranieWersjaStatus(wersja.id, status), t.zebraniaStatusSaved);

  /**
   * Save a version's note. The materials are re-read and written back as stored,
   * so the note cannot overwrite a notice edited (or downloaded) meanwhile.
   */
  const handleSaveOpis = (zebranie: Zebranie, wersja: ZebranieWersja, opis: string) =>
    run(async () => {
      const fresh = (await window.electronAPI.getZebrania()).find((z) => z.id === zebranie.id);
      const freshWersja = fresh?.wersje.find((w) => w.id === wersja.id);
      if (!freshWersja) throw new Error(t.zawVersionGone);
      await window.electronAPI.updateZebranieWersja(wersja.id, { opis, materialy: freshWersja.materialy });
    }, t.zebraniaOpisSaved);

  const handleAddRevision = async (zebranie: Zebranie) => {
    const current = latestWersja(zebranie);
    if (!current) return;
    const next = nextWersjaNumber(zebranie.wersje);
    const v = `${next.major}.${next.minor}`;
    const message =
      t.zebraniaAddRevisionConfirm.replace('{v}', v).replace('{from}', wersjaLabel(current)) +
      (zebranie.spotkanieId != null ? t.zebraniaAddRevisionLinkedNote : '');
    if (!(await notify.confirm(message, { confirmLabel: t.zebraniaAddRevision }))) return;
    await run(async () => {
      const created = await window.electronAPI.addZebranieWersja(zebranie.id);
      return created;
    }, t.zebraniaRevisionAdded.replace('{v}', v));
  };

  const handleDelete = async (zebranie: Zebranie, dane: ZebranieDane) => {
    const message =
      t.zebraniaDeleteConfirm.replace('{name}', dane.nazwa || '—') +
      (zebranie.spotkanieId != null ? t.zebraniaDeleteLinkedNote : '');
    if (!(await notify.confirm(message, { danger: true, confirmLabel: t.delete }))) return;
    setDetailId(null);
    await run(() => window.electronAPI.deleteZebranie(zebranie.id), t.zebraniaDeleted);
  };

  /* ------------------------------- Rendering ------------------------------- */

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  const renderRow = ({ zebranie, dane, wersja }: (typeof rows)[number]) => {
    const start = dane.startsAt ? new Date(dane.startsAt) : null;
    const validStart = !!start && !Number.isNaN(start.getTime());
    const spotkanie = spotkanieOf(zebranie);
    const place = [dane.lokalizacjaNazwa, dane.lokalizacjaAdres].filter(Boolean).join(', ');
    const open = () => setDetailId(zebranie.id);
    return (
      <li key={zebranie.id}>
        <div
          className={`zeb-row${wersja ? ` zeb-row--${wersja.status}` : ''}`}
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
          <div className={`zeb-date${validStart ? '' : ' is-empty'}`}>
            {validStart ? (
              <>
                <span className="zeb-date__day">{start!.getDate()}</span>
                <span className="zeb-date__month">
                  {start!.toLocaleDateString(locale, { month: 'short' })} {start!.getFullYear()}
                </span>
                <span className="zeb-date__time">{formatTime(dane.startsAt!, locale)}</span>
              </>
            ) : (
              <span className="zeb-date__none">{t.zebraniaNoDate}</span>
            )}
          </div>
          <div className="zeb-row__main">
            <span className="zeb-row__name">{dane.nazwa || '—'}</span>
            <span className="zeb-row__meta">
              <span>
                <Icon name="building" size={13} /> {dane.adresNazwa || t.zebraniaNoAdres}
              </span>
              {place && (
                <span>
                  <Icon name="map-pin" size={13} /> {place}
                </span>
              )}
            </span>
          </div>
          <div className="zeb-row__side">
            {dane.zKalendarza && spotkanie && onOpenSpotkanie ? (
              <button
                type="button"
                className="status-badge zeb-link zeb-link--kal zeb-link--button"
                title={t.zebraniaLinkedHint}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSpotkanie(spotkanie);
                }}
              >
                <Icon name="calendar" size={11} /> {t.zebraniaLinked}
              </button>
            ) : dane.zKalendarza ? (
              <span className="status-badge zeb-link zeb-link--kal">
                <Icon name="calendar" size={11} /> {t.zebraniaLinked}
              </span>
            ) : (
              <span className="status-badge zeb-link" title={t.zebraniaStandaloneHint}>
                {t.zebraniaStandalone}
              </span>
            )}
            {wersja && (
              <span className="zeb-row__version">
                {t.zebraniaVersion.replace('{v}', wersjaLabel(wersja))}
              </span>
            )}
            {wersja && (
              <span className={`status-badge zeb-status zeb-status--${wersja.status}`}>
                {zebranieStatusLabel(t, wersja.status)}
              </span>
            )}
            <Icon name="chevron-right" size={16} />
          </div>
        </div>
      </li>
    );
  };

  const statusOptions: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: t.zebraniaFilterAll, count: counts.all },
    { key: 'w_przygotowaniu', label: t.zebraniaStatusW, count: counts.w_przygotowaniu },
    { key: 'przygotowane', label: t.zebraniaStatusPrzygotowane, count: counts.przygotowane },
  ];
  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'nearest', label: t.zebraniaSortNearest },
    { key: 'latest', label: t.zebraniaSortLatest },
  ];

  return (
    <div className="content-body">
      <div className="zad-head zeb-head">
        <div className="zeb-head__id">
          <MeetingsIllustration className="zeb-head__art" />
          <div>
            <h2 className="page-hero__title">{t.zebraniaTitle}</h2>
            <p className="page-hero__text">{t.zebraniaHint}</p>
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
            className="button button-primary"
            onClick={() => {
              setFormError(null);
              setForm({ editing: null });
            }}
          >
            <Icon name="plus" size={14} /> {t.zebraniaAdd}
          </button>
        </div>
      </div>

      {zebrania.length === 0 ? (
        <div className="zeb-empty">
          <MeetingsIllustration className="zeb-empty__art" />
          <strong>{t.zebraniaEmptyTitle}</strong>
          <p>{t.zebraniaEmptyText}</p>
          <ul>
            <li>{t.zebraniaEmptyWay1}</li>
            <li>{t.zebraniaEmptyWay2}</li>
          </ul>
          <button
            className="button button-primary"
            onClick={() => {
              setFormError(null);
              setForm({ editing: null });
            }}
          >
            <Icon name="plus" size={14} /> {t.zebraniaAdd}
          </button>
        </div>
      ) : (
        <>
          <div className="zeb-toolbar">
            <div className="ksieg-search">
              <Icon name="search" size={15} />
              <input
                type="text"
                placeholder={t.zebraniaSearch}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && (
                <button type="button" onClick={() => setSearch('')} title={t.close} aria-label={t.close}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <div className="zad-seg" role="group" aria-label={t.zebraniaFilterStatus}>
              {statusOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`zad-seg__btn${statusFilter === o.key ? ' is-active' : ''}${
                    o.count === 0 ? ' is-empty' : ''
                  }`}
                  aria-pressed={statusFilter === o.key}
                  onClick={() => setStatusFilter(o.key)}
                >
                  {o.label}
                  <span className="zad-seg__count">{o.count}</span>
                </button>
              ))}
            </div>
            <div className="zad-seg" role="group" aria-label={t.zebraniaSort}>
              {sortOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`zad-seg__btn${sortMode === o.key ? ' is-active' : ''}`}
                  aria-pressed={sortMode === o.key}
                  onClick={() => setSortMode(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="zeb-nomatch">
              <Icon name="search" size={18} /> {t.zebraniaNoMatch}
            </div>
          ) : (
            <ul className="zeb-list">{visible.map(renderRow)}</ul>
          )}
        </>
      )}

      {detail && (
        <ZebranieDetailModal
          language={language}
          locale={locale}
          zebranie={detail.zebranie}
          dane={detail.dane}
          spotkanie={spotkanieOf(detail.zebranie)}
          busy={busy}
          onClose={() => setDetailId(null)}
          onEditData={() => {
            setFormError(null);
            setForm({ editing: detail.zebranie });
          }}
          onOpenSpotkanie={
            onOpenSpotkanie
              ? () => {
                  const s = spotkanieOf(detail.zebranie);
                  if (s) onOpenSpotkanie(s);
                }
              : undefined
          }
          onEditSpotkanie={
            onEditSpotkanie
              ? () => {
                  const s = spotkanieOf(detail.zebranie);
                  if (s) onEditSpotkanie(s);
                }
              : undefined
          }
          onStatus={(w, status) => void handleStatus(w, status)}
          onSaveOpis={(w, opis) => void handleSaveOpis(detail.zebranie, w, opis)}
          onAddRevision={() => void handleAddRevision(detail.zebranie)}
          onDelete={() => void handleDelete(detail.zebranie, detail.dane)}
          onOpenNotice={(w) => setNotice({ zebranie: detail.zebranie, wersjaId: w.id })}
        />
      )}

      {form && (
        <ZebranieFormModal
          key={form.editing ? `edit-${form.editing.id}` : 'new'}
          language={language}
          editing={form.editing}
          adresy={adresy}
          lokalizacje={lokalizacje}
          isSaving={formSaving}
          error={formError}
          onSubmit={(input) => void handleFormSubmit(input)}
          onCancel={() => {
            setForm(null);
            setFormError(null);
          }}
        />
      )}

      {notice && (
        <ZawiadomienieModal
          key={`${notice.zebranie.id}-${notice.wersjaId}`}
          language={language}
          userEmail={userEmail}
          zebranie={notice.zebranie}
          wersjaId={notice.wersjaId}
          onClose={() => setNotice(null)}
          onChanged={() => void load(true)}
          onOpenSzablony={onOpenSzablony}
        />
      )}
    </div>
  );
};

export default Zebrania;
