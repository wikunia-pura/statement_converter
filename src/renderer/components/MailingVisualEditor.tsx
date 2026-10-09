import { createPortal } from 'react-dom';
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
  /**
   * The fields the table can hold (the template's shortlist). With
   * `onTableFieldsChange` the table in the letter becomes editable: clicking it
   * opens a card to tick its rows and type their values.
   */
  tablePool?: MailingPole[];
  onTableFieldsChange?: (names: string[]) => void;
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
/** The table's card is wider: a row is a tick, a label and an input. */
const TABLE_POPOVER_WIDTH = 460;
/** Room kept between the card and the window's edge, and between card and pill. */
const VIEWPORT_MARGIN = 8;
const GAP = 6;

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
  /** The `{{Tabela pól}}` card: rows to tick and fill in place. */
  table?: boolean;
  draft: string;
  /** Anchor geometry in viewport coordinates — the card is fixed to the window. */
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
  tablePool,
  onTableFieldsChange,
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
  const [fit, setFit] = useState<{ up: boolean; maxHeight: number } | null>(null);
  const tableEditable = !readOnly && !!tablePool && !!onTableFieldsChange;

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
          const tone = tableEditable ? 'editable' : 'locked';
          const title = tableEditable ? t.mveChipTableEdit : t.mveChipTable;
          return html
            ? { text: '', html, tone, title }
            : { text: '', missing: t.mveTableEmpty, tone, title };
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
    [ctx, pola, t, chipLabels, readOnly, tableEditable],
  );

  /** A read-only letter explains nothing on hover — the tooltips are for the editor. */
  const shownDisplay = useMemo<ChipDisplayResolver>(
    () => (readOnly ? (ref: MailingFieldRef) => ({ ...display(ref), title: '' }) : display),
    [display, readOnly],
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
        return tableEditable
          ? { nazwa: ref.nazwa, title: ref.nazwa, kind: null, table: true }
          : { nazwa: ref.nazwa, title: ref.nazwa, kind: null, info: t.mveChipTable };
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
    [ctx, pola, t, chipLabels, tableEditable],
  );

  /** Open the popover for a field, anchored under the element that asked for it. */
  const openEditor = useCallback(
    (ref: MailingFieldRef, anchor: HTMLElement) => {
      const a = anchor.getBoundingClientRect();
      const described = describeField(ref);
      const width = Math.min(
        described.table ? TABLE_POPOVER_WIDTH : POPOVER_WIDTH,
        window.innerWidth - 2 * VIEWPORT_MARGIN,
      );
      setFit(null);
      setEditor({
        ...described,
        draft: described.kind ? readFieldValue(values, described.nazwa) : '',
        anchorTop: a.top,
        anchorBottom: a.bottom,
        left: Math.max(VIEWPORT_MARGIN, Math.min(a.left, window.innerWidth - width - VIEWPORT_MARGIN)),
      });
    },
    [describeField, values],
  );

  // Read-only still passes a handler: without one a click falls back to the
  // template editor's click-to-cycle, which would rewrite the placeholder's part
  // (and publish it) in a letter that is not meant to change.
  const onChipActivate = readOnly ? ignoreChipActivate : openEditor;

  // Below the pill when it fits in the window, above it otherwise, and capped
  // to the room there is — the card is fixed to the window, so it never grows
  // the scrolling letter under it (which made the page jump).
  useLayoutEffect(() => {
    if (!editor || !popoverRef.current || fit) return;
    const height = popoverRef.current.getBoundingClientRect().height;
    const below = window.innerHeight - editor.anchorBottom - GAP - VIEWPORT_MARGIN;
    const above = editor.anchorTop - GAP - VIEWPORT_MARGIN;
    const up = height > below && above > below;
    setFit({ up, maxHeight: Math.max(160, up ? above : below) });
  }, [editor, fit]);

  // The letter scrolling or the window resizing moves the pill away from a card
  // fixed to the window — close it rather than leave it floating over nothing.
  useEffect(() => {
    if (!editor) return;
    const onMove = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setEditor(null);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [editor]);

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

  /** One row of the table card: tick, label, value. Typing a value ticks the row. */
  const setTableRow = (pole: MailingPole, patch: { checked?: boolean; value?: string }) => {
    if (!tablePool || !onTableFieldsChange) return;
    const key = normalizeFieldName(pole.nazwa);
    const isTicked = (name: string) => (tableFields ?? NO_FIELDS).some((n) => normalizeFieldName(n) === normalizeFieldName(name));
    let on = patch.checked ?? isTicked(pole.nazwa);
    if (patch.value !== undefined) {
      onValuesChange(withFieldValue(values, pole.nazwa, patch.value));
      if (patch.value.trim()) on = true;
    }
    onTableFieldsChange(
      tablePool
        .filter((p) => (normalizeFieldName(p.nazwa) === key ? on : isTicked(p.nazwa)))
        .map((p) => p.nazwa),
    );
  };

  const tableRows = editor?.table ? (
    tablePool && tablePool.length > 0 ? (
      <div className="mve-table">
        {tablePool.map((p) => {
          const checked = (tableFields ?? NO_FIELDS).some(
            (n) => normalizeFieldName(n) === normalizeFieldName(p.nazwa),
          );
          return (
            <div key={p.id} className="mve-table__row">
              <label className={`ks-check${checked ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="ks-check__input"
                  checked={checked}
                  onChange={(e) => setTableRow(p, { checked: e.target.checked })}
                  aria-label={p.nazwa}
                />
                <span className="ks-check__box" aria-hidden="true">
                  <Icon name="check" size={12} strokeWidth={3} />
                </span>
              </label>
              <span className="mve-table__label" title={p.nazwa}>
                {p.tekst || p.nazwa}
              </span>
              <input
                className="mve-table__input"
                type={p.typWartosci === 'data' ? 'date' : p.typWartosci === 'godzina' ? 'time' : 'text'}
                value={readFieldValue(values, p.nazwa)}
                placeholder={t.mvePopoverPlaceholder}
                aria-label={`${t.mailingFieldValue}: ${p.tekst || p.nazwa}`}
                onChange={(e) => setTableRow(p, { value: e.target.value })}
              />
              {p.jednostka && <span className="mve-popover__unit">{p.jednostka}</span>}
            </div>
          );
        })}
      </div>
    ) : (
      <div className="mve-popover__info">
        <Icon name="info" size={13} /> <span>{t.mailingFieldTableNoPool}</span>
      </div>
    )
  ) : null;

  const inputType = editor?.kind === 'data' ? 'date' : editor?.kind === 'godzina' ? 'time' : 'text';
  return (
    <div className={`mve${readOnly ? ' mve--readonly' : ''}`} ref={wrapperRef}>
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
        chipDisplay={shownDisplay}
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

      {editor &&
        createPortal(
          <div
            ref={popoverRef}
            className="mve-popover"
            role="dialog"
            aria-label={editor.title}
            style={{
              position: 'fixed',
              zIndex: 3000,
              // Measured once at natural size (fit null) — hidden until placed.
              visibility: fit ? 'visible' : 'hidden',
              ...(fit?.up
                ? { bottom: window.innerHeight - editor.anchorTop + GAP }
                : { top: editor.anchorBottom + GAP }),
              left: editor.left,
              width: `min(${editor.table ? TABLE_POPOVER_WIDTH : POPOVER_WIDTH}px, calc(100vw - ${2 * VIEWPORT_MARGIN}px))`,
              maxHeight: fit?.maxHeight,
              overflowY: 'auto',
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
            {editor.table ? (
              <>
                {tableRows}
                <div className="mve-popover__actions">
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={() => setEditor(null)}
                    autoFocus
                  >
                    {t.mvePopoverOk}
                  </button>
                </div>
              </>
            ) : editor.kind ? (
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
          </div>,
        document.body,
      )}
    </div>
  );
};

export default MailingVisualEditor;
