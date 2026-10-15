import { MAILING_TYP_ZGN, MailingAdresaci, MailingTyp } from '../../shared/types';

// Kept apart from Mailing.tsx so the app shell can hold a draft without pulling
// the whole Mailing view into the first bundle — the view itself loads on demand.

/**
 * The send form's state. Lifted to App so stepping out to Adresy to attach a
 * missing city unit — the most likely detour mid-flow — doesn't discard the
 * selection, the typed values and the attachments.
 */
export interface MailingDraft {
  typ: MailingTyp;
  templateId: number | null;
  adresIds: number[];
  /** Field values keyed by field name — one set for the whole send. */
  values: Record<string, string>;
  /**
   * Dynamic fields ticked for the `{{Tabela pól}}` table in the body. Per send,
   * not per template: which positions a letter lists changes from month to month,
   * and the values for them are typed here anyway.
   */
  tableFields: string[];
  attachments: { fileName: string; filePath: string }[];
  /** null ⇒ follow the template's default. */
  attachPdf: boolean | null;
  /**
   * Subject and body for *this send*. Loaded from the chosen template and freely
   * editable afterwards: a rate-change letter usually needs a sentence about the
   * specific resolution, and saving that into the template would carry it into
   * every future mailing.
   */
  temat: string;
  tresc: string;
  /**
   * Template the text above was loaded from. Kept so picking another template
   * (or having the template edited in the other tab) reloads the text, while
   * every other re-render leaves the user's edits alone.
   */
  loadedFromTemplateId: number | null;
  /** True once the text differs from the template — drives the "edited" hint. */
  edited: boolean;
  /**
   * The meeting this send belongs to, when the user came here from a meeting's
   * "wyślij dokumenty". Travels through to every history row the send writes,
   * which is what lets the meeting list what actually went out for it.
   */
  spotkanieId?: number | null;
  /** The meeting's name, for the banner that says where this draft came from. */
  spotkanieNazwa?: string | null;
  /**
   * Recipient groups for this send. null ⇒ follow the kind's default (Mailing →
   * Typy mailingu), so editing the kind in the other tab still shows up here
   * until somebody changes the recipients for this one send.
   */
  adresaci: MailingAdresaci | null;
  /** Mailboxes (lower-cased) unticked for this send — across every community. */
  wykluczeni: string[];
}

export const emptyMailingDraft: MailingDraft = {
  typ: MAILING_TYP_ZGN,
  templateId: null,
  adresIds: [],
  values: {},
  tableFields: [],
  attachments: [],
  attachPdf: null,
  temat: '',
  tresc: '',
  loadedFromTemplateId: null,
  edited: false,
  spotkanieId: null,
  spotkanieNazwa: null,
  adresaci: null,
  wykluczeni: [],
};
