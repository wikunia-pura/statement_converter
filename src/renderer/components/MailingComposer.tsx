import React, { useMemo, useRef } from 'react';
import { MailingPole } from '../../shared/types';
import { translations, Language } from '../translations';
import RichTextEditor from './RichTextEditor';
import SearchableSelect, { SearchableOption } from './SearchableSelect';
import {
  BUILTIN_MAILING_FIELDS,
  extractUsedFields,
  fieldPlaceholder,
  normalizeFieldName,
} from '../../shared/mailing-template';

interface FieldPickerProps {
  options: SearchableOption[];
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  onInsert: (placeholderText: string) => void;
}

/**
 * Insert a field's placeholder at the caret. A searchable dropdown rather than a
 * row of chips: the dictionary grows with every rate a community can change, and
 * a wrapped wall of pills stops being scannable well before that.
 */
const FieldPicker: React.FC<FieldPickerProps> = ({
  options,
  label,
  placeholder,
  searchPlaceholder,
  emptyText,
  onInsert,
}) => (
  <div style={{ marginTop: '8px' }}>
    <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '6px' }}>{label}</div>
    <SearchableSelect
      // Always empty: this dropdown is an action ("insert this here"), not a
      // stored choice, so the trigger keeps inviting the next insertion.
      value=""
      options={options}
      onChange={onInsert}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      size="sm"
      style={{ maxWidth: '360px' }}
    />
  </div>
);

/**
 * Fields offered by both pickers, built-ins first. `value` is the exact text
 * inserted, so neither picker has to know how a placeholder is spelled.
 */
export function useMailingFieldOptions(pola: MailingPole[]): SearchableOption[] {
  return useMemo(
    () => [
      ...BUILTIN_MAILING_FIELDS.map((f) => ({
        value: fieldPlaceholder(f.nazwa),
        label: f.nazwa,
        hint: f.opis,
        keywords: 'wbudowane builtin',
      })),
      ...pola.map((p) => ({
        value: fieldPlaceholder(p.nazwa),
        label: p.nazwa,
        hint: p.tekst || undefined,
      })),
    ],
    [pola],
  );
}

/**
 * Placeholders in the given texts that match no defined field. They are left
 * visible in the output on purpose, so the composer can flag them before the
 * mail goes anywhere.
 */
export function useUnknownFields(pola: MailingPole[], ...texts: string[]): string[] {
  // Scanning one concatenated string is equivalent to scanning each separately —
  // a placeholder cannot span a newline — and it gives the memo a stable
  // dependency, which a fresh array of the same strings would not be.
  const joined = texts.join('\n');
  return useMemo(() => {
    const known = new Set([
      ...pola.map((p) => normalizeFieldName(p.nazwa)),
      ...BUILTIN_MAILING_FIELDS.map((f) => normalizeFieldName(f.nazwa)),
    ]);
    return extractUsedFields(joined).filter((name) => !known.has(normalizeFieldName(name)));
  }, [joined, pola]);
}

interface MailingComposerProps {
  language: Language;
  /** Subject line, with `{{field}}` placeholders. */
  temat: string;
  /** Body as HTML, with `{{field}}` placeholders. */
  tresc: string;
  /** Defined dynamic fields, for the two insert pickers. */
  pola: MailingPole[];
  onChange: (patch: { temat?: string; tresc?: string }) => void;
  /** Cleared by the caller when the user edits — a submit error, typically. */
  onDirty?: () => void;
  /** Extra note under the body label (e.g. "this send only"). */
  bodyNote?: React.ReactNode;
}

/**
 * Subject + body editor, shared by the template library and the send screen.
 *
 * It lives here rather than in either view because the two must offer literally
 * the same controls: a template is proofread in one screen and adjusted in the
 * other, and a formatting button present in only one of them would produce mails
 * the user cannot reproduce.
 */
const MailingComposer: React.FC<MailingComposerProps> = ({
  language,
  temat,
  tresc,
  pola,
  onChange,
  onDirty,
  bodyNote,
}) => {
  const t = translations[language];
  const subjectRef = useRef<HTMLInputElement>(null);
  const fieldOptions = useMailingFieldOptions(pola);
  const unknownFields = useUnknownFields(pola, temat, tresc);

  /** Insert a placeholder into the subject at the caret, then restore the caret. */
  const insertIntoSubject = (placeholder: string) => {
    const input = subjectRef.current;
    const start = input?.selectionStart ?? temat.length;
    const end = input?.selectionEnd ?? temat.length;
    onChange({ temat: temat.slice(0, start) + placeholder + temat.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      const caret = start + placeholder.length;
      input?.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      <div className="form-group">
        <label>
          {t.mailingSubject} <span style={{ color: 'red' }}>*</span>
        </label>
        <input
          ref={subjectRef}
          type="text"
          value={temat}
          onChange={(e) => {
            onChange({ temat: e.target.value });
            onDirty?.();
          }}
          placeholder={t.mailingSubjectPlaceholder}
        />
        <FieldPicker
          options={fieldOptions}
          label={t.mailingInsertFieldSubject}
          placeholder={t.mailingInsertFieldPick}
          searchPlaceholder={t.mailingInsertFieldSearch}
          emptyText={t.mailingInsertFieldNoMatch}
          onInsert={insertIntoSubject}
        />
      </div>

      <div className="form-group">
        <label>{t.mailingBody}</label>
        <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
          {bodyNote ?? t.mailingLogoNote}
        </div>
        <RichTextEditor
          fieldOptions={fieldOptions}
          value={tresc}
          onChange={(html) => {
            onChange({ tresc: html });
            onDirty?.();
          }}
          placeholder={t.mailingBodyPlaceholder}
          labels={{
            bold: t.rteBold,
            italic: t.rteItalic,
            underline: t.rteUnderline,
            heading: t.rteHeading,
            bulletList: t.rteBulletList,
            numberedList: t.rteNumberedList,
            clearFormatting: t.rteClearFormatting,
            alignLeft: t.rteAlignLeft,
            alignCenter: t.rteAlignCenter,
            alignRight: t.rteAlignRight,
            alignJustify: t.rteAlignJustify,
            table: t.rteTable,
            tableRows: t.rteTableRows,
            tableColumns: t.rteTableColumns,
            tableHeaderRow: t.rteTableHeaderRow,
            tableInsert: t.rteTableInsert,
            tableAddRow: t.rteTableAddRow,
            tableDeleteRow: t.rteTableDeleteRow,
            tableAddColumn: t.rteTableAddColumn,
            tableDeleteColumn: t.rteTableDeleteColumn,
            tableDelete: t.rteTableDelete,
            insertField: t.mailingInsertFieldShort,
            insertFieldSearch: t.mailingInsertFieldSearch,
            insertFieldNoMatch: t.mailingInsertFieldNoMatch,
          }}
        />
      </div>

      {unknownFields.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>
          {t.mailingUnknownFields}: {unknownFields.map((f) => fieldPlaceholder(f)).join(', ')}
        </div>
      )}
    </>
  );
};

export default MailingComposer;
