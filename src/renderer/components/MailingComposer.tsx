import React, { useMemo } from 'react';
import { MailingPole, MailingTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { FormField } from './FormSection';
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
  isBlockField,
  isFieldTableField,
  isZebranieField,
  normalizeFieldName,
  poleAllowedForTyp,
} from '../../shared/mailing-template';

/**
 * Fields offered by the insert pickers, built-ins first. The pills read the same
 * list, so a field missing from it shows up flagged in the text instead of going
 * out unsubstituted.
 *
 * `fieldTable: false` drops the fields that resolve to a block — the
 * `{{Tabela pól}}` table and the Zebrania lists — which a subject line cannot hold.
 * `typ` leaves out dictionary fields bound to another mailing kind, and
 * `zebranie: false` the Zebrania fields, for a letter that is not made in that
 * module and so could never fill them.
 *
 * Only what is OFFERED is narrowed. A field already placed keeps resolving —
 * the pills read the dictionary for that, not this list.
 */
export function useMailingFieldOptions(
  pola: MailingPole[],
  options?: { fieldTable?: boolean; typ?: MailingTyp | null; zebranie?: boolean },
): MailingFieldOption[] {
  const fieldTable = options?.fieldTable ?? true;
  const typ = options?.typ ?? null;
  const zebranie = options?.zebranie ?? true;
  return useMemo(
    () => [
      ...BUILTIN_MAILING_FIELDS.filter(
        (f) => (fieldTable || !isBlockField(f.nazwa)) && (zebranie || !isZebranieField(f.nazwa)),
      ).map((f) => ({
        nazwa: f.nazwa,
        hint: f.opis,
        keywords: isZebranieField(f.nazwa) ? 'wbudowane builtin zebranie zebrania' : 'wbudowane builtin',
        builtin: true,
      })),
      ...pola
        .filter((p) => poleAllowedForTyp(p, typ))
        .map((p) => ({ nazwa: p.nazwa, hint: p.tekst || undefined })),
    ],
    [pola, fieldTable, typ, zebranie],
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
  /** The template's mailing kind — fields bound to another kind are not offered. */
  typ?: MailingTyp | null;
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
  typ = null,
  onChange,
  onDirty,
  bodyNote,
}) => {
  const t = translations[language];
  const fields = useMailingFieldOptions(pola, { typ });
  const subjectFields = useMailingFieldOptions(pola, { fieldTable: false, typ });
  const chipLabels = useFieldChipLabels(language);
  const unknownFields = useUnknownFields(pola, temat, tresc);
  /** Drives the hint explaining where the table's rows come from. */
  const usesFieldTable = useMemo(
    () => extractUsedFields(tresc).some(isFieldTableField),
    [tresc],
  );

  return (
    <>
      <FormField label={t.mailingSubject} required>
        <ChipTextInput
          value={temat}
          onChange={(next) => onChange({ temat: next })}
          onDirty={onDirty}
          fields={subjectFields}
          labels={chipLabels}
          placeholder={t.mailingSubjectPlaceholder}
        />
      </FormField>

      <FormField
        label={t.mailingBody}
        hint={
          <>
            {bodyNote ?? t.mailingLogoNote} {t.mailingFieldPartsHint}
          </>
        }
      >
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
      </FormField>

      {usesFieldTable && (
        <div className="callout callout--info">
          <Icon name="info" size={16} />
          <div className="callout__body">{t.mailingFieldTableInBodyNote}</div>
        </div>
      )}

      {unknownFields.length > 0 && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">
            {t.mailingUnknownFields}: {unknownFields.map((f) => fieldPlaceholder(f)).join(', ')}
          </div>
        </div>
      )}
    </>
  );
};

export default MailingComposer;
