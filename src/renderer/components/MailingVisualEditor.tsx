import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MailingKalendarzContext, MailingPole, MailingPoleTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';
import RichTextEditor from './RichTextEditor';
import { ChipDisplay, ChipDisplayResolver, usePlaceholderChips } from './fieldChips';
import { useFieldChipLabels, useMailingFieldOptions } from './MailingComposer';
import {
  MAILING_LOGO_SVG_DATA_URI,
  MAIL_BORDER_COLOR,
  MAIL_CARD_COLOR,
  MAIL_CARD_WIDTH,
  MAIL_PAGE_COLOR,
  MAIL_TEXT_COLOR,
} from '../../shared/mailing-logo';
import {
  MailingFieldRef,
  MailingRenderContext,
  buildFieldTableHtml,
  buildLogoHeader,
  fieldPlaceholder,
  formatPolishDate,
  isBuiltinField,
  isFieldTableField,
  isKalendarzValueInjected,
  kalendarzFieldOf,
  missingFieldValues,
  normalizeFieldName,
  readFieldValue,
  renderPlain,
} from '../../shared/mailing-template';

/**
 * The letter as it will read, editable in place — for a person who should never
 * have to see a `{{placeholder}}`.
 *
 * CONTRACT (stable — other modules import this component):
 *   - `tresc` / `temat` are the STORED form: HTML / text with `{{field}}`
 *     placeholders. The editor shows each placeholder as its resolved value
 *     (rendered with shared/mailing-template, exactly as the send/PDF will), so
 *     the text reads like the final letter.
 *   - Formatting buttons (bold, lists, alignment, table …) work on the text.
 *   - Clicking a placeholder that takes a typed value (a user field; a calendar
 *     field the meeting did not fill) opens an inline input — a date/time picker
 *     for `data`/`godzina` fields — and the value appears in the letter at once
 *     via `onValuesChange`. Clicking it again edits the value.
 *   - Placeholders the context fills (Adres Wspólnoty, Data, calendar fields
 *     injected by the meeting) show their value and are not editable.
 *   - A field still missing a value is visibly marked in the text.
 *
 * HOW: it is the template editor (`RichTextEditor` on `usePlaceholderChips`) in
 * "value mode". The pills are the same atoms as in the template editor — so the
 * stored braces, the caret handling, copy/paste and the formatting guards are
 * shared, not reimplemented — but their caption is the placeholder rendered by
 * `renderPlain` (or `buildFieldTableHtml` for the table) against this letter's
 * context. One source of truth: what the pill says is what the mail will say.
 */
export interface MailingVisualEditorProps {
  language: Language;
  /** Subject with placeholders. Omit `onTematChange` to hide the subject line. */
  temat: string;
  onTematChange?: (temat: string) => void;
  /** Body HTML with placeholders. */
  tresc: string;
  onTrescChange: (tresc: string) => void;
  /** Values typed for this letter, keyed by field name. */
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  /** Defined dynamic fields. */
  pola: MailingPole[];
  /** Community the letter is about — what `{{Adres Wspólnoty}}` shows. */
  adresNazwa: string;
  /** What the meeting fills the calendar fields with; null/absent when not made from one. */
  kalendarz?: MailingKalendarzContext | null;
  /** Fields ticked for `{{Tabela pól}}`. */
  tableFields?: string[];
  /** Render the letterhead frame around the text, as in the PDF. Default true. */
  showLetterhead?: boolean;
  /** "Zapisz jako szablon" — the button is shown only when this is given. */
  onSaveAsTemplate?: () => void;
  readOnly?: boolean;
  /**
   * Hide the one-line "how this works" hint above the letter — for a caller that
   * explains the editor in its own words. Default false.
   */
  hideHint?: boolean;
}

/** Stable empty list, so an absent `tableFields` does not churn the context memo. */
const NO_FIELDS: string[] = [];

/** A pill click in a read-only letter: nothing happens. */
const ignoreChipActivate = (): void => undefined;

/** Popover width; also what keeps it inside the editor's right edge. */
const POPOVER_WIDTH = 320;

/**
 * Store a value under exactly one spelling of the field's name — the same rule as
 * the send screen's inputs. `{{zaliczka}}` in the text and `Zaliczka` in the
 * dictionary are one field, and two keys differing only in case would make the
 * resolved value depend on key order.
 */
function withFieldValue(
  values: Record<string, string>,
  nazwa: string,
  wartosc: string,
): Record<string, string> {
  const key = normalizeFieldName(nazwa);
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (normalizeFieldName(k) !== key) next[k] = v;
  }
  next[nazwa] = wartosc;
  return next;
}

/** What the value popover is showing. */
interface ValueEditorState {
  /** Name the value is stored under — the dictionary's spelling. */
  nazwa: string;
  /** Heading: the field's name. */
  title: string;
  /** The field's fixed sentence, or what the field is for. */
  hint?: string;
  /** Unit written after the value in the letter. */
  unit?: string;
  /** Kind of input; null ⇒ nothing to type, the popover only explains why. */
  kind: MailingPoleTyp | null;
  /** Why the field cannot be typed into (kind null). */
  info?: string;
  draft: string;
  /** Anchor geometry relative to the editor's frame. */
  anchorTop: number;
  anchorBottom: number;
  left: number;
}

const MailingVisualEditor: React.FC<MailingVisualEditorProps> = ({
  language,
  temat,
  onTematChange,
  tresc,
  onTrescChange,
  values,
  onValuesChange,
  pola,
  adresNazwa,
  kalendarz,
  tableFields,
  showLetterhead = true,
  onSaveAsTemplate,
  readOnly = false,
  hideHint = false,
}) => {
  const t = translations[language];
  const fields = useMailingFieldOptions(pola);
  const subjectFields = useMailingFieldOptions(pola, { fieldTable: false });
  const chipLabels = useFieldChipLabels(language);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<ValueEditorState | null>(null);
  /** Popover placed above its pill — when there is no room below it. */
  const [flipUp, setFlipUp] = useState(false);

  const ctx = useMemo<MailingRenderContext>(
    () => ({
      adresNazwa,
      dateText: formatPolishDate(new Date()),
      pola,
      values,
      tableFields: tableFields ?? NO_FIELDS,
      kalendarz: kalendarz ?? null,
    }),
    [adresNazwa, pola, values, tableFields, kalendarz],
  );

  /**
   * What each pill shows, from the shared renderer. A new function whenever the
   * context changes — that identity change is what redraws the pills.
   */
  const display = useMemo<ChipDisplayResolver>(
    () =>
      (ref: MailingFieldRef): ChipDisplay => {
        const placeholder = fieldPlaceholder(ref.nazwa, ref.part);

        if (isFieldTableField(ref.nazwa)) {
          const html = buildFieldTableHtml(ctx);
          return html
            ? { text: '', html, tone: 'locked', title: t.mveChipTable }
            : { text: '', missing: t.mveTableEmpty, tone: 'locked', title: t.mveChipTable };
        }

        const kal = kalendarzFieldOf(ref.nazwa);
        if (kal) {
          const text = renderPlain(placeholder, ctx);
          if (isKalendarzValueInjected(ref.nazwa, ctx)) {
            return { text, tone: 'locked', title: t.mveChipFromCalendar };
          }
          const tone = readOnly ? 'locked' : 'editable';
          return text
            ? { text, tone, title: t.mveChipClickToChange }
            : { text: '', missing: kal.nazwa, tone, title: t.mveChipClickToFill };
        }

        if (isBuiltinField(ref.nazwa)) {
          return { text: renderPlain(placeholder, ctx), tone: 'locked', title: t.mveChipAutomatic };
        }

        const pole = pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(ref.nazwa));
        // Left in the letter as braces, exactly as the send would leave it.
        if (!pole) return { text: placeholder, tone: 'unknown', title: chipLabels.chipUnknown };

        const text = renderPlain(placeholder, ctx);
        if (ref.part === 'label') return { text, tone: 'locked', title: t.mveChipLabelOnly };
        const tone = readOnly ? 'locked' : 'editable';
        return missingFieldValues(ctx, placeholder).length > 0
          ? { text, missing: pole.nazwa, tone, title: t.mveChipClickToFill }
          : { text, tone, title: t.mveChipClickToChange };
      },
    [ctx, pola, t, chipLabels, readOnly],
  );

  /** What clicking a given pill offers: an input of the field's kind, or a reason. */
  const describeField = useCallback(
    (ref: MailingFieldRef): Omit<ValueEditorState, 'draft' | 'anchorTop' | 'anchorBottom' | 'left'> => {
      const kal = kalendarzFieldOf(ref.nazwa);
      if (kal) {
        if (isKalendarzValueInjected(ref.nazwa, ctx)) {
          return { nazwa: kal.nazwa, title: kal.nazwa, kind: null, info: t.mveChipFromCalendar };
        }
        return { nazwa: kal.nazwa, title: kal.nazwa, kind: kal.typWartosci, hint: t.mveCalendarFieldHint };
      }
      if (isFieldTableField(ref.nazwa)) {
        return { nazwa: ref.nazwa, title: ref.nazwa, kind: null, info: t.mveChipTable };
      }
      if (isBuiltinField(ref.nazwa)) {
        return { nazwa: ref.nazwa, title: ref.nazwa, kind: null, info: t.mveChipAutomatic };
      }
      const pole = pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(ref.nazwa));
      if (!pole) return { nazwa: ref.nazwa, title: ref.nazwa, kind: null, info: chipLabels.chipUnknown };
      if (ref.part === 'label') {
        return { nazwa: pole.nazwa, title: pole.nazwa, kind: null, info: t.mveChipLabelOnly };
      }
      return {
        nazwa: pole.nazwa,
        title: pole.nazwa,
        hint: pole.tekst || undefined,
        unit: pole.jednostka || undefined,
        kind: pole.typWartosci ?? 'tekst',
      };
    },
    [ctx, pola, t, chipLabels],
  );

  /** Open the popover for a field, anchored under the element that asked for it. */
  const openEditor = useCallback(
    (ref: MailingFieldRef, anchor: HTMLElement) => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const a = anchor.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, w.width);
      const described = describeField(ref);
      setFlipUp(false);
      setEditor({
        ...described,
        draft: described.kind ? readFieldValue(values, described.nazwa) : '',
        anchorTop: a.top - w.top,
        anchorBottom: a.bottom - w.top,
        left: Math.max(0, Math.min(a.left - w.left, w.width - width)),
      });
    },
    [describeField, values],
  );

  // Read-only still passes a handler: without one a click falls back to the
  // template editor's click-to-cycle, which would rewrite the placeholder's part
  // (and publish it) in a letter that is not meant to change.
  const onChipActivate = readOnly ? ignoreChipActivate : openEditor;

  // Below the pill when it fits on screen, above it otherwise — a pill on the
  // letter's last line would push its input out of sight.
  useLayoutEffect(() => {
    if (!editor || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    if (!flipUp && rect.bottom > window.innerHeight - 8 && rect.height < editor.anchorTop) {
      setFlipUp(true);
    }
  }, [editor, flipUp]);

  // Outside click cancels — the same as Esc. Applying is always explicit.
  useEffect(() => {
    if (!editor) return;
    const onMouseDown = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setEditor(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [editor]);

  const apply = (wartosc: string) => {
    if (!editor || !editor.kind) return;
    onValuesChange(withFieldValue(values, editor.nazwa, wartosc.trim()));
    setEditor(null);
  };

  /**
   * The subject is one line of plain text: a `{{Tabela pól}}` pasted into it is
   * spelled out as the send spells it there (`renderPlain`), never drawn as a table.
   */
  const subjectDisplay = useMemo<ChipDisplayResolver>(
    () => (ref) =>
      isFieldTableField(ref.nazwa)
        ? { text: renderPlain(fieldPlaceholder(ref.nazwa), ctx) || '…', tone: 'locked', title: t.mveChipTable }
        : display(ref),
    [display, ctx, t],
  );

  const subject = usePlaceholderChips({
    value: temat,
    onChange: (next) => onTematChange?.(next),
    fields: subjectFields,
    labels: chipLabels,
    mode: 'text',
    display: subjectDisplay,
    onChipActivate,
    skipUnchanged: true,
  });

  /**
   * Fields still waiting for a value, across the subject and the body — the
   * subject goes out too, even when this editor does not show it.
   */
  const missing = useMemo(() => missingFieldValues(ctx, temat, tresc), [ctx, temat, tresc]);

  /** "Do uzupełnienia: X" → open X's popover on its first pill in the letter. */
  const jumpToField = (nazwa: string, button: HTMLElement) => {
    const key = normalizeFieldName(nazwa);
    const chip = Array.from(
      wrapperRef.current?.querySelectorAll<HTMLElement>('.ff-chip[data-ff-field]') ?? [],
    ).find((el) => normalizeFieldName(el.getAttribute('data-ff-field') ?? '') === key);
    if (chip) {
      chip.scrollIntoView({ block: 'nearest' });
      openEditor({ nazwa: chip.getAttribute('data-ff-field') ?? nazwa, part: 'full' }, chip);
    } else {
      // Only in a hidden subject: anchor to the button itself.
      openEditor({ nazwa, part: 'full' }, button);
    }
  };

  const logoHtml = useMemo(() => buildLogoHeader(MAILING_LOGO_SVG_DATA_URI, { flush: true }), []);

  /**
   * The mail's frame around the editable text — page tint, card, letterhead —
   * from the same colours and the same letterhead markup the send uses, so the
   * letter being edited is the letter that arrives.
   */
  const renderLetter = (content: React.ReactElement) => (
    <div
      className="mve-page"
      // `--mve-text` feeds the light palette the stylesheet sets up for the
      // letter, so text, table cells and placeholders all share the mail's ink.
      style={{ backgroundColor: MAIL_PAGE_COLOR, '--mve-text': MAIL_TEXT_COLOR } as React.CSSProperties}
    >
      <div
        className="mve-card"
        style={{
          maxWidth: `${MAIL_CARD_WIDTH}px`,
          backgroundColor: MAIL_CARD_COLOR,
          borderColor: MAIL_BORDER_COLOR,
        }}
      >
        {showLetterhead && <div className="mve-logo" dangerouslySetInnerHTML={{ __html: logoHtml }} />}
        {content}
      </div>
    </div>
  );

  const inputType = editor?.kind === 'data' ? 'date' : editor?.kind === 'godzina' ? 'time' : 'text';
  const popoverTop = editor
    ? flipUp
      ? undefined
      : editor.anchorBottom + 6
    : undefined;
  const popoverBottom =
    editor && flipUp && wrapperRef.current
      ? wrapperRef.current.getBoundingClientRect().height - editor.anchorTop + 6
      : undefined;

  return (
    <div className="mve" ref={wrapperRef}>
      {!hideHint && !readOnly && (
        <div className="mve-hint">
          <Icon name="edit" size={13} />
          <span>{t.mveHint}</span>
        </div>
      )}

      {onTematChange && (
        <div className="mve-subject">
          <span className="mve-subject__label">{t.mveSubjectLabel}</span>
          <div
            ref={subject.elementRef}
            className="chip-input mve-subject__input"
            contentEditable={!readOnly}
            suppressContentEditableWarning
            role="textbox"
            aria-label={t.mveSubjectLabel}
            {...subject.handlers}
            data-placeholder={temat ? '' : t.mveSubjectPlaceholder}
          />
        </div>
      )}

      <RichTextEditor
        className="mve-rte"
        contentClassName="mve-body ff-body"
        fields={fields}
        fieldLabels={chipLabels}
        value={tresc}
        onChange={onTrescChange}
        placeholder={t.mveBodyPlaceholder}
        minHeight={180}
        chipDisplay={display}
        onChipActivate={onChipActivate}
        skipUnchangedEmits
        renderContent={renderLetter}
        readOnly={readOnly}
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

      {(missing.length > 0 || onSaveAsTemplate) && (
        <div className="mve-footer">
          {missing.length > 0 ? (
            <div className="mve-missing">
              <Icon name="alert-triangle" size={14} />
              <span>{t.mveMissingTitle}</span>
              {missing.map((nazwa) => (
                <button
                  key={nazwa}
                  type="button"
                  className="mve-missing__item"
                  onClick={(e) => jumpToField(nazwa, e.currentTarget)}
                  disabled={readOnly}
                  title={t.mveChipClickToFill}
                >
                  {nazwa}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          {onSaveAsTemplate && !readOnly && (
            <button type="button" className="button button-secondary button-small" onClick={onSaveAsTemplate}>
              <Icon name="save" size={14} /> {t.mveSaveAsTemplate}
            </button>
          )}
        </div>
      )}

      {editor && (
        <div
          ref={popoverRef}
          className="mve-popover"
          role="dialog"
          aria-label={editor.title}
          style={{
            top: popoverTop,
            bottom: popoverBottom,
            left: editor.left,
            width: `min(${POPOVER_WIDTH}px, 100%)`,
          }}
          onKeyDown={(e) => {
            // Stopped here so an Esc meant for the popover does not also close a
            // modal the editor sits in (ModalDismiss listens on the document).
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditor(null);
            }
          }}
        >
          <div className="mve-popover__title">{editor.title}</div>
          {editor.kind ? (
            <>
              {editor.hint && <div className="mve-popover__hint">„{editor.hint}”</div>}
              <div className="mve-popover__row">
                <input
                  type={inputType}
                  value={editor.draft}
                  autoFocus
                  placeholder={t.mvePopoverPlaceholder}
                  onChange={(e) => {
                    const draft = e.target.value;
                    setEditor((prev) => (prev ? { ...prev, draft } : prev));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      apply(editor.draft);
                    }
                  }}
                />
                {editor.unit && <span className="mve-popover__unit">{editor.unit}</span>}
              </div>
              <div className="mve-popover__keys">{t.mvePopoverKeys}</div>
              <div className="mve-popover__actions">
                {readFieldValue(values, editor.nazwa) && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => apply('')}
                    style={{ marginRight: 'auto' }}
                  >
                    {t.mvePopoverClear}
                  </button>
                )}
                <button type="button" className="button button-secondary button-small" onClick={() => setEditor(null)}>
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => apply(editor.draft)}
                >
                  {t.mvePopoverApply}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mve-popover__info">
                <Icon name="info" size={13} /> <span>{editor.info}</span>
              </div>
              <div className="mve-popover__actions">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setEditor(null)}
                  autoFocus
                >
                  {t.mvePopoverOk}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MailingVisualEditor;
