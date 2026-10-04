/**
 * Who one community's mail goes to — pure, so the send screen lists exactly the
 * addresses the main process will put in the To header.
 *
 * A mailing kind names recipient GROUPS (`MailingAdresaci`); this turns them into
 * mailboxes for one community, optionally in the context of the meeting the
 * letter is about. The meeting wins where it is more specific: the proxy it
 * names, the board members on it, the city unit it is with.
 */

import {
  Adres,
  MailingAdresaci,
  MailingOdbiorca,
  MailingOdbiorcaRodzaj,
  Spotkanie,
  ZgnJednostka,
  ZgnPelnomocnik,
} from './types';

/** Loose on purpose: the point is to catch a typo'd entry, not to validate RFC 5322. */
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test((email ?? '').trim());
}

export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Split a typed list ("a@x.pl, b@y.pl; c@z.pl" or one per line) into mailboxes,
 * deduplicated, in typed order.
 */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? '').split(/[\s,;]+/)) {
    const email = raw.trim();
    if (!email) continue;
    const key = normalizeEmail(email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export interface MailingRecipientLookup {
  /** Community the letter is about; null for none (a standalone entry with no community). */
  adres: Adres | null;
  /** The meeting it came from, when it did. */
  spotkanie?: Spotkanie | null;
  jednostki: ZgnJednostka[];
  pelnomocnicy: ZgnPelnomocnik[];
}

/** One candidate recipient, with whether it was unticked for this letter. */
export interface MailingOdbiorcaKandydat extends MailingOdbiorca {
  wykluczony: boolean;
}

export interface MailingRecipientsResolved {
  /** Every candidate, in group order, deduplicated by mailbox. */
  kandydaci: MailingOdbiorcaKandydat[];
  /** The ones the mail actually goes to: candidates minus the unticked ones. */
  odbiorcy: MailingOdbiorca[];
  /**
   * Groups that were asked for but produced nobody — "no city unit", "board has
   * no mailbox". Shown next to the list so an empty group is explained, not
   * silently missing.
   */
  braki: MailingOdbiorcaRodzaj[];
}

/** The city unit the letter is about: the meeting's when it names one, else the community's. */
export function jednostkaFor(lookup: MailingRecipientLookup): ZgnJednostka | undefined {
  const id = lookup.spotkanie?.zgnJednostkaId ?? lookup.adres?.zgnJednostkaId ?? null;
  return id != null ? lookup.jednostki.find((j) => j.id === id) : undefined;
}

export function resolveOdbiorcy(
  lookup: MailingRecipientLookup,
  adresaci: MailingAdresaci,
  wykluczeni: string[] = [],
): MailingRecipientsResolved {
  const excluded = new Set(wykluczeni.map(normalizeEmail));
  const seen = new Set<string>();
  const kandydaci: MailingOdbiorcaKandydat[] = [];
  const braki: MailingOdbiorcaRodzaj[] = [];

  const add = (rodzaj: MailingOdbiorcaRodzaj, nazwa: string, email: string): boolean => {
    const key = normalizeEmail(email);
    if (!key || !isValidEmail(key)) return false;
    if (seen.has(key)) return true;
    seen.add(key);
    kandydaci.push({ rodzaj, nazwa: (nazwa ?? '').trim(), email: email.trim(), wykluczony: excluded.has(key) });
    return true;
  };

  const jednostka = jednostkaFor(lookup);

  if (adresaci.zgn) {
    if (!(jednostka && add('zgn', jednostka.nazwa, jednostka.email))) braki.push('zgn');
  }

  if (adresaci.pelnomocnik) {
    const named = lookup.spotkanie?.zgnPelnomocnikId ?? null;
    const proxies =
      named != null
        ? lookup.pelnomocnicy.filter((p) => p.id === named)
        : jednostka
          ? lookup.pelnomocnicy.filter((p) => p.jednostkaId === jednostka.id)
          : [];
    let any = false;
    for (const p of proxies) any = add('pelnomocnik', p.imieNazwisko, p.email) || any;
    if (!any) braki.push('pelnomocnik');
  }

  if (adresaci.zarzad) {
    const board = lookup.spotkanie ? lookup.spotkanie.zarzad : lookup.adres?.zarzad ?? [];
    let any = false;
    for (const osoba of board ?? []) any = add('zarzad', osoba.imieNazwisko, osoba.email) || any;
    if (!any) braki.push('zarzad');
  }

  for (const email of adresaci.wlasne ?? []) add('wlasne', '', email);

  return {
    kandydaci,
    odbiorcy: kandydaci
      .filter((k) => !k.wykluczony)
      .map(({ rodzaj, nazwa, email }) => ({ rodzaj, nazwa, email })),
    braki,
  };
}

/**
 * The two summary columns a history row has always had, written for a mail
 * with several recipients: names and mailboxes, each joined with ", ".
 */
export function summarizeOdbiorcy(odbiorcy: MailingOdbiorca[]): {
  jednostkaNazwa: string;
  jednostkaEmail: string;
} {
  return {
    jednostkaNazwa: odbiorcy
      .map((o) => o.nazwa || o.email)
      .filter(Boolean)
      .join(', '),
    jednostkaEmail: odbiorcy.map((o) => o.email).join(', '),
  };
}

/** `"Jan Kowalski" <jan@x.pl>` — or the bare mailbox when there is no name. */
export function formatAddressHeader(odbiorca: MailingOdbiorca): string {
  const name = (odbiorca.nazwa ?? '').replace(/["<>]/g, '').trim();
  return name ? `"${name}" <${odbiorca.email}>` : odbiorca.email;
}
