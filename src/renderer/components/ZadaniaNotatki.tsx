import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, ZadanieNotatka, ZADANIE_NOTATKA_MAX_LENGTH } from '../../shared/types';
import { personColor, personLabel } from '../../shared/app-users';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';

interface Props {
  language: Language;
  users: AppUser[];
  /** The signed-in mailbox — whose notes carry a delete button. */
  userEmail: string;
}

/** Re-read now and then, so a note pinned by someone else shows up without a reload. */
const REFRESH_MS = 60_000;
const COLLAPSED_KEY = 'zadania-notatki-collapsed';

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase() && (a ?? '').trim() !== '';

/** Whether this viewer folded the strip. A per-person convenience: storage may be unavailable. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Notes pinned to the Zadania view, under the filters: remarks for the whole
 * board rather than for one card. Shaped like comments — a text, its author and
 * when — in the amber of a note in Księgowania. Anyone can pin one; only the
 * author can take it down.
 */
const ZadaniaNotatki: React.FC<Props> = ({ language, users, userEmail }) => {
  const t = translations[language];
  const notify = useNotify();
  const [notatki, setNotatki] = useState<ZadanieNotatka[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  // The note being reworded, and the text in its box.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editBox = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const usersByEmail = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of users) map.set(u.email.trim().toLowerCase(), u);
    return map;
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.electronAPI.getZadaniaNotatki();
        if (cancelled) return;
        setNotatki(rows);
        setLoadFailed(false);
      } catch {
        // A failed background refresh keeps what is on screen.
        if (!cancelled) setLoadFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (adding) box.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId !== null) editBox.current?.focus();
  }, [editingId]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* the fold just does not survive a restart */
    }
  };

  const save = async () => {
    const tresc = draft.trim();
    if (!tresc || saving) return;
    setSaving(true);
    try {
      const created = await window.electronAPI.addZadanieNotatka(tresc);
      setNotatki((prev) => [created, ...prev]);
      setDraft('');
      setAdding(false);
      // A note pinned into a folded strip would be invisible: show it.
      if (collapsed) toggleCollapsed();
    } catch {
      notify.error(t.zadNoteSaveError);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    const id = editingId;
    const tresc = editDraft.trim();
    if (id === null || !tresc || saving) return;
    setSaving(true);
    try {
      const done = await window.electronAPI.updateZadanieNotatka(id, tresc);
      if (!done) throw new Error('refused');
      setNotatki((prev) => prev.map((n) => (n.id === id ? { ...n, tresc } : n)));
      setEditingId(null);
    } catch {
      notify.error(t.zadNoteSaveError);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    setConfirmId(null);
    try {
      await window.electronAPI.deleteZadanieNotatka(id);
      setNotatki((prev) => prev.filter((n) => n.id !== id));
    } catch {
      notify.error(t.zadNoteDeleteError);
    }
  };

  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const tooLong = draft.length > ZADANIE_NOTATKA_MAX_LENGTH;
  const hasNotes = notatki.length > 0;

  return (
    <section className="zad-notes" aria-label={t.zadNotes}>
      <div className="zad-notes__head">
        <button
          type="button"
          className="zad-notes__title"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? t.zadNotesExpand : t.zadNotesCollapse}
          disabled={!hasNotes}
        >
          <Icon name="pin" size={14} />
          {t.zadNotes}
          {hasNotes && <span className="zad-notes__count">{notatki.length}</span>}
          {hasNotes && (
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={13} />
          )}
        </button>
        {/* Rarely used, so a small "+" beside the heading, not a labelled button. */}
        {!adding && (
          <button
            type="button"
            className="zad-icon-btn zad-notes__add"
            onClick={() => setAdding(true)}
            title={t.zadNoteAdd}
            aria-label={t.zadNoteAdd}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>

      {loadFailed && !hasNotes && <div className="zad-notes__error">{t.zadNoteLoadError}</div>}

      {adding && (
        <div className="zad-notes__form">
          <textarea
            ref={box}
            value={draft}
            rows={3}
            placeholder={t.zadNotePlaceholder}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
          />
          <div className="zad-notes__form-actions">
            <span className={`zad-upload__hint${tooLong ? ' zad-comments__hint--error' : ''}`}>
              {draft.length > ZADANIE_NOTATKA_MAX_LENGTH * 0.9
                ? `${draft.length}/${ZADANIE_NOTATKA_MAX_LENGTH}`
                : t.zadNoteHint}
            </span>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => {
                setAdding(false);
                setDraft('');
              }}
              disabled={saving}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => void save()}
              disabled={saving || !draft.trim() || tooLong}
            >
              <Icon name="pin" size={13} /> {t.zadNoteSave}
            </button>
          </div>
        </div>
      )}

      {hasNotes && !collapsed && (
        <div className="zad-notes__list">
          {notatki.map((n) => {
            const author = usersByEmail.get(n.autorEmail.trim().toLowerCase());
            const mine = same(n.autorEmail, userEmail);
            const editing = editingId === n.id;
            const editTooLong = editDraft.length > ZADANIE_NOTATKA_MAX_LENGTH;
            return (
              <article key={n.id} className={`zad-note${editing ? ' is-editing' : ''}`}>
                {editing ? (
                  <>
                    <textarea
                      ref={editBox}
                      value={editDraft}
                      rows={3}
                      disabled={saving}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void saveEdit();
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                              />
                    <div className="zad-notes__form-actions">
                      <span
                        className={`zad-upload__hint${editTooLong ? ' zad-comments__hint--error' : ''}`}
                      >
                        {editDraft.length > ZADANIE_NOTATKA_MAX_LENGTH * 0.9
                          ? `${editDraft.length}/${ZADANIE_NOTATKA_MAX_LENGTH}`
                          : t.zadNoteHint}
                      </span>
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={() => void saveEdit()}
                        disabled={saving || !editDraft.trim() || editTooLong}
                      >
                        <Icon name="save" size={13} /> {t.save}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="zad-note__text">{n.tresc}</p>
                    <footer className="zad-note__meta">
                      <span className="zad-note__who">
                        {/* The person's colour bead, as on a card and in a comment. */}
                        <span
                          className={`zad-avatar${author ? '' : ' zad-avatar--none'}`}
                          style={
                            author ? { ['--avatar' as string]: personColor(author) } : undefined
                          }
                          aria-hidden="true"
                        />
                        <span className="zad-note__author">
                          {author ? personLabel(author) : n.autorEmail}
                        </span>
                      </span>
                      <span className="zad-note__time">{formatWhen(n.createdAt)}</span>
                    </footer>
                    {mine &&
                      (confirmId === n.id ? (
                        <span className="zad-comment__confirm zad-note__confirm">
                          {t.zadNoteDeleteConfirm}
                          <button
                            type="button"
                            className="zad-comment__link zad-comment__link--danger"
                            onClick={() => void remove(n.id)}
                          >
                            {t.zadCommentDeleteYes}
                          </button>
                          <button
                            type="button"
                            className="zad-comment__link"
                            onClick={() => setConfirmId(null)}
                          >
                            {t.cancel}
                          </button>
                        </span>
                      ) : (
                        <span className="zad-note__actions">
                          <button
                            type="button"
                            className="zad-icon-btn"
                            title={t.edit}
                            aria-label={t.edit}
                            onClick={() => {
                              setConfirmId(null);
                              setEditDraft(n.tresc);
                              setEditingId(n.id);
                            }}
                          >
                            <Icon name="edit" size={13} />
                          </button>
                          <button
                            type="button"
                            className="zad-icon-btn zad-icon-btn--danger"
                            title={t.zadNoteDelete}
                            aria-label={t.zadNoteDelete}
                            onClick={() => setConfirmId(n.id)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      ))}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ZadaniaNotatki;
