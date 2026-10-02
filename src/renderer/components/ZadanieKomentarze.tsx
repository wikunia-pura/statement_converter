import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, ZadanieKomentarz, ZADANIE_KOMENTARZ_MAX_LENGTH } from '../../shared/types';
import { comparePeople, personColor, personLabel } from '../../shared/app-users';
import { translations, Language } from '../translations';
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
const MAX_SUGGESTIONS = 6;

/** Separates a pill from the text after it, so the caret has somewhere to stand. */
const AFTER_PILL = ' ';

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase() && (a ?? '').trim() !== '';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case- and diacritic-blind, so "lukasz" finds "Łukasz". */
const fold = (value: string): string =>
  value
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * `@Name` as a whole word: preceded by the start or a space/bracket, and not
 * followed by more letters (so "@Jan" does not match inside "@Janina").
 */
function mentionRegex(labels: string[]): RegExp | null {
  const sorted = [...labels].filter(Boolean).sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  return new RegExp(`(^|[\\s(])(@(?:${sorted.map(escapeRegExp).join('|')}))(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * A tag as a pill — the look of the dynamic fields in the mailing editors
 * (`.ff-chip`), so the two places that put people or fields into text read alike.
 */
function buildPill(user: AppUser): HTMLElement {
  const label = personLabel(user);
  const el = document.createElement('span');
  el.className = 'ff-chip zad-pill';
  el.setAttribute('data-mention', user.email.trim().toLowerCase());
  el.setAttribute('data-label', label);
  // One atom, like a mailing pill: the caret cannot land inside it and Backspace
  // takes the whole tag. Built from `textContent`, so a name cannot inject markup.
  el.contentEditable = 'false';
  el.textContent = `@${label}`;
  return el;
}

interface Serialized {
  text: string;
  /** Mailboxes of the pills — the tags themselves, not a guess from the text. */
  mentions: string[];
}

/** The box as it is stored: pills as "@Name" in the text, their mailboxes aside. */
function serialize(root: HTMLElement): Serialized {
  let text = '';
  const mentions = new Set<string>();
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
      } else if (child instanceof HTMLElement) {
        const mention = child.getAttribute('data-mention');
        if (mention) {
          text += `@${child.getAttribute('data-label') ?? ''}`;
          mentions.add(mention);
        } else if (child.tagName === 'BR') {
          text += '\n';
        } else {
          // A block the browser opened on Enter: it starts a new line.
          if (text && !text.endsWith('\n')) text += '\n';
          walk(child);
        }
      }
    }
  };
  walk(root);
  return { text: text.replace(/[ ​]/g, (c) => (c === ' ' ? ' ' : '')), mentions: [...mentions] };
}

interface TextProps {
  text: string;
  /** Labels of the people the comment tags, to show as pills. */
  labels: { label: string; me: boolean }[];
}

/** The comment's text with its tags as pills — plain text otherwise, never HTML. */
export const CommentText: React.FC<TextProps> = ({ text, labels }) => {
  const re = mentionRegex(labels.map((l) => l.label));
  if (!re) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1].length;
    if (start > last) parts.push(text.slice(last, start));
    const tag = match[2];
    const mine = labels.some((l) => l.me && `@${l.label}`.toLowerCase() === tag.toLowerCase());
    parts.push(
      <span key={start} className={`ff-chip zad-pill zad-pill--static${mine ? ' zad-pill--me' : ''}`}>
        {tag}
      </span>,
    );
    last = start + tag.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

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
  // An open "@…" under the caret: what has been typed after it.
  const [suggest, setSuggest] = useState<{ query: string } | null>(null);
  const [active, setActive] = useState(0);
  const editor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  // Where the "@query" sits in the box — a text node and the span of the query in it.
  const mentionSpan = useRef<{ node: Text; start: number; end: number } | null>(null);
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
    const timer = setInterval(() => void load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
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

  useEffect(() => {
    if (autoFocus) editor.current?.focus();
  }, [autoFocus]);

  const candidates = useMemo(() => {
    if (!suggest) return [];
    const q = fold(suggest.query);
    return [...users]
      .filter((u) => !same(u.email, userEmail))
      .filter((u) => q === '' || fold(`${personLabel(u)} ${u.email}`).includes(q))
      .sort(comparePeople)
      .slice(0, MAX_SUGGESTIONS);
  }, [suggest, users, userEmail]);

  /** Keep the length counter and the placeholder in step with what is in the box. */
  const sync = () => {
    const el = editor.current;
    if (!el) return;
    const { text } = serialize(el);
    // A browser leaves a stray <br> in an emptied box, which hides the
    // placeholder (`:empty`) — a box with nothing in it is made really empty.
    if (!text.trim() && el.innerHTML !== '') el.innerHTML = '';
    setDraftLength(text.trim().length);
  };

  /** Is the caret right after an "@word"? Opens or closes the list of people. */
  const updateSuggest = () => {
    const el = editor.current;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!el || !sel || !sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      mentionSpan.current = null;
      setSuggest(null);
      return;
    }
    const before = (node.textContent ?? '').slice(0, sel.anchorOffset);
    const m = /(^|[\s ​])@([^\s@ ]{0,30})$/.exec(before);
    if (!m) {
      mentionSpan.current = null;
      setSuggest(null);
      return;
    }
    mentionSpan.current = {
      node: node as Text,
      start: sel.anchorOffset - m[2].length - 1,
      end: sel.anchorOffset,
    };
    setSuggest((prev) => {
      if (prev?.query === m[2]) return prev;
      setActive(0);
      return { query: m[2] };
    });
  };

  const pick = (user: AppUser) => {
    const span = mentionSpan.current;
    const el = editor.current;
    if (!span || !el || !el.contains(span.node)) return;
    const range = document.createRange();
    range.setStart(span.node, span.start);
    range.setEnd(span.node, span.end);
    range.deleteContents();
    // `insertNode` puts each at the start of the range, so the space goes first
    // and the pill in front of it.
    const space = document.createTextNode(AFTER_PILL);
    range.insertNode(space);
    range.insertNode(buildPill(user));
    const caret = document.createRange();
    caret.setStart(space, space.length);
    caret.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caret);
    el.focus();
    mentionSpan.current = null;
    setSuggest(null);
    sync();
  };

  const send = async () => {
    const el = editor.current;
    if (!el || isSending) return;
    const { text, mentions } = serialize(el);
    const tresc = text.trim();
    if (!tresc || tresc.length > ZADANIE_KOMENTARZ_MAX_LENGTH) return;
    setIsSending(true);
    try {
      const created = await window.electronAPI.addZadanieKomentarz({ zadanieId, tresc, mentions });
      stickToEnd.current = true;
      setKomentarze((prev) => [...prev, created]);
      el.innerHTML = '';
      setDraftLength(0);
      setSuggest(null);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (suggest && candidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[Math.min(active, candidates.length - 1)]);
        return;
      }
    }
    if (suggest && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setSuggest(null);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Ctrl/Cmd+Enter sends; a plain Enter is a line break, as in a text box.
      if (e.ctrlKey || e.metaKey) void send();
      else document.execCommand('insertLineBreak');
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
                          title={t.zadCommentDelete}
                          aria-label={t.zadCommentDelete}
                          onClick={() => setConfirmId(k.id)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      ))}
                  </div>
                  <div className="zad-comment__text">
                    <CommentText text={k.tresc} labels={labels} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="zad-comments__compose">
        {/* A contenteditable, not a textarea: a textarea cannot hold a pill. React
            renders it empty and never touches what the person (or `pick`) puts in. */}
        <div
          ref={editor}
          className="zad-editor"
          role="textbox"
          aria-multiline="true"
          aria-label={t.zadComments}
          data-placeholder={t.zadCommentPlaceholder}
          contentEditable={!isSending}
          suppressContentEditableWarning
          onInput={() => {
            sync();
            updateSuggest();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            // The caret moved without typing (arrows, Home/End): the list follows it —
            // except the arrows that are choosing from the list itself.
            if (!(suggest && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) updateSuggest();
          }}
          onClick={updateSuggest}
          onBlur={() => setSuggest(null)}
          onPaste={(e) => {
            // Plain text only: a pasted page would bring its own markup into the box.
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          onDrop={(e) => e.preventDefault()}
        />
        {suggest && (
          <ul className="zad-suggest" role="listbox">
            {candidates.length === 0 ? (
              <li className="zad-suggest__empty">{t.zadNoPersonFound}</li>
            ) : (
              candidates.map((u, i) => (
                <li
                  key={u.id}
                  role="option"
                  aria-selected={i === active}
                  className={`zad-suggest__item${i === active ? ' is-active' : ''}`}
                  // mousedown, not click: the box's blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span
                    className="zad-avatar"
                    style={{ ['--avatar' as string]: personColor(u) }}
                    aria-hidden="true"
                  />
                  <span className="zad-suggest__name">{personLabel(u)}</span>
                  <span className="zad-suggest__hint">{u.email}</span>
                </li>
              ))
            )}
          </ul>
        )}
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
