import React, { useRef, useState } from 'react';
import { AppUser, KsiegowanieUwaga } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';
import { MentionEditor, MentionEditorHandle } from './MentionEditor';
import { FormSection } from './FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';

/**
 * Pieces of the "Księgowania" notes feature that are shared between the
 * dashboard and the Converter: a small text editor, one note as it reads, and
 * the notice the Converter raises when it recognises a community with an open
 * note.
 */

/* ------------------------------ Text editor ------------------------------ */

/**
 * A text box with save / cancel, for a note typed in place. "@" tags a person,
 * who gets a notification. Ctrl/⌘+Enter saves and Escape cancels, so a note can
 * be written without leaving the keyboard.
 */
export const NoteEditor: React.FC<{
  initial?: string;
  /** Mailboxes the stored note tags — they come back as pills. */
  initialMentions?: string[];
  users: AppUser[];
  /** The signed-in mailbox — never offered as a tag. */
  userEmail?: string;
  placeholder: string;
  saveLabel: string;
  cancelLabel: string;
  noMatchLabel: string;
  busy?: boolean;
  /** An empty note is allowed (a priority without a reason); a posting note is not. */
  allowEmpty?: boolean;
  onSave: (text: string, mentions: string[]) => void;
  onCancel: () => void;
}> = ({
  initial = '',
  initialMentions = [],
  users,
  userEmail,
  placeholder,
  saveLabel,
  cancelLabel,
  noMatchLabel,
  busy,
  allowEmpty,
  onSave,
  onCancel,
}) => {
  const [length, setLength] = useState(initial.trim().length);
  const editor = useRef<MentionEditorHandle>(null);

  const canSave = !busy && (allowEmpty || length > 0);
  const save = () => {
    if (!canSave || !editor.current) return;
    const { text, mentions } = editor.current.value();
    onSave(text, mentions);
  };

  return (
    <div className="ks-note-editor">
      <MentionEditor
        ref={editor}
        users={users}
        userEmail={userEmail}
        placeholder={placeholder}
        ariaLabel={placeholder}
        noMatchLabel={noMatchLabel}
        initial={{ text: initial, mentions: initialMentions }}
        autoFocus
        onLengthChange={setLength}
        onSubmit={save}
        onEscape={onCancel}
      />
      <div className="ks-note-editor__actions">
        <button type="button" className="button button-small button-primary" disabled={!canSave} onClick={save}>
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
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="message-square"
          title={t.convNoteTitle}
          subtitle={items.length > 1 ? t.convNoteLeadMany : t.convNoteLead}
        />
        <div className="modal-body modal-body--sectioned">
          {items.map((item) => (
            <FormSection key={item.adresId} icon="home" title={item.adresNazwa}>
              <ul className="record-list">
                {item.uwagi.map((u) => (
                  <li key={u.id} className="record-row">
                    <div className="record-row__main">
                      <div className="record-row__title record-row__title--wrap record-row__title--text">{u.tresc}</div>
                      <div className="record-row__meta">{uwagaMeta(u, language, formatDateTime)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </FormSection>
          ))}
          <div className="callout callout--muted">
            <Icon name="info" size={16} />
            <div className="callout__body">{t.convNoteResolveHint}</div>
          </div>
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.convNoteOk} />
      </div>
    </div>
  );
};
