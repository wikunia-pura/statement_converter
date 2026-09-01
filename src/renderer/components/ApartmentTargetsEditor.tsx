import React from 'react';
import { ApartmentMappingTarget } from '../../shared/types';
import { isAccountSymbol, isLetteredApartment } from '../../shared/apartment-account';
import { translations, Language } from '../translations';
import Icon from './Icon';

/**
 * The apartment list of one apartment rule, edited as repeatable rows.
 *
 * Used by both places a rule can be written — the Adresy dictionary and the
 * "Powiąż lokal" form on the acceptance screen — so a rule saved in either place
 * can hold the same thing, and opening a multi-apartment rule in the smaller form
 * can never silently drop the apartments it does not show.
 */

/** One row being typed into. `key` is stable while the number still changes. */
export interface ApartmentTargetDraft {
  key: string;
  apartmentNumber: string;
  kontoLokalu: string;
}

let draftCounter = 0;

export function newApartmentTargetDraft(
  apartmentNumber = '',
  kontoLokalu = '',
): ApartmentTargetDraft {
  draftCounter += 1;
  return { key: `t${draftCounter}`, apartmentNumber, kontoLokalu };
}

/** Drafts for an existing rule — always at least one row, so the form is usable. */
export function apartmentTargetDrafts(targets: ApartmentMappingTarget[]): ApartmentTargetDraft[] {
  if (targets.length === 0) return [newApartmentTargetDraft()];
  return targets.map(target =>
    newApartmentTargetDraft(target.apartmentNumber, target.kontoLokalu ?? ''),
  );
}

/** Rows with an apartment number, in order, ready to be saved. */
export function apartmentTargetsFromDrafts(
  drafts: ApartmentTargetDraft[],
): ApartmentMappingTarget[] {
  return drafts
    .filter(draft => draft.apartmentNumber.trim().length > 0)
    .map(draft => ({
      apartmentNumber: draft.apartmentNumber.trim(),
      ...(draft.kontoLokalu.trim() ? { kontoLokalu: draft.kontoLokalu.trim() } : {}),
    }));
}

/**
 * The first thing wrong with the rows, phrased for the user, or null when they
 * are saveable. Both forms call this before saving, so the same rule is accepted
 * or refused identically in both.
 */
export function validateApartmentTargets(
  drafts: ApartmentTargetDraft[],
  language: Language,
): string | null {
  const t = translations[language];
  const targets = apartmentTargetsFromDrafts(drafts);
  if (targets.length === 0) return t.fillAllFields;

  const seen = new Set<string>();
  for (const target of targets) {
    const account = target.kontoLokalu ?? '';
    if (account && !isAccountSymbol(account)) return t.apartmentMappingAccountInvalid;
    // Without a symbol a lettered apartment stays unbookable, so the rule would
    // send this payer back to the acceptance screen every single month.
    if (!account && isLetteredApartment(target.apartmentNumber)) {
      return t.apartmentMappingAccountRequired;
    }
    const key = target.apartmentNumber.toUpperCase();
    if (seen.has(key)) return t.apartmentMappingApartmentDuplicate;
    seen.add(key);
  }
  return null;
}

interface ApartmentTargetsEditorProps {
  language: Language;
  drafts: ApartmentTargetDraft[];
  onChange: (next: ApartmentTargetDraft[]) => void;
  /** Example of a full account symbol for this community, e.g. "204-00017A". */
  accountPlaceholder: string;
  disabled?: boolean;
}

const ApartmentTargetsEditor: React.FC<ApartmentTargetsEditorProps> = ({
  language,
  drafts,
  onChange,
  accountPlaceholder,
  disabled = false,
}) => {
  const t = translations[language];

  const patch = (key: string, change: Partial<ApartmentTargetDraft>) =>
    onChange(drafts.map(draft => (draft.key === key ? { ...draft, ...change } : draft)));

  const remove = (key: string) => {
    const next = drafts.filter(draft => draft.key !== key);
    onChange(next.length > 0 ? next : [newApartmentTargetDraft()]);
  };

  return (
    <div className="apt-targets">
      {drafts.map((draft, index) => {
        const apartment = draft.apartmentNumber.trim();
        const account = draft.kontoLokalu.trim();
        const accountMissing = !account && isLetteredApartment(apartment);
        const accountInvalid = account.length > 0 && !isAccountSymbol(account);

        return (
          <div className="apt-targets__row" key={draft.key}>
            <div>
              {index === 0 && (
                <label className="apt-targets__label">
                  {t.apartmentMappingApartment} <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
              )}
              <input
                type="text"
                value={draft.apartmentNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  patch(draft.key, { apartmentNumber: e.target.value })
                }
                placeholder={t.apartmentMappingApartmentPlaceholder}
                disabled={disabled}
                autoFocus={index === 0 && drafts.length === 1 && !draft.apartmentNumber}
              />
            </div>
            <div>
              {index === 0 && (
                <label className="apt-targets__label">{t.apartmentMappingAccount}</label>
              )}
              <input
                type="text"
                value={draft.kontoLokalu}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  patch(draft.key, { kontoLokalu: e.target.value })
                }
                placeholder={accountPlaceholder}
                disabled={disabled}
                style={{ fontFamily: 'monospace' }}
              />
              {accountMissing && (
                <div className="review-card__manual-hint review-card__manual-hint--warning">
                  <Icon name="alert-triangle" size={12} /> {t.apartmentMappingAccountRequired}
                </div>
              )}
              {accountInvalid && (
                <div className="review-card__manual-hint review-card__manual-hint--warning">
                  <Icon name="alert-triangle" size={12} /> {t.apartmentMappingAccountInvalid}
                </div>
              )}
            </div>
            <div>
              {index === 0 && <label className="apt-targets__label">&nbsp;</label>}
              <button
                type="button"
                className="button button-small button-danger apt-targets__remove"
                onClick={() => remove(draft.key)}
                disabled={disabled || (drafts.length === 1 && !draft.apartmentNumber && !draft.kontoLokalu)}
                title={t.apartmentMappingRemoveApartment}
                aria-label={t.apartmentMappingRemoveApartment}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() => onChange([...drafts, newApartmentTargetDraft()])}
          disabled={disabled}
        >
          <Icon name="plus" size={13} /> {t.apartmentMappingAddApartment}
        </button>
      </div>
    </div>
  );
};

export default ApartmentTargetsEditor;
