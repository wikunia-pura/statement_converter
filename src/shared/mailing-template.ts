/**
 * Rendering of mailing templates — pure and dependency-free, so the renderer can
 * show a live preview with exactly the same code that the main process uses when
 * the mail actually goes out. Any divergence here would mean the user proofreads
 * one text and sends another.
 *
 * Placeholder syntax is `{{Nazwa pola}}`: readable in the editor, and the same
 * string the "insert field" button writes. Names are matched case-insensitively
 * and whitespace-insensitively so a stray space inside the braces still resolves.
 */

import { MailingFieldValue, MailingPole } from './types';
import {
  LOGO_ACCENT_COLOR,
  LOGO_BAND_COLOR,
  LOGO_WIDTH,
  MAIL_BORDER_COLOR,
  MAIL_CARD_COLOR,
  MAIL_CARD_WIDTH,
  MAIL_PAGE_COLOR,
  MAIL_TEXT_COLOR,
} from './mailing-logo';

/** Field substituting the selected community's name — one mail per community. */
export const FIELD_ADDRESS = 'Adres Wspólnoty';
/** Field substituting today's date in Polish format (dd.mm.yyyy). */
export const FIELD_DATE = 'Data';
/**
 * Field expanding into a two-column table: each row is one dynamic field's
 * sentence and the value typed for it.
 *
 * The rows are decided in two steps. The template names the fields its table may
 * use (`MailingSzablon.tableFields`) — five out of a fifty-entry dictionary — and
 * the send screen ticks which of those five actually go out, with their values. A
 * rate-change letter lists different positions every month, so neither a fixed
 * table in the template nor a template per combination would survive contact with
 * the next month.
 */
export const FIELD_TABLE = 'Tabela pól';

/**
 * Fields every template can use without defining them. They resolve from the
 * send context rather than from a value the user types, so they carry no `tekst`.
 */
export const BUILTIN_MAILING_FIELDS: { nazwa: string; opis: string }[] = [
  { nazwa: FIELD_ADDRESS, opis: 'Nazwa wybranej wspólnoty' },
  { nazwa: FIELD_DATE, opis: 'Dzisiejsza data (dd.mm.rrrr)' },
  {
    nazwa: FIELD_TABLE,
    opis:
      'Tabela: zdanie pola w pierwszej kolumnie, wartość w drugiej. Pola dla niej ' +
      'wybierasz w szablonie, a wiersze zaznaczasz przy wysyłce.',
  },
];

export function isBuiltinField(nazwa: string): boolean {
  return BUILTIN_MAILING_FIELDS.some((f) => normalizeFieldName(f.nazwa) === normalizeFieldName(nazwa));
}

/** True for the `{{Tabela pól}}` placeholder, whatever its spelling. */
export function isFieldTableField(nazwa: string): boolean {
  return normalizeFieldName(nazwa) === normalizeFieldName(FIELD_TABLE);
}

/** Collapse whitespace and case so `{{ data }}` and `{{Data}}` are one field. */
export function normalizeFieldName(nazwa: string): string {
  return nazwa.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The exact string inserted into a template for a field. */
export function fieldPlaceholder(nazwa: string): string {
  return `{{${nazwa.trim()}}}`;
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Names of every placeholder appearing in the given texts, in first-seen order,
 * spelled as they were written. Drives both the "fill these in" list on the send
 * screen and the unknown-field warning.
 */
export function extractUsedFields(...texts: string[]): string[] {
  const seen = new Map<string, string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(PLACEHOLDER_RE)) {
      const raw = match[1].trim();
      const key = normalizeFieldName(raw);
      if (!seen.has(key)) seen.set(key, raw);
    }
  }
  return [...seen.values()];
}

/** Context a template needs beyond the user-typed values. */
export interface MailingRenderContext {
  /** Name of the community this mail is about — substitutes `{{Adres Wspólnoty}}`. */
  adresNazwa: string;
  /** Date substituted into `{{Data}}`, already formatted (dd.mm.yyyy). */
  dateText: string;
  /** Defined fields, so a placeholder can pick up its lead-in `tekst`. */
  pola: MailingPole[];
  /** Values typed once per send, keyed by field name (any spelling/case). */
  values: Record<string, string>;
  /**
   * Fields ticked for `{{Tabela pól}}`, in the order they should appear as rows.
   * Empty or absent ⇒ the placeholder renders as nothing at all.
   */
  tableFields?: string[];
}

/** Today in the Polish format users expect in a letter. */
export function formatPolishDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * A field's value, matched however the name is spelled. Exported because the
 * send screen has to read a value back the same way rendering resolves it — the
 * table rows and the placeholder inputs can name one field differently.
 */
export function readFieldValue(values: Record<string, string>, nazwa: string): string {
  const key = normalizeFieldName(nazwa);
  for (const [k, v] of Object.entries(values)) {
    if (normalizeFieldName(k) === key) return (v ?? '').trim();
  }
  return '';
}

/**
 * Resolve one placeholder to its final text. A user-defined field renders as its
 * lead-in sentence followed by the typed value ("…w kwocie: 350,00 zł"); either
 * half may be empty. An unknown name is left as-is rather than silently deleted —
 * a visible `{{Foo}}` in the preview is a bug the user can see and fix.
 */
function resolveField(nazwa: string, ctx: MailingRenderContext): string {
  const key = normalizeFieldName(nazwa);
  if (key === normalizeFieldName(FIELD_ADDRESS)) return ctx.adresNazwa;
  if (key === normalizeFieldName(FIELD_DATE)) return ctx.dateText;
  // Only reachable from renderPlain — the subject line, where a table cannot go.
  // The rows are still written out rather than dropped, so a placeholder pasted
  // into the subject by mistake is visible instead of silently swallowed.
  if (isFieldTableField(nazwa)) {
    return collectFieldTableRows(ctx)
      .map((row) => [row.label, row.value].filter(Boolean).join(' '))
      .join('; ');
  }

  const pole = ctx.pola.find((p) => normalizeFieldName(p.nazwa) === key);
  if (!pole) return fieldPlaceholder(nazwa);

  const value = readFieldValue(ctx.values, nazwa);
  const tekst = (pole.tekst ?? '').trim();
  if (tekst && value) return `${tekst} ${value}`;
  return tekst || value;
}

/** Substitute every placeholder in a plain-text string (e.g. the subject). */
export function renderPlain(text: string, ctx: MailingRenderContext): string {
  return (text ?? '').replace(PLACEHOLDER_RE, (_all, nazwa: string) => resolveField(nazwa, ctx));
}

/**
 * Substitute every placeholder in the HTML body. Resolved values are escaped, so
 * an ampersand or a `<` typed into a field value can't break the markup (or the
 * PDF) — the surrounding HTML is the user's own formatting and stays untouched.
 *
 * `{{Tabela pól}}` is the one placeholder that resolves to markup rather than to
 * text, so it is substituted in its own pass, before (and outside) the escaping
 * one.
 */
export function renderHtml(html: string, ctx: MailingRenderContext): string {
  const tableHtml = buildFieldTableHtml(ctx);
  return (
    (html ?? '')
      // The editor wraps whatever the user types in a block element, so the
      // placeholder normally sits alone inside a <p>. Replacing the paragraph as
      // a whole keeps a <table> out of a <p>, which is markup mail clients
      // re-shuffle in their own ways (and Outlook renders with extra spacing).
      .replace(FIELD_TABLE_BLOCK_RE, () => tableHtml)
      .replace(PLACEHOLDER_RE, (_all, nazwa: string) =>
        isFieldTableField(nazwa) ? tableHtml : escapeHtml(resolveField(nazwa, ctx)),
      )
  );
}

/** One row of the `{{Tabela pól}}` table, as it will be rendered. */
export interface MailingTableRow {
  /** First column: the field's fixed sentence (its name when it has none). */
  label: string;
  /** Second column: the value typed for this send. */
  value: string;
}

/**
 * Rows of the field table, in `ctx.tableFields` order and deduplicated — the
 * same field ticked twice is one row. Fields no longer in the dictionary keep
 * their name as the label rather than disappearing, so a deleted field shows up
 * as something to fix instead of as a silently missing position.
 */
export function collectFieldTableRows(ctx: MailingRenderContext): MailingTableRow[] {
  const rows: MailingTableRow[] = [];
  const seen = new Set<string>();
  for (const nazwa of ctx.tableFields ?? []) {
    const key = normalizeFieldName(nazwa);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const pole = ctx.pola.find((p) => normalizeFieldName(p.nazwa) === key);
    rows.push({
      label: (pole?.tekst ?? '').trim() || (pole?.nazwa ?? nazwa).trim(),
      value: readFieldValue(ctx.values, nazwa),
    });
  }
  return rows;
}

/**
 * Look of a generated table, inline on every element. Mail clients drop `<style>`
 * blocks (Outlook's Word renderer first among them), so a border set anywhere
 * else is a border that may not arrive — and a borderless two-column table stops
 * reading as a table at all.
 *
 * Shared with the editor's own table tool: a table the app generates and one the
 * user draws by hand must look the same in the sent mail.
 */
export const MAIL_TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:8px 0;';
export const MAIL_TABLE_CELL_STYLE = 'border:1px solid #cccccc;padding:6px 8px;vertical-align:top;';
export const MAIL_TABLE_HEADER_CELL_STYLE = 'background-color:#f2f2f2;text-align:left;';
/** Value column: narrow and bold, so the amounts line up and read as the point. */
const MAIL_TABLE_VALUE_CELL_STYLE = 'width:34%;font-weight:600;';

/**
 * The field table as mail-safe HTML. Empty string when nothing is ticked: an
 * empty table would leave a stray box in the letter, and the user's own text
 * around the placeholder still reads correctly without it.
 */
export function buildFieldTableHtml(ctx: MailingRenderContext): string {
  const rows = collectFieldTableRows(ctx);
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (row) =>
        `<tr><td style="${MAIL_TABLE_CELL_STYLE}">${escapeHtml(row.label)}</td>` +
        `<td style="${MAIL_TABLE_CELL_STYLE}${MAIL_TABLE_VALUE_CELL_STYLE}">` +
        `${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  return (
    `<table style="${MAIL_TABLE_STYLE}" cellpadding="0" cellspacing="0" border="0">` +
    `<tbody>${body}</tbody></table>`
  );
}

/**
 * The table placeholder alone in its own block element, `<br>` padding included —
 * that is how the rich-text editor stores a placeholder on its own line. Built
 * from `FIELD_TABLE` so the accepted spellings stay those `normalizeFieldName`
 * accepts: any casing, any run of whitespace.
 */
const FIELD_TABLE_BLOCK_RE = new RegExp(
  `<(p|div)[^>]*>\\s*(?:<br\\s*/?>\\s*)*` +
    `\\{\\{\\s*${FIELD_TABLE.trim().split(/\s+/).join('\\s+')}\\s*\\}\\}` +
    `\\s*(?:<br\\s*/?>\\s*)*</\\1>`,
  'gi',
);

/**
 * The field values used by a send, in template order — stored in the history.
 * The fields ticked for `{{Tabela pól}}` follow the ones written into the text:
 * they carry values too, and a record missing them would not say what was sent.
 */
export function collectFieldValues(
  usedFields: string[],
  ctx: MailingRenderContext,
): MailingFieldValue[] {
  const names = [
    ...usedFields.filter((nazwa) => !isBuiltinField(nazwa)),
    ...(ctx.tableFields ?? []),
  ];
  const seen = new Set<string>();
  const values: MailingFieldValue[] = [];
  for (const nazwa of names) {
    const key = normalizeFieldName(nazwa);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const pole = ctx.pola.find((p) => normalizeFieldName(p.nazwa) === key);
    values.push({
      nazwa: pole?.nazwa ?? nazwa,
      tekst: pole?.tekst ?? '',
      wartosc: readFieldValue(ctx.values, nazwa),
    });
  }
  return values;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BLOCK_END_RE = /<\/(p|div|h[1-6]|li|ul|ol|table|blockquote)\s*>/gi;
/** Cells of one row, then the row itself — see `htmlToPlainText`. */
const CELL_END_RE = /<\/(td|th)\s*>/gi;
const ROW_END_RE = /<\/tr\s*>/gi;

/**
 * Plain-text alternative of the HTML body. Mail clients that refuse HTML (and
 * spam filters that score its absence) need it, and it's what the history shows
 * when reading a sent message back.
 */
export function htmlToPlainText(html: string): string {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // A table becomes a tab-separated block: without the cell separator the two
    // columns run into one word ("…w kwocie:350,00 zł"), and with a blank line
    // per row a rate table reads as a series of paragraphs instead of a list.
    // Cells before rows before the table, so each rule still finds its tag.
    .replace(CELL_END_RE, '\t')
    .replace(ROW_END_RE, '\n')
    .replace(BLOCK_END_RE, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Centered INTER-EJ letterhead placed above every body.
 *
 * Built as a one-cell table, not a styled div: Outlook's Word renderer ignores
 * `margin: auto` and drops background colours on block elements, and the band is
 * not decoration here — the logo's lettering is white, so losing the dark
 * background would make the letterhead vanish into the page.
 *
 * `src` differs by destination: `cid:` for the mail (clients block `data:` image
 * sources), the data URI for the PDF and the in-app previews.
 */
export function buildLogoHeader(logoSrc: string, options?: { flush?: boolean }): string {
  // `flush` = sitting at the top of the card, where the card supplies the spacing
  // below and an orange hairline separates band from text.
  const flush = options?.flush ?? false;
  return (
    `<table class="ff-logo" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;${flush ? '' : 'margin:0 0 18px;'}"><tr>` +
    `<td align="center" bgcolor="${LOGO_BAND_COLOR}" ` +
    `style="background-color:${LOGO_BAND_COLOR};padding:20px 12px;">` +
    `<img src="${logoSrc}" alt="INTER-EJ — zarządzanie nieruchomościami" ` +
    `width="${LOGO_WIDTH}" ` +
    `style="display:block;border:0;outline:none;width:${LOGO_WIDTH}px;max-width:100%;height:auto;" />` +
    `</td></tr>` +
    // Hairline in the logo's orange: ties the letterhead to the mark and gives
    // the band a deliberate edge instead of a bare colour change.
    `<tr><td bgcolor="${LOGO_ACCENT_COLOR}" ` +
    `style="background-color:${LOGO_ACCENT_COLOR};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>` +
    `</table>`
  );
}

/**
 * The mail's visual frame: a tinted page with a white, width-limited card holding
 * the letterhead and the letter. Nothing here is decoration for its own sake —
 * the constrained width is what stops lines running the whole window, and the
 * card edge is what makes the message read as stationery rather than as text
 * dropped into the client's chrome.
 *
 * Every colour and dimension is an inline style **and**, where one exists, the
 * matching HTML attribute (`bgcolor`, `width`). That redundancy is the whole
 * trick: Gmail discards `<body>` and `<style>` can be stripped, so a background
 * set anywhere but on a table cell is a background that may simply not arrive.
 * Outlook's Word renderer then ignores `max-width`, which is why the card also
 * carries a fixed `width` attribute.
 *
 * Because it is inline-styled throughout, the in-app preview renders this exact
 * markup — the frame the user proofreads is the frame that is sent.
 */
export function buildMailShell(
  bodyHtml: string,
  logoSrc: string,
  options?: { pagePadding?: string; fontSize?: string },
): string {
  // The PDF gets a slightly roomier page inset and print-sized type; the frame
  // itself is identical, so the attachment looks like the message.
  const pagePadding = options?.pagePadding ?? '24px 12px';
  const fontSize = options?.fontSize ?? '14px';
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `bgcolor="${MAIL_PAGE_COLOR}" ` +
    `style="border-collapse:collapse;width:100%;height:100%;background-color:${MAIL_PAGE_COLOR};">` +
    `<tr><td align="center" valign="top" style="padding:${pagePadding};">` +
    `<table role="presentation" width="${MAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" ` +
    `bgcolor="${MAIL_CARD_COLOR}" ` +
    `style="border-collapse:collapse;width:100%;max-width:${MAIL_CARD_WIDTH}px;` +
    `background-color:${MAIL_CARD_COLOR};border:1px solid ${MAIL_BORDER_COLOR};">` +
    `<tr><td style="padding:0;">${buildLogoHeader(logoSrc, { flush: true })}</td></tr>` +
    `<tr><td class="ff-body" style="padding:26px 28px 30px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;` +
    `font-size:${fontSize};line-height:1.6;color:${MAIL_TEXT_COLOR};">${bodyHtml}</td></tr>` +
    `</table></td></tr></table>`
  );
}

/**
 * Wrap a rendered body in a complete HTML document. Used for both the mail's
 * HTML part and the PDF, from the same string, so the attachment can't say
 * something different from the message: only the page-level styling and the way
 * the logo is referenced differ.
 */
export function buildDocumentHtml(
  bodyHtml: string,
  options?: { forPdf?: boolean; logoSrc?: string },
): string {
  const forPdf = options?.forPdf ?? false;
  const logoSrc = options?.logoSrc;

  // Mail and PDF share one frame, so the attachment is a faithful copy of the
  // message: the tinted page surrounds a white card holding the letterhead and
  // the letter. Only the page inset and the type size differ — a printed page
  // wants a little more air and points rather than pixels.
  const content = logoSrc
    ? buildMailShell(bodyHtml, logoSrc, forPdf ? { pagePadding: '32px 24px', fontSize: '11pt' } : undefined)
    : `<div class="ff-body">\n${bodyHtml}\n</div>`;

  // The page tint also goes on <body>. In the PDF that is what guarantees full
  // coverage — including the area below a short letter and any further pages,
  // which the table alone would leave white. In the mail it is a bonus: clients
  // that keep <body> tint edge to edge, the rest get it from the table.
  const pageStyle =
    `margin:0;padding:0;line-height:${forPdf ? '1.55' : '1.6'};color:${MAIL_TEXT_COLOR};` +
    `font-size:${forPdf ? '11pt' : '14px'};background-color:${MAIL_PAGE_COLOR}`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Declares the message as light-only. Gmail, Apple Mail and Outlook use this
     to stop force-inverting colours in dark mode; without it a dark-mode client
     may recolour the card and the letterhead band on its own. -->
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<style>
  html, body { height: 100%; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; ${pageStyle}; }
  p { margin: 0 0 12px; }
  h1, h2, h3 { margin: 0 0 12px; line-height: 1.3; }
  ul, ol { margin: 0 0 12px 22px; padding: 0; }
  li { margin: 0 0 5px; }
  strong { font-weight: 600; }
  /* Scoped to the body wrapper so neither the letterhead band nor the shell's
     layout tables pick up cell borders. A descendant selector rather than
     :not(.ff-logo) — Outlook's Word renderer handles ".ff-body table" but not
     reliably :not(), and there the failure would put a border around the logo. */
  .ff-body table { border-collapse: collapse; }
  .ff-body td, .ff-body th { padding: 4px 8px; border: 1px solid #ccc; }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

/**
 * Turn a community/template name into a file-name-safe slug. Polish diacritics
 * are transliterated rather than stripped so "Żeromskiego" stays recognizable in
 * a Windows-friendly file name.
 */
export function slugifyForFileName(text: string): string {
  const map: Record<string, string> = {
    ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
    Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
  };
  const ascii = (text ?? '').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => map[ch] ?? ch);
  return (
    ascii
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'mail'
  );
}
