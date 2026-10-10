import React, { useMemo, useState } from 'react';
import {
  Sprawozdanie,
  SprawozdanieCel,
  SprawozdanieGrupowanie,
  SprawozdanieLaczenie,
  SprawozdanieLaczeniePropozycja,
  SprawozdanieSekcja,
} from '../../shared/types';
import { bezLaczenia, formatKwota, laczenieAktualne } from '../../shared/sprawozdanie';
import { translations } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormSection } from './FormSection';
import Icon from './Icon';
import { bezPrefiksu } from './PodpisKarta';

type T = (typeof translations)['pl'];

/** The words that differ between merging rows and grouping them in subcategories. */
const TEKSTY = [
  'Title', 'Desc', 'New', 'AiHint', 'AiDone', 'AiNone', 'AiReview', 'Empty', 'Nothing', 'StaleHint',
  'Accepted', 'AcceptedAll', 'Saved', 'Removed', 'NewTitle', 'EditTitle', 'ModalHint', 'Taken', 'Name',
  'NamePlaceholder', 'Save', 'Remove', 'AiWorking',
] as const;
type Tekst = (typeof TEKSTY)[number];
type Tx = (k: Tekst) => string;

const teksty = (t: T, rodzaj: SprawozdanieGrupowanie): Tx => (k) =>
  rodzaj === 'podkategorie' ? t[`zpodk${k}`] : t[`zlacz${k}`];

/** The item rows of a section, one per name — a merge names its rows. */
function pozycje(sec: SprawozdanieSekcja | undefined, rodzaj: SprawozdanieGrupowanie): string[] {
  if (!sec) return [];
  const rows = sec.wiersze.filter((w) => !w.podsumowanie && (rodzaj === 'podkategorie' || !bezLaczenia(w.nazwa)));
  return [...new Set(rows.map((w) => w.nazwa))];
}

/** "Przychód 1 234,00 · Koszty 56,00" — the sums of the rows, per column with any amount. */
function sumy(sec: SprawozdanieSekcja | undefined, nazwy: string[]): string {
  if (!sec) return '';
  const rows = sec.wiersze.filter((w) => !w.podsumowanie && nazwy.includes(w.nazwa));
  return sec.kolumny
    .map((k, c) => {
      const vals = rows.map((w) => w.kwoty[c]).filter((v): v is number => v != null);
      return vals.length ? `${k} ${formatKwota(vals.reduce((a, b) => a + b, 0))}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

const kwotyWiersza = (sec: SprawozdanieSekcja, nazwa: string): string => sumy(sec, [nazwa]);

/* ================================ The editor ================================ */

/** One merge made or changed by hand: a section, its rows, a name. */
const LaczenieModal: React.FC<{
  t: T;
  tx: Tx;
  rodzaj: SprawozdanieGrupowanie;
  icon: 'copy' | 'align-left';
  spr: Sprawozdanie;
  /** The merge edited (a stored one, or a suggestion); absent = a new one. */
  poczatek?: SprawozdanieLaczenie;
  /** The other merges — their rows cannot go into this one. */
  inne: SprawozdanieLaczenie[];
  busy: boolean;
  onSave: (l: SprawozdanieLaczenie) => void;
  onClose: () => void;
}> = ({ t, tx, rodzaj, icon, spr, poczatek, inne, busy, onSave, onClose }) => {
  // Only sections with something to merge: two item rows or more.
  const sekcje = useMemo(() => spr.sekcje.filter((s) => pozycje(s, rodzaj).length >= 2), [spr]);
  // An out-of-date merge opens with only the rows the statement still has — a
  // missing one has no box to untick, and would keep the merge out of date.
  const startSec = sekcje.find((s) => s.tytul === poczatek?.sekcja);
  const [sekcja, setSekcja] = useState(startSec?.tytul ?? sekcje[0]?.tytul ?? '');
  const [wiersze, setWiersze] = useState<string[]>(() =>
    startSec ? (poczatek?.wiersze ?? []).filter((n) => pozycje(startSec, rodzaj).includes(n)) : []
  );
  const [nazwa, setNazwa] = useState(poczatek?.nazwa ?? '');
  const sec = spr.sekcje.find((s) => s.tytul === sekcja);
  const zajete = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of inne) if (l.sekcja === sekcja) for (const w of l.wiersze) m.set(w, l.nazwa);
    return m;
  }, [inne, sekcja]);

  const toggle = (n: string) =>
    setWiersze((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const valid = !!sec && wiersze.length >= 2 && !!nazwa.trim();

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon={icon}
          title={poczatek ? tx('EditTitle') : tx('NewTitle')}
          subtitle={tx('ModalHint')}
        />
        <div className="modal-body">
          <FormSection icon="table" title={t.zlaczRowsTitle}>
            <FormField label={t.zlaczSection} htmlFor="zlacz-sekcja">
              <select
                id="zlacz-sekcja"
                value={sekcja}
                disabled={busy}
                onChange={(e) => {
                  setSekcja(e.target.value);
                  setWiersze([]);
                }}
              >
                {sekcje.map((s) => (
                  <option key={s.tytul} value={s.tytul}>
                    {s.tytul}
                  </option>
                ))}
              </select>
            </FormField>
            <ul className="zlacz-pick-list">
              {pozycje(sec, rodzaj).map((n) => {
                const picked = wiersze.includes(n);
                const w = zajete.get(n);
                return (
                  <li key={n}>
                    <label className={`zlacz-pick${picked ? ' is-picked' : ''}${w ? ' is-taken' : ''}`}>
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={busy || !!w}
                        onChange={() => toggle(n)}
                      />
                      <span className="zlacz-pick__text">
                        <strong>{n}</strong>
                        {w && <span>{tx('Taken').replace('{name}', w)}</span>}
                      </span>
                      <span className="zlacz-pick__amount">{sec ? kwotyWiersza(sec, n) : ''}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </FormSection>
          <FormSection icon="edit" title={t.zlaczNameTitle}>
            <FormField
              label={tx('Name')}
              htmlFor="zlacz-nazwa"
              required
              hint={wiersze.length >= 2 ? t.zlaczSum.replace('{sum}', sumy(sec, wiersze) || '—') : t.zlaczPickTwo}
            >
              <input
                id="zlacz-nazwa"
                type="text"
                value={nazwa}
                maxLength={80}
                placeholder={tx('NamePlaceholder')}
                disabled={busy}
                onChange={(e) => setNazwa(e.target.value)}
              />
            </FormField>
          </FormSection>
        </div>
        <ModalFooter
          note={<span>{t.zlaczSelected.replace('{n}', String(wiersze.length))}</span>}
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => valid && onSave({ sekcja, wiersze, nazwa: nazwa.trim() })}
          submitLabel={tx('Save')}
          submitIcon="check"
          submitDisabled={!valid}
          submitTitle={t.zlaczPickTwo}
          busy={busy}
        />
      </div>
    </div>
  );
};

/* ================================ The section ================================ */

const nachodza = (a: SprawozdanieLaczenie, b: SprawozdanieLaczenie) =>
  a.sekcja === b.sekcja && a.wiersze.some((w) => b.wiersze.includes(w));

/**
 * How a version (or a Plany gospodarcze plan) regroups its statement's rows —
 * in the preview, the PDF and Excel, the package and the plan's positions.
 * The library's figures stay as vDom printed them.
 * - "Połączone pozycje": rows of one section shown as one, under a name given.
 * - "Podkategorie": rows of one section kept, under a heading with their sum.
 * The AI can suggest either; each suggestion waits for review — accept,
 * change, or reject — and only what is accepted is stored.
 */
const ZebranieSprawozdanieLaczenia: React.FC<{
  t: T;
  rodzaj: SprawozdanieGrupowanie;
  /** Whose statement: a meeting version's, or a Plany gospodarcze plan's. */
  cel: SprawozdanieCel;
  /**
   * The rows to group: merges are made over the library's statement,
   * subcategories over the statement with the merges applied.
   */
  spr: Sprawozdanie;
  /** The stored merges, or subcategories. */
  lista: SprawozdanieLaczenie[];
  busy: boolean;
  onChanged: () => Promise<void>;
}> = ({ t, rodzaj, cel, spr, lista: laczenia, busy: parentBusy, onChanged }) => {
  const notify = useNotify();
  const tx = teksty(t, rodzaj);
  const icon = rodzaj === 'podkategorie' ? 'align-left' : 'copy';
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [propozycje, setPropozycje] = useState<SprawozdanieLaczeniePropozycja[] | null>(null);
  /** The editor: which merge, or suggestion, it changes. */
  const [edycja, setEdycja] = useState<
    { kind: 'nowe' } | { kind: 'zapisane'; index: number } | { kind: 'propozycja'; index: number } | null
  >(null);
  const busy = parentBusy || saving || aiBusy;

  const save = async (next: SprawozdanieLaczenie[], message: string): Promise<boolean> => {
    setSaving(true);
    try {
      await window.electronAPI.setSprawozdanieLaczenia(cel, rodzaj, next);
      await onChanged();
      notify.success(message);
      // A suggestion over rows a merge has just taken is no longer possible.
      setPropozycje((p) => p && p.filter((x) => !next.some((l) => nachodza(l, x))));
      return true;
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const propose = async () => {
    setAiBusy(true);
    try {
      const found = await window.electronAPI.proponujLaczeniaSprawozdaniaAi(cel, rodzaj);
      setPropozycje(found);
      if (found.length === 0) notify.info(tx('AiNone'));
      else notify.success(tx('AiDone').replace('{n}', String(found.length)));
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.zlaczAiError);
    } finally {
      setAiBusy(false);
    }
  };

  const dropPropozycja = (i: number) =>
    setPropozycje((p) => (p ? p.filter((_, j) => j !== i) : p));

  const accept = async (i: number, l: SprawozdanieLaczenie = propozycje![i]) => {
    const merge = { sekcja: l.sekcja, wiersze: l.wiersze, nazwa: l.nazwa };
    if (await save([...laczenia, merge], tx('Accepted').replace('{name}', merge.nazwa))) dropPropozycja(i);
  };

  const acceptAll = async () => {
    if (!propozycje) return;
    const next = [...laczenia];
    for (const p of propozycje) {
      if (!next.some((l) => nachodza(l, p))) next.push({ sekcja: p.sekcja, wiersze: p.wiersze, nazwa: p.nazwa });
    }
    if (await save(next, tx('AcceptedAll').replace('{n}', String(next.length - laczenia.length)))) {
      setPropozycje(null);
    }
  };

  const remove = async (i: number) => {
    const l = laczenia[i];
    await save(
      laczenia.filter((_, j) => j !== i),
      tx('Removed').replace('{name}', l.nazwa)
    );
  };

  const onEditorSave = async (l: SprawozdanieLaczenie) => {
    if (!edycja) return;
    if (edycja.kind === 'zapisane') {
      if (await save(laczenia.map((x, j) => (j === edycja.index ? l : x)), tx('Saved'))) setEdycja(null);
    } else if (edycja.kind === 'propozycja') {
      const index = edycja.index;
      if (await save([...laczenia, l], tx('Accepted').replace('{name}', l.nazwa))) {
        dropPropozycja(index);
        setEdycja(null);
      }
    } else if (await save([...laczenia, l], tx('Saved'))) {
      setEdycja(null);
    }
  };

  const sekcjaOf = (l: SprawozdanieLaczenie) => spr.sekcje.find((s) => s.tytul === l.sekcja);
  const editorStart =
    edycja?.kind === 'zapisane'
      ? laczenia[edycja.index]
      : edycja?.kind === 'propozycja'
        ? propozycje?.[edycja.index]
        : undefined;
  // A changed merge may keep its own rows; a suggestion edited may not take a stored merge's.
  const editorInne = edycja?.kind === 'zapisane' ? laczenia.filter((_, j) => j !== edycja.index) : laczenia;
  const mozna = spr.sekcje.some((s) => pozycje(s, rodzaj).length >= 2);

  const czlony = (l: SprawozdanieLaczenie) => (
    <ul className="zlacz-parts">
      {l.wiersze.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );

  return (
    <>
      <FormSection
        icon={icon}
        title={tx('Title')}
        description={tx('Desc')}
        badge={laczenia.length > 0 ? String(laczenia.length) : undefined}
        aside={
          mozna && (
            <div className="form-section__actions">
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void propose()}
                disabled={busy}
                title={tx('AiHint')}
              >
                <Icon name={aiBusy ? 'loader' : 'sparkles'} size={13} /> {t.zlaczAi}
              </button>
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => setEdycja({ kind: 'nowe' })}
                disabled={busy}
              >
                <Icon name="plus" size={13} /> {tx('New')}
              </button>
            </div>
          )
        }
      >
        {aiBusy && (
          // The AI takes a while over a long statement: say what is going on, where the answer will appear.
          <div className="zlacz-ai-working" role="status" aria-live="polite">
            <div className="zlacz-ai-working__head">
              <span className="loader-spinner zlacz-ai-working__spinner" aria-hidden="true" />
              <span className="zlacz-ai-working__text">
                <strong>{tx('AiWorking')}</strong>
                <span>{t.zlaczAiWorkingHint}</span>
              </span>
            </div>
            <div className="zlacz-ai-working__skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {!aiBusy && propozycje && propozycje.length > 0 && (
          <div className="zlacz-proposals">
            <div className="zlacz-proposals__head">
              <span>
                <Icon name="sparkles" size={14} /> {tx('AiReview').replace('{n}', String(propozycje.length))}
              </span>
              <div className="form-section__actions">
                <button
                  type="button"
                  className="button button-small button-ghost"
                  onClick={() => setPropozycje(null)}
                  disabled={busy}
                >
                  <Icon name="x" size={13} /> {t.zlaczRejectAll}
                </button>
                <button
                  type="button"
                  className="button button-small button-success"
                  onClick={() => void acceptAll()}
                  disabled={busy}
                >
                  <Icon name="check" size={13} /> {t.zlaczAcceptAll}
                </button>
              </div>
            </div>
            <ul className="zlacz-list">
              {propozycje.map((p, i) => (
                <li key={`${p.sekcja}|${p.wiersze.join('|')}`} className="zlacz-item zlacz-item--ai">
                  <div className="zlacz-item__main">
                    <div className="zlacz-item__title">
                      <strong>{p.nazwa}</strong>
                      <span className="zeb-muted">{p.sekcja}</span>
                    </div>
                    {czlony(p)}
                    <span className="zlacz-item__sum">{sumy(sekcjaOf(p), p.wiersze)}</span>
                    {p.uzasadnienie && <span className="zlacz-item__why">{p.uzasadnienie}</span>}
                  </div>
                  <div className="zlacz-item__actions">
                    <button
                      type="button"
                      className="button button-small button-success"
                      onClick={() => void accept(i)}
                      disabled={busy}
                    >
                      <Icon name="check" size={13} /> {t.zlaczAccept}
                    </button>
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      onClick={() => setEdycja({ kind: 'propozycja', index: i })}
                      disabled={busy}
                    >
                      <Icon name="edit" size={13} /> {t.zlaczEdit}
                    </button>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      onClick={() => dropPropozycja(i)}
                      disabled={busy}
                    >
                      <Icon name="x" size={13} /> {t.zlaczReject}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {laczenia.length === 0 ? (
          <p className="form-empty">{mozna ? tx('Empty') : tx('Nothing')}</p>
        ) : (
          <ul className="zlacz-list">
            {laczenia.map((l, i) => {
              const ok = laczenieAktualne(spr, l);
              return (
                <li key={`${l.sekcja}|${l.wiersze.join('|')}`} className={`zlacz-item${ok ? '' : ' is-stale'}`}>
                  <div className="zlacz-item__main">
                    <div className="zlacz-item__title">
                      <strong>{l.nazwa}</strong>
                      <span className="zeb-muted">{l.sekcja}</span>
                      {!ok && (
                        <span className="status-badge status-pending" title={tx('StaleHint')}>
                          {t.zlaczStale}
                        </span>
                      )}
                    </div>
                    {czlony(l)}
                    {ok && <span className="zlacz-item__sum">{sumy(sekcjaOf(l), l.wiersze)}</span>}
                  </div>
                  <div className="zlacz-item__actions">
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      onClick={() => setEdycja({ kind: 'zapisane', index: i })}
                      disabled={busy}
                    >
                      <Icon name="edit" size={13} /> {t.zlaczEdit}
                    </button>
                    <button
                      type="button"
                      className="button button-small button-ghost icon-danger"
                      onClick={() => void remove(i)}
                      disabled={busy}
                    >
                      <Icon name={rodzaj === 'podkategorie' ? 'trash' : 'undo'} size={13} /> {tx('Remove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </FormSection>

      {edycja && (
        <LaczenieModal
          t={t}
          tx={tx}
          rodzaj={rodzaj}
          icon={icon}
          spr={spr}
          poczatek={editorStart}
          inne={editorInne}
          busy={busy}
          onSave={(l) => void onEditorSave(l)}
          onClose={() => setEdycja(null)}
        />
      )}
    </>
  );
};

export default ZebranieSprawozdanieLaczenia;
