import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Adres,
  AppUser,
  Spotkanie,
  SpotkanieInput,
  SpotkanieLokalizacja,
  SpotkanieTerminStatus,
  SpotkanieTyp,
  SpotkanieUczestnik,
  Zadanie,
  ZadanieInput,
  ZgnJednostka,
  ZgnPelnomocnik,
  SpotkanieZarzadOsoba,
} from '../../../shared/types';
import { ipcErrorMessage, isIpcError } from '../../ipcError';
import { comparePeople, personLabel, personName } from '../../../shared/app-users';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import Icon from '../Icon';
import Select from '../Select';
import SearchableSelect from '../SearchableSelect';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { FormField, FormRow, FormSection, RequiredNote } from '../FormSection';
import { ZadanieFormModal, ZadaniePreviewModal } from '../../views/Zadania';
import {
  formatStamp,
  partsToIso,
  shiftTime,
  suggestSpotkanieTitle,
  toParts,
  defaultTerminWysylki,
} from '../../../shared/calendar';
import { SpotkanieZadania } from './SpotkanieZadania';

/** Default start for a meeting created by clicking an empty day. */
const DEFAULT_START = '10:00';

/* ============================ City unit / proxy ============================ */

/** The picker's value for a unit (`j:12`) or a proxy (`p:7`); '' for none. */
function zgnPickValue(jednostkaId: number | null, pelnomocnikId: number | null): string {
  if (pelnomocnikId != null) return `p:${pelnomocnikId}`;
  if (jednostkaId != null) return `j:${jednostkaId}`;
  return '';
}

/** What a meeting shows for a proxy: their name and the unit they act for. */
function pelnomocnikLabel(p: ZgnPelnomocnik, jednostki: ZgnJednostka[]): string {
  const unit = jednostki.find((j) => j.id === p.jednostkaId);
  return unit ? `${p.imieNazwisko} (${unit.nazwa})` : p.imieNazwisko;
}

/* ============================ The add/edit form ============================ */

interface FormProps {
  language: Language;
  /** Meeting being edited, or null when adding a new one. */
  editing: Spotkanie | null;
  /**
   * With `editing` null: the meeting being cloned. The new one starts with all
   * of its fields; saving adds a meeting and leaves the original untouched.
   */
  template?: Spotkanie | null;
  /** Day the form opens on (`YYYY-MM-DD`) — the cell the user clicked. */
  defaultDay: string;
  typy: SpotkanieTyp[];
  lokalizacje: SpotkanieLokalizacja[];
  adresy: Adres[];
  users: AppUser[];
  userEmail?: string;
  isSaving: boolean;
  error: string | null;
  /**
   * `pendingZadania`: tasks written for a meeting that did not exist yet.
   * `materialyPotrzebne`: whether the meeting needs materials — saved through
   * the materials action (it records who moved it), so it travels beside the input.
   */
  onSubmit: (
    input: SpotkanieInput,
    pendingZadania: ZadanieInput[],
    materialyPotrzebne: boolean,
  ) => void;
  onCancel: () => void;
  onManageTypes?: () => void;
  onManagePlaces?: () => void;
  /** While editing: start a new meeting from this one instead. */
  onClone?: () => void;
  /** City units, and their proxies — the "with whom from the city" picker. */
  zgnJednostki: ZgnJednostka[];
  zgnPelnomocnicy: ZgnPelnomocnik[];
  /** Tasks already linked to the meeting being edited. */
  linkedZadania: Zadanie[];
  /** Every meeting — to warn about another one of the same type for the same community. */
  spotkania?: Spotkanie[];
  /** A linked task was added, changed or deleted here — reload them. */
  onZadaniaChanged: () => void;
  onDeleteZadanie: (zadanie: Zadanie) => void;
  onOpenZadanie?: (zadanie: Zadanie) => void;
}

export const SpotkanieFormModal: React.FC<FormProps> = ({
  language,
  editing,
  template = null,
  defaultDay,
  typy,
  lokalizacje,
  adresy,
  users,
  userEmail,
  isSaving,
  error,
  onSubmit,
  onCancel,
  onManageTypes,
  onManagePlaces,
  onClone,
  zgnJednostki,
  zgnPelnomocnicy,
  linkedZadania,
  spotkania = [],
  onZadaniaChanged,
  onDeleteZadanie,
  onOpenZadanie,
}) => {
  const t = translations[language];
  // Where the fields start: the meeting being edited, else the one being cloned.
  const base = editing ?? template;
  const startParts = toParts(base?.startsAt ?? null);
  const endParts = toParts(base?.endsAt ?? null);

  const [typId, setTypId] = useState(base?.typId != null ? String(base.typId) : '');
  const [adresId, setAdresId] = useState(base?.adresId != null ? String(base.adresId) : '');
  const [nazwa, setNazwa] = useState(base?.nazwa ?? '');
  /**
   * Whether the title has been written by hand and must stop following the two
   * pickers. An existing meeting counts as hand-written only when its name is
   * not what its own type and community would have produced — so a generated
   * name keeps tracking a type change, and a name someone chose is never
   * silently overwritten.
   */
  const [nameEdited, setNameEdited] = useState(
    base
      ? base.nazwa.trim() !==
        suggestSpotkanieTitle(
          typy.find((typ) => typ.id === base.typId)?.nazwa ?? null,
          base.adresNazwa,
        )
      : false,
  );
  const [date, setDate] = useState(startParts.date || defaultDay);
  const [timeFrom, setTimeFrom] = useState(startParts.time || DEFAULT_START);
  // A new meeting gets a one-hour default; an existing one with no end keeps
  // none, so editing it doesn't invent an end time nobody asked for.
  const [timeTo, setTimeTo] = useState(
    base ? endParts.time : shiftTime(DEFAULT_START, 60),
  );
  const [opis, setOpis] = useState(base?.opis ?? '');
  const [lokalizacjaId, setLokalizacjaId] = useState(
    base?.lokalizacjaId != null ? String(base.lokalizacjaId) : '',
  );
  /**
   * Confirmed or still being agreed. A new meeting starts confirmed — that is
   * what most of them are, and calling every fresh entry tentative would make
   * the mark meaningless by the end of the first week.
   */
  const [terminStatus, setTerminStatus] = useState<SpotkanieTerminStatus>(
    base?.terminStatus ?? 'potwierdzony',
  );
  const [uczestnicy, setUczestnicy] = useState<SpotkanieUczestnik[]>(base?.uczestnicy ?? []);
  // The community's board on this meeting: filled in from the community when it
  // is picked, then the user's to trim.
  const [zarzad, setZarzad] = useState<SpotkanieZarzadOsoba[]>(base?.zarzad ?? []);
  // A new meeting needs materials unless the user says otherwise.
  const [materialyPotrzebne, setMaterialyPotrzebne] = useState(
    base ? base.materialyStatus !== 'brak' : true,
  );
  /**
   * The day the documents are due by, when set on this meeting by hand. Null
   * follows the meeting's kind (its notice period before the date) — and keeps
   * following it when the kind or the date changes.
   */
  const [terminWysylkiOwn, setTerminWysylkiOwn] = useState<string | null>(
    base?.terminWysylki ?? null,
  );
  // A unit or one of its proxies, as one picker value (see `zgnPickValue`).
  const [zgnPick, setZgnPick] = useState(
    zgnPickValue(base?.zgnJednostkaId ?? null, base?.zgnPelnomocnikId ?? null),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  // The task form, over this one: null = closed, otherwise the task being
  // edited (or null for a new one). The meeting form stays open underneath and
  // keeps whatever has been typed into it so far.
  const notify = useNotify();
  const [taskForm, setTaskForm] = useState<{ editing: Zadanie | null } | null>(null);
  const [taskPreview, setTaskPreview] = useState<Zadanie | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  // A meeting that is not saved yet has no id to link to: its tasks wait here.
  const [pendingZadania, setPendingZadania] = useState<ZadanieInput[]>([]);

  const closeTask = () => {
    setTaskForm(null);
    setTaskError(null);
  };

  const handleTaskSubmit = async (input: ZadanieInput) => {
    if (!editing && !taskForm?.editing) {
      setPendingZadania((prev) => [...prev, input]);
      closeTask();
      return;
    }
    setTaskSaving(true);
    setTaskError(null);
    try {
      if (taskForm?.editing) {
        await window.electronAPI.updateZadanie(taskForm.editing.id, input);
        notify.success(t.kalTaskUpdated);
      } else if (editing) {
        await window.electronAPI.addZadanie({ ...input, spotkanieId: editing.id });
        notify.success(t.kalTaskAdded);
      }
      closeTask();
      onZadaniaChanged();
    } catch (err: unknown) {
      if (taskForm?.editing && isIpcError(err, 'zadanieConflict')) {
        // Saved elsewhere meanwhile: the form keeps the edits and is rebased on
        // the card as it now is (ZadanieFormModal), so the next save goes through.
        setTaskError(t.zadConflict);
        const id = taskForm.editing.id;
        const card = await window.electronAPI.getZadanie(id).catch(() => null);
        if (card) setTaskForm((prev) => (prev?.editing?.id === id ? { editing: card } : prev));
        onZadaniaChanged();
      } else {
        setTaskError(ipcErrorMessage(err, t.zadSaveError));
      }
    } finally {
      setTaskSaving(false);
    }
  };

  /** Files of a pending task are already in the bucket; nothing else would remove them. */
  const discardPending = (list: ZadanieInput[]) => {
    const paths = list.flatMap((p) => p.zalaczniki.map((z) => z.sciezka));
    if (paths.length > 0) void window.electronAPI.zadaniaDiscardAttachments(paths).catch(() => {});
  };

  const handleCancel = () => {
    discardPending(pendingZadania);
    onCancel();
  };

  const chosen = new Set(uczestnicy.map((u) => u.userId));
  // Offered by name, in name order — the dropdown is read down, and mailbox
  // order stops making sense the moment the labels are people's names.
  const available = users.filter((u) => !chosen.has(u.id)).sort(comparePeople);

  const typNazwa = (id: string): string | null =>
    typy.find((typ) => String(typ.id) === id)?.nazwa ?? null;
  const adresNazwa = (id: string): string | null =>
    adresy.find((a) => String(a.id) === id)?.nazwa ?? null;

  /** A community's board, as a meeting snapshots it. */
  const boardOf = (id: string): SpotkanieZarzadOsoba[] =>
    (adresy.find((a) => String(a.id) === id)?.zarzad ?? []).map(({ imieNazwisko, email }) => ({
      imieNazwisko,
      email,
    }));

  /** The title the current pair of pickers would write. */
  const suggestion = suggestSpotkanieTitle(typNazwa(typId), adresNazwa(adresId));

  /**
   * Answering a picker rewrites the title, unless the user has taken it over.
   * Both pickers go through here so neither can drift out of step with it.
   */
  const applyPickers = (nextTypId: string, nextAdresId: string) => {
    setTypId(nextTypId);
    setAdresId(nextAdresId);
    if (nameEdited) return;
    setNazwa(suggestSpotkanieTitle(typNazwa(nextTypId), adresNazwa(nextAdresId)));
    if (localError) setLocalError(null);
  };

  /** Hand the title back to the pickers after a manual edit. */
  const restoreSuggestedTitle = () => {
    setNazwa(suggestion);
    setNameEdited(false);
    if (localError) setLocalError(null);
  };

  /**
   * Add every account that isn't on the list yet. Appends rather than replaces:
   * an existing meeting can carry a participant whose account has since been
   * removed, and "add everyone" must not be the thing that drops them.
   */
  const addAllParticipants = () => {
    setUczestnicy((prev) => [
      ...prev,
      ...users
        .filter((u) => !prev.some((p) => p.userId === u.id))
        .map((u) => ({ userId: u.id, email: u.email, displayName: personName(u) })),
    ]);
  };

  /** Keep the end after the start when the start moves past it. */
  const handleStartChange = (value: string) => {
    setTimeFrom(value);
    if (timeTo && timeTo <= value) setTimeTo(shiftTime(value, 60));
    if (localError) setLocalError(null);
  };

  const addParticipant = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user || chosen.has(user.id)) return;
    setUczestnicy((prev) => [
      ...prev,
      { userId: user.id, email: user.email, displayName: personName(user) },
    ]);
  };

  /**
   * The unit or proxy picked, resolved for saving. A pick that no longer exists
   * (deleted since) keeps the meeting's own snapshot rather than dropping it.
   */
  const resolveZgn = (): Pick<
    SpotkanieInput,
    'zgnJednostkaId' | 'zgnPelnomocnikId' | 'zgnNazwa'
  > => {
    const none = { zgnJednostkaId: null, zgnPelnomocnikId: null, zgnNazwa: '' };
    if (!zgnPick) return none;
    const [kind, raw] = zgnPick.split(':');
    const id = Number(raw);
    if (kind === 'p') {
      const p = zgnPelnomocnicy.find((x) => x.id === id);
      if (p) {
        return {
          zgnJednostkaId: p.jednostkaId,
          zgnPelnomocnikId: p.id,
          zgnNazwa: pelnomocnikLabel(p, zgnJednostki),
        };
      }
    } else {
      const j = zgnJednostki.find((x) => x.id === id);
      if (j) return { zgnJednostkaId: j.id, zgnPelnomocnikId: null, zgnNazwa: j.nazwa };
    }
    return base && zgnPick === zgnPickValue(base.zgnJednostkaId, base.zgnPelnomocnikId)
      ? {
          zgnJednostkaId: base.zgnJednostkaId,
          zgnPelnomocnikId: base.zgnPelnomocnikId,
          zgnNazwa: base.zgnNazwa,
        }
      : none;
  };

  /**
   * Units first, each followed by its proxies — the picker reads as "the unit,
   * or somebody acting for it". A pick that is no longer in the dictionaries
   * stays selectable under its snapshot name, so opening and saving the meeting
   * never silently drops it.
   */
  const zgnOptions: { value: string; label: string; hint?: string; keywords?: string }[] = [
    { value: '', label: t.kalNoZgn },
  ];
  for (const j of zgnJednostki) {
    zgnOptions.push({ value: `j:${j.id}`, label: j.nazwa, hint: j.email || undefined });
    for (const p of zgnPelnomocnicy.filter((x) => x.jednostkaId === j.id)) {
      zgnOptions.push({
        value: `p:${p.id}`,
        label: `↳ ${p.imieNazwisko}`,
        hint: [t.kalZgnProxyOf.replace('{unit}', j.nazwa), p.email].filter(Boolean).join(' · '),
        keywords: `${j.nazwa} ${p.email}`,
      });
    }
  }
  if (zgnPick && !zgnOptions.some((o) => o.value === zgnPick) && base?.zgnNazwa) {
    zgnOptions.push({ value: zgnPick, label: base.zgnNazwa });
  }

  const selectedTyp = typy.find((typ) => String(typ.id) === typId) ?? null;
  const terminWysylkiDefault = defaultTerminWysylki(partsToIso(date, timeFrom), selectedTyp);
  const terminWysylki = terminWysylkiOwn ?? terminWysylkiDefault ?? '';
  /** Other meetings of this type for this community — a warning, never a block. */
  const duplikaty =
    typId && adresId
      ? spotkania
          .filter(
            (x) =>
              x.id !== editing?.id &&
              String(x.typId) === typId &&
              String(x.adresId) === adresId,
          )
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      : [];

  const handleSubmit = () => {
    const name = nazwa.trim();
    if (!name) {
      setLocalError(t.kalNameRequired);
      return;
    }
    const startsAt = partsToIso(date, timeFrom);
    if (!startsAt) {
      setLocalError(t.kalDateRequired);
      return;
    }
    const endsAt = timeTo ? partsToIso(date, timeTo) : null;
    if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setLocalError(t.kalEndBeforeStart);
      return;
    }
    const adres = adresy.find((a) => String(a.id) === adresId) ?? null;
    const lokalizacja = lokalizacje.find((l) => String(l.id) === lokalizacjaId) ?? null;
    onSubmit(
      {
        nazwa: name,
        typId: typId ? Number(typId) : null,
        adresId: adres ? adres.id : null,
        // The name travels with the meeting: a restore renumbers the addresses,
        // and this is what the link is re-pointed through afterwards.
        adresNazwa: adres ? adres.nazwa : '',
        lokalizacjaId: lokalizacja ? lokalizacja.id : null,
        lokalizacjaNazwa: lokalizacja ? lokalizacja.nazwa : '',
        startsAt,
        endsAt,
        opis: opis.trim(),
        uczestnicy,
        terminStatus,
        // Stored only when it differs from what the kind says.
        terminWysylki:
          terminWysylkiOwn && terminWysylkiOwn !== terminWysylkiDefault ? terminWysylkiOwn : null,
        ...resolveZgn(),
        zarzad,
      },
      pendingZadania,
      materialyPotrzebne,
    );
  };

  const board = boardOf(adresId);
  const boardMissing = board.filter((m) => !zarzad.some((z) => z.imieNazwisko === m.imieNazwisko));
  const errorText = localError || error;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={handleCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="calendar"
          title={editing ? t.kalEditMeeting : template ? t.kalCloneMeeting : t.kalNewMeeting}
          subtitle={editing ? editing.nazwa : t.kalFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          {/* The two decisions the user actually makes, first — the title below
              is written from them. */}
          <FormSection icon="calendar" title={t.kalSectionMeeting} description={t.kalSectionMeetingDesc}>
            <FormRow>
              <FormField
                label={t.kalFieldType}
                hint={
                  typy.length === 0 ? (
                    <>
                      {t.kalNoTypesYet}{' '}
                      {onManageTypes && (
                        <button type="button" className="link-button" onClick={onManageTypes}>
                          {t.kalTypyTitle}
                        </button>
                      )}
                    </>
                  ) : undefined
                }
              >
                <Select
                  overlay
                  value={typId}
                  options={[
                    { value: '', label: t.kalNoType },
                    ...typy.map((typ) => ({ value: String(typ.id), label: typ.nazwa })),
                  ]}
                  onChange={(value) => applyPickers(value, adresId)}
                  placeholder={t.kalNoType}
                  ariaLabel={t.kalFieldType}
                />
              </FormField>
              <FormField label={t.kalFieldAdres}>
                <SearchableSelect
                  overlay
                  value={adresId}
                  options={[
                    { value: '', label: t.kalNoAdres },
                    ...adresy.map((a) => ({ value: String(a.id), label: a.nazwa })),
                  ]}
                  onChange={(value) => {
                    applyPickers(typId, value);
                    // A different community brings its own board: the list is
                    // replaced, not appended to — the previous board was not
                    // invited to this community's meeting.
                    if (value !== adresId) setZarzad(boardOf(value));
                    // The community's own city unit, offered when nothing is picked
                    // yet — it is almost always the one the meeting is with.
                    const unit = adresy.find((a) => String(a.id) === value)?.zgnJednostkaId;
                    if (!zgnPick && unit != null) setZgnPick(`j:${unit}`);
                  }}
                  placeholder={t.kalNoAdres}
                  searchPlaceholder={t.searchAdres}
                  emptyText={t.kalNoResults}
                  ariaLabel={t.kalFieldAdres}
                />
              </FormField>
            </FormRow>
            <FormField
              label={t.kalFieldName}
              htmlFor="kal-meeting-name"
              required
              hint={nameEdited ? t.kalFieldNameHintEdited : t.kalFieldNameHint}
              action={
                // Only offered once it would actually change something — after a
                // manual edit, with a suggestion available to go back to.
                nameEdited && suggestion && suggestion !== nazwa.trim() ? (
                  <button type="button" className="button button-small button-subtle" onClick={restoreSuggestedTitle}>
                    <Icon name="refresh" size={13} /> {t.kalTitleRestore}
                  </button>
                ) : undefined
              }
            >
              <input
                id="kal-meeting-name"
                type="text"
                value={nazwa}
                onChange={(e) => {
                  setNazwa(e.target.value);
                  setNameEdited(true);
                  if (localError) setLocalError(null);
                }}
                placeholder={suggestion || t.kalFieldNamePlaceholder}
              />
            </FormField>
            <FormField label={t.kalFieldDesc} htmlFor="kal-meeting-desc">
              <textarea
                id="kal-meeting-desc"
                value={opis}
                onChange={(e) => setOpis(e.target.value)}
                placeholder={t.kalFieldDescPlaceholder}
                rows={3}
              />
            </FormField>
            {duplikaty.length > 0 && (
              <div className="callout callout--warning" role="status">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.kalDuplicateWarning
                    .replace('{typ}', selectedTyp?.nazwa ?? '')
                    .replace('{adres}', adresNazwa(adresId) ?? '')}
                  <ul className="kal-duplicates">
                    {duplikaty.slice(0, 5).map((d) => (
                      <li key={d.id}>
                        {formatStamp(d.startsAt, language === 'en' ? 'en-GB' : 'pl-PL')} — {d.nazwa}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </FormSection>

          <FormSection icon="clock" title={t.kalSectionWhen} description={t.kalSectionWhenDesc}>
            <div className="form-grid form-grid--3">
              <FormField label={t.kalFieldDate} htmlFor="kal-meeting-date" required>
                <input
                  id="kal-meeting-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                />
              </FormField>
              <FormField label={t.kalFieldTimeFrom} htmlFor="kal-meeting-from" required>
                <input
                  id="kal-meeting-from"
                  type="time"
                  value={timeFrom}
                  onChange={(e) => handleStartChange(e.target.value)}
                />
              </FormField>
              <FormField label={t.kalFieldTimeTo} htmlFor="kal-meeting-to" hint={t.kalFieldTimeToHint}>
                <input
                  id="kal-meeting-to"
                  type="time"
                  value={timeTo}
                  onChange={(e) => {
                    setTimeTo(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                />
              </FormField>
            </div>
            {/* Is that date settled? Two radios rather than a checkbox: "wstępny"
                is a real state somebody chose, not the absence of a tick. */}
            <FormField label={t.kalFieldTermin} hint={t.kalFieldTerminHint}>
              <div className="kal-termin-choice">
                {(['potwierdzony', 'wstepny'] as SpotkanieTerminStatus[]).map((value) => (
                  <label
                    key={value}
                    className={`kal-termin-option${terminStatus === value ? ' is-active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="kal-termin-status"
                      value={value}
                      checked={terminStatus === value}
                      onChange={() => setTerminStatus(value)}
                    />
                    <Icon name={value === 'potwierdzony' ? 'check-circle' : 'clock'} size={14} />
                    <span>{value === 'potwierdzony' ? t.kalTerminConfirmed : t.kalTerminTentative}</span>
                  </label>
                ))}
              </div>
            </FormField>
          </FormSection>

          {/* Where. Picked from the dictionary, never typed — three spellings of
              one address is exactly what the dictionary exists to prevent. */}
          <FormSection icon="map-pin" title={t.kalSectionWhere} description={t.kalSectionWhereDesc}>
            <FormRow>
              <FormField
                label={t.kalFieldPlace}
                hint={lokalizacje.length === 0 ? t.kalNoPlaces : undefined}
                action={
                  onManagePlaces ? (
                    <button type="button" className="button button-small button-subtle" onClick={onManagePlaces}>
                      {t.kalManagePlaces}
                    </button>
                  ) : undefined
                }
              >
                {lokalizacje.length > 0 && (
                  <SearchableSelect
                    overlay
                    value={lokalizacjaId}
                    options={[
                      { value: '', label: t.kalNoPlaceOption },
                      ...lokalizacje.map((lok) => ({
                        value: String(lok.id),
                        label: lok.nazwa,
                        hint: lok.adres || undefined,
                        keywords: `${lok.nazwa} ${lok.adres} ${lok.opis}`,
                      })),
                    ]}
                    onChange={setLokalizacjaId}
                    placeholder={t.kalPlacePlaceholder}
                    searchPlaceholder={t.kalPlaceSearch}
                    emptyText={t.kalPlaceNoMatch}
                    ariaLabel={t.kalFieldPlace}
                  />
                )}
              </FormField>
              <FormField label={t.kalFieldZgn} hint={zgnJednostki.length === 0 ? t.kalZgnNoneYet : undefined}>
                <SearchableSelect
                  overlay
                  value={zgnPick}
                  options={zgnOptions}
                  onChange={setZgnPick}
                  placeholder={t.kalNoZgn}
                  searchPlaceholder={t.kalZgnSearch}
                  emptyText={t.kalNoResults}
                  ariaLabel={t.kalFieldZgn}
                />
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection icon="users" title={t.kalSectionPeople} description={t.kalSectionPeopleDesc}>
            <FormField
              label={t.kalFieldParticipants}
              hint={users.length === 0 ? t.kalNoAccounts : t.kalFieldParticipantsHint}
              action={
                users.length > 0 ? (
                  <>
                    {/* "Everyone" is one of the two common answers here — a
                        committee meeting is for the whole office — so it is a
                        button, not fifteen picks from the dropdown. */}
                    <button
                      type="button"
                      className="button button-small button-subtle"
                      onClick={addAllParticipants}
                      disabled={available.length === 0}
                    >
                      {t.kalParticipantsAddAll.replace('{count}', String(users.length))}
                    </button>
                    {uczestnicy.length > 0 && (
                      <button
                        type="button"
                        className="button button-small button-subtle"
                        onClick={() => setUczestnicy([])}
                      >
                        {t.kalParticipantsClear}
                      </button>
                    )}
                  </>
                ) : undefined
              }
            >
              {users.length > 0 && (
                <SearchableSelect
                  overlay
                  // A permanently empty value turns the dropdown into an action
                  // picker: the trigger keeps its placeholder, each pick adds a
                  // person below instead of replacing a selection.
                  value=""
                  options={available.map((u) => ({
                    value: u.id,
                    // Pick people by name; the mailbox drops to the hint line and
                    // stays searchable, so it is still there when two people
                    // share a first name — or when nobody has named them yet.
                    label: personLabel(u),
                    hint: personName(u) ? u.email : undefined,
                    // Searchable by name, by mailbox, and by whatever name the
                    // account itself carries — someone may still look for the
                    // label they saw before anyone was named here.
                    keywords: `${u.email} ${personName(u) ?? ''} ${u.displayName ?? ''}${
                      u.email === userEmail ? ' ja me' : ''
                    }`,
                  }))}
                  onChange={addParticipant}
                  placeholder={available.length === 0 ? t.kalParticipantsAllAdded : t.kalParticipantsAdd}
                  searchPlaceholder={t.kalParticipantsSearch}
                  emptyText={t.kalParticipantsNoMatch}
                  disabled={available.length === 0}
                  ariaLabel={t.kalParticipantsAdd}
                />
              )}
              {uczestnicy.length > 0 && (
                <div className="kal-people">
                  {uczestnicy.map((person) => (
                    <span key={person.userId} className="kal-person">
                      <Icon name="users" size={12} />
                      <span className="kal-person__label">
                        {personLabel(person)}
                        {person.email === userEmail && <em className="kal-person__you"> ({t.kalYou})</em>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setUczestnicy((prev) => prev.filter((p) => p.userId !== person.userId))}
                        data-tip={t.kalParticipantRemove}
                        aria-label={t.kalParticipantRemove}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </FormField>

            {(zarzad.length > 0 || board.length > 0) && (
              <FormField
                label={t.kalFieldZarzad}
                hint={zarzad.length === 0 ? t.kalZarzadNone : undefined}
                action={
                  // Back to the community's whole board after people were removed.
                  boardMissing.length > 0 && zarzad.length > 0 ? (
                    <button type="button" className="button button-small button-subtle" onClick={() => setZarzad(board)}>
                      <Icon name="refresh" size={13} /> {t.kalZarzadRestore}
                    </button>
                  ) : undefined
                }
              >
                {/* One by one, like the participants: the members not on the
                    meeting yet. A permanently empty value makes it an action
                    picker — each pick adds a person below. */}
                {board.length > 0 && (
                  <SearchableSelect
                    overlay
                    value=""
                    options={boardMissing.map((m) => ({
                      value: m.imieNazwisko,
                      label: m.imieNazwisko,
                      hint: m.email || undefined,
                    }))}
                    onChange={(name) => {
                      const member = board.find((m) => m.imieNazwisko === name);
                      if (member) setZarzad((prev) => [...prev, member]);
                    }}
                    placeholder={boardMissing.length === 0 ? t.kalZarzadAllAdded : t.kalZarzadAdd}
                    searchPlaceholder={t.kalZarzadSearch}
                    emptyText={t.kalParticipantsNoMatch}
                    disabled={boardMissing.length === 0}
                    ariaLabel={t.kalZarzadAdd}
                  />
                )}
                {zarzad.length > 0 && (
                  <div className="kal-people">
                    {zarzad.map((m) => (
                      <span key={m.imieNazwisko} className="kal-person kal-person--board" data-tip={m.email || undefined}>
                        <Icon name="home" size={12} />
                        <span className="kal-person__label">{m.imieNazwisko}</span>
                        <button
                          type="button"
                          onClick={() => setZarzad((prev) => prev.filter((p) => p.imieNazwisko !== m.imieNazwisko))}
                          data-tip={t.kalParticipantRemove}
                          aria-label={t.kalParticipantRemove}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </FormField>
            )}
          </FormSection>

          <FormSection icon="paperclip" title={t.kalSectionMaterials} description={t.kalSectionMaterialsDesc}>
            <FormField label={t.kalMaterialsNeeded} hint={t.kalMaterialsNeededHint}>
              <div className="kal-pill-switch" role="group" aria-label={t.kalMaterialsNeeded}>
                {[true, false].map((needed) => (
                  <button
                    key={String(needed)}
                    type="button"
                    className={`kal-pill-switch__opt${needed ? ' is-yes' : ''}${
                      materialyPotrzebne === needed ? ' is-active' : ''
                    }`}
                    aria-pressed={materialyPotrzebne === needed}
                    onClick={() => setMaterialyPotrzebne(needed)}
                  >
                    {needed ? t.kalMaterialsYes : t.kalMaterialsNo}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField
              label={t.kalFieldTerminWysylki}
              htmlFor="kal-meeting-wysylka"
              hint={
                terminWysylkiOwn
                  ? t.kalFieldTerminWysylkiOwn
                  : terminWysylkiDefault && selectedTyp
                    ? t.kalFieldTerminWysylkiFromTyp
                        .replace('{days}', String(selectedTyp.dniNaDokumenty))
                        .replace('{typ}', selectedTyp.nazwa)
                    : t.kalFieldTerminWysylkiNone
              }
            >
              <div className="kal-wysylka">
                <input
                  id="kal-meeting-wysylka"
                  type="date"
                  value={terminWysylki}
                  max={date || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTerminWysylkiOwn(v && v !== terminWysylkiDefault ? v : null);
                  }}
                />
                {terminWysylkiOwn && terminWysylkiDefault && (
                  <button
                    type="button"
                    className="button button-small button-subtle"
                    onClick={() => setTerminWysylkiOwn(null)}
                  >
                    <Icon name="undo" size={13} /> {t.kalFieldTerminWysylkiReset}
                  </button>
                )}
              </div>
            </FormField>
          </FormSection>

          <FormSection icon="clipboard" title={t.kalSectionTasks} description={t.kalSectionTasksDesc}>
            <SpotkanieZadania
              zadania={editing ? linkedZadania : []}
              pending={pendingZadania}
              users={users}
              language={language}
              disabled={isSaving}
              onAdd={() => setTaskForm({ editing: null })}
              onPreview={setTaskPreview}
              onEdit={(z) => setTaskForm({ editing: z })}
              onDelete={onDeleteZadanie}
              onOpenBoard={onOpenZadanie}
              onRemovePending={(i) => {
                discardPending([pendingZadania[i]]);
                setPendingZadania((prev) => prev.filter((_, k) => k !== i));
              }}
            />
          </FormSection>

          {errorText && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{errorText}</div>
            </div>
          )}
        </div>
        <ModalFooter
          note={
            editing && onClone ? (
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={onClone}
                disabled={isSaving}
                data-tip={t.kalCloneHint}
              >
                <Icon name="copy" size={13} /> {t.kalClone}
              </button>
            ) : (
              <RequiredNote label={t.formRequiredNote} />
            )
          }
          onCancel={handleCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.kalNewMeeting}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!nazwa.trim()}
          submitTitle={t.kalNameRequired}
          busy={isSaving}
        />

        {/* On document.body so the meeting modal's entry animation (a transform)
            cannot become the task modal's containing block. Kept inside this
            .modal in the React tree: portal clicks bubble through it, and its
            stopPropagation is what keeps them from closing the meeting form. */}
        {taskPreview &&
          createPortal(
            <ZadaniePreviewModal
              key={taskPreview.id}
              language={language}
              zadanie={taskPreview}
              users={users}
              userEmail={userEmail ?? ''}
              onCommentsChange={() => {}}
              onEdit={() => {
                setTaskForm({ editing: taskPreview });
                setTaskPreview(null);
              }}
              onClose={() => setTaskPreview(null)}
            />,
            document.body,
          )}

        {taskForm &&
          createPortal(
            <ZadanieFormModal
              key={taskForm.editing ? `edit-${taskForm.editing.id}` : 'new'}
              language={language}
              editing={taskForm.editing}
              initialStatus="todo"
              initialValues={{
                termin: date || null,
                spotkanieId: editing ? editing.id : null,
              }}
              users={users}
              userEmail={userEmail ?? ''}
              onCommentsChange={() => {}}
              isSaving={taskSaving}
              error={taskError}
              onSubmit={handleTaskSubmit}
              onCancel={closeTask}
            />,
            document.body,
          )}
      </div>
    </div>
  );
};
