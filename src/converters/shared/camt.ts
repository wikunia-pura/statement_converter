/**
 * Reading ISO 20022 camt entries (BNP Paribas camt.053, BOŚ camt.052) as parsed
 * by xml2js with `explicitArray: false`.
 *
 * That option turns an element into an object when it occurs once and into an
 * array when it repeats, and code written against the single case quietly read
 * nothing from the repeated one: two <Ustrd> lines gave an empty description,
 * two <TxDtls> (a batch booking) an empty counterparty. Everything that may
 * repeat is read through asArray / textOf here.
 */

import type { DroppedStatementLine } from '../../shared/types';

/** The element as a list, whether xml2js gave one object, an array, or nothing. */
export function asArray<T = any>(node: T | T[] | null | undefined): T[] {
  if (node === null || node === undefined) return [];
  return Array.isArray(node) ? node : [node];
}

/**
 * The text of an element: a plain value, the `_` text of an element with
 * attributes, or — for a repeated element such as <Ustrd> — every occurrence
 * joined with a space.
 */
export function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (Array.isArray(node)) {
    return node.map(textOf).filter((part) => part !== '').join(' ');
  }
  if (typeof node === 'object') {
    return '_' in (node as Record<string, unknown>) ? String((node as Record<string, unknown>)._).trim() : '';
  }
  return String(node).trim();
}

/** Walk `path` from `obj`; '' when a step is missing. Repeated elements are joined (see textOf). */
export function textAt(obj: any, ...path: string[]): string {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) return '';
    current = current[key];
  }
  return textOf(current);
}

/** The entry amount, or null when <Amt> is missing or not a number — never 0 by default. */
export function readAmount(amtNode: any): { amount: number | null; currency: string; text: string } {
  const text = textOf(amtNode);
  const currency = (amtNode && typeof amtNode === 'object' && amtNode.$?.ccy) || 'PLN';
  const amount = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  return { amount: amount !== null && Number.isFinite(amount) ? amount : null, currency, text };
}

/** Counterparty and remittance data of one entry, read from all of its <TxDtls>. */
export interface CamtEntryDetails {
  instrId: string;
  endToEndId: string;
  counterpartyName: string;
  counterpartyAddress: string;
  counterpartyCountry: string;
  counterpartyAccount: string;
  description: string;
  /** More than one counterparty in a batch entry — see readEntryDetails. */
  batchCounterparties: boolean;
}

/**
 * Read an entry's <NtryDtls>/<TxDtls>. The counterparty is the debtor of a
 * credit and the creditor of a debit.
 *
 * A batch booking carries several <TxDtls> under one amount. Their remittance
 * lines are all kept (joined with a space). When they name one counterparty that
 * counterparty is used; when they name several, none of them can be booked as
 * "the" counterparty of the whole amount, so the names are kept for display and
 * the entry is flagged for review instead of one being picked.
 */
export function readEntryDetails(
  ntry: any,
  indicator: 'CRDT' | 'DBIT',
  opts: { txIdAsInstrId?: boolean } = {},
): CamtEntryDetails {
  const details = asArray(ntry?.ntrydtls).flatMap((d: any) => asArray(d?.txdtls));
  const partyKey = indicator === 'CRDT' ? 'dbtr' : 'cdtr';
  const accountKey = indicator === 'CRDT' ? 'dbtracct' : 'cdtracct';

  const parties = details.map((tx: any) => {
    const rltdPties = tx?.rltdpties || {};
    const party = rltdPties[partyKey] || {};
    const pstlAdr = party.pstladr || {};
    const account = rltdPties[accountKey]?.id?.othr?.id;
    return {
      name: textAt(party, 'nm'),
      address: asArray(pstlAdr.adrline).map(textOf).filter(Boolean).join(' ').trim(),
      country: textAt(pstlAdr, 'ctry'),
      account: account === undefined || account === null || typeof account === 'object' ? '' : String(account),
    };
  });

  const first = details[0] || {};
  const refs = first.refs || {};
  const description = details
    .map((tx: any) => textAt(tx, 'rmtinf', 'ustrd'))
    .filter(Boolean)
    .join(' ');

  const distinct = Array.from(
    new Set(parties.map((p) => `${p.name}|${p.account}`).filter((key) => key !== '|')),
  );
  const batchCounterparties = details.length > 1 && distinct.length > 1;
  const named = parties.find((p) => p.name || p.account) ?? { name: '', address: '', country: '', account: '' };

  return {
    instrId: textAt(refs, 'instrid') || (opts.txIdAsInstrId ? textAt(refs, 'txid') : ''),
    endToEndId: textAt(refs, 'endtoendid'),
    counterpartyName: batchCounterparties
      ? Array.from(new Set(parties.map((p) => p.name).filter(Boolean))).join('; ')
      : named.name,
    counterpartyAddress: batchCounterparties ? '' : named.address,
    counterpartyCountry: batchCounterparties ? '' : named.country,
    counterpartyAccount: batchCounterparties ? '' : named.account,
    description,
    batchCounterparties,
  };
}

/** What a dropped camt entry is shown as: its date, direction and amount as written. */
export function entryExcerpt(date: string, indicator: string, amountText: string): string {
  return [date, indicator, amountText].filter(Boolean).join(' ').slice(0, 80) || '<Ntry>';
}

/**
 * True for an entry marked <RvslInd>true</RvslInd>: the bank took an earlier
 * booking back. Its <CdtDbtInd> already is the side the reversal moves money
 * on, so the direction is read as written; the row is only held for review,
 * like an MT940 storno.
 */
export function isReversalEntry(ntry: any): boolean {
  const flag = textAt(ntry, 'rvslind').toLowerCase();
  return flag === 'true' || flag === '1';
}

/** The account a <Stmt> / <Rpt> reports on: its IBAN, or its other identification. */
export function statementAccount(stmt: any): string {
  const id = stmt?.acct?.id;
  return (textAt(id, 'iban') || textAt(id, 'othr', 'id')).replace(/\s/g, '').toUpperCase();
}

/**
 * Split a file's <Stmt> / <Rpt> elements into those for the first one's account
 * and the rest.
 *
 * A file may carry several statements. For the same account they are one
 * statement in parts and are read together; for another account they are not
 * this statement at all — merged in, that account's money went into this
 * account's books. Their entries are listed as dropped lines instead (one per
 * entry, "IBAN …4321 ≠ …6666: <date> <side> <amount>" — both accounts by their
 * last digits only, and no words, as the excerpt is shown in either language),
 * so the review shows them and asks for an acknowledgement, and that account's
 * statement is converted on its own.
 */
export function splitByAccount(stmts: any[], dropped: DroppedStatementLine[]): any[] {
  const account = statementAccount(stmts[0]);
  return stmts.filter((stmt) => {
    const other = statementAccount(stmt);
    if (other === account) return true;
    const tail = (acct: string) => (acct ? `…${acct.slice(-4)}` : '?');
    for (const ntry of asArray(stmt?.ntry)) {
      const date = textAt(ntry, 'bookgdt', 'dt') || textAt(ntry, 'bookgdt', 'dttm').slice(0, 10);
      const excerpt = entryExcerpt(date, textAt(ntry, 'cdtdbtind'), textOf(ntry?.amt));
      dropped.push({ excerpt: `IBAN ${tail(other)} ≠ ${tail(account)}: ${excerpt}`, reason: 'structure' });
    }
    return false;
  });
}
