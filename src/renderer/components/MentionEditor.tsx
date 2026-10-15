import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppUser } from '../../shared/types';
import { comparePeople, personColor, personLabel } from '../../shared/app-users';
import { foldText } from '../../shared/text';

/**
 * A text box that can tag people with "@" — the task comments and the
 * dashboard's notes share it. A tag is a pill in the box; what is stored is the
 * text with "@Name" in it and, aside, the tagged mailboxes (what the notifier
 * reads, so a rename never un-tags anyone).
 */

const MAX_SUGGESTIONS = 6;

/** Separates a pill from the text after it, so the caret has somewhere to stand. */
const AFTER_PILL = ' ';

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase() && (a ?? '').trim() !== '';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export interface MentionValue {
  text: string;
  /** Mailboxes of the pills — the tags themselves, not a guess from the text. */
  mentions: string[];
}

/** The box as it is stored: pills as "@Name" in the text, their mailboxes aside. */
function serialize(root: HTMLElement): MentionValue {
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
  return { text: text.replace(/[ ​]/g, (c) => (c === ' ' ? ' ' : '')), mentions: [...mentions] };
}

/** Appends plain text to the box, its line breaks as <br>. */
function appendText(root: HTMLElement, text: string): void {
  text.split('\n').forEach((line, i) => {
    if (i > 0) root.appendChild(document.createElement('br'));
    if (line) root.appendChild(document.createTextNode(line));
  });
}

/** The stored text put back into the box, its tags as pills again — for editing. */
function fill(root: HTMLElement, value: MentionValue, usersByEmail: Map<string, AppUser>): void {
  root.innerHTML = '';
  const tagged = value.mentions.flatMap((email) => {
    const u = usersByEmail.get(email.trim().toLowerCase());
    return u ? [u] : [];
  });
  const re = mentionRegex(tagged.map(personLabel));
  if (!re) {
    appendText(root, value.text);
    return;
  }
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value.text)) !== null) {
    const start = match.index + match[1].length;
    const tag = match[2].slice(1).toLowerCase();
    const user = tagged.find((u) => personLabel(u).toLowerCase() === tag);
    if (!user) continue;
    appendText(root, value.text.slice(last, start));
    root.appendChild(buildPill(user));
    last = start + match[2].length;
  }
  appendText(root, value.text.slice(last));
}

/** Labels of the people a text tags, for `MentionText` — `me` marks the signed-in person. */
export function mentionLabels(
  mentions: string[] | undefined,
  users: AppUser[],
  userEmail?: string,
): { label: string; me: boolean }[] {
  return (mentions ?? []).flatMap((email) => {
    const u = users.find((x) => same(x.email, email));
    return u ? [{ label: personLabel(u), me: same(u.email, userEmail) }] : [];
  });
}

interface TextProps {
  text: string;
  /** Labels of the people the text tags, to show as pills. */
  labels: { label: string; me: boolean }[];
}

/** A stored text with its tags as pills — plain text otherwise, never HTML. */
export const MentionText: React.FC<TextProps> = ({ text, labels }) => {
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

export interface MentionEditorHandle {
  value: () => MentionValue;
  clear: () => void;
  focus: () => void;
}

interface Props {
  users: AppUser[];
  /** The signed-in mailbox — never offered as a tag. */
  userEmail?: string;
  placeholder: string;
  ariaLabel: string;
  /** "Nikogo nie znaleziono" under an "@…" that matches nobody. */
  noMatchLabel: string;
  /** What the box starts with (editing a stored text). */
  initial?: MentionValue;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The trimmed length of what is typed — for a counter or a disabled button. */
  onLengthChange?: (length: number) => void;
  /** Ctrl/⌘+Enter. */
  onSubmit?: () => void;
  /** Escape while no list of people is open. */
  onEscape?: () => void;
}

/**
 * The box itself. A contenteditable, not a textarea: a textarea cannot hold a
 * pill. React renders it empty and never touches what the person (or `pick`)
 * puts in; the parent reads it through the handle.
 */
export const MentionEditor = forwardRef<MentionEditorHandle, Props>(
  (
    {
      users,
      userEmail,
      placeholder,
      ariaLabel,
      noMatchLabel,
      initial,
      disabled = false,
      autoFocus = false,
      onLengthChange,
      onSubmit,
      onEscape,
    },
    ref,
  ) => {
    // An open "@…" under the caret: what has been typed after it.
    const [suggest, setSuggest] = useState<{ query: string } | null>(null);
    const [active, setActive] = useState(0);
    const editor = useRef<HTMLDivElement>(null);
    // Where the "@query" sits in the box — a text node and the span of the query in it.
    const mentionSpan = useRef<{ node: Text; start: number; end: number } | null>(null);

    const usersByEmail = useMemo(() => {
      const map = new Map<string, AppUser>();
      for (const u of users) map.set(u.email.trim().toLowerCase(), u);
      return map;
    }, [users]);

    /** Keep the length and the placeholder in step with what is in the box. */
    const sync = () => {
      const el = editor.current;
      if (!el) return;
      const { text } = serialize(el);
      // A browser leaves a stray <br> in an emptied box, which hides the
      // placeholder (`:empty`) — a box with nothing in it is made really empty.
      if (!text.trim() && el.innerHTML !== '') el.innerHTML = '';
      onLengthChange?.(text.trim().length);
    };

    const focusEnd = () => {
      const el = editor.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    useImperativeHandle(ref, () => ({
      value: () => (editor.current ? serialize(editor.current) : { text: '', mentions: [] }),
      clear: () => {
        if (editor.current) editor.current.innerHTML = '';
        setSuggest(null);
        onLengthChange?.(0);
      },
      focus: focusEnd,
    }));

    // The starting text goes in once, when the box opens.
    useEffect(() => {
      const el = editor.current;
      if (el && initial?.text) {
        fill(el, initial, usersByEmail);
        sync();
      }
      if (autoFocus) focusEnd();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const candidates = useMemo(() => {
      if (!suggest) return [];
      // Case- and diacritic-blind, so "lukasz" finds "Łukasz".
      const q = foldText(suggest.query);
      return [...users]
        .filter((u) => !same(u.email, userEmail))
        .filter((u) => q === '' || foldText(`${personLabel(u)} ${u.email}`).includes(q))
        .sort(comparePeople)
        .slice(0, MAX_SUGGESTIONS);
    }, [suggest, users, userEmail]);

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
      const m = /(^|[\s ​])@([^\s@ ]{0,30})$/.exec(before);
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
      if (e.key === 'Escape') {
        if (suggest) {
          e.preventDefault();
          e.stopPropagation();
          setSuggest(null);
        } else if (onEscape) {
          e.stopPropagation();
          onEscape();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Ctrl/Cmd+Enter submits; a plain Enter is a line break, as in a text box.
        if (e.ctrlKey || e.metaKey) onSubmit?.();
        else document.execCommand('insertLineBreak');
      }
    };

    return (
      <div className="mention-editor">
        <div
          ref={editor}
          className="zad-editor"
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-placeholder={placeholder}
          contentEditable={!disabled}
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
              <li className="zad-suggest__empty">{noMatchLabel}</li>
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
      </div>
    );
  },
);
MentionEditor.displayName = 'MentionEditor';
