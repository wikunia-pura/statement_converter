import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect, { SearchableOption } from './SearchableSelect';
import {
  MailingFieldPart,
  escapeHtml,
  fieldPlaceholder,
  htmlToPlainText,
  isBuiltinField,
  normalizeFieldName,
  parseFieldRef,
  placeholderRegExp,
} from '../../shared/mailing-template';

/**
 * Dynamic fields as pills.
 *
 * A placeholder is stored as `{{Nazwa}}` — one string the database, the history,
 * the preview and the main process all read the same way. Braces are a poor thing
 * to *edit*, though: they are easy to break with a stray keystroke, they hide
 * which half of the field is being placed, and a wall of them stops reading as a
 * letter. So the editors show every placeholder as a non-editable pill and
 * convert back to braces on the way out. Nothing downstream learns about pills:
 * they are put on when text enters an editor and taken off when it leaves.
 *
 * Both editors — the rich-text body and the single-line subject — sit on
 * `usePlaceholderChips` below, so a pill behaves identically in either.
 */

/** Marks a pill in the editor DOM. Never reaches the stored HTML. */
export const CHIP_CLASS = 'ff-chip';

/**
 * Zero-width space kept between two touching pills.
 *
 * Two `contenteditable="false"` elements with nothing between them leave the
 * caret nowhere to land, so a comma or a space between two fields cannot be
 * typed at all. This gives that position a text node to be in. It exists only
 * while editing — like the pills themselves, it is taken off on the way out.
 */
const CARET_SLOT = '\u200B';
const FIELD_ATTR = 'data-ff-field';
const PART_ATTR = 'data-ff-part';

/** Clicking a pill steps through the halves, so a wrong pick costs one click. */
const PART_CYCLE: MailingFieldPart[] = ['full', 'label', 'value'];

/** A field offered by the insert picker. */
export interface MailingFieldOption {
  /** Field name — the placeholder's identity. */
  nazwa: string;
  /** Second line in the picker: the field's fixed sentence, or what it resolves to. */
  hint?: string;
  /** Extra search terms. */
  keywords?: string;
  /**
   * Built-ins resolve from the send context (community, date, field table), so
   * they have no sentence/value halves: they insert whole and never cycle.
   */
  builtin?: boolean;
}

/** Everything the pills need to render, owned by the parent's translations. */
export interface FieldChipLabels {
  partFull: string;
  partLabel: string;
  partValue: string;
  /** Lead-in before the part switch, e.g. "Wstaw:". */
  insertMode: string;
  /** Tooltip on a pill that can be cycled. */
  chipHint: string;
  /** Tooltip on a built-in pill. */
  chipBuiltinHint: string;
  /** Tooltip on a pill naming a field that no longer exists. */
  chipUnknown: string;
  insertField: string;
  insertFieldSearch: string;
  insertFieldNoMatch: string;
}

/** What `decorateChips` and friends need to build a pill. */
interface ChipContext {
  labels: FieldChipLabels;
  /** Normalized names of the defined fields — anything else is flagged. */
  known: Set<string>;
}

/**
 * Elements the caret can sit inside at the end of the content, and which are
 * therefore worth descending into. A pill is never one of them: it is an atom.
 */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'TR', 'TD', 'TH',
]);

/**
 * The deepest block the end of the content belongs to. Text typed with no caret
 * of its own belongs inside the last paragraph, not after it — see the note in
 * `insertField` on what a pill outside a block looks like.
 */
function lastEditableBlock(root: HTMLElement): HTMLElement {
  let node: HTMLElement = root;
  for (;;) {
    const last = node.lastElementChild;
    if (!(last instanceof HTMLElement) || !BLOCK_TAGS.has(last.tagName)) return node;
    node = last;
  }
}

function partToken(part: MailingFieldPart, labels: FieldChipLabels): string {
  if (part === 'label') return labels.partLabel;
  if (part === 'value') return labels.partValue;
  return labels.partFull;
}

function readPart(chip: Element): MailingFieldPart {
  const raw = chip.getAttribute(PART_ATTR);
  return raw === 'label' || raw === 'value' ? raw : 'full';
}

/**
 * One pill, built as DOM rather than as an HTML string: field names are
 * user-typed, and `textContent` cannot be broken by a `<` or a quote in one.
 */
function buildChip(nazwa: string, part: MailingFieldPart, ctx: ChipContext): HTMLElement {
  const builtin = isBuiltinField(nazwa);
  const known = builtin || ctx.known.has(normalizeFieldName(nazwa));
  const el = document.createElement('span');
  el.className =
    CHIP_CLASS +
    (known ? '' : ` ${CHIP_CLASS}--unknown`) +
    (builtin ? ` ${CHIP_CLASS}--builtin` : '');
  el.setAttribute(FIELD_ATTR, nazwa);
  el.setAttribute(PART_ATTR, part);
  // The pill is one atom: the caret cannot land inside it, Backspace removes the
  // whole placeholder, and no keystroke can leave half a `{{`.
  el.contentEditable = 'false';
  el.title = !known
    ? ctx.labels.chipUnknown
    : builtin
      ? ctx.labels.chipBuiltinHint
      : ctx.labels.chipHint;
  el.appendChild(document.createTextNode(nazwa));
  if (part !== 'full') {
    const badge = document.createElement('span');
    badge.className = `${CHIP_CLASS}__part`;
    badge.textContent = partToken(part, ctx.labels);
    el.appendChild(badge);
  }
  return el;
}

/** Swap every pill in a detached tree back for its `{{…}}` text. */
function unchip(root: HTMLElement): void {
  for (const chip of Array.from(root.querySelectorAll(`.${CHIP_CLASS}`))) {
    const nazwa = chip.getAttribute(FIELD_ATTR);
    chip.replaceWith(
      document.createTextNode(nazwa ? fieldPlaceholder(nazwa, readPart(chip)) : ''),
    );
  }
}

/**
 * Take the pills off the live DOM, leaving their `{{…}}` text behind. Every pill
 * is replaced one-for-one, so each container keeps its child count and a saved
 * selection boundary stays meaningful.
 */
export function undecorateChips(root: HTMLElement): void {
  unchip(root);
}

/** Give every pair of touching pills a caret slot between them — see CARET_SLOT. */
function ensureChipSeparators(root: HTMLElement): void {
  // The list is taken first: the loop inserts nodes into the tree it walks.
  for (const chip of Array.from(root.querySelectorAll(`.${CHIP_CLASS}`))) {
    const next = chip.nextSibling;
    if (next instanceof Element && next.classList.contains(CHIP_CLASS)) {
      chip.parentNode?.insertBefore(document.createTextNode(CARET_SLOT), next);
    }
  }
}

/** Editing-only characters, gone before the value reaches anyone else. */
function stripCaretSlots(html: string): string {
  return html.split(CARET_SLOT).join('');
}

/** The editor's content as it is stored: pills back to `{{…}}`, nothing else changed. */
export function serializeChips(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  unchip(clone);
  return stripCaretSlots(clone.innerHTML);
}

/** Same, for a copied selection. */
function serializeFragment(fragment: DocumentFragment): { html: string; text: string } {
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  unchip(holder);
  const html = stripCaretSlots(holder.innerHTML);
  return { html, text: htmlToPlainText(html) };
}

/** Turn every `{{…}}` in the editor's text nodes into a pill. */
export function decorateChips(root: HTMLElement, ctx: ChipContext): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    // A pill's own caption is not text to re-scan.
    if (node.parentElement?.closest(`.${CHIP_CLASS}`)) continue;
    if (node.data.includes('{{')) targets.push(node);
  }
  for (const node of targets) {
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of node.data.matchAll(placeholderRegExp())) {
      const at = match.index ?? 0;
      if (at > last) fragment.appendChild(document.createTextNode(node.data.slice(last, at)));
      const ref = parseFieldRef(match[1]);
      fragment.appendChild(buildChip(ref.nazwa, ref.part, ctx));
      last = at + match[0].length;
    }
    if (last === 0) continue;
    if (last < node.data.length) fragment.appendChild(document.createTextNode(node.data.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
  }
  // `{{A}}{{B}}` written side by side arrives here as two touching pills.
  ensureChipSeparators(root);
}

/**
 * Rebuild existing pills. Needed once, when the field dictionary arrives after
 * the editor has already rendered its text — otherwise every pill would sit
 * there flagged as an unknown field.
 */
function refreshChips(root: HTMLElement, ctx: ChipContext): void {
  for (const chip of Array.from(root.querySelectorAll(`.${CHIP_CLASS}`))) {
    const nazwa = chip.getAttribute(FIELD_ATTR);
    if (!nazwa) continue;
    chip.replaceWith(buildChip(nazwa, readPart(chip), ctx));
  }
}

/** Pasted plain text, with its placeholders already turned into pills. */
function pasteHtml(text: string, ctx: ChipContext, mode: ChipEditorMode): string {
  const asText = (part: string) => {
    const escaped = escapeHtml(part);
    return mode === 'text'
      ? escaped.replace(/\s*[\r\n]+\s*/g, ' ')
      : escaped.replace(/\r\n|\r|\n/g, '<br>');
  };
  let out = '';
  let last = 0;
  for (const match of text.matchAll(placeholderRegExp())) {
    const at = match.index ?? 0;
    out += asText(text.slice(last, at));
    const ref = parseFieldRef(match[1]);
    out += buildChip(ref.nazwa, ref.part, ctx).outerHTML;
    last = at + match[0].length;
  }
  return out + asText(text.slice(last));
}

/**
 * What the editor's value *is*. `html` is the mail body — formatting is part of
 * the content. `text` is the subject line: one plain string that ends up in a
 * mail header, so markup must never survive a round trip through the editor, and
 * Enter has nothing to mean.
 */
export type ChipEditorMode = 'html' | 'text';

export interface PlaceholderChipsOptions {
  /** Stored value, with `{{…}}` placeholders: HTML or plain text per `mode`. */
  value: string;
  onChange: (value: string) => void;
  fields: MailingFieldOption[];
  labels: FieldChipLabels;
  mode?: ChipEditorMode;
}

export interface PlaceholderChips {
  /** Attach to the `contentEditable` element. */
  elementRef: React.RefObject<HTMLDivElement>;
  /** Spread onto the same element. */
  handlers: {
    onInput: () => void;
    onBlur: () => void;
    onPaste: (event: React.ClipboardEvent) => void;
    onCopy: (event: React.ClipboardEvent) => void;
    onCut: (event: React.ClipboardEvent) => void;
    onClick: (event: React.MouseEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
  /** Insert a field's pill at the caret. */
  insertField: (nazwa: string, part: MailingFieldPart) => void;
  /** Put the caret back inside before running a command that acts on the selection. */
  ensureCaretInside: () => void;
  /** Publish the current content to `onChange`. */
  emit: () => void;
  /**
   * Run a native editing command with the pills taken off, then put them back.
   *
   * `execCommand` treats a non-editable span as an atom it may relocate: running
   * `removeFormat` over a paragraph containing pills moves them out of it and
   * leaves `<br>`s where they were. Commands wrapped here see the plain `{{…}}`
   * text they saw before pills existed.
   */
  withoutChips: (run: () => void) => void;
}

/**
 * The pill-aware half of a contentEditable editor: prop syncing, serialization,
 * insertion at the caret, click-to-cycle, and clipboard handling that keeps
 * placeholders intact across a copy.
 */
export function usePlaceholderChips({
  value,
  onChange,
  fields,
  labels,
  mode = 'html',
}: PlaceholderChipsOptions): PlaceholderChips {
  const elementRef = useRef<HTMLDivElement>(null);
  /**
   * Last caret position seen inside the editor. Picking a field goes through a
   * dropdown with a search box, which takes the document selection out of the
   * editor — without this the pill would land at the end of the text instead of
   * where the user left off.
   */
  const savedRangeRef = useRef<Range | null>(null);
  /**
   * The value this editor last published. The DOM holds pills, so it never equals
   * `value` literally; comparing against our own last emission is what keeps the
   * caret from being thrown to the start on every keystroke.
   */
  const lastValueRef = useRef<string | null>(null);

  const known = useMemo(
    () =>
      new Set(
        fields.filter((f) => !f.builtin).map((f) => normalizeFieldName(f.nazwa)),
      ),
    [fields],
  );

  // Read through a ref inside DOM helpers: the pills must follow the current
  // labels and dictionary without those becoming reasons to rewrite the content.
  const ctxRef = useRef<ChipContext>({ known, labels });
  ctxRef.current = { known, labels };

  const emit = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    const html = serializeChips(el);
    // In text mode the markup is an implementation detail of editing, not part of
    // the value: a subject is a mail header, and a stray <div> in it would be sent
    // literally.
    const next = mode === 'text' ? htmlToPlainText(html) : html;
    lastValueRef.current = next;
    onChange(next);
  }, [onChange, mode]);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (value === lastValueRef.current) return;
    el.innerHTML = mode === 'text' ? escapeHtml(value || '') : value || '';
    decorateChips(el, ctxRef.current);
    lastValueRef.current = value;
  }, [value, mode]);

  // The dictionary usually loads before the text, but not always — a template
  // opened while `pola` is still in flight would show every pill as unknown.
  useEffect(() => {
    const el = elementRef.current;
    if (el) refreshChips(el, ctxRef.current);
  }, [known]);

  useEffect(() => {
    const onSelectionChange = () => {
      const el = elementRef.current;
      const selection = window.getSelection();
      if (!el || !selection || selection.rangeCount === 0) return;
      if (!selection.anchorNode || !el.contains(selection.anchorNode)) return;
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const ensureCaretInside = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    const selection = window.getSelection();
    // Whether the caret is in the editor has to be read *before* focusing it:
    // focus() on a contentEditable the user has left drops a caret at its very
    // start, which then looks exactly like "the caret is already inside" — and a
    // field picked from the toolbar would land at the top of the letter instead
    // of where the user was writing.
    const inside = Boolean(
      selection &&
        selection.rangeCount > 0 &&
        selection.anchorNode &&
        el.contains(selection.anchorNode),
    );
    el.focus();
    if (inside) return;
    // The remembered caret, when it still points into the current content — a
    // stale range would throw or insert in the wrong place.
    const saved = savedRangeRef.current;
    if (selection && saved && el.contains(saved.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
      return;
    }
    const range = document.createRange();
    const block = lastEditableBlock(el);
    const tail = block.lastChild;
    // A block's trailing <br> is the browser's own "this line exists" marker, so
    // the caret goes before it: after it, the pill would open a second line
    // inside the paragraph — the very thing this fallback must not do.
    if (tail && tail.nodeName === 'BR') {
      range.setStartBefore(tail);
      range.collapse(true);
    } else {
      range.selectNodeContents(block);
      range.collapse(false);
    }
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  /**
   * Leave the caret immediately after `node`, so typing continues past a pill
   * that was just inserted or switched.
   *
   * A position in the parent, not inside a text node placed there for the
   * purpose: an empty text node beside a non-editable element confuses Chromium's
   * own editing commands, and Backspace stops removing the pill as one atom.
   */
  const caretAfter = (node: Node) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const insertField = useCallback(
    (nazwa: string, part: MailingFieldPart) => {
      const el = elementRef.current;
      if (!el) return;
      ensureCaretInside();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer)) return;
      const chip = buildChip(nazwa, part, ctxRef.current);
      // Placed through the range rather than with execCommand('insertHTML').
      // Chromium treats a contenteditable="false" element as an atom it refuses
      // to keep at a block's edge: with the caret at the start or the end of a
      // paragraph — where it is after writing a sentence — it lifts the pill out
      // of the <p> and drops it beside it, and a pill that is a sibling of a
      // paragraph renders on its own line. A range puts the node exactly where
      // the caret was. The cost is that inserting a pill is no longer a step in
      // the browser's own undo stack.
      range.deleteContents();
      range.insertNode(chip);
      ensureChipSeparators(el);
      caretAfter(chip);
      emit();
    },
    [emit, ensureCaretInside],
  );

  const withoutChips = useCallback(
    (run: () => void) => {
      const el = elementRef.current;
      if (!el) return;
      const selection = window.getSelection();
      const inside =
        selection &&
        selection.rangeCount > 0 &&
        selection.anchorNode &&
        el.contains(selection.anchorNode);
      const saved = inside ? selection.getRangeAt(0) : null;
      const bounds = saved
        ? {
            startContainer: saved.startContainer,
            startOffset: saved.startOffset,
            endContainer: saved.endContainer,
            endOffset: saved.endOffset,
          }
        : null;

      undecorateChips(el);

      if (bounds) {
        // The boundaries survive the swap — a pill is replaced one-for-one and
        // the caret can never sit inside one — but a selection the browser
        // adjusted on its own may not, hence the guard.
        try {
          const range = document.createRange();
          range.setStart(bounds.startContainer, bounds.startOffset);
          range.setEnd(bounds.endContainer, bounds.endOffset);
          selection?.removeAllRanges();
          selection?.addRange(range);
        } catch {
          /* Leave the selection where the browser put it. */
        }
      }

      run();
      decorateChips(el, ctxRef.current);
      emit();
    },
    [emit],
  );

  const handlers = {
    onInput: emit,

    /**
     * Placeholders typed by hand (or arriving with a paste into an older
     * template) become pills when the user leaves the editor — the one moment
     * where re-writing the content cannot disturb the caret.
     */
    onBlur: () => {
      const el = elementRef.current;
      if (!el) return;
      decorateChips(el, ctxRef.current);
      emit();
    },

    onPaste: (event: React.ClipboardEvent) => {
      event.preventDefault();
      // Plain text only: a fragment copied out of Word carries markup that renders
      // differently in a mail client than in the PDF, which is exactly the
      // divergence the mailing module must avoid. Placeholders in the pasted text
      // still arrive as pills.
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      ensureCaretInside();
      document.execCommand('insertHTML', false, pasteHtml(text, ctxRef.current, mode));
      const el = elementRef.current;
      if (el) ensureChipSeparators(el);
      emit();
    },

    /**
     * Copy the placeholders, not the pill captions. Without this, copying a table
     * row would paste the field's *name* as literal text and the placeholder
     * would be silently gone.
     */
    onCopy: (event: React.ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const { html, text } = serializeFragment(selection.getRangeAt(0).cloneContents());
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    },

    onCut: (event: React.ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const { html, text } = serializeFragment(selection.getRangeAt(0).cloneContents());
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      document.execCommand('delete');
      emit();
    },

    /** Click a pill to step through whole field → sentence only → value only. */
    onClick: (event: React.MouseEvent) => {
      const el = elementRef.current;
      const chip = (event.target as HTMLElement | null)?.closest?.(`.${CHIP_CLASS}`);
      if (!el || !chip || !el.contains(chip)) return;
      const nazwa = chip.getAttribute(FIELD_ATTR);
      // Built-ins have no halves to switch between.
      if (!nazwa || isBuiltinField(nazwa)) return;
      const next = PART_CYCLE[(PART_CYCLE.indexOf(readPart(chip)) + 1) % PART_CYCLE.length];
      const fresh = buildChip(nazwa, next, ctxRef.current);
      chip.replaceWith(fresh);
      caretAfter(fresh);
      emit();
    },

    onKeyDown: (event: React.KeyboardEvent) => {
      // A subject is one line; Enter here would put a <br> into a string that is
      // sent as a mail header.
      if (mode === 'text' && event.key === 'Enter') event.preventDefault();
    },
  };

  return { elementRef, handlers, insertField, ensureCaretInside, emit, withoutChips };
}

interface ChipTextInputProps {
  /** Plain-text value with `{{…}}` placeholders — a subject line. */
  value: string;
  onChange: (text: string) => void;
  fields: MailingFieldOption[];
  labels: FieldChipLabels;
  placeholder?: string;
  onDirty?: () => void;
}

/**
 * The subject line: an `<input>` in every respect the user can see, except that
 * the placeholders inside it are pills.
 *
 * It has to be a contentEditable — a text input can only hold characters — and
 * that is worth the swap: the subject carries `{{Adres Wspólnoty}}` in nearly
 * every template, and leaving braces here while the body shows pills would make
 * the two halves of one form look like two different features.
 */
export const ChipTextInput: React.FC<ChipTextInputProps> = ({
  value,
  onChange,
  fields,
  labels,
  placeholder,
  onDirty,
}) => {
  const { elementRef, handlers, insertField } = usePlaceholderChips({
    value,
    onChange: (text) => {
      onChange(text);
      onDirty?.();
    },
    fields,
    labels,
    mode: 'text',
  });

  return (
    <>
      <div
        ref={elementRef}
        className="chip-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        {...handlers}
        data-placeholder={value ? '' : placeholder ?? ''}
      />
      <FieldInsertPicker fields={fields} labels={labels} onInsert={insertField} />
    </>
  );
};

interface FieldInsertPickerProps {
  fields: MailingFieldOption[];
  labels: FieldChipLabels;
  onInsert: (nazwa: string, part: MailingFieldPart) => void;
  /** Compact form for the editor toolbar. */
  compact?: boolean;
  style?: React.CSSProperties;
}

/**
 * The insert control: which half to place, then which field.
 *
 * The half is a switch beside the picker rather than three entries per field in
 * it — the dictionary runs to dozens of fields, and tripling it would turn a list
 * you scan into a list you search three times. It stays where the user left it,
 * which is what filling a two-column table wants: pick "opis", insert the four
 * rows' labels, switch to "wartość", insert the four values.
 */
export const FieldInsertPicker: React.FC<FieldInsertPickerProps> = ({
  fields,
  labels,
  onInsert,
  compact = false,
  style,
}) => {
  const [part, setPart] = useState<MailingFieldPart>('full');

  const options = useMemo<SearchableOption[]>(
    () =>
      fields.map((f) => ({
        value: f.nazwa,
        label: f.nazwa,
        hint: f.hint,
        keywords: [f.keywords, f.builtin ? 'wbudowane builtin' : ''].filter(Boolean).join(' '),
      })),
    [fields],
  );

  /**
   * Built-ins ignore the switch — they have no halves — rather than dropping out
   * of the list while a half is selected. A field vanishing from the picker
   * because of an unrelated toggle is a worse surprise than one inserting whole.
   */
  const insert = (nazwa: string) => {
    const field = fields.find((f) => normalizeFieldName(f.nazwa) === normalizeFieldName(nazwa));
    onInsert(nazwa, field?.builtin ? 'full' : part);
  };

  return (
    <div className="ff-insert" style={style}>
      <span className="ff-insert__label">{labels.insertMode}</span>
      <div className="ff-part-toggle" role="group" aria-label={labels.insertMode}>
        {PART_CYCLE.map((option) => (
          <button
            key={option}
            type="button"
            className={`ff-part-toggle__item${part === option ? ' is-active' : ''}`}
            aria-pressed={part === option}
            onClick={() => setPart(option)}
          >
            {partToken(option, labels)}
          </button>
        ))}
      </div>
      <SearchableSelect
        // Always empty: this is an action ("insert this here"), so the trigger
        // keeps inviting the next insertion.
        value=""
        options={options}
        onChange={insert}
        placeholder={labels.insertField}
        searchPlaceholder={labels.insertFieldSearch}
        emptyText={labels.insertFieldNoMatch}
        size="sm"
        title={labels.insertField}
        ariaLabel={labels.insertField}
        style={{ width: compact ? '210px' : '100%', maxWidth: '260px' }}
      />
    </div>
  );
};
