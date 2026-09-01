import React, { useMemo } from 'react';
import { MailingPole } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';
import RichTextEditor from './RichTextEditor';
import {
  ChipTextInput,
  FieldChipLabels,
  MailingFieldOption,
} from './fieldChips';
import {
  BUILTIN_MAILING_FIELDS,
  extractUsedFields,
  fieldPlaceholder,
  isFieldTableField,
  normalizeFieldName,
} from '../../shared/mailing-template';

/**
 * Fields offered by the insert pickers, built-ins first. The pills read the same
 * list, so a field missing from it shows up flagged in the text instead of going
 * out unsubstituted.
 *
 * `fieldTable: false` drops the `{{Tabela pól}}` entry — it resolves to a table,
 * which a subject line cannot hold.
 */
export function useMailingFieldOptions(
  pola: MailingPole[],
  options?: { fieldTable?: boolean },
): MailingFieldOption[] {
  const fieldTable = options?.fieldTable ?? true;
  return useMemo(
    () => [
      ...BUILTIN_MAILING_FIELDS.filter((f) => fieldTable || !isFieldTableField(f.nazwa)).map((f) => ({
        nazwa: f.nazwa,
        hint: f.opis,
        keywords: 'wbudowane builtin',
        builtin: true,
      })),
      ...pola.map((p) => ({ nazwa: p.nazwa, hint: p.tekst || undefined })),
    ],
    [pola, fieldTable],
  );
}

/** Wording for the pills and the insert control, from the app's translations. */
export function useFieldChipLabels(language: Language): FieldChipLabels {
  const t = translations[language];
  return useMemo(
    () => ({
      partFull: t.mailingFieldPartFull,
      partLabel: t.mailingFieldPartLabel,
      partValue: t.mailingFieldPartValue,
      insertMode: t.mailingInsertFieldMode,
      chipHint: t.mailingFieldChipHint,
      chipBuiltinHint: t.mailingFieldChipBuiltinHint,
      chipUnknown: t.mailingFieldChipUnknown,
      insertField: t.mailingInsertFieldShort,
      insertFieldSearch: t.mailingInsertFieldSearch,
      insertFieldNoMatch: t.mailingInsertFieldNoMatch,
    }),
    [t],
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
  const fields = useMailingFieldOptions(pola);
  const subjectFields = useMailingFieldOptions(pola, { fieldTable: false });
  const chipLabels = useFieldChipLabels(language);
  const unknownFields = useUnknownFields(pola, temat, tresc);
  /** Drives the hint explaining where the table's rows come from. */
  const usesFieldTable = useMemo(
    () => extractUsedFields(tresc).some(isFieldTableField),
    [tresc],
  );

  return (
    <>
      <div className="form-group">
        <label>
          {t.mailingSubject} <span style={{ color: 'red' }}>*</span>
        </label>
        <ChipTextInput
          value={temat}
          onChange={(next) => onChange({ temat: next })}
          onDirty={onDirty}
          fields={subjectFields}
          labels={chipLabels}
          placeholder={t.mailingSubjectPlaceholder}
        />
      </div>

      <div className="form-group">
        <label>{t.mailingBody}</label>
        <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
          {bodyNote ?? t.mailingLogoNote}
        </div>
        <RichTextEditor
          fields={fields}
          fieldLabels={chipLabels}
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
          }}
        />
        <div style={{ fontSize: '12px', opacity: 0.75, marginTop: '8px', maxWidth: '90ch' }}>
          <Icon name="info" size={13} /> {t.mailingFieldPartsHint}
        </div>
      </div>

      {usesFieldTable && (
        <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '10px' }}>
          <Icon name="info" size={13} /> {t.mailingFieldTableInBodyNote}
        </div>
      )}

      {unknownFields.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>
          {t.mailingUnknownFields}: {unknownFields.map((f) => fieldPlaceholder(f)).join(', ')}
        </div>
      )}
    </>
  );
};

export default MailingComposer;
