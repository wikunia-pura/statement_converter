import DOMPurify, { type Config } from 'dompurify';

/**
 * Stored HTML — mailing templates, resolution texts, a sent message's body — goes
 * through here before it is put into the page. Any account of the team can write
 * those rows, and this page carries the full `window.electronAPI` (open files,
 * send mail with attachments, restore a backup), so one `<img onerror>` saved in
 * a template would run for everyone who opens it.
 *
 * The allowlist is what a letter is made of: text formatting (including the
 * `<font>`/`<b>`/`<u>` that the editor's commands produce), lists, tables with
 * the attributes mail clients still need (`bgcolor`, `cellpadding`, `width` …),
 * inline styles, images (`data:` included — the letterhead is one) and links.
 * Out: scripts and every event handler, frames, objects, forms, `<style>`
 * elements (a stylesheet in a template would restyle the whole app), SVG/MathML,
 * `javascript:` URLs, and `id`/`name` (DOM clobbering).
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'b', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'wbr',
];

const ALLOWED_ATTR = [
  'style', 'class', 'title', 'dir', 'lang', 'role',
  'href', 'src', 'alt', 'width', 'height',
  'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'scope',
  'span', 'nowrap', 'start', 'type', 'reversed',
  'color', 'face', 'size',
];

const CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // `data-ff-*` marks the editors' field pills; harmless anywhere else.
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'option', 'link', 'meta', 'base', 'svg', 'math', 'template'],
  FORBID_ATTR: ['id', 'name', 'srcset', 'formaction', 'action', 'background'],
};

/** Stored HTML made safe to place in the page with `innerHTML`. */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, CONFIG);
}
