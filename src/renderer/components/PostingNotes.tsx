import React, { useEffect, useRef, useState } from 'react';
import { KsiegowanieUwaga } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';

/**
 * Pieces of the "Księgowania" notes feature that are shared between the
 * dashboard and the Converter: a small text editor, one note as it reads, and
 * the notice the Converter raises when it recognises a community with an open
 * note.
 */

/* ------------------------------ Text editor ------------------------------ */

/**
 * A textarea with save / cancel, for a note typed in place. Ctrl/⌘+Enter saves
 * and Escape cancels, so a note can be written without leaving the keyboard.
 */
export const NoteEditor: React.FC<{
  initial?: string;
  placeholder: string;
  saveLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** An empty note is allowed (a priority without a reason); a posting note is not. */
  allowEmpty?: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}> = ({ initial = '', placeholder, saveLabel, cancelLabel, busy, allowEmpty, onSave, onCancel }) => {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSave = !busy && (allowEmpty || text.trim().length > 0);

  return (
    <div className="ks-note-editor">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSave) {
            e.preventDefault();
            onSave(text);
          }
        }}
      />
      <div className="ks-note-editor__actions">
        <button
          type="button"
          className="button button-small button-primary"
          disabled={!canSave}
          onClick={() => onSave(text)}
        >
          {saveLabel}
        </button>
        <button type="button" className="button button-small button-ghost" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------ Meta line -------------------------------- */

/** "dodane 12.09, 14:03 przez ania@…" — who and when, without inventing either. */
export function uwagaMeta(
  uwaga: KsiegowanieUwaga,
  language: Language,
  formatDateTime: (iso: string) => string,
): string {
  const t = translations[language];
  const date = formatDateTime(uwaga.createdAt);
  return uwaga.createdBy
    ? t.ksUwagaMeta.replace('{date}', date).replace('{who}', uwaga.createdBy)
    : t.ksUwagaMetaNoWho.replace('{date}', date);
}

export function uwagaResolvedMeta(
  uwaga: KsiegowanieUwaga,
  language: Language,
  formatDateTime: (iso: string) => string,
): string {
  const t = translations[language];
  if (!uwaga.resolvedAt) return '';
  const date = formatDateTime(uwaga.resolvedAt);
  return uwaga.resolvedBy
    ? t.ksUwagaResolvedMeta.replace('{date}', date).replace('{who}', uwaga.resolvedBy)
    : t.ksUwagaResolvedMetaNoWho.replace('{date}', date);
}

/* ------------------------- Notice in the Converter ------------------------ */

export interface PostingNoteNoticeItem {
  adresId: number;
  adresNazwa: string;
  uwagi: KsiegowanieUwaga[];
}

/**
 * The message the Converter shows when a dropped statement turns out to belong
 * to a community with an open note. A modal rather than a toast: the note is
 * something to read BEFORE posting, and a toast that fades is read by nobody.
 * The same notes stay under the file's address in the table afterwards.
 */
export const PostingNoteNotice: React.FC<{
  items: PostingNoteNoticeItem[];
  language: Language;
  formatDateTime: (iso: string) => string;
  onClose: () => void;
}> = ({ items, language, formatDateTime, onClose }) => {
  const t = translations[language];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ks-notice" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <div className="modal-header">
          <span className="ks-notice__title">
            <Icon name="message-square" size={20} /> {t.convNoteTitle}
          </span>
        </div>
        <div className="modal-body">
          <p className="ks-notice__lead">{items.length > 1 ? t.convNoteLeadMany : t.convNoteLead}</p>
          {items.map((item) => (
            <section key={item.adresId} className="ks-notice__community">
              <h3>{item.adresNazwa}</h3>
              {item.uwagi.map((u) => (
                <div key={u.id} className="ks-notice__note">
                  <p>{u.tresc}</p>
                  <span>{uwagaMeta(u, language, formatDateTime)}</span>
                </div>
              ))}
            </section>
          ))}
          <p className="ks-notice__hint">{t.convNoteResolveHint}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-primary" onClick={onClose} autoFocus>
            {t.convNoteOk}
          </button>
        </div>
      </div>
    </div>
  );
};
