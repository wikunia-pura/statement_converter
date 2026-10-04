import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AppUser,
  Spotkanie,
  SpotkanieTyp,
  Zadanie,
  ZadanieInput,
  ZadanieKomentarz,
  ZadanieKomentarzPodsumowanie,
  ZadanieStatus,
  ZadaniePriorytet,
  ZadanieZalacznik,
  ZADANIE_STATUSES,
  ZADANIE_PRIORYTETY,
  DEFAULT_ZADANIE_PRIORYTET,
} from '../../shared/types';
import {
  DEFAULT_ZADANIA_FILTER,
  ZadaniaDueFilter,
  ZadaniaFilterSeed,
  dayKey,
  dueBucket,
  formatBytes,
  formatDayKey,
  compareZadaniaOrder,
  matchesDue,
} from '../../shared/zadania';
import { comparePeople, personColor, personLabel } from '../../shared/app-users';
import { toDayKey } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import ZadanieKomentarze, { CommentText } from '../components/ZadanieKomentarze';
import ZadaniaNotatki from '../components/ZadaniaNotatki';
import SpotkaniePreviewModal from '../components/SpotkaniePreviewModal';

interface Props {
  language: Language;
  /** The signed-in mailbox — what "Przypisane do mnie" matches against. */
  userEmail: string;
  /** Where the filter bar starts — the dashboard's tiles open the board pre-filtered. */
  initialFilter?: ZadaniaFilterSeed;
  /**
   * Open this card straight away — a notification about it was clicked. A fresh
   * `nonce` makes the same card open again after it was closed.
   */
  openRequest?: { id: number; nonce: number } | null;
  /** Show a task's meeting in Kalendarz — from the meeting preview a card's link opens. */
  onOpenSpotkanie?: (spotkanie: Spotkanie) => void;
  /** Open that meeting's edit form in Kalendarz. */
  onEditSpotkanie?: (spotkanie: Spotkanie) => void;
}

/** The picker's "Przypisz do mnie" entry — resolved to the signed-in mailbox on pick. */
const ASSIGN_TO_ME = '__me__';

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
 * The meeting a task belongs to, as a link: its name and day. A meeting that is
 * not (or no longer) loaded shows nothing — the database nulls the link when the
 * meeting goes, so this is only ever a moment's gap.
 */
const SpotkanieLink: React.FC<{
  spotkanie: Spotkanie | undefined;
  t: (typeof translations)['pl'];
  locale: 'pl' | 'en';
  onOpen?: (spotkanie: Spotkanie) => void;
}> = ({ spotkanie, t, locale, onOpen }) => {
  if (!spotkanie) return null;
  const text = `${spotkanie.nazwa} · ${formatDayKey(toDayKey(spotkanie.startsAt), locale)}`;
  return (
    <button
      type="button"
      className="zad-meeting"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(spotkanie);
      }}
      disabled={!onOpen}
      title={onOpen ? t.zadMeetingPreview : text}
    >
      <Icon name="calendar" size={12} />
      <span className="zad-meeting__text">{text}</span>
    </button>
  );
};

/** The wording of the three priorities, in the order they are offered. */
function priorityLabels(t: (typeof translations)['pl']): Record<ZadaniePriorytet, string> {
  return { high: t.zadPrioHigh, normal: t.zadPrioNormal, low: t.zadPrioLow };
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
      if (saved) notify.success(t.zadAttachSaved, { file: saved });
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
  /** Fields a new card starts with — a task added from a meeting carries its date and link. */
  initialValues?: Partial<Pick<ZadanieInput, 'tytul' | 'opis' | 'termin' | 'spotkanieId'>>;
  users: AppUser[];
  /** The signed-in mailbox, for the comments. */
  userEmail: string;
  onCommentsChange: (zadanieId: number, komentarze: ZadanieKomentarz[]) => void;
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: ZadanieInput) => void;
  onCancel: () => void;
}

export const ZadanieFormModal: React.FC<FormModalProps> = ({
  language,
  editing,
  initialStatus,
  initialValues,
  users,
  userEmail,
  onCommentsChange,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [tytul, setTytul] = useState(editing?.tytul ?? initialValues?.tytul ?? '');
  const [opis, setOpis] = useState(editing?.opis ?? initialValues?.opis ?? '');
  const [status, setStatus] = useState<ZadanieStatus>(editing?.status ?? initialStatus);
  const [priorytet, setPriorytet] = useState<ZadaniePriorytet>(
    editing?.priorytet ?? DEFAULT_ZADANIE_PRIORYTET,
  );
  const [email, setEmail] = useState(editing?.przypisanyEmail ?? '');
  const [termin, setTermin] = useState(editing?.termin ?? initialValues?.termin ?? '');
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
      // The most common answer, first — unless it is already the answer.
      ...(userEmail && !sameMailbox(email, userEmail)
        ? [{ value: ASSIGN_TO_ME, label: t.zadAssignToMe, hint: '' }]
        : []),
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
  }, [users, email, userEmail, t.zadUnassigned, t.zadAssignToMe]);

  const handleSubmit = () => {
    if (!tytul.trim()) {
      setLocalError(t.zadTitleRequired);
      return;
    }
    onSubmit({
      tytul: tytul.trim(),
      opis: opis.trim(),
      status,
      priorytet,
      przypisanyEmail: email || null,
      termin: termin || null,
      zalaczniki,
      // Not a field of the form: a card keeps the meeting it was made for.
      spotkanieId: editing ? editing.spotkanieId : initialValues?.spotkanieId ?? null,
    });
  };

  const errorText = localError || error;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={handleCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="clipboard"
          title={editing ? t.zadEdit : t.zadAdd}
          subtitle={editing ? editing.tytul : t.zadFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="clipboard" title={t.zadSectionTask} description={t.zadSectionTaskDesc}>
            <FormField label={t.zadFieldTitle} htmlFor="zad-title" required>
              <input
                id="zad-title"
                type="text"
                value={tytul}
                onChange={(e) => {
                  setTytul(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder={t.zadFieldTitlePlaceholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
            </FormField>
            <FormField label={t.zadFieldDescription} htmlFor="zad-desc">
              <textarea
                id="zad-desc"
                value={opis}
                rows={5}
                onChange={(e) => setOpis(e.target.value)}
                placeholder={t.zadFieldDescriptionPlaceholder}
              />
            </FormField>
          </FormSection>

          <FormSection icon="users" title={t.zadSectionWho} description={t.zadSectionWhoDesc}>
            <FormRow>
              <FormField
                label={t.zadFieldAssignee}
                action={
                  !sameMailbox(email, userEmail) ? (
                    <button
                      type="button"
                      className="button button-small button-subtle"
                      title={t.zadAssignToMe}
                      onClick={() => setEmail(userEmail)}
                    >
                      <Icon name="user-plus" size={13} /> {t.zadAssignToMeShort}
                    </button>
                  ) : undefined
                }
              >
                <SearchableSelect
                  value={email}
                  options={assigneeOptions}
                  onChange={(v) => setEmail(v === ASSIGN_TO_ME ? userEmail : v)}
                  placeholder={t.zadUnassigned}
                  searchPlaceholder={t.zadSearchPerson}
                  emptyText={t.zadNoPersonFound}
                  ariaLabel={t.zadFieldAssignee}
                  // On top of the modal, not inside its scrolling body: the list is not
                  // clipped, and the modal stays only as tall as its content.
                  overlay
                />
              </FormField>
              <FormField
                label={t.zadFieldDue}
                htmlFor="zad-due"
                action={
                  <>
                    {termin !== dayKey() && (
                      <button
                        type="button"
                        className="button button-small button-subtle"
                        title={t.zadDueSetToday}
                        onClick={() => setTermin(dayKey())}
                      >
                        <Icon name="clock" size={13} /> {t.zadDueTodayShort}
                      </button>
                    )}
                    {termin && (
                      <button
                        type="button"
                        className="button button-small button-subtle"
                        title={t.zadDueClear}
                        onClick={() => setTermin('')}
                      >
                        <Icon name="x" size={13} /> {t.zadDueClear}
                      </button>
                    )}
                  </>
                }
              >
                <input id="zad-due" type="date" value={termin} onChange={(e) => setTermin(e.target.value)} />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={t.zadFieldStatus}>
                <Select
                  overlay
                  value={status}
                  options={ZADANIE_STATUSES.map((s) => ({ value: s, label: statusLabels[s] }))}
                  onChange={(v) => setStatus(v as ZadanieStatus)}
                  ariaLabel={t.zadFieldStatus}
                />
              </FormField>
              <FormField label={t.zadFieldPriority}>
                <div className="zad-seg" role="radiogroup" aria-label={t.zadFieldPriority}>
                  {ZADANIE_PRIORYTETY.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={priorytet === p}
                      className={`zad-seg__btn${priorytet === p ? ' is-active' : ''}`}
                      onClick={() => setPriorytet(p)}
                    >
                      <span className={`zad-prio-dot zad-prio-dot--${p}`} aria-hidden="true" />
                      {priorityLabels(t)[p]}
                    </button>
                  ))}
                </div>
              </FormField>
            </FormRow>
          </FormSection>

          <FormSection icon="paperclip" title={t.zadSectionFiles} description={t.zadSectionFilesDesc}>
            <FormField label={t.zadFieldAttachments} hint={t.zadAttachHint}>
              {/* The add button lives inside the list's frame, as in every file list. */}
              <div className={`file-list${zalaczniki.length === 0 ? ' is-empty' : ''}`}>
                {zalaczniki.map((z) => (
                  <div key={z.id} className="file-list__row">
                    <Icon name="paperclip" size={14} />
                    <button
                      type="button"
                      className={`file-list__name file-list__name--link${busyId === z.id ? ' is-busy' : ''}`}
                      title={t.zadAttachDownload}
                      disabled={busyId !== null}
                      onClick={() => void handleDownload(z)}
                    >
                      {z.nazwa}
                    </button>
                    <span className="file-list__size">{formatBytes(z.rozmiar)}</span>
                    <button
                      type="button"
                      className="button button-ghost button-icon icon-danger"
                      title={t.zadAttachRemove}
                      aria-label={`${t.zadAttachRemove}: ${z.nazwa}`}
                      onClick={() => handleRemoveAttachment(z)}
                      disabled={isSaving}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
                <div className="file-list__footer">
                  {uploading ? (
                    <span className="file-list__empty" role="status" aria-live="polite">
                      <Icon name="loader" size={14} className="icon-spin" />
                      {t.zadAttachUploading}
                    </span>
                  ) : (
                    zalaczniki.length === 0 && (
                      <span className="file-list__empty">
                        <Icon name="paperclip" size={14} />
                        {t.zadNoFiles}
                      </span>
                    )
                  )}
                  <button
                    type="button"
                    className="button button-small button-subtle"
                    onClick={() => void handleAttach()}
                    disabled={uploading || isSaving}
                  >
                    <Icon name="plus" size={13} /> {t.zadAttachAdd}
                  </button>
                </div>
              </div>
            </FormField>
          </FormSection>

          {/* Comments save on their own, not with the form, so they need a card that exists. */}
          <FormSection icon="message-square" title={t.zadSectionComments} description={t.zadSectionCommentsDesc}>
            {editing ? (
              <ZadanieKomentarze
                language={language}
                zadanieId={editing.id}
                users={users}
                userEmail={userEmail}
                bare
                onChange={onCommentsChange}
              />
            ) : (
              <div className="form-empty">
                <Icon name="message-square" size={16} />
                {t.zadCommentsAfterSave}
              </div>
            )}
          </FormSection>

          {errorText && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{errorText}</div>
            </div>
          )}
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={handleCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zadAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={uploading || !tytul.trim()}
          submitTitle={t.zadTitleRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface CommentStripProps {
  summary: ZadanieKomentarzPodsumowanie;
  usersByEmail: Map<string, AppUser>;
  userEmail: string;
  t: (typeof translations)['pl'];
  onOpen: () => void;
}

/**
 * The newest comment on a card and how many there are. The whole strip is the button: a click opens the conversation. Tagged
 * people are pills here too, so a comment that names someone reads the same on
 * the card as in the list.
 */
const CommentStrip: React.FC<CommentStripProps> = ({ summary, usersByEmail, userEmail, t, onOpen }) => {
  const k = summary.ostatni;
  const labels = k.mentions.flatMap((email) => {
    const u = usersByEmail.get(email.trim().toLowerCase());
    return u ? [{ label: personLabel(u), me: sameMailbox(u.email, userEmail) }] : [];
  });
  return (
    <button
      type="button"
      className="zad-card__comment"
      title={t.zadCommentOpen}
      // A card is draggable; the strip must not start a drag.
      draggable={false}
      onClick={onOpen}
    >
      <Icon name="message-square" size={13} />
      <span className="zad-card__comment-body">
        <span className="zad-card__comment-text">
          <CommentText text={k.tresc} labels={labels} />
        </span>
      </span>
      {/* No author here: who wrote it is in the details, where the whole list is. */}
      {summary.liczba > 1 && <span className="zad-card__comment-count">{summary.liczba}</span>}
    </button>
  );
};

interface CommentsModalProps {
  language: Language;
  zadanie: Zadanie;
  users: AppUser[];
  userEmail: string;
  /** Put the caret in the box at once — the card's quick "add comment" button. */
  focusComposer: boolean;
  onCommentsChange: (zadanieId: number, komentarze: ZadanieKomentarz[]) => void;
  onClose: () => void;
}

/**
 * A card's conversation on its own, without the rest of the form: what the
 * comment strip and the quick button on the card open.
 */
const ZadanieCommentsModal: React.FC<CommentsModalProps> = ({
  language,
  zadanie,
  users,
  userEmail,
  focusComposer,
  onCommentsChange,
  onClose,
}) => {
  const t = translations[language];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="message-square" title={t.zadComments} subtitle={zadanie.tytul} />
        <div className="modal-body">
          <ZadanieKomentarze
            language={language}
            zadanieId={zadanie.id}
            users={users}
            userEmail={userEmail}
            autoFocus={focusComposer}
            bare
            onChange={onCommentsChange}
          />
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};

interface PreviewModalProps {
  language: Language;
  zadanie: Zadanie;
  spotkanie?: Spotkanie;
  onOpenSpotkanie?: (spotkanie: Spotkanie) => void;
  users: AppUser[];
  userEmail: string;
  onCommentsChange: (zadanieId: number, komentarze: ZadanieKomentarz[]) => void;
  onEdit: () => void;
  onClose: () => void;
}

/**
 * A card to read, not to change: what a clicked notification opens. Everything
 * is shown as text; the way into the form is the "Edytuj" button. The
 * conversation stays live — a comment saves on its own, it is not an edit of
 * the card.
 */
export const ZadaniePreviewModal: React.FC<PreviewModalProps> = ({
  language,
  zadanie: z,
  spotkanie,
  onOpenSpotkanie,
  users,
  userEmail,
  onCommentsChange,
  onEdit,
  onClose,
}) => {
  const t = translations[language];
  const locale = language === 'en' ? 'en' : 'pl';
  const { busyId, download } = useAttachmentDownload(t);
  const statusLabels: Record<ZadanieStatus, string> = {
    todo: t.zadColTodo,
    in_progress: t.zadColInProgress,
    done: t.zadColDone,
  };
  const assignee = z.przypisanyEmail
    ? users.find((u) => sameMailbox(u.email, z.przypisanyEmail))
    : undefined;
  const assigneeText = z.przypisanyEmail
    ? assignee
      ? personLabel(assignee)
      : z.przypisanyEmail
    : t.zadUnassigned;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="clipboard"
          title={z.tytul}
          subtitle={
            <span className="modal-header__meta">
              <span className={`zad-prio zad-prio--${z.priorytet}`}>
                <PriorityMark priorytet={z.priorytet} />
                {priorityLabels(t)[z.priorytet]}
              </span>
              <span className="form-section__badge is-neutral">{statusLabels[z.status]}</span>
              {z.zarchiwizowane && (
                <span className="form-section__badge is-neutral">
                  <Icon name="archive" size={11} /> {t.zadArchivedBadge}
                </span>
              )}
            </span>
          }
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="clipboard" title={t.zadSectionDetails}>
            <dl className="facts">
              <dt>{t.zadFieldAssignee}</dt>
              <dd>{assigneeText}</dd>
              <dt>{t.zadFieldDue}</dt>
              <dd>{z.termin ? formatDayKey(z.termin, locale) : '—'}</dd>
              {spotkanie && (
                <>
                  <dt>{t.zadFieldMeeting}</dt>
                  <dd>
                    <SpotkanieLink spotkanie={spotkanie} t={t} locale={locale} onOpen={onOpenSpotkanie} />
                  </dd>
                </>
              )}
              <dt>{t.zadFieldDescription}</dt>
              <dd className="zad-preview__desc">{z.opis || t.zadPreviewNoDescription}</dd>
            </dl>
          </FormSection>
          {z.zalaczniki.length > 0 && (
            <FormSection icon="paperclip" title={t.zadSectionFiles}>
              <div className="file-list">
                {z.zalaczniki.map((a) => (
                  <div key={a.id} className="file-list__row">
                    <Icon name="paperclip" size={14} />
                    <button
                      type="button"
                      className={`file-list__name file-list__name--link${busyId === a.id ? ' is-busy' : ''}`}
                      title={t.zadAttachDownload}
                      disabled={busyId !== null}
                      onClick={() => void download(a)}
                    >
                      {a.nazwa}
                    </button>
                    <span className="file-list__size">{formatBytes(a.rozmiar)}</span>
                  </div>
                ))}
              </div>
            </FormSection>
          )}
          <FormSection icon="message-square" title={t.zadSectionComments} description={t.zadSectionCommentsDesc}>
            <ZadanieKomentarze
              language={language}
              zadanieId={z.id}
              users={users}
              userEmail={userEmail}
              bare
              onChange={onCommentsChange}
            />
          </FormSection>
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          onSubmit={onEdit}
          submitLabel={t.edit}
          submitIcon="edit"
        />
      </div>
    </div>
  );
};

const PriorityMark: React.FC<{ priorytet: ZadaniePriorytet }> = ({ priorytet }) =>
  priorytet === 'normal' ? (
    <span className="zad-prio-dot zad-prio-dot--normal" aria-hidden="true" />
  ) : (
    <Icon name={priorytet === 'high' ? 'arrow-up' : 'arrow-down'} size={11} />
  );

interface PriorityBadgeProps {
  zadanie: Zadanie;
  t: (typeof translations)['pl'];
  onChange: (priorytet: ZadaniePriorytet) => void;
}

/**
 * A card's priority, and the way to change it: the pill is a button, and a click
 * opens the three choices beside it — the same "click the thing to change it" as
 * the person and the date. The list is drawn on the page body, not inside the
 * card: the columns scroll and would clip it.
 */
const PriorityBadge: React.FC<PriorityBadgeProps> = ({ zadanie: z, t, onChange }) => {
  const labels = priorityLabels(t);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Where the list sits: under the pill, or over it when there is no room below.
  const [at, setAt] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const right = window.innerWidth - rect.right;
    setAt(
      rect.bottom + 130 > window.innerHeight
        ? { bottom: window.innerHeight - rect.top + 4, right }
        : { top: rect.bottom + 4, right }
    );
  };

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // The list is fixed to the screen: once the board scrolls or resizes under it,
    // it would point at nothing.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`zad-prio zad-prio--${z.priorytet} zad-prio--button`}
        title={`${t.zadFieldPriority} — ${t.zadChangePriority}`}
        aria-haspopup="listbox"
        aria-expanded={at !== null}
        // A card is draggable; the pill must not start a drag.
        draggable={false}
        onClick={() => (at ? setAt(null) : open())}
      >
        <PriorityMark priorytet={z.priorytet} />
        {labels[z.priorytet]}
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            className="zad-prio-menu"
            role="listbox"
            aria-label={t.zadFieldPriority}
            style={{ top: at.top, bottom: at.bottom, right: at.right }}
          >
            {ZADANIE_PRIORYTETY.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === z.priorytet}
                className={`zad-prio-menu__item${p === z.priorytet ? ' is-active' : ''}`}
                onClick={() => {
                  setAt(null);
                  if (p !== z.priorytet) onChange(p);
                }}
              >
                <span className={`zad-prio-menu__mark zad-prio--${p}`}>
                  <PriorityMark priorytet={p} />
                </span>
                {labels[p]}
                {p === z.priorytet && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
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
  openRequest = null,
  onOpenSpotkanie,
  onEditSpotkanie,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const { busyId: downloadingId, download: downloadAttachment } = useAttachmentDownload(t);
  const [zadania, setZadania] = useState<Zadanie[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  // Only to name the meeting a card belongs to.
  const [spotkaniaById, setSpotkaniaById] = useState<Map<number, Spotkanie>>(new Map());
  const [spotkaniaTypy, setSpotkaniaTypy] = useState<SpotkanieTyp[]>([]);
  // The meeting a card's link was clicked for, shown to read.
  const [meetingPreview, setMeetingPreview] = useState<Spotkanie | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Three independent questions — whose, which deadlines, how important — so
  // "mine, due today, high priority" is a thing you can ask for.
  const [filter, setFilter] = useState<Filter>({ kind: initialFilter.who });
  const [dueFilter, setDueFilter] = useState<ZadaniaDueFilter>(initialFilter.due);
  const [prioFilter, setPrioFilter] = useState<'all' | ZadaniePriorytet>('all');
  // The archive is a working set of its own, not one more narrowing: the board
  // shows either the live cards or the put-away ones.
  const [showArchived, setShowArchived] = useState(false);
  // The card whose title is being typed over, straight on the board.
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  // Enter and the blur it causes both arrive: only the first one counts.
  const renameSettled = useRef(true);
  // A card opened to read (a clicked notification), apart from the form that edits.
  const [preview, setPreview] = useState<Zadanie | null>(null);
  // null = closed; otherwise the card being edited (null = add) and the column
  // a new card starts in.
  const [formState, setFormState] = useState<{
    editing: Zadanie | null;
    status: ZadanieStatus;
  } | null>(null);
  // What each card shows of its conversation: the count and the newest comment.
  const [summaries, setSummaries] = useState<Map<number, ZadanieKomentarzPodsumowanie>>(new Map());
  // The comments modal: the card, and whether it opened to write (the quick button).
  const [commentsFor, setCommentsFor] = useState<{ zadanie: Zadanie; focus: boolean } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropColumn, setDropColumn] = useState<ZadanieStatus | null>(null);
  // The card the dragged one would land next to, and on which side of it.
  const [dropAt, setDropAt] = useState<{ id: number; after: boolean } | null>(null);

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
    // Apart from the board: a comments table that is missing or slow must leave
    // the cards themselves usable, just without their comment strip.
    try {
      const rows = await window.electronAPI.getZadaniaKomentarzePodsumowanie();
      setSummaries(new Map(rows.map((r) => [r.zadanieId, r])));
    } catch {
      setSummaries(new Map());
    }
    // Same: a calendar that fails to load only costs the cards their meeting link.
    try {
      const [rows, typy] = await Promise.all([
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaTypy(),
      ]);
      setSpotkaniaById(new Map(rows.map((s) => [s.id, s])));
      setSpotkaniaTypy(typy);
    } catch {
      setSpotkaniaById(new Map());
    }
  };

  /** A conversation changed in a modal: the card under it shows the same. */
  const handleCommentsChange = (zadanieId: number, komentarze: ZadanieKomentarz[]) => {
    setSummaries((prev) => {
      const next = new Map(prev);
      const last = komentarze[komentarze.length - 1];
      if (last) next.set(zadanieId, { zadanieId, liczba: komentarze.length, ostatni: last });
      else next.delete(zadanieId);
      return next;
    });
  };

  // A clicked notification: read the board afresh (the card may be newer than
  // what this view loaded) and show the card it was about — to read, not to edit.
  useEffect(() => {
    if (!openRequest) return;
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await window.electronAPI.getZadania();
        if (cancelled) return;
        setZadania(fresh);
        const card = fresh.find((z) => z.id === openRequest.id);
        if (card) setPreview(card);
      } catch {
        if (!cancelled) notify.error(t.zadLoadError);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the request alone: `notify` and `t` change identity without meaning a new request.
  }, [openRequest]);

  const usersByEmail = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of users) map.set(u.email.trim().toLowerCase(), u);
    return map;
  }, [users]);

  const passesWho = (z: Zadanie): boolean => {
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
  };

  const visible = useMemo(
    () =>
      zadania.filter(
        (z) =>
          z.zarchiwizowane === showArchived &&
          passesWho(z) &&
          matchesDue(z, dueFilter, dayKey()) &&
          (prioFilter === 'all' || z.priorytet === prioFilter)
      ),
    [zadania, filter, dueFilter, prioFilter, showArchived, userEmail]
  );

  // The two sizes of the archive switch, and the total the "shown of" line is
  // measured against: the cards of the view being looked at.
  const archiveCounts = useMemo(() => {
    const archived = zadania.filter((z) => z.zarchiwizowane).length;
    return { active: zadania.length - archived, archived };
  }, [zadania]);

  // The number on each chip: how many cards it would show given the OTHER two
  // groups — so a chip says what clicking it yields, not what exists in total.
  const chipCounts = useMemo(() => {
    const day = dayKey();
    const due: Record<Exclude<ZadaniaDueFilter, 'all'>, number> = {
      overdue: 0,
      today: 0,
      upcoming: 0,
      none: 0,
    };
    const prio: Record<ZadaniePriorytet, number> = { high: 0, normal: 0, low: 0 };
    for (const z of zadania) {
      if (z.zarchiwizowane !== showArchived || !passesWho(z)) continue;
      const prioOk = prioFilter === 'all' || z.priorytet === prioFilter;
      if (prioOk) {
        for (const key of Object.keys(due) as (keyof typeof due)[]) {
          if (matchesDue(z, key, day)) due[key] += 1;
        }
      }
      if (matchesDue(z, dueFilter, day)) prio[z.priorytet] += 1;
    }
    return { due, prio };
  }, [zadania, filter, dueFilter, prioFilter, showArchived, userEmail]);

  const filtersActive =
    filter.kind !== 'all' || dueFilter !== 'all' || prioFilter !== 'all' || showArchived;
  const clearFilters = () => {
    setFilter({ kind: 'all' });
    setDueFilter('all');
    setPrioFilter('all');
    setShowArchived(false);
  };

  /**
   * The picker on a card: the people, plus — if the card is held by a mailbox
   * with no account any more — that mailbox, so opening the picker and choosing
   * nobody new cannot silently drop it.
   */
  const assigneeOptionsFor = (current: string | null) => {
    const options = [
      ...(userEmail && !sameMailbox(current, userEmail)
        ? [{ value: ASSIGN_TO_ME, label: t.zadAssignToMe, hint: '' }]
        : []),
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
    patch: Partial<Pick<Zadanie, 'tytul' | 'przypisanyEmail' | 'termin' | 'priorytet'>>
  ) => {
    const next = { ...z, ...patch };
    if (
      next.tytul === z.tytul &&
      next.przypisanyEmail === z.przypisanyEmail &&
      next.termin === z.termin &&
      next.priorytet === z.priorytet
    ) {
      return;
    }
    setZadania((prev) => prev.map((c) => (c.id === z.id ? next : c)));
    try {
      await window.electronAPI.updateZadanie(z.id, {
        tytul: next.tytul,
        opis: next.opis,
        status: next.status,
        priorytet: next.priorytet,
        przypisanyEmail: next.przypisanyEmail,
        termin: next.termin,
        zalaczniki: next.zalaczniki,
        spotkanieId: next.spotkanieId,
      });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
      await load();
    }
  };

  const reassign = (z: Zadanie, email: string) =>
    patchCard(z, { przypisanyEmail: (email === ASSIGN_TO_ME ? userEmail : email) || null });

  const startRename = (z: Zadanie) => {
    renameSettled.current = false;
    setRenaming({ id: z.id, value: z.tytul });
  };

  /** Enter or leaving the box saves (an empty or unchanged title just closes it); Esc drops it. */
  const settleRename = (z: Zadanie, save: boolean) => {
    if (renameSettled.current) return;
    renameSettled.current = true;
    const tytul = (renaming?.id === z.id ? renaming.value : z.tytul).trim();
    setRenaming(null);
    if (save && tytul && tytul !== z.tytul) void patchCard(z, { tytul });
  };

  /** Put a card away, or bring it back. Optimistic, like the other quick edits on a card. */
  const setArchived = async (z: Zadanie, archived: boolean) => {
    setZadania((prev) => prev.map((c) => (c.id === z.id ? { ...c, zarchiwizowane: archived } : c)));
    try {
      await window.electronAPI.archiveZadanie(z.id, archived);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
      await load();
    }
  };

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
  /**
   * Put a card in a column, at a place: `end`
   * (dropped on the empty part of a column) or next to another card. The order is
   * worked out on the WHOLE column, filters or not — a hidden card keeps its
   * place between the visible ones — then shown at once and saved; a failed save
   * puts the board back to what the database says.
   */
  const placeCard = async (
    id: number,
    status: ZadanieStatus,
    place: 'end' | { id: number; after: boolean }
  ) => {
    const card = zadania.find((z) => z.id === id);
    if (!card) return;
    const before = zadania
      .filter((z) => z.status === card.status)
      .sort(compareZadaniaOrder)
      .map((z) => z.id);
    const others = zadania
      .filter((z) => z.status === status && z.id !== id)
      .sort(compareZadaniaOrder);

    let index = others.length;
    if (place !== 'end') {
      const at = others.findIndex((z) => z.id === place.id);
      if (at >= 0) index = place.after ? at + 1 : at;
    }
    const ordered = [...others.slice(0, index), card, ...others.slice(index)];
    const orderedIds = ordered.map((z) => z.id);

    // Dropped back exactly where it was: nothing to say to the database.
    if (
      card.status === status &&
      before.length === orderedIds.length &&
      before.every((v, i) => v === orderedIds[i])
    ) {
      return;
    }

    const place1 = new Map(orderedIds.map((cardId, i) => [cardId, i + 1] as const));
    setZadania((prev) =>
      prev.map((z) => {
        if (z.id === id) return { ...z, status, pozycja: place1.get(z.id) ?? z.pozycja };
        return place1.has(z.id) ? { ...z, pozycja: place1.get(z.id)! } : z;
      })
    );
    try {
      await window.electronAPI.moveZadanie(id, status, orderedIds);
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

  interface SegOption {
    key: string;
    label: string;
    active: boolean;
    onClick: () => void;
    /** How many cards the option would show; omitted where a count means nothing. */
    count?: number;
    /** A coloured dot before the label (the priorities). */
    dot?: ZadaniePriorytet;
  }

  const seg = (label: string, options: SegOption[]) => (
    <div className="zad-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`zad-seg__btn${o.active ? ' is-active' : ''}${o.count === 0 ? ' is-empty' : ''}`}
          aria-pressed={o.active}
          onClick={o.onClick}
        >
          {o.dot && <span className={`zad-prio-dot zad-prio-dot--${o.dot}`} aria-hidden="true" />}
          {o.label}
          {o.count !== undefined && <span className="zad-seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );

  const prioNames = priorityLabels(t);

  return (
    <div className="content-body">
      <div className="zad-head">
        <div>
          <h2 className="page-hero__title">{t.zadTitle}</h2>
          <p className="page-hero__text">{t.zadHint}</p>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setError(null);
            setFormState({ editing: null, status: 'todo' });
          }}
        >
          <Icon name="plus" size={14} /> {t.zadAdd}
        </button>
      </div>

      <div className="zad-filterbar" role="group" aria-label={t.zadFilterLabel}>
        <div className="zad-filterbar__grid">
        <div className="zad-fgroup">
          <span className="zad-fgroup__label">
            <Icon name="users" size={13} /> {t.zadFilterGroupWho}
          </span>
          <div className="zad-fgroup__controls">
            {seg(t.zadFilterGroupWho, [
              {
                key: 'all',
                label: t.zadFilterAll,
                active: filter.kind === 'all',
                onClick: () => setFilter({ kind: 'all' }),
              },
              {
                key: 'mine',
                label: t.zadFilterMine,
                active: filter.kind === 'mine',
                onClick: () => setFilter({ kind: 'mine' }),
              },
              {
                key: 'none',
                label: t.zadUnassigned,
                active: filter.kind === 'none',
                onClick: () => setFilter({ kind: 'none' }),
              },
            ])}
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
        </div>

        <div className="zad-fgroup">
          <span className="zad-fgroup__label">
            <Icon name="calendar" size={13} /> {t.zadFilterGroupDue}
          </span>
          {seg(t.zadFilterGroupDue, [
            {
              key: 'all',
              label: t.zadFilterAll,
              active: dueFilter === 'all',
              onClick: () => setDueFilter('all'),
            },
            {
              key: 'overdue',
              label: t.zadFilterOverdue,
              active: dueFilter === 'overdue',
              count: chipCounts.due.overdue,
              onClick: () => setDueFilter(dueFilter === 'overdue' ? 'all' : 'overdue'),
            },
            {
              key: 'today',
              label: t.zadFilterToday,
              active: dueFilter === 'today',
              count: chipCounts.due.today,
              onClick: () => setDueFilter(dueFilter === 'today' ? 'all' : 'today'),
            },
            {
              key: 'upcoming',
              label: t.zadFilterUpcoming,
              active: dueFilter === 'upcoming',
              count: chipCounts.due.upcoming,
              onClick: () => setDueFilter(dueFilter === 'upcoming' ? 'all' : 'upcoming'),
            },
            {
              key: 'none',
              label: t.zadFilterNoDue,
              active: dueFilter === 'none',
              count: chipCounts.due.none,
              onClick: () => setDueFilter(dueFilter === 'none' ? 'all' : 'none'),
            },
          ])}
        </div>

        <div className="zad-fgroup">
          <span className="zad-fgroup__label">
            <Icon name="flag" size={13} /> {t.zadFilterGroupPrio}
          </span>
          {seg(t.zadFilterGroupPrio, [
            {
              key: 'all',
              label: t.zadFilterAll,
              active: prioFilter === 'all',
              onClick: () => setPrioFilter('all'),
            },
            ...ZADANIE_PRIORYTETY.map(
              (p): SegOption => ({
                key: p,
                label: prioNames[p],
                dot: p,
                active: prioFilter === p,
                count: chipCounts.prio[p],
                onClick: () => setPrioFilter(prioFilter === p ? 'all' : p),
              })
            ),
          ])}
        </div>

        <div className="zad-fgroup">
          <span className="zad-fgroup__label">
            <Icon name="archive" size={13} /> {t.zadFilterGroupArchive}
          </span>
          {seg(t.zadFilterGroupArchive, [
            {
              key: 'active',
              label: t.zadFilterActive,
              active: !showArchived,
              count: archiveCounts.active,
              onClick: () => setShowArchived(false),
            },
            {
              key: 'archived',
              label: t.zadFilterArchived,
              active: showArchived,
              count: archiveCounts.archived,
              onClick: () => setShowArchived(true),
            },
          ])}
        </div>

        </div>

        {filtersActive && (
          <div className="zad-filterbar__result">
            <span>
              {t.zadFilterShown
                .replace('{shown}', String(visible.length))
                .replace('{total}', String(showArchived ? archiveCounts.archived : archiveCounts.active))}
            </span>
            <button type="button" className="zad-filterbar__clear" onClick={clearFilters}>
              <Icon name="x" size={12} /> {t.zadFilterClear}
            </button>
          </div>
        )}
      </div>

      {/* Pinned notes: remarks for the whole board, right under the filters. */}
      <ZadaniaNotatki language={language} users={users} userEmail={userEmail} />

      <div className="zad-board">
        {columns.map((col) => {
          // The order somebody dragged them into; cards never placed keep the old one
          // (latest change on top).
          const cards = visible
            .filter((z) => z.status === col.status)
            .sort(compareZadaniaOrder);
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
                  setDropAt(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId;
                // Only a card of THIS column counts as a place to drop next to; the gaps
                // between cards keep the last one hovered, so a drop there is not "end".
                const at = dropAt && cards.some((z) => z.id === dropAt.id) ? dropAt : null;
                setDragId(null);
                setDropColumn(null);
                setDropAt(null);
                if (id !== null) void placeCard(id, col.status, at ?? 'end');
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
                      className={`zad-card${dragId === z.id ? ' is-dragging' : ''}${z.priorytet === 'high' ? ' zad-card--high' : ''}${
                        dropAt?.id === z.id && dragId !== z.id
                          ? dropAt.after
                            ? ' is-drop-after'
                            : ' is-drop-before'
                          : ''
                      }`}
                      draggable
                      // A click on the card itself reads it. Buttons, inputs and the
                      // pickers keep their own clicks, and a click inside a menu drawn
                      // on the page body (a portal) reaches here through React but is
                      // not inside the card, so it is not a click on the card.
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (!e.currentTarget.contains(target)) return;
                        if (target.closest('button, input, select, textarea, a, .zad-who-select')) return;
                        // The title is edited where it stands, on one click — the
                        // rest of the card opens it to read.
                        if (target.closest('.zad-card__title--editable')) {
                          startRename(z);
                        } else {
                          setPreview(z);
                        }
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        // Some engines refuse a drag that carries no payload.
                        e.dataTransfer.setData('text/plain', String(z.id));
                        setDragId(z.id);
                      }}
                      onDragOver={(e) => {
                        if (dragId === null || dragId === z.id) return;
                        e.preventDefault();
                        // Upper half = before this card, lower half = after it.
                        const rect = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > rect.top + rect.height / 2;
                        setDropAt((prev) =>
                          prev?.id === z.id && prev.after === after ? prev : { id: z.id, after }
                        );
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropColumn(null);
                        setDropAt(null);
                      }}
                    >
                      <div className="zad-card__head">
                        {/* What the task is, read top-down: title, its meeting,
                            its description — beside the corner, not under it. */}
                        <div className="zad-card__main">
                        {renaming?.id === z.id ? (
                          <input
                            className="zad-card__title-input"
                            type="text"
                            autoFocus
                            // A card is draggable; the box must not start a drag.
                            draggable={false}
                            value={renaming.value}
                            aria-label={t.zadFieldTitle}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setRenaming({ id: z.id, value: e.target.value })}
                            onBlur={() => settleRename(z, true)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                settleRename(z, true);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                settleRename(z, false);
                              }
                            }}
                          />
                        ) : (
                          <div
                            className="zad-card__title zad-card__title--editable"
                            title={t.zadRenameTitle}
                          >
                            {z.tytul}
                          </div>
                        )}
                        {z.spotkanieId !== null && (
                          <SpotkanieLink
                            spotkanie={spotkaniaById.get(z.spotkanieId)}
                            t={t}
                            locale={locale}
                            onOpen={setMeetingPreview}
                          />
                        )}
                        {z.opis && <div className="zad-card__desc">{z.opis}</div>}
                        </div>
                        {/* Top right, where the eye goes to ask "when?". Clicking it
                            opens the date picker; on a card with no date there is
                            a faint "add" in the same spot, shown on hover. */}
                        <div className="zad-card__side">
                          <DueBadge
                            zadanie={z}
                            today={today}
                            locale={locale}
                            t={t}
                            onChange={(termin) => void patchCard(z, { termin })}
                          />
                          {/* Under the date, the same size as it. Click to change. */}
                          <PriorityBadge
                            zadanie={z}
                            t={t}
                            onChange={(priorytet) => void patchCard(z, { priorytet })}
                          />
                        </div>
                      </div>
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
                      {summaries.get(z.id) && (
                        <CommentStrip
                          summary={summaries.get(z.id)!}
                          usersByEmail={usersByEmail}
                          userEmail={userEmail}
                          t={t}
                          onOpen={() => setCommentsFor({ zadanie: z, focus: false })}
                        />
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
                          {/* Two shortcuts that disappear once they have nothing to do. */}
                          {z.termin !== today && (
                            <button
                              type="button"
                              className="zad-icon-btn"
                              title={t.zadDueSetToday}
                              aria-label={t.zadDueSetToday}
                              onClick={() => void patchCard(z, { termin: today })}
                            >
                              <Icon name="clock" size={14} />
                            </button>
                          )}
                          {!sameMailbox(z.przypisanyEmail, userEmail) && (
                            <button
                              type="button"
                              className="zad-icon-btn"
                              title={t.zadAssignToMe}
                              aria-label={t.zadAssignToMe}
                              onClick={() => void reassign(z, userEmail)}
                            >
                              <Icon name="user-plus" size={14} />
                            </button>
                          )}
                          {/* Always there, even on a card with no comments yet. */}
                          <button
                            type="button"
                            className="zad-icon-btn"
                            title={t.zadCommentAddQuick}
                            aria-label={t.zadCommentAddQuick}
                            onClick={() => setCommentsFor({ zadanie: z, focus: true })}
                          >
                            <Icon name="message-square" size={14} />
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
                            className="zad-icon-btn"
                            title={z.zarchiwizowane ? t.zadUnarchive : t.zadArchive}
                            aria-label={z.zarchiwizowane ? t.zadUnarchive : t.zadArchive}
                            onClick={() => void setArchived(z, !z.zarchiwizowane)}
                          >
                            <Icon name={z.zarchiwizowane ? 'undo' : 'archive'} size={14} />
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
          key={formState.editing?.id ?? 'new'}
          language={language}
          editing={formState.editing}
          initialStatus={formState.status}
          users={users}
          userEmail={userEmail}
          onCommentsChange={handleCommentsChange}
          isSaving={isSaving}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => setFormState(null)}
        />
      )}

      {preview && (
        <ZadaniePreviewModal
          key={preview.id}
          language={language}
          zadanie={preview}
          spotkanie={
            preview.spotkanieId !== null ? spotkaniaById.get(preview.spotkanieId) : undefined
          }
          onOpenSpotkanie={(s) => {
            setPreview(null);
            setMeetingPreview(s);
          }}
          users={users}
          userEmail={userEmail}
          onCommentsChange={handleCommentsChange}
          onEdit={() => {
            setError(null);
            setFormState({ editing: preview, status: preview.status });
            setPreview(null);
          }}
          onClose={() => setPreview(null)}
        />
      )}

      {meetingPreview && (
        <SpotkaniePreviewModal
          key={meetingPreview.id}
          language={language}
          spotkanie={meetingPreview}
          typ={spotkaniaTypy.find((typ) => typ.id === meetingPreview.typId) ?? null}
          onShowInCalendar={
            onOpenSpotkanie
              ? () => {
                  setMeetingPreview(null);
                  onOpenSpotkanie(meetingPreview);
                }
              : undefined
          }
          onEdit={
            onEditSpotkanie
              ? () => {
                  setMeetingPreview(null);
                  onEditSpotkanie(meetingPreview);
                }
              : undefined
          }
          onClose={() => setMeetingPreview(null)}
        />
      )}

      {commentsFor && (
        <ZadanieCommentsModal
          key={commentsFor.zadanie.id}
          language={language}
          zadanie={commentsFor.zadanie}
          users={users}
          userEmail={userEmail}
          focusComposer={commentsFor.focus}
          onCommentsChange={handleCommentsChange}
          onClose={() => setCommentsFor(null)}
        />
      )}
    </div>
  );
};

export default Zadania;
