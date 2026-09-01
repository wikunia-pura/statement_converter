import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import {
  MAIL_TABLE_CELL_STYLE,
  MAIL_TABLE_HEADER_CELL_STYLE,
  MAIL_TABLE_STYLE,
} from '../../shared/mailing-template';
import {
  CHIP_CLASS,
  FieldChipLabels,
  FieldInsertPicker,
  MailingFieldOption,
  usePlaceholderChips,
} from './fieldChips';

export interface RichTextEditorLabels {
  bold: string;
  italic: string;
  underline: string;
  heading: string;
  bulletList: string;
  numberedList: string;
  clearFormatting: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  table: string;
  tableRows: string;
  tableColumns: string;
  tableHeaderRow: string;
  tableInsert: string;
  tableAddRow: string;
  tableDeleteRow: string;
  tableAddColumn: string;
  tableDeleteColumn: string;
  tableDelete: string;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** Labels for the formatting buttons, so the parent owns the translations. */
  labels: RichTextEditorLabels;
  /**
   * Dynamic fields offered in the toolbar. They also decide which pills read as
   * defined: a placeholder naming none of them is flagged in place.
   */
  fields: MailingFieldOption[];
  /** Labels for the pills and the insert control. */
  fieldLabels: FieldChipLabels;
}

/**
 * Border, padding and header shade of a generated cell — inline, so Outlook keeps
 * them, and taken from shared/mailing-template so a table drawn here looks like
 * the one the app generates for `{{Tabela pól}}`.
 *
 * The editor overrides the header shade for dark mode in CSS (`.rte-content th`),
 * so what you see follows the app theme while what you send stays light.
 */
const CELL_STYLE = MAIL_TABLE_CELL_STYLE;
const HEADER_CELL_STYLE = MAIL_TABLE_HEADER_CELL_STYLE;
const TABLE_STYLE = MAIL_TABLE_STYLE;

/**
 * Small contentEditable editor producing the HTML that becomes both the mail body
 * and the PDF. Built on `document.execCommand`: formally deprecated, but it is
 * still what every Chromium build implements, and it keeps the whole editor at
 * zero dependencies — the alternative is shipping an editor framework for bold,
 * lists, alignment and a table.
 *
 * Dynamic fields show as pills rather than as `{{braces}}`; `usePlaceholderChips`
 * owns that translation, the prop syncing and the caret bookkeeping, so what is
 * left here is the formatting toolbar.
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder,
  minHeight = 220,
  labels,
  fields,
  fieldLabels,
}) => {
    const {
      elementRef: editorRef,
      handlers,
      insertField,
      ensureCaretInside,
      emit,
      withoutChips,
    } = usePlaceholderChips({ value, onChange, fields, labels: fieldLabels });
    const tablePanelRef = useRef<HTMLDivElement>(null);
    const [tablePanelOpen, setTablePanelOpen] = useState(false);
    const [newRows, setNewRows] = useState(2);
    const [newCols, setNewCols] = useState(2);
    const [headerRow, setHeaderRow] = useState(false);
    // Whether the caret currently sits in a table — the row/column buttons only
    // make sense then, and showing them always would suggest they do nothing.
    const [inTable, setInTable] = useState(false);

    /** The table cell holding the caret, or null when it is outside a table. */
    const currentCell = useCallback((): HTMLTableCellElement | null => {
      const el = editorRef.current;
      const selection = window.getSelection();
      if (!el || !selection || selection.rangeCount === 0) return null;
      let node: Node | null = selection.anchorNode;
      while (node && node !== el) {
        if (node instanceof HTMLTableCellElement) return node;
        node = node.parentNode;
      }
      return null;
    }, []);

    // Keep the table-tools row in sync with the caret. Only selections inside the
    // editor count, so clicking a toolbar button (which moves focus) doesn't hide
    // the very buttons the user is reaching for.
    useEffect(() => {
      const onSelectionChange = () => {
        const el = editorRef.current;
        const selection = window.getSelection();
        if (!el || !selection || selection.rangeCount === 0) return;
        if (!selection.anchorNode || !el.contains(selection.anchorNode)) return;
        setInTable(currentCell() !== null);
      };
      document.addEventListener('selectionchange', onSelectionChange);
      return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [currentCell, editorRef]);

    useEffect(() => {
      if (!tablePanelOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        if (tablePanelRef.current && !tablePanelRef.current.contains(event.target as Node)) {
          setTablePanelOpen(false);
        }
      };
      document.addEventListener('mousedown', onMouseDown);
      return () => document.removeEventListener('mousedown', onMouseDown);
    }, [tablePanelOpen]);

    const exec = (command: string, argument?: string) => {
      ensureCaretInside();
      document.execCommand(command, false, argument);
      emit();
    };

    /**
     * Alignment with CSS rather than the legacy `align` attribute: the mail and the
     * PDF are rendered from this HTML, and `text-align` is the form every mail
     * client (including Outlook's Word renderer) still honours.
     */
    const align = (command: 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyFull') => {
      ensureCaretInside();
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(command);
      document.execCommand('styleWithCSS', false, 'false');
      emit();
    };

    /**
     * Clear formatting. `removeFormat` alone looks broken here, and it is not:
     * it needs a non-empty selection (a plain caret is a no-op) and it only
     * touches inline styling — headings, lists and alignment survive it. So:
     * select everything when nothing is selected, run removeFormat, then undo the
     * block-level formatting explicitly and strip the inline styles pasted or
     * generated markup leaves behind.
     */
    const clearFormatting = () => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const selection = window.getSelection();
      const noSelection =
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !el.contains(selection.anchorNode);
      if (noSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }

      // The commands below would relocate the field pills, so they run on the
      // plain `{{…}}` text and the pills go back on afterwards.
      withoutChips(() => clearFormattingCommands(el));
    };

    /** The actual clearing, with no pill in the DOM to be dragged around. */
    const clearFormattingCommands = (el: HTMLElement) => {
      const selection = window.getSelection();
      const noSelection =
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !el.contains(selection.anchorNode);

      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('removeFormat');
      document.execCommand('unlink');
      document.execCommand('styleWithCSS', false, 'false');
      if (document.queryCommandState('insertUnorderedList')) {
        document.execCommand('insertUnorderedList');
      }
      if (document.queryCommandState('insertOrderedList')) {
        document.execCommand('insertOrderedList');
      }
      document.execCommand('formatBlock', false, 'div');
      document.execCommand('justifyLeft');

      // A null range means "the whole body": re-reading the selection after the
      // commands above would point at nodes they have already replaced.
      const after = window.getSelection();
      stripInlineFormatting(
        el,
        noSelection || !after || after.rangeCount === 0 ? null : after.getRangeAt(0),
      );

      // Leaving everything selected would make the next keystroke wipe the body.
      if (noSelection) {
        const caret = document.createRange();
        caret.selectNodeContents(el);
        caret.collapse(false);
        after?.removeAllRanges();
        after?.addRange(caret);
      }
    };

    /**
     * Remove leftovers `removeFormat` does not reach: inline styles (alignment,
     * font sizes) and wrapper tags. A null range means the whole editor. Table
     * structure is deliberately kept — the user asked to clear formatting, not to
     * lose their table — but cells fall back to the border/padding that makes it
     * readable as a table.
     *
     * Pills are skipped: they are spans, so the unwrapping below would dissolve
     * every dynamic field in the letter into its own caption — a placeholder lost
     * to a formatting command, which is not what "clear formatting" may ever mean.
     */
    const stripInlineFormatting = (root: HTMLElement, range: Range | null) => {
      const touched: HTMLElement[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode as HTMLElement;
        if (node.closest(`.${CHIP_CLASS}`)) continue;
        if (!range || range.intersectsNode(node)) touched.push(node);
      }
      for (const node of touched) {
        if (node instanceof HTMLTableCellElement) {
          node.setAttribute('style', CELL_STYLE + (node.tagName === 'TH' ? HEADER_CELL_STYLE : ''));
          continue;
        }
        if (node instanceof HTMLTableElement) {
          node.setAttribute('style', TABLE_STYLE);
          continue;
        }
        node.removeAttribute('style');
        node.removeAttribute('align');
        if (/^(SPAN|FONT|B|STRONG|I|EM|U|S|SMALL|BIG)$/.test(node.tagName)) {
          const parent = node.parentNode;
          if (!parent) continue;
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
        }
      }
    };

    const buildCell = (isHeader: boolean) => {
      const tag = isHeader ? 'th' : 'td';
      return `<${tag} style="${CELL_STYLE}${isHeader ? HEADER_CELL_STYLE : ''}"><br></${tag}>`;
    };

    const insertTable = () => {
      const rows = Math.min(20, Math.max(1, newRows));
      const cols = Math.min(10, Math.max(1, newCols));
      const bodyRows: string[] = [];
      for (let r = 0; r < rows; r += 1) {
        const isHeader = headerRow && r === 0;
        bodyRows.push(`<tr>${buildCell(isHeader).repeat(cols)}</tr>`);
      }
      // A paragraph after the table: without it the caret has nowhere to go below
      // a table that ends the body, and the user cannot keep writing.
      const html =
        `<table style="${TABLE_STYLE}" cellpadding="0" cellspacing="0"><tbody>` +
        `${bodyRows.join('')}</tbody></table><p><br></p>`;
      ensureCaretInside();
      document.execCommand('insertHTML', false, html);
      setTablePanelOpen(false);
      emit();
    };

    /** Run a DOM edit on the table holding the caret, then publish the result. */
    const withCell = (fn: (cell: HTMLTableCellElement, table: HTMLTableElement) => void) => {
      const cell = currentCell();
      const table = cell?.closest('table');
      if (!cell || !table) return;
      fn(cell, table);
      emit();
    };

    const addRow = () =>
      withCell((cell) => {
        const row = cell.parentElement as HTMLTableRowElement | null;
        if (!row) return;
        const fresh = row.cloneNode(false) as HTMLTableRowElement;
        fresh.innerHTML = buildCell(false).repeat(row.cells.length);
        row.parentNode?.insertBefore(fresh, row.nextSibling);
      });

    const deleteRow = () =>
      withCell((cell, table) => {
        const row = cell.parentElement as HTMLTableRowElement | null;
        if (!row) return;
        if (table.rows.length <= 1) {
          table.remove();
          setInTable(false);
          return;
        }
        row.remove();
      });

    const addColumn = () =>
      withCell((cell, table) => {
        const index = cell.cellIndex;
        for (const row of Array.from(table.rows)) {
          const isHeader = row.cells[index]?.tagName === 'TH';
          const fresh = document.createElement(isHeader ? 'th' : 'td');
          fresh.setAttribute('style', CELL_STYLE + (isHeader ? HEADER_CELL_STYLE : ''));
          fresh.innerHTML = '<br>';
          row.insertBefore(fresh, row.cells[index + 1] ?? null);
        }
      });

    const deleteColumn = () =>
      withCell((cell, table) => {
        const index = cell.cellIndex;
        if ((table.rows[0]?.cells.length ?? 0) <= 1) {
          table.remove();
          setInTable(false);
          return;
        }
        for (const row of Array.from(table.rows)) row.cells[index]?.remove();
      });

    const deleteTable = () =>
      withCell((_cell, table) => {
        table.remove();
        setInTable(false);
      });

    const isEmpty = !value || value === '<br>' || value === '<p></p>';

    return (
      <div className="rte">
        <div className="rte-toolbar">
          <button type="button" className="button button-ghost button-icon" title={labels.bold} onClick={() => exec('bold')}>
            <strong>B</strong>
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.italic} onClick={() => exec('italic')}>
            <em>I</em>
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.underline} onClick={() => exec('underline')}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="button button-ghost button-icon" title={labels.heading} onClick={() => exec('formatBlock', 'H3')}>
            H
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.bulletList} onClick={() => exec('insertUnorderedList')}>
            •
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.numberedList} onClick={() => exec('insertOrderedList')}>
            1.
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="button button-ghost button-icon" title={labels.alignLeft} onClick={() => align('justifyLeft')}>
            <Icon name="align-left" size={15} />
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.alignCenter} onClick={() => align('justifyCenter')}>
            <Icon name="align-center" size={15} />
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.alignRight} onClick={() => align('justifyRight')}>
            <Icon name="align-right" size={15} />
          </button>
          <button type="button" className="button button-ghost button-icon" title={labels.alignJustify} onClick={() => align('justifyFull')}>
            <Icon name="align-justify" size={15} />
          </button>
          <span className="toolbar-divider" />
          <div className="rte-table-menu" ref={tablePanelRef}>
            <button
              type="button"
              className="button button-ghost button-icon"
              title={labels.table}
              onClick={() => setTablePanelOpen((open) => !open)}
            >
              <Icon name="table" size={15} />
            </button>
            {tablePanelOpen && (
              <div className="rte-table-panel">
                <label className="rte-table-panel__field">
                  {labels.tableRows}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newRows}
                    onChange={(e) => setNewRows(Number(e.target.value))}
                  />
                </label>
                <label className="rte-table-panel__field">
                  {labels.tableColumns}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newCols}
                    onChange={(e) => setNewCols(Number(e.target.value))}
                  />
                </label>
                <label className="rte-table-panel__check">
                  <input
                    type="checkbox"
                    checked={headerRow}
                    onChange={(e) => setHeaderRow(e.target.checked)}
                  />
                  {labels.tableHeaderRow}
                </label>
                <button type="button" className="button button-primary button-small" onClick={insertTable}>
                  {labels.tableInsert}
                </button>
              </div>
            )}
          </div>
          <span className="toolbar-divider" />
          <button
            type="button"
            className="button button-ghost button-icon"
            title={labels.clearFormatting}
            onClick={clearFormatting}
          >
            <Icon name="x" size={14} />
          </button>

          {fields.length > 0 && (
            <>
              <span className="toolbar-divider" />
              <FieldInsertPicker
                fields={fields}
                labels={fieldLabels}
                onInsert={insertField}
                compact
                style={{ marginLeft: 'auto' }}
              />
            </>
          )}
        </div>

        {inTable && (
          <div className="rte-toolbar rte-toolbar--table">
            <span className="rte-toolbar__label">{labels.table}</span>
            <button type="button" className="button button-ghost button-small" onClick={addRow}>
              {labels.tableAddRow}
            </button>
            <button type="button" className="button button-ghost button-small" onClick={deleteRow}>
              {labels.tableDeleteRow}
            </button>
            <button type="button" className="button button-ghost button-small" onClick={addColumn}>
              {labels.tableAddColumn}
            </button>
            <button type="button" className="button button-ghost button-small" onClick={deleteColumn}>
              {labels.tableDeleteColumn}
            </button>
            <button type="button" className="button button-ghost button-small" onClick={deleteTable}>
              {labels.tableDelete}
            </button>
          </div>
        )}

        <div
          ref={editorRef}
          className="rte-content"
          contentEditable
          suppressContentEditableWarning
          {...handlers}
          style={{ minHeight }}
          data-placeholder={isEmpty ? placeholder ?? '' : ''}
        />
      </div>
    );
};

export default RichTextEditor;
