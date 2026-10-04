import React, { useMemo, useRef, useState } from 'react';
import { MailingAdresaci, MailingOdbiorca, MailingOdbiorcaRodzaj } from '../../shared/types';
import {
  MailingOdbiorcaKandydat,
  MailingRecipientLookup,
  isValidEmail,
  jednostkaFor,
  normalizeEmail,
  parseEmailList,
  resolveOdbiorcy,
} from '../../shared/mailing-recipients';
import { translations, Language } from '../translations';
import ChoiceCards from './ChoiceCards';
import Icon from './Icon';

type T = (typeof translations)[Language];

/**
 * Who this letter goes to: the four recipient groups (jednostka ZGN,
 * pełnomocnik, zarząd, własne e-maile) with the addresses each one resolves to,
 * every address untickable for this letter.
 *
 * CONTRACT (stable — the Mailing send screen and the Zebrania notice editor both
 * use it):
 *   - `adresaci` starts as the mailing kind's default and is changed for this
 *     letter only; `onAdresaciChange` reports the new groups / custom list.
 *   - `wykluczeni` are lower-cased mailboxes unticked for this letter.
 *   - `lookup` is what the groups resolve against (community, meeting, units,
 *     proxies); null ⇒ only the groups are shown, without addresses.
 *   - Resolution is `resolveOdbiorcy` from shared/mailing-recipients — the same
 *     function the main process sends with.
 */
export interface MailingRecipientsEditorProps {
  language: Language;
  adresaci: MailingAdresaci;
  onAdresaciChange: (adresaci: MailingAdresaci) => void;
  wykluczeni: string[];
  onWykluczeniChange: (wykluczeni: string[]) => void;
  lookup: MailingRecipientLookup | null;
  /** Which community the address list is for, when a send has several. */
  contextLabel?: string;
  disabled?: boolean;
}

/** The three groups that are switched on or off, in the order they are resolved. */
const GROUP_KEYS = ['zgn', 'pelnomocnik', 'zarzad'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

/** Every group in resolution order — the order the resolved list is shown in. */
const ALL_RODZAJE: MailingOdbiorcaRodzaj[] = ['zgn', 'pelnomocnik', 'zarzad', 'wlasne'];

/**
 * Display name of a recipient group. Exported because the history and the kinds
 * dictionary label recipients the same way — one wording for one concept.
 */
export function odbiorcaRodzajLabel(t: T, rodzaj: MailingOdbiorcaRodzaj): string {
  switch (rodzaj) {
    case 'zgn':
      return t.mailingAdresaciGroupZgn;
    case 'pelnomocnik':
      return t.mailingAdresaciGroupPelnomocnik;
    case 'zarzad':
      return t.mailingAdresaciGroupZarzad;
    case 'wlasne':
      return t.mailingAdresaciGroupWlasne;
  }
}

/**
 * One-line summary of a recipient setting ("Jednostka ZGN, Osoby z zarządu,
 * 2 własne adresy") for lists where the full editor would be too much.
 */
export function adresaciSummary(t: T, adresaci: MailingAdresaci): string {
  const parts: string[] = GROUP_KEYS.filter((key) => adresaci[key]).map((key) =>
    odbiorcaRodzajLabel(t, key),
  );
  const wlasne = adresaci.wlasne ?? [];
  if (wlasne.length === 1) parts.push(wlasne[0]);
  else if (wlasne.length > 1) parts.push(`${t.mailingAdresaciGroupWlasne} (${wlasne.length})`);
  return parts.length > 0 ? parts.join(', ') : t.mailingAdresaciNoGroups;
}

/** "Mail trafi do: N adresatów" — Polish takes the singular only for exactly one. */
export function odbiorcyTotalLabel(t: T, count: number): string {
  if (count === 0) return t.mailingAdresaciTotalNone;
  if (count === 1) return t.mailingAdresaciTotalOne;
  return t.mailingAdresaciTotal.replace('{count}', String(count));
}

interface MailingOdbiorcyListProps {
  language: Language;
  odbiorcy: MailingOdbiorca[];
  /** Show at most this many, then "+N więcej"; absent ⇒ all of them. */
  limit?: number;
  /** Label each line with its group ("Jednostka ZGN", "Osoby z zarządu"…). */
  showGroup?: boolean;
}

/**
 * The resolved recipients of one mail, one per line — name, then mailbox. Used
 * wherever a mail's addressees are shown after the fact (communities list,
 * results, history), so they read the same everywhere.
 */
export const MailingOdbiorcyList: React.FC<MailingOdbiorcyListProps> = ({
  language,
  odbiorcy,
  limit,
  showGroup,
}) => {
  const t = translations[language];
  const shown = limit != null ? odbiorcy.slice(0, limit) : odbiorcy;
  const rest = odbiorcy.length - shown.length;
  return (
    <div className="mailing-odbiorcy-list">
      {shown.map((o) => (
        <div key={`${o.rodzaj}-${o.email}`}>
          {showGroup && <span className="mailing-odbiorca-tag">{odbiorcaRodzajLabel(t, o.rodzaj)}</span>}
          {o.nazwa && <span>{o.nazwa} </span>}
          <span style={{ opacity: o.nazwa ? 0.7 : 1, wordBreak: 'break-all' }}>
            {o.nazwa ? `<${o.email}>` : o.email}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <div className="mailing-odbiorcy-list__more">
          {t.mailingAdresaciMoreCount.replace('{count}', String(rest))}
        </div>
      )}
    </div>
  );
};

/**
 * Why a group that was asked for produced nobody, in the office's own terms —
 * an empty group is the question "why isn't the board on this?", and the answer
 * is always a missing piece of data somewhere specific.
 */
function brakExplanation(t: T, rodzaj: MailingOdbiorcaRodzaj, lookup: MailingRecipientLookup): string {
  const jednostka = jednostkaFor(lookup);
  switch (rodzaj) {
    case 'zgn':
      return jednostka ? t.mailingAdresaciMissingZgnNoEmail : t.mailingAdresaciMissingZgnNoUnit;
    case 'pelnomocnik':
      if (lookup.spotkanie?.zgnPelnomocnikId != null) return t.mailingAdresaciMissingPelnomocnikMeeting;
      return jednostka ? t.mailingAdresaciMissingPelnomocnik : t.mailingAdresaciMissingPelnomocnikNoUnit;
    case 'zarzad':
      return lookup.spotkanie ? t.mailingAdresaciMissingZarzadMeeting : t.mailingAdresaciMissingZarzad;
    case 'wlasne':
      return '';
  }
}

function groupHint(t: T, key: GroupKey): string {
  switch (key) {
    case 'zgn':
      return t.mailingAdresaciGroupZgnHint;
    case 'pelnomocnik':
      return t.mailingAdresaciGroupPelnomocnikHint;
    case 'zarzad':
      return t.mailingAdresaciGroupZarzadHint;
  }
}

const MailingRecipientsEditor: React.FC<MailingRecipientsEditorProps> = ({
  language,
  adresaci,
  onAdresaciChange,
  wykluczeni,
  onWykluczeniChange,
  lookup,
  contextLabel,
  disabled,
}) => {
  const t = translations[language];
  /** What is being typed into the custom-address box, before it becomes chips. */
  const [typed, setTyped] = useState('');
  /** Entries from the last "add" that did not look like a mailbox — left in the box to fix. */
  const [typedInvalid, setTypedInvalid] = useState<string[]>([]);
  const typedRef = useRef<HTMLInputElement>(null);

  const resolved = useMemo(
    () => (lookup ? resolveOdbiorcy(lookup, adresaci, wykluczeni) : null),
    [lookup, adresaci, wykluczeni],
  );

  const wlasne = adresaci.wlasne ?? [];

  const toggleGroup = (key: GroupKey) => onAdresaciChange({ ...adresaci, [key]: !adresaci[key] });

  /**
   * Turn the typed text into custom addresses. Valid ones become chips at once;
   * anything that isn't a mailbox stays in the box with a note, rather than being
   * stored and then silently skipped at send time.
   */
  const addTyped = () => {
    const entries = parseEmailList(typed);
    if (entries.length === 0) {
      setTyped('');
      setTypedInvalid([]);
      return;
    }
    const valid = entries.filter(isValidEmail);
    const invalid = entries.filter((e) => !isValidEmail(e));
    if (valid.length > 0) {
      const have = new Set(wlasne.map(normalizeEmail));
      const added = valid.filter((e) => !have.has(normalizeEmail(e)));
      if (added.length > 0) onAdresaciChange({ ...adresaci, wlasne: [...wlasne, ...added] });
    }
    setTyped(invalid.join(', '));
    setTypedInvalid(invalid);
  };

  const removeWlasny = (email: string) => {
    const key = normalizeEmail(email);
    onAdresaciChange({ ...adresaci, wlasne: wlasne.filter((e) => normalizeEmail(e) !== key) });
  };

  const toggleExcluded = (kandydat: MailingOdbiorcaKandydat) => {
    const key = normalizeEmail(kandydat.email);
    onWykluczeniChange(
      kandydat.wykluczony ? wykluczeni.filter((w) => normalizeEmail(w) !== key) : [...wykluczeni, key],
    );
  };

  /** Groups worth a heading in the resolved list: switched on, or custom addresses present. */
  const shownRodzaje = ALL_RODZAJE.filter((rodzaj) =>
    rodzaj === 'wlasne' ? wlasne.length > 0 : adresaci[rodzaj],
  );
  const nothingPicked = shownRodzaje.length === 0;
  const excludedCount = resolved ? resolved.kandydaci.filter((k) => k.wykluczony).length : 0;

  return (
    <div className="mailing-adresaci">
      <div className="form-field">
        <div className="form-field__label-row">
          <span className="form-field__label">{t.mailingAdresaciGroupsLabel}</span>
        </div>
        <ChoiceCards
          options={GROUP_KEYS.map((key) => ({ value: key, label: odbiorcaRodzajLabel(t, key), hint: groupHint(t, key) }))}
          selected={GROUP_KEYS.filter((key) => adresaci[key])}
          onToggle={toggleGroup}
          disabled={disabled}
        />
      </div>

      {/* Own addresses in the app's tag field: chips inside the box, the next one
          typed after them — the same control as the address form's lists. */}
      <div className="form-field">
        <div className="form-field__label-row">
          <label className="form-field__label" htmlFor="mailing-adresaci-wlasne">
            {t.mailingAdresaciWlasneLabel}
          </label>
        </div>
        <div
          className={`tag-input${disabled ? ' is-disabled' : ''}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) typedRef.current?.focus();
          }}
        >
          {wlasne.map((email) => {
            const invalid = !isValidEmail(email);
            return (
              <span
                key={email}
                className={`tag-input__chip${invalid ? ' tag-input__chip--invalid' : ''}`}
                title={invalid ? t.mailingAdresaciWlasneInvalidChip : email}
              >
                {invalid && <Icon name="alert-triangle" size={12} />}
                <span className="tag-input__chip-text">{email}</span>
                <button
                  type="button"
                  className="tag-input__chip-remove"
                  onClick={() => removeWlasny(email)}
                  disabled={disabled}
                  title={t.mailingAdresaciWlasneRemove}
                  aria-label={`${t.mailingAdresaciWlasneRemove}: ${email}`}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            );
          })}
          <input
            ref={typedRef}
            id="mailing-adresaci-wlasne"
            type="text"
            className="tag-input__input"
            value={typed}
            disabled={disabled}
            placeholder={wlasne.length === 0 ? t.mailingAdresaciWlasnePlaceholder : undefined}
            onChange={(e) => {
              setTyped(e.target.value);
              if (typedInvalid.length > 0) setTypedInvalid([]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTyped();
              }
            }}
            // Leaving the box counts as "add": an address typed and then forgotten
            // about would otherwise be lost when the form is saved.
            onBlur={() => {
              if (typed.trim()) addTyped();
            }}
          />
          {typed.trim() && !disabled && (
            <button
              type="button"
              className="tag-input__add"
              // Keep focus in the input: the click adds, the blur must not add twice.
              onMouseDown={(e) => e.preventDefault()}
              onClick={addTyped}
            >
              <Icon name="plus" size={12} />
              {t.mailingAdresaciWlasneAdd}
              <kbd>Enter</kbd>
            </button>
          )}
        </div>
        <div className="form-field__hint">{t.mailingAdresaciWlasneHint}</div>
        {typedInvalid.length > 0 && (
          <div className="form-field__error" role="alert">
            <Icon name="alert-circle" size={13} />
            {t.mailingAdresaciWlasneInvalid.replace('{emails}', typedInvalid.join(', '))}
          </div>
        )}
      </div>

      {/* What the groups resolve to for one community, as a small table: the
          group on the left, its addresses (or why it has none) on the right.
          Header = whose list it is + the total; the hint goes under the box. */}
      {lookup && resolved && (
        <div className="form-field">
          <div className="recipients-box">
            <div className="recipients-box__head">
              {contextLabel ? (
                <span className="recipients-box__context">
                  <Icon name="building" size={14} />
                  {t.mailingAdresaciListFor.replace('{name}', contextLabel)}
                </span>
              ) : (
                <span />
              )}
              <span className={`recipients-box__total${resolved.odbiorcy.length === 0 ? ' is-empty' : ''}`}>
                <Icon name={resolved.odbiorcy.length === 0 ? 'alert-triangle' : 'mail'} size={14} />
                {odbiorcyTotalLabel(t, resolved.odbiorcy.length)}
                {excludedCount > 0 && (
                  <span className="recipients-box__excluded">
                    ({t.mailingAdresaciExcludedCount.replace('{count}', String(excludedCount))})
                  </span>
                )}
              </span>
            </div>

            {nothingPicked ? (
              <div className="recipients-box__group">
                <div className="recipients-box__missing is-alert">
                  <Icon name="alert-triangle" size={14} /> {t.mailingAdresaciNoGroups}
                </div>
              </div>
            ) : (
              shownRodzaje.map((rodzaj) => {
                const rows = resolved.kandydaci.filter((k) => k.rodzaj === rodzaj);
                const missing = resolved.braki.includes(rodzaj);
                // A mailbox already listed under an earlier group isn't repeated, so
                // a group can be empty without anything missing — say nothing then.
                if (rows.length === 0 && !missing) return null;
                return (
                  <div key={rodzaj} className="recipients-box__group">
                    <div className="recipients-box__label">{odbiorcaRodzajLabel(t, rodzaj)}</div>
                    <div className="recipients-box__rows">
                      {rows.map((k) => (
                        <label
                          key={k.email}
                          className={`recipients-box__row${k.wykluczony ? ' is-excluded' : ''}`}
                        >
                          <span className={`ks-check ks-check--sm${k.wykluczony ? '' : ' is-on'}`}>
                            <input
                              type="checkbox"
                              className="ks-check__input"
                              checked={!k.wykluczony}
                              disabled={disabled}
                              onChange={() => toggleExcluded(k)}
                              aria-label={k.nazwa ? `${k.nazwa} <${k.email}>` : k.email}
                            />
                            <span className="ks-check__box" aria-hidden="true">
                              <Icon name="check" size={10} strokeWidth={3} />
                            </span>
                          </span>
                          {k.nazwa && <span className="recipients-box__name">{k.nazwa}</span>}
                          <span className="recipients-box__email">{k.email}</span>
                        </label>
                      ))}
                      {missing && (
                        <div className="recipients-box__missing">
                          <Icon name="info" size={14} /> {brakExplanation(t, rodzaj, lookup)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {resolved.kandydaci.length > 0 && (
            <div className="form-field__hint">{t.mailingAdresaciListHint}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MailingRecipientsEditor;
