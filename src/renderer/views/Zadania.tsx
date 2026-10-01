import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppUser,
  Zadanie,
  ZadanieInput,
  ZadanieStatus,
  ZadanieZalacznik,
  ZADANIE_STATUSES,
} from '../../shared/types';
import {
  DEFAULT_ZADANIA_FILTER,
  ZadaniaFilterSeed,
  dayKey,
  dueBucket,
  formatBytes,
  formatDayKey,
  isOverdue,
} from '../../shared/zadania';
import { comparePeople, personColor, personLabel } from '../../shared/app-users';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import ModalDismiss from '../components/Modal';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';

interface Props {
  language: Language;
  /** The signed-in mailbox — what "Przypisane do mnie" matches against. */
  userEmail: string;
  /** Where the filter bar starts — the dashboard's tiles open the board pre-filtered. */
  initialFilter?: ZadaniaFilterSeed;
}

/**
 * Whose cards the board shows. `mine` and `none` are the two questions people
 * ask most, so they are filters of their own rather than entries buried in a
 * person picker; any other person is `person` with their mailbox.
 */
type Filter =
  { kind: 'all' } | { kind: 'mine' } | { kind: 'none' } | { kind: 'person'; email: string };

/** Mailboxes compare case-insensitively; an empty one matches nothing. */
function sameMailbox(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? '').trim().toLowerCase();
  return left !== '' && left === (b ?? '').trim().toLowerCase();
}

/**
 * Saving an attachment, from the card or from the form. The save dialog opens
 * first (the main process asks for it before fetching anything), and the result
 * is always said out loud — a download that fails silently looks exactly like a
 * link that does nothing.
 */
function useAttachmentDownload(t: (typeof translations)['pl']) {
  const notify = useNotify();
  const [busyId, setBusyId] = useState<string | null>(null);
  const download = async (z: ZadanieZalacznik) => {
    if (busyId) return;
    setBusyId(z.id);
    try {
      const saved = await window.electronAPI.zadaniaDownloadAttachment({
        sciezka: z.sciezka,
        nazwa: z.nazwa,
      });
      if (saved) notify.success(t.zadAttachSaved);
    } catch {
      notify.error(t.zadAttachDownloadError);
    } finally {
      setBusyId(null);
    }
  };
  return { busyId, download };
}

interface FormModalProps {
  language: Language;
  /** Card being edited, or null when adding a new one. */
  editing: Zadanie | null;
  /** Column a new card starts in (the one whose "+" was pressed). */
  initialStatus: ZadanieStatus;
  users: AppUser[];
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: ZadanieInput) => void;
  onCancel: () => void;
}

const ZadanieFormModal: React.FC<FormModalProps> = ({
  language,
  editing,
  initialStatus,
  users,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [tytul, setTytul] = useState(editing?.tytul ?? '');
  const [opis, setOpis] = useState(editing?.opis ?? '');
  const [status, setStatus] = useState<ZadanieStatus>(editing?.status ?? initialStatus);
  const [email, setEmail] = useState(editing?.przypisanyEmail ?? '');
  const [termin, setTermin] = useState(editing?.termin ?? '');
  const [zalaczniki, setZalaczniki] = useState<ZadanieZalacznik[]>(editing?.zalaczniki ?? []);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Uploads made in THIS form: they are in the bucket but on no card until the
  // form is saved, so closing it any other way has to take them out again.
  const uploadedHere = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  // Armed in the body, not only disarmed in the cleanup: StrictMode runs
  // mount → cleanup → mount, and a ref that cleanup left false would read as
  // "form closed" for the rest of the form's life.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refusal = (code: string): string =>
    code === 'too_large'
      ? t.zadAttachTooLarge
      : code === 'not_a_file'
        ? t.zadAttachNotFile
        : code === 'unreadable'
          ? t.zadAttachUnreadable
          : t.zadAttachFailed;

  const discard = (paths: string[]) => {
    if (paths.length > 0) void window.electronAPI.zadaniaDiscardAttachments(paths);
  };

  const handleAttach = async () => {
    setLocalError(null);
    const picked = await window.electronAPI.zadaniaPickAttachment();
    if (!picked) return; // dialog cancelled
    if (!picked.ok) {
      setLocalError(refusal(picked.error));
      return;
    }
    // The loader covers the upload only — the file dialog above can sit open
    // for as long as the person likes.
    setUploading(true);
    try {
      const result = await window.electronAPI.zadaniaUploadAttachment(picked.token);
      if (!result.ok) {
        if (mounted.current) setLocalError(refusal(result.error));
        return;
      }
      if (!mounted.current) {
        // The form was closed mid-upload: nobody will ever save this file.
        discard([result.zalacznik.sciezka]);
        return;
      }
      uploadedHere.current.add(result.zalacznik.sciezka);
      setZalaczniki((prev) => [...prev, result.zalacznik]);
    } catch {
      if (mounted.current) setLocalError(t.zadAttachFailed);
    } finally {
      if (mounted.current) setUploading(false);
    }
  };

  const handleRemoveAttachment = (z: ZadanieZalacznik) => {
    setZalaczniki((prev) => prev.filter((a) => a.id !== z.id));
    // A file uploaded in this very form can go at once; one that was already on
    // the card is only deleted once the save that drops it succeeds.
    if (uploadedHere.current.delete(z.sciezka)) discard([z.sciezka]);
  };

  const { busyId, download: handleDownload } = useAttachmentDownload(t);

  const handleCancel = () => {
    discard([...uploadedHere.current]);
    onCancel();
  };

  const statusLabels: Record<ZadanieStatus, string> = {
    todo: t.zadColTodo,
    in_progress: t.zadColInProgress,
    done: t.zadColDone,
  };

  // A card may be assigned to someone whose account is gone; keep that mailbox
  // selectable, or opening and saving the card would silently unassign it.
  const assigneeOptions = useMemo(() => {
    const options = [
      { value: '', label: t.zadUnassigned },
      ...[...users].sort(comparePeople).map((u) => ({
        value: u.email,
        label: personLabel(u),
        hint: u.email,
      })),
    ];
    if (email && !users.some((u) => sameMailbox(u.email, email))) {
      options.push({ value: email, label: email, hint: '' });
    }
    return options;
  }, [users, email, t.zadUnassigned]);

  const handleSubmit = () => {
    if (!tytul.trim()) {
      setLocalError(t.zadTitleRequired);
      return;
    }
    onSubmit({
      tytul: tytul.trim(),
      opis: opis.trim(),
      status,
      przypisanyEmail: email || null,
      termin: termin || null,
      zalaczniki,
    });
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(660px, 94vw)', maxWidth: 660 }}
      >
        <ModalDismiss onClose={handleCancel} ariaLabel={t.close} />
        <div className="modal-header">{editing ? t.zadEdit : t.zadAdd}</div>
        <div className="modal-body">
          <div className="form-group">
            <label>
              {t.zadFieldTitle} <span style={{ color: 'red' }}>*</span>
            </label>
            <input
              type="text"
              value={tytul}
              onChange={(e) => {
                setTytul(e.target.value);
                if (localError) setLocalError(null);
              }}
              placeholder={t.zadFieldTitlePlaceholder}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          <div className="form-group">
            <label>{t.zadFieldDescription}</label>
            <textarea
              value={opis}
              rows={5}
              onChange={(e) => setOpis(e.target.value)}
              placeholder={t.zadFieldDescriptionPlaceholder}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="zad-form-row">
            <div className="form-group">
              <label>{t.zadFieldAssignee}</label>
              <SearchableSelect
                value={email}
                options={assigneeOptions}
                onChange={setEmail}
                placeholder={t.zadUnassigned}
                searchPlaceholder={t.zadSearchPerson}
                emptyText={t.zadNoPersonFound}
                ariaLabel={t.zadFieldAssignee}
                // On top of the modal, not inside its scrolling body: the list is not
                // clipped, and the modal stays only as tall as its content.
                overlay
              />
            </div>

            <div className="form-group">
              <label>{t.zadFieldDue}</label>
              <div className="zad-due-input">
                <input type="date" value={termin} onChange={(e) => setTermin(e.target.value)} />
                {termin && (
                  <button
                    type="button"
                    className="zad-icon-btn"
                    title={t.zadDueClear}
                    aria-label={t.zadDueClear}
                    onClick={() => setTermin('')}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>{t.zadFieldStatus}</label>
              <Select
                value={status}
                options={ZADANIE_STATUSES.map((s) => ({ value: s, label: statusLabels[s] }))}
                onChange={(v) => setStatus(v as ZadanieStatus)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>{t.zadFieldAttachments}</label>
            {zalaczniki.length > 0 && (
              <ul className="zad-files">
                {zalaczniki.map((z) => (
                  <li key={z.id} className="zad-file">
                    <Icon name="paperclip" size={14} />
                    <button
                      type="button"
                      className={`zad-file__name${busyId === z.id ? ' is-busy' : ''}`}
                      title={t.zadAttachDownload}
                      disabled={busyId !== null}
                      onClick={() => void handleDownload(z)}
                    >
                      {z.nazwa}
                    </button>
                    <span className="zad-file__size">{formatBytes(z.rozmiar)}</span>
                    <button
                      type="button"
                      className="zad-icon-btn zad-icon-btn--danger"
                      title={t.zadAttachRemove}
                      aria-label={t.zadAttachRemove}
                      onClick={() => handleRemoveAttachment(z)}
                      disabled={isSaving}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="zad-upload">
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void handleAttach()}
                disabled={uploading || isSaving}
              >
                <Icon name="paperclip" size={13} /> {t.zadAttachAdd}
              </button>
              {uploading ? (
                <span className="zad-upload__busy" role="status" aria-live="polite">
                  <span className="loader-spinner zad-upload__spinner" />
                  {t.zadAttachUploading}
                </span>
              ) : (
                <span className="zad-upload__hint">{t.zadAttachHint}</span>
              )}
            </div>
          </div>

          {(localError || error) && (
            <div style={{ fontSize: '12px', color: 'var(--danger)' }}>{localError || error}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={handleCancel} disabled={isSaving}>
            <Icon name="x" size={14} /> {t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || uploading || !tytul.trim()}
          >
            <Icon name="save" size={14} /> {editing ? t.update : t.add}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DueBadgeProps {
  zadanie: Zadanie;
  today: string;
  locale: 'pl' | 'en';
  t: (typeof translations)['pl'];
  onChange: (termin: string | null) => void;
}

/**
 * The date in a card's corner, and the way to change it.
 *
 * A date input is the only thing that can pick a date, but its own box would
 * clutter a card — so the badge is a button, and a transparent date input sits
 * exactly over it purely so the browser's picker opens in the right place.
 * Clearing is the picker's own "Clear". "Overdue" is said by the colour and the
 * tooltip rather than by a word, so the corner stays one short date wide.
 */
const DueBadge: React.FC<DueBadgeProps> = ({ zadanie: z, today, locale, t, onChange }) => {
  const input = useRef<HTMLInputElement>(null);
  const done = z.status === 'done';
  const bucket = dueBucket(z.termin, today);

  const open = () => {
    // `showPicker` needs a user gesture, which the click is. Older engines lack
    // it; the input then simply cannot be opened from here, and the form still can.
    try {
      input.current?.showPicker();
    } catch {
      input.current?.focus();
    }
  };

  const label = !z.termin
    ? t.zadAddDue
    : !done && bucket === 'today'
      ? t.zadDueToday
      : formatDayKey(z.termin, locale);

  return (
    <span className="zad-due-wrap">
      <button
        type="button"
        className={`zad-due zad-due--button zad-due--${
          !z.termin ? 'ghost' : done ? 'done' : (bucket ?? 'upcoming')
        }`}
        title={
          !z.termin
            ? t.zadAddDue
            : !done && bucket === 'overdue'
              ? `${t.zadDueOverdue} — ${t.zadChangeDue}`
              : t.zadChangeDue
        }
        // A card is draggable; the badge must not start a drag.
        draggable={false}
        onClick={open}
      >
        <Icon name="calendar" size={12} />
        {label}
      </button>
      <input
        ref={input}
        type="date"
        className="zad-due-native"
        value={z.termin ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  );
};

/**
 * "Zadania": a deliberately small Kanban — three fixed columns, a title, a
 * description and an assignee. The people come from the same `app_users` list
 * the calendar's participant picker and Ustawienia → Użytkownicy use, so there
 * is one answer to "who is in this office".
 */
const Zadania: React.FC<Props> = ({
  language,
  userEmail,
  initialFilter = DEFAULT_ZADANIA_FILTER,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const { busyId: downloadingId, download: downloadAttachment } = useAttachmentDownload(t);
  const [zadania, setZadania] = useState<Zadanie[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two independent questions — whose, and only the late ones — so "mine, and
  // overdue" is a thing you can ask for.
  const [filter, setFilter] = useState<Filter>({ kind: initialFilter.who });
  const [overdueOnly, setOverdueOnly] = useState(initialFilter.overdue);
  // null = closed; otherwise the card being edited (null = add) and the column
  // a new card starts in.
  const [formState, setFormState] = useState<{
    editing: Zadanie | null;
    status: ZadanieStatus;
  } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropColumn, setDropColumn] = useState<ZadanieStatus | null>(null);

  const today = dayKey();
  const locale = language === 'en' ? 'en' : 'pl';

  const columns: { status: ZadanieStatus; label: string }[] = [
    { status: 'todo', label: t.zadColTodo },
    { status: 'in_progress', label: t.zadColInProgress },
    { status: 'done', label: t.zadColDone },
  ];

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const [zadaniaData, usersData] = await Promise.all([
        window.electronAPI.getZadania(),
        window.electronAPI.getAppUsers(),
      ]);
      setZadania(zadaniaData);
      setUsers(usersData);
    } catch {
      notify.error(t.zadLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const usersByEmail = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of users) map.set(u.email.trim().toLowerCase(), u);
    return map;
  }, [users]);

  const visible = useMemo(
    () =>
      zadania.filter((z) => {
        if (overdueOnly && !isOverdue(z, dayKey())) return false;
        switch (filter.kind) {
          case 'all':
            return true;
          case 'mine':
            return sameMailbox(z.przypisanyEmail, userEmail);
          case 'none':
            return !(z.przypisanyEmail ?? '').trim();
          case 'person':
            return sameMailbox(z.przypisanyEmail, filter.email);
        }
      }),
    [zadania, filter, overdueOnly, userEmail]
  );

  /**
   * The picker on a card: the people, plus — if the card is held by a mailbox
   * with no account any more — that mailbox, so opening the picker and choosing
   * nobody new cannot silently drop it.
   */
  const assigneeOptionsFor = (current: string | null) => {
    const options = [
      { value: '', label: t.zadUnassigned, hint: '' },
      ...[...users]
        .sort(comparePeople)
        .map((u) => ({ value: u.email, label: personLabel(u), hint: u.email })),
    ];
    if (current && !usersByEmail.has(current.trim().toLowerCase())) {
      options.push({ value: current, label: current, hint: '' });
    }
    return options;
  };

  /**
   * Change one thing on a card straight from the board — who it is assigned to,
   * or its due date. Optimistic, like moving a card between columns: the card
   * changes at once, and a failed write puts the board back to what the database
   * says. Everything else is sent as it already is, so nothing but the patched
   * field can change.
   */
  const patchCard = async (
    z: Zadanie,
    patch: Partial<Pick<Zadanie, 'przypisanyEmail' | 'termin'>>
  ) => {
    const next = { ...z, ...patch };
    if (next.przypisanyEmail === z.przypisanyEmail && next.termin === z.termin) return;
    setZadania((prev) => prev.map((c) => (c.id === z.id ? next : c)));
    try {
      await window.electronAPI.updateZadanie(z.id, {
        tytul: next.tytul,
        opis: next.opis,
        status: next.status,
        przypisanyEmail: next.przypisanyEmail,
        termin: next.termin,
        zalaczniki: next.zalaczniki,
      });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
      await load();
    }
  };

  const reassign = (z: Zadanie, email: string) => patchCard(z, { przypisanyEmail: email || null });

  const personOptions = useMemo(
    () =>
      [...users]
        .sort(comparePeople)
        .map((u) => ({ value: u.email, label: personLabel(u), hint: u.email })),
    [users]
  );

  const handleSubmit = async (input: ZadanieInput) => {
    const editingId = formState?.editing?.id ?? null;
    setIsSaving(true);
    setError(null);
    try {
      if (editingId !== null) {
        await window.electronAPI.updateZadanie(editingId, input);
      } else {
        await window.electronAPI.addZadanie(input);
      }
      setFormState(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.zadSaveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (z: Zadanie) => {
    if (!(await notify.confirm(t.zadConfirmDelete.replace('{title}', z.tytul), { danger: true }))) {
      return;
    }
    try {
      await window.electronAPI.deleteZadanie(z.id);
      await load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
    }
  };

  /**
   * Move a card. Optimistic — the card jumps at once and the write follows —
   * because a drag that waits on a round trip to the cloud feels like a miss;
   * a failed write puts the board back to what the database says.
   */
  const moveTo = async (id: number, status: ZadanieStatus) => {
    const card = zadania.find((z) => z.id === id);
    if (!card || card.status === status) return;
    setZadania((prev) => prev.map((z) => (z.id === id ? { ...z, status } : z)));
    try {
      await window.electronAPI.setZadanieStatus(id, status);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
      await load();
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      className={`zad-filter-chip${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="content-body">
      <div className="zad-head">
        <div>
          <h2 style={{ margin: '0 0 6px' }}>{t.zadTitle}</h2>
          <div style={{ fontSize: '13px', opacity: 0.75 }}>{t.zadHint}</div>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setError(null);
            setFormState({ editing: null, status: 'todo' });
          }}
          style={{ whiteSpace: 'nowrap' }}
        >
          <Icon name="plus" size={14} /> {t.zadAdd}
        </button>
      </div>

      <div className="zad-filters" role="group" aria-label={t.zadFilterLabel}>
        {chip(filter.kind === 'all', t.zadFilterAll, () => setFilter({ kind: 'all' }))}
        {chip(filter.kind === 'mine', t.zadFilterMine, () => setFilter({ kind: 'mine' }))}
        {chip(filter.kind === 'none', t.zadUnassigned, () => setFilter({ kind: 'none' }))}
        {chip(overdueOnly, t.zadFilterOverdue, () => setOverdueOnly((on) => !on))}
        <div className="zad-filter-person">
          <SearchableSelect
            size="sm"
            ariaLabel={t.zadFilterPerson}
            placeholder={t.zadFilterPersonAny}
            searchPlaceholder={t.zadSearchPerson}
            emptyText={t.zadNoPersonFound}
            value={filter.kind === 'person' ? filter.email : ''}
            options={personOptions}
            onChange={(email) => setFilter(email ? { kind: 'person', email } : { kind: 'all' })}
          />
        </div>
      </div>

      <div className="zad-board">
        {columns.map((col, colIndex) => {
          const cards = visible.filter((z) => z.status === col.status);
          return (
            <div
              key={col.status}
              className={`zad-col zad-col--${col.status}${dropColumn === col.status ? ' is-drop' : ''}`}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                if (dropColumn !== col.status) setDropColumn(col.status);
              }}
              onDragLeave={(e) => {
                // Leaving for a child of the column is not leaving the column.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDropColumn(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId;
                setDragId(null);
                setDropColumn(null);
                if (id !== null) void moveTo(id, col.status);
              }}
            >
              <div className="zad-col__head">
                <span className="zad-col__title">{col.label}</span>
                <span className="zad-col__count">{cards.length}</span>
                <button
                  type="button"
                  className="zad-icon-btn"
                  title={t.zadAdd}
                  aria-label={`${t.zadAdd}: ${col.label}`}
                  onClick={() => {
                    setError(null);
                    setFormState({ editing: null, status: col.status });
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>

              <div className="zad-col__cards">
                {cards.length === 0 && <div className="zad-col__empty">{t.zadEmptyColumn}</div>}
                {cards.map((z) => {
                  // A mailbox with no account behind it any more is still shown,
                  // as the mailbox — better than pretending the card is unassigned.
                  const assignee = z.przypisanyEmail
                    ? (usersByEmail.get(z.przypisanyEmail.trim().toLowerCase()) ?? {
                        email: z.przypisanyEmail,
                      })
                    : null;
                  return (
                    <div
                      key={z.id}
                      className={`zad-card${dragId === z.id ? ' is-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        // Some engines refuse a drag that carries no payload.
                        e.dataTransfer.setData('text/plain', String(z.id));
                        setDragId(z.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropColumn(null);
                      }}
                    >
                      <div className="zad-card__head">
                        <div className="zad-card__title">{z.tytul}</div>
                        {/* Top right, where the eye goes to ask "when?". Clicking it
                            opens the date picker; on a card with no date there is
                            a faint "add" in the same spot, shown on hover. */}
                        <DueBadge
                          zadanie={z}
                          today={today}
                          locale={locale}
                          t={t}
                          onChange={(termin) => void patchCard(z, { termin })}
                        />
                      </div>
                      {z.opis && <div className="zad-card__desc">{z.opis}</div>}
                      {z.zalaczniki.length > 0 && (
                        <div className="zad-card__files">
                          {z.zalaczniki.slice(0, 3).map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className={`zad-card__file${downloadingId === a.id ? ' is-busy' : ''}`}
                              title={`${t.zadAttachDownload}: ${a.nazwa} (${formatBytes(a.rozmiar)})`}
                              disabled={downloadingId !== null}
                              // A card is draggable; the button must not start a drag.
                              draggable={false}
                              onClick={() => void downloadAttachment(a)}
                            >
                              <Icon name="paperclip" size={13} />
                              <span className="zad-card__file-name">{a.nazwa}</span>
                              <span className="zad-card__file-size">{formatBytes(a.rozmiar)}</span>
                            </button>
                          ))}
                          {z.zalaczniki.length > 3 && (
                            <button
                              type="button"
                              className="zad-card__file zad-card__file--more"
                              title={t.zadAttachCount.replace(
                                '{count}',
                                String(z.zalaczniki.length)
                              )}
                              onClick={() => {
                                setError(null);
                                setFormState({ editing: z, status: z.status });
                              }}
                            >
                              {t.zadDashMore.replace('{count}', String(z.zalaczniki.length - 3))}
                            </button>
                          )}
                        </div>
                      )}
                      <div className="zad-card__foot">
                        {/* The person IS the control: clicking the name opens the
                            same searchable list as the form, and picking someone
                            reassigns the card at once. */}
                        <span className="zad-card__who" title={assignee?.email}>
                          <span
                            className={`zad-avatar${assignee ? '' : ' zad-avatar--none'}`}
                            style={
                              assignee
                                ? { ['--avatar' as string]: personColor(assignee) }
                                : undefined
                            }
                            aria-hidden="true"
                          />
                          <SearchableSelect
                            className="zad-who-select"
                            size="sm"
                            overlay
                            menuMinWidth={240}
                            value={z.przypisanyEmail ?? ''}
                            options={assigneeOptionsFor(z.przypisanyEmail)}
                            onChange={(email) => void reassign(z, email)}
                            placeholder={t.zadUnassigned}
                            searchPlaceholder={t.zadSearchPerson}
                            emptyText={t.zadNoPersonFound}
                            ariaLabel={t.zadFieldAssignee}
                            title={t.zadReassign}
                          />
                        </span>
                        <span className="zad-card__actions">
                          <button
                            type="button"
                            className="zad-icon-btn"
                            title={t.zadMoveLeft}
                            aria-label={t.zadMoveLeft}
                            disabled={colIndex === 0}
                            onClick={() => void moveTo(z.id, columns[colIndex - 1].status)}
                          >
                            <Icon name="chevron-left" size={14} />
                          </button>
                          <button
                            type="button"
                            className="zad-icon-btn"
                            title={t.zadMoveRight}
                            aria-label={t.zadMoveRight}
                            disabled={colIndex === columns.length - 1}
                            onClick={() => void moveTo(z.id, columns[colIndex + 1].status)}
                          >
                            <Icon name="chevron-right" size={14} />
                          </button>
                          <button
                            type="button"
                            className="zad-icon-btn"
                            title={t.edit}
                            aria-label={t.edit}
                            onClick={() => {
                              setError(null);
                              setFormState({ editing: z, status: z.status });
                            }}
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="zad-icon-btn zad-icon-btn--danger"
                            title={t.delete}
                            aria-label={t.delete}
                            onClick={() => void handleDelete(z)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {formState && (
        <ZadanieFormModal
          language={language}
          editing={formState.editing}
          initialStatus={formState.status}
          users={users}
          isSaving={isSaving}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => setFormState(null)}
        />
      )}
    </div>
  );
};

export default Zadania;
