import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, ZadanieKomentarz, ZADANIE_KOMENTARZ_MAX_LENGTH } from '../../shared/types';
import { personColor, personLabel } from '../../shared/app-users';
import { MentionEditor, MentionEditorHandle, MentionText } from './MentionEditor';
import { translations, Language } from '../translations';
import { pollWhileVisible } from '../hooks/pollWhileVisible';
import { useNotify } from './Notifications';
import Icon from './Icon';

interface Props {
  language: Language;
  zadanieId: number;
  users: AppUser[];
  /** The signed-in mailbox — whose comments carry a delete button, and who is never offered as a tag. */
  userEmail: string;
  /** Put the caret in the comment box as soon as it opens (the quick "add comment" button). */
  autoFocus?: boolean;
  /** Without its own title and divider — for a modal that already says "Komentarze". */
  bare?: boolean;
  /** The conversation changed (loaded, added to, trimmed): the board refreshes its card from it. */
  onChange?: (zadanieId: number, komentarze: ZadanieKomentarz[]) => void;
}

/** Comments re-read while the card is open, so a reply shows up without reopening it. */
const REFRESH_MS = 30_000;
const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase() && (a ?? '').trim() !== '';

/** The comment's text with its tags as pills — kept under its old name for the board. */
export const CommentText = MentionText;

const ZadanieKomentarze: React.FC<Props> = ({
  language,
  zadanieId,
  users,
  userEmail,
  autoFocus = false,
  bare = false,
  onChange,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [komentarze, setKomentarze] = useState<ZadanieKomentarz[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draftLength, setDraftLength] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const editor = useRef<MentionEditorHandle>(null);
  const list = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const usersByEmail = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of users) map.set(u.email.trim().toLowerCase(), u);
    return map;
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    const load = async (first: boolean) => {
      try {
        const rows = await window.electronAPI.getZadanieKomentarze(zadanieId);
        if (cancelled) return;
        // Only a longer conversation scrolls the list down — a refresh that found
        // nothing new must not yank it away from what is being read.
        setKomentarze((prev) => {
          if (rows.length > prev.length) stickToEnd.current = true;
          return rows;
        });
        setLoaded(true);
        setLoadFailed(false);
      } catch {
        // A failed background refresh keeps what is on screen; only the first
        // load has nothing to fall back on.
        if (!cancelled && first) setLoadFailed(true);
      } finally {
        if (!cancelled && first) setIsLoading(false);
      }
    };
    void load(true);
    // Paused while the window is hidden; refreshed the moment it is back.
    const stopPolling = pollWhileVisible(() => void load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [zadanieId]);

  // Tell the board, so the card under the modal shows the same last comment.
  // Held back until the first read: an empty list that has not loaded yet is not
  // "no comments".
  useEffect(() => {
    if (loaded) onChangeRef.current?.(zadanieId, komentarze);
  }, [komentarze, loaded, zadanieId]);

  useEffect(() => {
    if (stickToEnd.current && list.current) {
      list.current.scrollTop = list.current.scrollHeight;
      stickToEnd.current = false;
    }
  }, [komentarze]);

  const send = async () => {
    const box = editor.current;
    if (!box || isSending) return;
    const { text, mentions } = box.value();
    const tresc = text.trim();
    if (!tresc || tresc.length > ZADANIE_KOMENTARZ_MAX_LENGTH) return;
    setIsSending(true);
    try {
      const created = await window.electronAPI.addZadanieKomentarz({ zadanieId, tresc, mentions });
      stickToEnd.current = true;
      setKomentarze((prev) => [...prev, created]);
      box.clear();
    } catch {
      notify.error(t.zadCommentSendError);
    } finally {
      setIsSending(false);
    }
  };

  const remove = async (id: number) => {
    setConfirmId(null);
    try {
      await window.electronAPI.deleteZadanieKomentarz(id);
      setKomentarze((prev) => prev.filter((k) => k.id !== id));
    } catch {
      notify.error(t.zadCommentDeleteError);
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

  const tooLong = draftLength > ZADANIE_KOMENTARZ_MAX_LENGTH;

  return (
    <div className={`zad-comments${bare ? ' zad-comments--bare' : ''}`}>
      {!bare && (
        <div className="zad-comments__title">
          {t.zadComments}
          {komentarze.length > 0 && <span className="zad-comments__count">{komentarze.length}</span>}
        </div>
      )}

      <div className="zad-comments__list" ref={list}>
        {isLoading ? (
          <div className="zad-comments__empty">
            <span className="loader-spinner zad-upload__spinner" />
          </div>
        ) : loadFailed ? (
          <div className="zad-comments__empty zad-comments__empty--error">{t.zadCommentLoadError}</div>
        ) : komentarze.length === 0 ? (
          <div className="zad-comments__empty">{t.zadCommentsEmpty}</div>
        ) : (
          komentarze.map((k) => {
            const author = usersByEmail.get(k.autorEmail.trim().toLowerCase());
            const mine = same(k.autorEmail, userEmail);
            const labels = k.mentions.flatMap((email) => {
              const u = usersByEmail.get(email.trim().toLowerCase());
              return u ? [{ label: personLabel(u), me: same(u.email, userEmail) }] : [];
            });
            return (
              <div key={k.id} className="zad-comment">
                {/* The person's colour bead, as on the card — not initials. */}
                <span
                  className={`zad-avatar zad-comment__avatar${author ? '' : ' zad-avatar--none'}`}
                  style={author ? { ['--avatar' as string]: personColor(author) } : undefined}
                  aria-hidden="true"
                />
                <div className="zad-comment__main">
                  <div className="zad-comment__meta">
                    <span className="zad-comment__author">
                      {author ? personLabel(author) : k.autorEmail}
                    </span>
                    <span className="zad-comment__time">{formatWhen(k.createdAt)}</span>
                    {mine &&
                      (confirmId === k.id ? (
                        <span className="zad-comment__confirm">
                          {t.zadCommentDeleteConfirm}
                          <button
                            type="button"
                            className="zad-comment__link zad-comment__link--danger"
                            onClick={() => void remove(k.id)}
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
                        <button
                          type="button"
                          className="zad-icon-btn zad-icon-btn--danger zad-comment__delete"
                          data-tip={t.zadCommentDelete}
                          aria-label={t.zadCommentDelete}
                          onClick={() => setConfirmId(k.id)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      ))}
                  </div>
                  <div className="zad-comment__text">
                    <MentionText text={k.tresc} labels={labels} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="zad-comments__compose">
        <MentionEditor
          ref={editor}
          users={users}
          userEmail={userEmail}
          placeholder={t.zadCommentPlaceholder}
          ariaLabel={t.zadComments}
          noMatchLabel={t.zadNoPersonFound}
          disabled={isSending}
          autoFocus={autoFocus}
          onLengthChange={setDraftLength}
          onSubmit={() => void send()}
        />
        <div className="zad-comments__actions">
          <span className={`zad-upload__hint${tooLong ? ' zad-comments__hint--error' : ''}`}>
            {draftLength > ZADANIE_KOMENTARZ_MAX_LENGTH * 0.9
              ? `${draftLength}/${ZADANIE_KOMENTARZ_MAX_LENGTH}`
              : t.zadCommentHint}
          </span>
          <button
            type="button"
            className="button button-primary button-small"
            onClick={() => void send()}
            disabled={isSending || draftLength === 0 || tooLong}
          >
            <Icon name="mail" size={13} /> {t.zadCommentSend}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZadanieKomentarze;
