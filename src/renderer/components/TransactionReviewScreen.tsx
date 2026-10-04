import React, { useState, useEffect, useMemo } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview, Kontrahent, KontrahentTyp, ApartmentMapping, ApartmentMappingTarget, ContractorSortOrder, DEFAULT_ACCOUNT_CONFIG } from '../../shared/types';
import { composeApartmentAccount, isLetteredApartment, resolveApartmentAccount } from '../../shared/apartment-account';
import { buildApartmentMapping, mappingTargets } from '../../shared/apartment-mapping';
import ApartmentTargetsEditor, {
  ApartmentTargetDraft,
  apartmentTargetDrafts,
  apartmentTargetsFromDrafts,
  validateApartmentTargets,
} from './ApartmentTargetsEditor';
import { translations, Language } from '../translations';
import { searchTransactionInPdf, PdfSearchMatch } from '../../shared/pdf-search';
import { useNotify } from './Notifications';
import Icon from './Icon';
import SearchableSelect from './SearchableSelect';
import { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormRow, FormSection } from './FormSection';

// Normalize like AddressMatcher (lowercase + strip Polish diacritics) so we can
// find which apartment-mapping rule produced a match in the acceptance view.
const normalizeForMapping = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[ąĄ]/g, 'a').replace(/[ćĆ]/g, 'c').replace(/[ęĘ]/g, 'e')
    .replace(/[łŁ]/g, 'l').replace(/[ńŃ]/g, 'n').replace(/[óÓ]/g, 'o')
    .replace(/[śŚ]/g, 's').replace(/[źŹżŻ]/g, 'z');

// Sort a contractor pick-list per the user's preferred order. Names use a
// True when a contractor holds the given role. Missing/empty typy ⇒ ['Kontrahent'].
const hasTyp = (k: Kontrahent, t: KontrahentTyp): boolean =>
  (k.typy && k.typy.length > 0 ? k.typy : ['Kontrahent']).includes(t);

// Polish-locale compare; account numbers use a numeric-aware compare so
// "9" < "10". Returns a new array (does not mutate the input).
const sortKontrahenci = (list: Kontrahent[], order: ContractorSortOrder): Kontrahent[] => {
  const byName = (a: Kontrahent, b: Kontrahent) =>
    (a.nazwa || '').localeCompare(b.nazwa || '', 'pl', { sensitivity: 'base' });
  const byAccount = (a: Kontrahent, b: Kontrahent) =>
    (a.kontoKontrahenta || '').localeCompare(b.kontoKontrahenta || '', undefined, { numeric: true });
  const sorted = [...list];
  switch (order) {
    case 'name-desc':
      return sorted.sort((a, b) => byName(b, a));
    case 'account-asc':
      return sorted.sort(byAccount);
    case 'account-desc':
      return sorted.sort((a, b) => byAccount(b, a));
    case 'name-asc':
    default:
      return sorted.sort(byName);
  }
};

// SearchableContractorSelect component
interface SearchableContractorSelectProps {
  kontrahenci: Kontrahent[];
  selectedContractorId: number | null;
  onChange: (contractorId: number | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
}

/**
 * A contractor (or an "other income / cost" entry) for one row — the app's
 * SearchableSelect, searchable by name, alternative spellings, NIP and account,
 * in the order the list was sorted by the user's preference.
 */
const SearchableContractorSelect: React.FC<SearchableContractorSelectProps> = ({
  kontrahenci,
  selectedContractorId,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled = false,
}) => {
  const options = useMemo(
    () => [
      { value: '', label: placeholder },
      ...kontrahenci.map((k) => ({
        value: String(k.id),
        label: k.kontoKontrahenta ? `${k.nazwa} (${k.kontoKontrahenta})` : k.nazwa,
        hint:
          [k.nip ? `NIP: ${k.nip}` : '', (k.alternativeNames ?? []).join(', ')].filter(Boolean).join(' · ') ||
          undefined,
        keywords: [k.nip ?? '', k.kontoKontrahenta ?? '', ...(k.alternativeNames ?? [])].join(' '),
      })),
    ],
    [kontrahenci, placeholder],
  );
  return (
    <SearchableSelect
      overlay
      value={selectedContractorId != null ? String(selectedContractorId) : ''}
      options={options}
      onChange={(v) => onChange(v ? Number(v) : null)}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      disabled={disabled}
      ariaLabel={placeholder}
      menuMinWidth={320}
    />
  );
};

// PdfPanel sub-component - shows PDF search result
interface PdfPanelProps {
  language: Language;
  searchResult: PdfSearchMatch | null;
  searching: boolean;
  searchField: string; // which field triggered the search
  onClose: () => void;
  highlightTokens: string[];
}

const PdfPanel: React.FC<PdfPanelProps> = ({ language, searchResult, searching, searchField, onClose, highlightTokens }) => {
  const t = translations[language];
  const closeButton = (
    <button
      type="button"
      className="button button-ghost button-icon pdf-panel__close"
      onClick={onClose}
      title={t.close}
      aria-label={t.close}
    >
      <Icon name="x" size={14} />
    </button>
  );

  if (searching) {
    return (
      <div className="pdf-panel pdf-panel--info" role="status">
        <div className="pdf-panel__head">
          <span className="pdf-panel__title">
            <Icon name="loader" size={14} className="icon-spin" /> {t.revPdfSearching}
          </span>
          {closeButton}
        </div>
      </div>
    );
  }

  if (!searchResult) {
    return (
      <div className="pdf-panel pdf-panel--danger" role="status">
        <div className="pdf-panel__head">
          <span className="pdf-panel__title">
            <Icon name="alert-circle" size={14} /> {t.revPdfNotFound}
          </span>
          {closeButton}
        </div>
        <div className="pdf-panel__text">{t.revPdfNotFoundText}</div>
      </div>
    );
  }

  // Highlight matching tokens in the text
  const highlightText = (text: string): React.ReactNode => {
    if (highlightTokens.length === 0) return text;

    const escapedTokens = highlightTokens.map(tok => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Split on the tokens (capturing group keeps them). Membership is tested
    // against a Set — NOT regex.test(), whose global-flag lastIndex is stateful
    // across calls and would mis-classify parts.
    const parts = text.split(new RegExp(`(${escapedTokens.join('|')})`, 'gi'));
    const tokenSet = new Set(highlightTokens.map(tok => tok.toLowerCase()));

    return parts.map((part, i) => {
      if (part && tokenSet.has(part.toLowerCase())) {
        return <mark key={i} className="pdf-panel__hit">{part}</mark>;
      }
      return part;
    });
  };

  const lines = searchResult.matchedText.split('\n');
  const { coreLineStart, coreLineEnd } = searchResult;

  // Detect transaction boundaries — lines starting with DD.MM.YYYY followed by ID+type
  const isTransactionStart = (line: string): boolean => {
    return /^\d{2}\.\d{2}\.\d{4}[A-Z0-9]{10,}/.test(line.trim());
  };

  // Split lines into: before-context, core match, after-context
  const beforeLines = lines.slice(0, coreLineStart);
  const coreLines = lines.slice(coreLineStart, coreLineEnd + 1);
  const afterLines = lines.slice(coreLineEnd + 1);

  // Render a set of lines with transaction separators
  const renderLinesWithSeparators = (
    lineArr: string[],
    prefix: string,
    lineClass: string,
    highlight: boolean,
  ) => {
    const elements: React.ReactNode[] = [];
    lineArr.forEach((line, i) => {
      // Add separator before transaction starts (but not the very first line)
      if (i > 0 && isTransactionStart(line)) {
        elements.push(<div key={`${prefix}-sep-${i}`} className="pdf-panel__sep" />);
      }
      elements.push(
        <div key={`${prefix}-${i}`} className={lineClass}>
          {highlight ? (highlightText(line) || '\u00A0') : (line || '\u00A0')}
        </div>
      );
    });
    return elements;
  };

  const strong = searchResult.score >= 60;

  return (
    <div className="pdf-panel pdf-panel--info">
      <div className="pdf-panel__head">
        <span className="pdf-panel__title">
          <Icon name="file-text" size={14} /> {t.revPdfData} ({searchField})
          <span className={`pdf-panel__score${strong ? ' is-strong' : ''}`}>
            {t.revPdfScore}: {searchResult.score}%
          </span>
        </span>
        {closeButton}
      </div>

      <div className="pdf-panel__body">
        {beforeLines.length > 0 && (
          <div className="pdf-panel__context">
            {renderLinesWithSeparators(beforeLines, 'before', 'pdf-panel__line', false)}
          </div>
        )}

        {/* Core match — highlighted block */}
        <div className="pdf-panel__core">
          <div className="pdf-panel__core-label">{t.revPdfFound}</div>
          {renderLinesWithSeparators(coreLines, 'core', 'pdf-panel__line is-core', true)}
        </div>

        {afterLines.length > 0 && (
          <div className="pdf-panel__context is-after">
            {renderLinesWithSeparators(afterLines, 'after', 'pdf-panel__line', false)}
          </div>
        )}
      </div>
    </div>
  );
};

interface ApartmentChoicePanelProps {
  language: Language;
  /** The rule's apartments, in the order the rule lists them. */
  targets: ApartmentMappingTarget[];
  /** Fixed part of every apartment account in this conversion ("204"). */
  apartmentPrefix: string;
  /** The phrase that matched, shown so the user can tell which rule this is. */
  matchText: string;
  note?: string;
  selected: ApartmentMappingTarget | undefined;
  onSelect: (target: ApartmentMappingTarget | null) => void;
}

/**
 * "Which of this payer's apartments is this?" — the acceptance-screen half of a
 * multi-apartment rule.
 *
 * The rule identified the payer, so the app knows the shortlist but not the
 * answer; showing the shortlist as buttons keeps the decision to one click while
 * making it impossible to book the transfer onto an apartment the rule never
 * mentioned. Each option carries the account it would post to, because that is
 * the part that actually moves the money.
 */
const ApartmentChoicePanel: React.FC<ApartmentChoicePanelProps> = ({
  language,
  targets,
  apartmentPrefix,
  matchText,
  note,
  selected,
  onSelect,
}) => {
  const t = translations[language];
  const resolved = selected
    ? resolveApartmentAccount(selected.apartmentNumber, selected.kontoLokalu ?? null, apartmentPrefix)
    : null;
  // A lettered apartment with no account on the rule cannot be picked: the rule
  // says which apartment it is but not where to book it, and the app must not
  // invent the symbol. The row is then resolved by the "Konto lokalu" field below.
  const unbookable = targets.filter(
    (target) => !resolveApartmentAccount(target.apartmentNumber, target.kontoLokalu ?? null, apartmentPrefix),
  );

  return (
    <div className={`mapping-choice${selected ? ' mapping-choice--resolved' : ''}`}>
      <div className="mapping-choice__label">
        <Icon name={selected ? 'check-circle' : 'map-pin'} size={12} />
        {selected ? t.mappingChoiceSelectedLabel : t.mappingChoicePending}
      </div>
      <div className="mapping-choice__hint">
        {selected ? t.mappingChoiceLabel : t.mappingChoiceHint}
      </div>
      <div className="mapping-choice__options">
        {targets.map((target) => {
          const account = resolveApartmentAccount(
            target.apartmentNumber,
            target.kontoLokalu ?? null,
            apartmentPrefix,
          );
          const isSelected = selected?.apartmentNumber === target.apartmentNumber;
          return (
            <button
              key={target.apartmentNumber}
              type="button"
              className={`mapping-choice__option${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(isSelected ? null : target)}
              disabled={!account}
              title={account ? `${target.apartmentNumber} → ${account}` : t.mappingChoiceNoAccountHint}
            >
              <span className="mapping-choice__number">{target.apartmentNumber}</span>
              <span className="mapping-choice__account">{account || t.mappingChoiceNoAccount}</span>
            </button>
          );
        })}
      </div>
      <div className="mapping-choice__footer">
        <span>
          <Icon name="map-pin" size={11} /> {matchText}
          {note ? ` — ${note}` : ''}
        </span>
        {selected && resolved && (
          <>
            <strong className="mapping-choice__resolved">
              {t.manualApartmentAccountPreview}: {resolved}
            </strong>
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => onSelect(null)}
            >
              <Icon name="x" size={12} /> {t.mappingChoiceClear}
            </button>
          </>
        )}
      </div>
      {unbookable.length > 0 && (
        <div className="review-card__manual-hint review-card__manual-hint--warning">
          <Icon name="alert-triangle" size={12} /> {t.mappingChoiceNoAccountHint}
        </div>
      )}
    </div>
  );
};

// TransactionCard sub-component
interface TransactionCardProps {
  trn: TransactionForReview;
  idx: number;
  currentDecision: ReviewDecision | undefined;
  manualInput: string | undefined;
  /** "Konto lokalu" suffix typed for this row (the part after the prefix). */
  manualAccount: string | undefined;
  /** Fixed part of every apartment account in this conversion ("204"). */
  apartmentPrefix: string;
  manualContractorId: number | undefined;
  manualRemainingIncomeId: number | undefined;
  manualRemainingCostId: number | undefined;
  kontrahenci: Kontrahent[];
  remainingIncomeEntries: Kontrahent[];
  remainingCostEntries: Kontrahent[];
  handleDecision: (index: number, action: 'accept' | 'reject' | 'clarify') => void;
  handleManualInput: (index: number, value: string) => void;
  handleManualAccountInput: (index: number, value: string) => void;
  handleManualContractorSelect: (index: number, contractorId: number | null) => void;
  handleManualRemainingIncomeSelect: (index: number, entryId: number | null) => void;
  handleManualRemainingCostSelect: (index: number, entryId: number | null) => void;
  language: Language;
  pdfLines?: string[];
  /** Address id the current acceptance concerns; null disables saving a rule. */
  adresId: number | null;
  /** Current apartment-mapping rules of that address (for detecting existing matches). */
  addressMappings: ApartmentMapping[];
  /** Persist an apartment-mapping rule under the current address and mark the
   *  given transaction as matched by it. Pass editId to update an existing rule. */
  onSaveApartmentMapping: (
    index: number,
    matchText: string,
    targets: ApartmentMappingTarget[],
    editId?: string,
  ) => Promise<void>;
  /** Which of a multi-apartment rule's apartments the user picked for this row. */
  mappingChoice: ApartmentMappingTarget | undefined;
  /** Book this row onto one of the rule's apartments (null clears the choice). */
  onChooseMappingTarget: (index: number, target: ApartmentMappingTarget | null) => void;
  /** Expense counterpart of the apartment rule: teach a contractor the spelling
   *  this bank uses, so the deterministic matcher catches it next time — no AI. */
  onSaveAlternativeName: (index: number, contractorId: number, alternativeName: string) => Promise<void>;
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  trn,
  idx,
  currentDecision,
  manualInput,
  manualAccount,
  apartmentPrefix,
  manualContractorId,
  manualRemainingIncomeId,
  manualRemainingCostId,
  kontrahenci,
  remainingIncomeEntries,
  remainingCostEntries,
  handleDecision,
  handleManualInput,
  handleManualAccountInput,
  handleManualContractorSelect,
  handleManualRemainingIncomeSelect,
  handleManualRemainingCostSelect,
  language,
  pdfLines,
  adresId,
  addressMappings,
  onSaveApartmentMapping,
  mappingChoice,
  onChooseMappingTarget,
  onSaveAlternativeName,
}) => {
  const [pdfResult, setPdfResult] = useState<PdfSearchMatch | null>(null);
  const [pdfSearching, setPdfSearching] = useState(false);
  const [pdfVisible, setPdfVisible] = useState(false);
  const [pdfSearchField, setPdfSearchField] = useState('');
  const [pdfHighlightTokens, setPdfHighlightTokens] = useState<string[]>([]);

  // Apartment-mapping rule form (income only)
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleMatchText, setRuleMatchText] = useState('');
  /**
   * The rule's apartments, each with its optional account symbol. A list rather
   * than a single field because one payer can own several apartments — and because
   * editing a rule that already has several must not quietly drop the extra ones.
   */
  const [ruleTargetDrafts, setRuleTargetDrafts] = useState<ApartmentTargetDraft[]>(
    apartmentTargetDrafts([]),
  );
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleSaved, setRuleSaved] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  // Alternative-name form (expense only)
  const [altFormOpen, setAltFormOpen] = useState(false);
  const [altContractorId, setAltContractorId] = useState<number | null>(null);
  const [altName, setAltName] = useState('');
  const [altSaving, setAltSaving] = useState(false);
  const [altSaved, setAltSaved] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);

  const t = translations[language];

  // The rule (if any) that this transaction already matches — used to switch the
  // "link apartment" button into edit mode instead of adding a duplicate.
  const existingRule = React.useMemo<ApartmentMapping | null>(() => {
    if (trn.transactionType !== 'income') return null;
    if (!trn.extracted.matchedByManualMapping) return null;
    const hay = normalizeForMapping(`${trn.original.description} ${trn.original.counterparty}`);
    // Some converters glue MT940 continuation lines together without a separator
    // and others join them with a space, so a phrase straddling a line break can
    // differ from this text by whitespace alone. Retry without it before giving up:
    // failing to recognize the rule here would cost the user the apartment picker.
    const squeezed = hay.replace(/\s+/g, '');
    return addressMappings.find(m => {
      const needle = normalizeForMapping(m.matchText.trim());
      return hay.includes(needle) || squeezed.includes(needle.replace(/\s+/g, ''));
    }) || null;
  }, [addressMappings, trn]);

  /**
   * The apartments the matched rule points at. More than one means the rule knows
   * the payer but not which of their apartments this transfer is for — the matcher
   * then leaves the number empty on purpose, and this row is resolved by picking
   * one of these instead of by accepting an extracted number.
   */
  const ruleTargets = React.useMemo<ApartmentMappingTarget[]>(
    () => (existingRule ? mappingTargets(existingRule) : []),
    [existingRule],
  );
  const needsApartmentChoice = trn.transactionType === 'income' && ruleTargets.length > 1;

  const openRuleForm = () => {
    if (existingRule) {
      setRuleMatchText(existingRule.matchText);
      setRuleTargetDrafts(apartmentTargetDrafts(mappingTargets(existingRule)));
    } else {
      setRuleMatchText(trn.original.counterparty || '');
      // Carry over what the user already stated for this row — the apartment they
      // typed, or the account — so "assign it once, then make it stick" needs no
      // retyping.
      const typedAccount = manualAccount && composeApartmentAccount(apartmentPrefix, manualAccount);
      setRuleTargetDrafts(
        apartmentTargetDrafts([
          {
            apartmentNumber:
              (manualInput && manualInput.trim()) || trn.extracted.apartmentNumber || '',
            kontoLokalu: typedAccount || trn.extracted.accountOverride || '',
          },
        ]),
      );
    }
    setRuleError(null);
    setRuleSaved(false);
    setRuleFormOpen(true);
  };

  const submitRule = async () => {
    const mt = ruleMatchText.trim();
    if (!mt) {
      setRuleError(t.fillAllFields);
      return;
    }
    const targetsError = validateApartmentTargets(ruleTargetDrafts, language);
    if (targetsError) {
      setRuleError(targetsError);
      return;
    }
    setRuleSaving(true);
    setRuleError(null);
    try {
      await onSaveApartmentMapping(
        trn.index,
        mt,
        apartmentTargetsFromDrafts(ruleTargetDrafts),
        existingRule?.id,
      );
      setRuleSaved(true);
      setRuleFormOpen(false);
    } catch (e: unknown) {
      setRuleError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRuleSaving(false);
    }
  };

  const openAltForm = () => {
    // Default to the contractor the user just picked for this row — the usual
    // flow is "assign it manually, then teach the matcher so it sticks".
    setAltContractorId(manualContractorId ?? null);
    // The bank's own rendering of the vendor is exactly the string that has to
    // match next month, wrapping damage and all.
    setAltName(trn.original.counterparty || trn.original.description || '');
    setAltError(null);
    setAltSaved(false);
    setAltFormOpen(true);
  };

  const submitAltName = async () => {
    const name = altName.trim();
    if (!altContractorId || !name) {
      setAltError(t.fillAllFields);
      return;
    }
    setAltSaving(true);
    setAltError(null);
    try {
      await onSaveAlternativeName(trn.index, altContractorId, name);
      setAltSaved(true);
      setAltFormOpen(false);
    } catch (e: unknown) {
      setAltError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAltSaving(false);
    }
  };

  const handlePdfLookup = (field: 'opis' | 'kontrahent') => {
    if (!pdfLines || pdfLines.length === 0) return;
    
    // If already showing for the same field, toggle off
    if (pdfVisible && pdfSearchField === field) {
      setPdfVisible(false);
      return;
    }
    
    setPdfSearching(true);
    setPdfVisible(true);
    setPdfSearchField(field);
    
    // Build highlight tokens from the field
    const text = field === 'opis' ? trn.original.description : trn.original.counterparty;
    const tokens = text.replace(/[˙�]/g, '').split(/\s+/).filter(w => w.length >= 3).slice(0, 6);
    // Also add amount as highlight
    tokens.push(trn.original.amount.toFixed(2).replace('.', ','));
    setPdfHighlightTokens(tokens);
    
    // Run search (synchronous but wrap in setTimeout to show loading state)
    setTimeout(() => {
      const result = searchTransactionInPdf(pdfLines, {
        amount: trn.original.amount,
        description: trn.original.description,
        counterparty: trn.original.counterparty,
        date: trn.original.date,
      });
      setPdfResult(result);
      setPdfSearching(false);
    }, 50);
  };

  // The card's frame says where the decision stands — undecided, accepted,
  // rejected / to clarify, or resolved by hand.
  const decisionTone = !currentDecision
    ? ''
    : currentDecision.action === 'accept'
      ? ' is-accepted'
      : currentDecision.action === 'reject'
        ? ' is-rejected'
        : currentDecision.action === 'clarify'
          ? ' is-clarify'
          : ' is-manual';

  const hasPdf = !!pdfLines && pdfLines.length > 0;
  const lookup = (field: 'opis' | 'kontrahent', text: string) =>
    hasPdf ? (
      <button
        type="button"
        className={`pdf-lookup${pdfVisible && pdfSearchField === field ? ' is-active' : ''}`}
        onClick={() => handlePdfLookup(field)}
        title={t.revPdfLookupTitle}
      >
        {text}
      </button>
    ) : (
      text
    );

  const conf = trn.transactionType === 'income'
    ? trn.extracted.confidence
    : (trn.matchedContractor?.confidence || 0);
  const confTone = conf >= 85 ? 'is-high' : conf >= 60 ? 'is-mid' : 'is-low';

  return (
  <article className={`review-card${decisionTone}`}>
    {/* Transaction Header */}
    <header className="review-card__head">
      <h3 className="review-card__title">{t.revTransaction} #{idx + 1}</h3>
      <span className={`review-badge ${trn.transactionType === 'income' ? 'is-income' : 'is-expense'}`}>
        <Icon name={trn.transactionType === 'income' ? 'coins' : 'arrow-right'} size={11} />
        {trn.transactionType === 'income' ? t.revIncomeBadge : t.revExpenseBadge}
      </span>
      <span className={`review-badge conf ${confTone}`}>
        {trn.transactionType === 'income' ? t.revConfidence : t.revMatch}: {conf}%
      </span>
    </header>

    <div className="review-card__grid">
      {/* Original Data */}
      <section className="review-card__block">
        <h4 className="review-card__block-title">
          <Icon name="file-text" size={14} /> {t.revStatementData}
        </h4>
        <dl className="facts">
          <dt>{t.revDate}</dt>
          <dd>{trn.original.date}</dd>
          <dt>{t.revAmount}</dt>
          <dd className="review-card__amount">{trn.original.amount} PLN</dd>
          <dt>{t.revDescription}</dt>
          <dd>{lookup('opis', trn.original.description)}</dd>
          <dt>{t.revCounterparty}</dt>
          <dd>{lookup('kontrahent', trn.original.counterparty)}</dd>
        </dl>
        {hasPdf && <div className="form-field__hint">{t.revPdfLookupHint}</div>}
      </section>

      {/* Extracted Data */}
      {trn.transactionType === 'income' && (
        <section className="review-card__block">
          <h4 className="review-card__block-title">
            <Icon name="search" size={14} /> {t.revExtracted}
            {trn.extracted.matchedByManualMapping && (
              <span className="form-section__badge is-accent">
                <Icon name="check-circle" size={11} /> {t.matchedByMapping}
              </span>
            )}
          </h4>
          <dl className="facts">
            <dt>{t.revAddress}</dt>
            <dd>{trn.extracted.fullAddress || <span className="cell-empty">{t.revNotFound}</span>}</dd>
            <dt>{t.revStreet}</dt>
            <dd>{trn.extracted.streetName || <span className="cell-empty">—</span>}</dd>
            <dt>{t.revBuilding}</dt>
            <dd>{trn.extracted.buildingNumber || <span className="cell-empty">—</span>}</dd>
            <dt>{t.revApartment}</dt>
            <dd>{trn.extracted.apartmentNumber || <span className="cell-empty">{t.revNotFound}</span>}</dd>
            <dt>{t.revTenant}</dt>
            <dd>{trn.extracted.tenantName || <span className="cell-empty">—</span>}</dd>
          </dl>
        </section>
      )}

      {/* Contractor Data (for expenses) */}
      {trn.transactionType === 'expense' && trn.matchedContractor && (
        <section className="review-card__block">
          <h4 className="review-card__block-title">
            <Icon name="briefcase" size={14} /> {t.revMatchedContractor}
          </h4>
          <dl className="facts">
            <dt>{t.revContractorName}</dt>
            <dd>{trn.matchedContractor.contractorName || <span className="cell-empty">{t.revNotFound}</span>}</dd>
            <dt>{t.revContractorAccount}</dt>
            <dd className="cell-mono">{trn.matchedContractor.contractorAccount || <span className="cell-empty">—</span>}</dd>
            <dt>{t.revMatch}</dt>
            <dd>{trn.matchedContractor.confidence}%</dd>
          </dl>
        </section>
      )}
    </div>

    {/* PDF Search Result Panel */}
    {pdfVisible && (
      <PdfPanel
        language={language}
        searchResult={pdfSearching ? null : pdfResult}
        searching={pdfSearching}
        searchField={pdfSearchField}
        onClose={() => setPdfVisible(false)}
        highlightTokens={pdfHighlightTokens}
      />
    )}

    {trn.extracted.reasoning && (trn.transactionType === 'income' || trn.matchedContractor) && (
      <div className="callout callout--muted review-card__reasoning">
        <Icon name="sparkles" size={16} />
        <div className="callout__body">
          <span className="callout__title">{t.revAiReasoning}:</span> {trn.extracted.reasoning}
        </div>
      </div>
    )}

    {/* Highlighted Apartment Number Box (for income) */}
    {trn.transactionType === 'income' && (() => {
      // A rule with several apartments has no number to highlight until the user
      // picks one, so the picker stands where the matched number normally would.
      if (needsApartmentChoice) {
        return (
          <ApartmentChoicePanel
            language={language}
            targets={ruleTargets}
            apartmentPrefix={apartmentPrefix}
            matchText={existingRule?.matchText || ''}
            note={existingRule?.note}
            selected={mappingChoice}
            onSelect={(target) => onChooseMappingTarget(trn.index, target)}
          />
        );
      }

      const extractedApt = trn.extracted.apartmentNumber;
      const manualApt = manualInput?.trim();
      const isManuallyEdited = manualApt && manualApt.length > 0 && manualApt !== extractedApt;
      const displayValue = isManuallyEdited ? manualApt : extractedApt;
      // A lettered apartment was read correctly but has no account to go to, so the
      // box must not look like a finished match — the number alone is not a booking.
      const awaitingAccount = !isManuallyEdited && trn.extracted.needsAccount === true;

      if (displayValue && displayValue.length > 0) {
        const tone = awaitingAccount ? 'is-warning' : isManuallyEdited ? 'is-manual' : 'is-ok';
        const icon = awaitingAccount ? 'alert-triangle' : isManuallyEdited ? 'edit' : 'check-circle';
        return (
          <div className={`apt-result ${tone}`}>
            <div className="apt-result__label">
              <Icon name={icon} size={12} />
              {awaitingAccount
                ? t.apartmentNeedsAccountLabel
                : isManuallyEdited
                  ? t.revApartmentManual
                  : t.revApartmentMatched}
            </div>
            <div className="apt-result__value">{displayValue}</div>
            {awaitingAccount && <div className="apt-result__hint">{t.apartmentNeedsAccountHint}</div>}
          </div>
        );
      }
      // No apartment number is available.
      return (
        <div className="apt-result is-missing">
          <div className="apt-result__label">
            <Icon name="alert-triangle" size={12} /> {t.revApartment}
          </div>
          <div className="apt-result__value">{t.revNotFound}</div>
        </div>
      );
    })()}

    {/* Action zone — decision + manual input + status */}
    {(() => {
      const hasManualNumber = !!(manualInput && manualInput.trim().length > 0);
      const hasManualAccount = !!(manualAccount && manualAccount.trim().length > 0);
      const manualNumberIsLettered = hasManualNumber && isLetteredApartment(manualInput!.trim());
      const composedManualAccount = hasManualAccount
        ? composeApartmentAccount(apartmentPrefix, manualAccount!)
        : null;
      const hasManualOverride = hasManualNumber
        || hasManualAccount
        || mappingChoice !== undefined
        || manualContractorId !== undefined
        || manualRemainingIncomeId !== undefined
        || manualRemainingCostId !== undefined;

      return (
        <div className="review-card__actions">
          <h4 className="review-card__actions-title">
            <Icon name="check-circle" size={12} /> {t.revDecision}
          </h4>

          <div className="review-card__actions-row">
            {/* No "Akceptuj" for an apartment with no account: accepting would look
                like a decision while the payment still ends up unrecognized. Such a
                row is resolved by giving an account, not by confirming the number. */}
            {((trn.transactionType === 'expense' && trn.matchedContractor?.contractorName)
              || (trn.transactionType === 'income' && trn.extracted.apartmentNumber && trn.extracted.needsAccount !== true)) && (
              <button
                type="button"
                onClick={() => handleDecision(trn.index, 'accept')}
                disabled={hasManualOverride}
                className={`button button-success${currentDecision?.action === 'accept' ? ' is-selected' : ''}`}
              >
                <Icon name="check" size={14} /> {t.revAccept}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDecision(trn.index, 'reject')}
              disabled={hasManualOverride}
              className={`button button-danger${currentDecision?.action === 'reject' ? ' is-selected' : ''}`}
            >
              <Icon name="x" size={14} /> {t.revReject}
            </button>
            <button
              type="button"
              onClick={() => handleDecision(trn.index, 'clarify')}
              disabled={hasManualOverride}
              className={`button button-warning${currentDecision?.action === 'clarify' ? ' is-selected' : ''}`}
              title={t.revClarifyHint}
            >
              <Icon name="info" size={14} /> {t.revClarify}
            </button>
            {trn.transactionType === 'income' && (
              <button
                type="button"
                onClick={() => (ruleFormOpen ? setRuleFormOpen(false) : openRuleForm())}
                disabled={adresId == null}
                className={`button button-info${ruleFormOpen ? ' is-selected' : ''}`}
                title={adresId == null ? t.apartmentMappingNeedsAddress : (existingRule ? t.editApartmentLink : t.saveApartmentMappingRule)}
              >
                <Icon name={existingRule ? 'edit' : 'map-pin'} size={14} /> {existingRule ? t.editApartmentLink : t.linkApartment}
              </button>
            )}
            {trn.transactionType === 'expense' && (
              <button
                type="button"
                onClick={() => (altFormOpen ? setAltFormOpen(false) : openAltForm())}
                className={`button button-info${altFormOpen ? ' is-selected' : ''}`}
                title={t.addAlternativeNameTooltip}
              >
                <Icon name="edit" size={14} /> {t.addAlternativeNameAction}
              </button>
            )}
          </div>

          {hasManualOverride && (
            <div className="review-card__manual-hint review-card__manual-hint--warning">
              <Icon name="alert-triangle" size={12} /> {t.revClearManualFirst}
            </div>
          )}

          {/* Manual Input (only for income) — three mutually exclusive ways to say
              where this payment goes: the apartment number, the account symbol
              outright, or a "Pozostałe przychody" entry. Each disables the others,
              so two of them can never disagree about one transaction. */}
          {trn.transactionType === 'income' && (
            <div className="review-card__manual">
              <div className="review-card__manual-field review-card__manual-field--narrow">
                <label className="review-card__manual-label">{t.manualApartmentNumber}</label>
                <input
                  type="text"
                  value={manualInput || ''}
                  onChange={(e) => handleManualInput(trn.index, (e.target as HTMLInputElement).value)}
                  placeholder={t.revManualApartmentPlaceholder}
                  disabled={manualRemainingIncomeId !== undefined || hasManualAccount}
                />
                {manualNumberIsLettered && (
                  <div className="review-card__manual-hint review-card__manual-hint--warning">
                    <Icon name="alert-triangle" size={12} /> {t.manualApartmentLetterBlocked}
                  </div>
                )}
              </div>
              <div className="review-card__manual-field review-card__manual-field--narrow">
                <label className="review-card__manual-label">{t.manualApartmentAccount}</label>
                <div className="review-card__account-input">
                  <span className="review-card__account-prefix">{apartmentPrefix}-</span>
                  <input
                    type="text"
                    value={manualAccount || ''}
                    onChange={(e) => handleManualAccountInput(trn.index, (e.target as HTMLInputElement).value)}
                    placeholder={t.manualApartmentAccountPlaceholder}
                    disabled={manualRemainingIncomeId !== undefined || hasManualNumber}
                  />
                </div>
                {/* The composed symbol is echoed back rather than padded silently:
                    conventions for lettered apartments vary, so the user has to see
                    exactly what will land in the accounting file. */}
                {composedManualAccount && (
                  <div className="review-card__manual-hint review-card__manual-hint--ok">
                    {t.manualApartmentAccountPreview}: <strong>{composedManualAccount}</strong>
                  </div>
                )}
                {manualAccount && manualAccount.trim().length > 0 && !composedManualAccount && (
                  <div className="review-card__manual-hint review-card__manual-hint--warning">
                    <Icon name="alert-triangle" size={12} /> {t.manualApartmentAccountInvalid}
                  </div>
                )}
              </div>
              <div className="review-card__manual-field review-card__manual-field--wide">
                <label className="review-card__manual-label">{t.revOtherIncome}</label>
                <SearchableContractorSelect
                  kontrahenci={remainingIncomeEntries}
                  selectedContractorId={manualRemainingIncomeId !== undefined ? manualRemainingIncomeId : null}
                  onChange={(entryId) => handleManualRemainingIncomeSelect(trn.index, entryId)}
                  placeholder={t.revOtherIncomePick}
                  searchPlaceholder={t.revSearchByName}
                  emptyText={t.revNoContractors}
                  disabled={hasManualNumber || hasManualAccount}
                />
              </div>
            </div>
          )}

          {/* Save apartment-mapping rule (only for income) — remembers this payer
              for future statements under the address this acceptance concerns. */}
          {trn.transactionType === 'income' && ruleFormOpen && (
            <div className="inline-form">
              <div className="form-field__hint">{t.apartmentMappingsHint}</div>
              <FormField label={t.apartmentMappingMatchText}>
                <input
                  type="text"
                  value={ruleMatchText}
                  onChange={(e) => { setRuleMatchText((e.target as HTMLInputElement).value); if (ruleError) setRuleError(null); }}
                  placeholder={t.apartmentMappingMatchTextPlaceholder}
                />
              </FormField>
              <FormField
                label={t.apartmentMappingApartments}
                hint={<>{t.apartmentMappingApartmentsHint} {t.apartmentMappingAccountHint}</>}
                error={ruleError}
              >
                <ApartmentTargetsEditor
                  language={language}
                  drafts={ruleTargetDrafts}
                  onChange={(next) => { setRuleTargetDrafts(next); if (ruleError) setRuleError(null); }}
                  accountPlaceholder={`np. ${apartmentPrefix}-00017A`}
                  disabled={ruleSaving}
                />
              </FormField>
              <div className="inline-form__actions">
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => setRuleFormOpen(false)}
                  disabled={ruleSaving}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="button button-small button-success"
                  onClick={submitRule}
                  disabled={ruleSaving || !ruleMatchText.trim() || apartmentTargetsFromDrafts(ruleTargetDrafts).length === 0}
                >
                  <Icon name={ruleSaving ? 'loader' : 'check'} size={13} className={ruleSaving ? 'icon-spin' : undefined} />{' '}
                  {existingRule ? t.save : t.saveApartmentMappingRule}
                </button>
              </div>
            </div>
          )}
          {trn.transactionType === 'income' && ruleSaved && !ruleFormOpen && (
            <div className="inline-status is-success">
              <Icon name="check-circle" size={14} /> {t.apartmentMappingSaved}
            </div>
          )}

          {/* Manual Contractor Selection (only for expense) */}
          {trn.transactionType === 'expense' && (
            <div className="review-card__manual">
              <div className="review-card__manual-field">
                <label className="review-card__manual-label">
                  {trn.matchedContractor?.contractorName ? t.revContractorChange : t.revContractorPick}
                </label>
                <SearchableContractorSelect
                  kontrahenci={kontrahenci}
                  selectedContractorId={manualContractorId !== undefined ? manualContractorId : null}
                  onChange={(contractorId) => handleManualContractorSelect(trn.index, contractorId)}
                  placeholder={t.revContractorNone}
                  searchPlaceholder={t.revContractorSearch}
                  emptyText={t.revNoContractors}
                  disabled={manualRemainingCostId !== undefined}
                />
              </div>
              <div className="review-card__manual-field">
                <label className="review-card__manual-label">{t.revOtherCosts}</label>
                <SearchableContractorSelect
                  kontrahenci={remainingCostEntries}
                  selectedContractorId={manualRemainingCostId !== undefined ? manualRemainingCostId : null}
                  onChange={(entryId) => handleManualRemainingCostSelect(trn.index, entryId)}
                  placeholder={t.revOtherCostsPick}
                  searchPlaceholder={t.revSearchByName}
                  emptyText={t.revNoContractors}
                  disabled={manualContractorId !== undefined}
                />
              </div>
            </div>
          )}

          {/* Teach a contractor this bank's spelling (expense only). Saved onto the
              contractor, so it applies to every future statement, not just this one. */}
          {trn.transactionType === 'expense' && altFormOpen && (
            <div className="inline-form">
              <div className="form-field__hint">{t.addAlternativeNameHint}</div>
              <FormRow>
                <FormField label={t.addAlternativeNameContractor}>
                  <SearchableContractorSelect
                    kontrahenci={kontrahenci}
                    selectedContractorId={altContractorId}
                    onChange={(contractorId) => { setAltContractorId(contractorId); if (altError) setAltError(null); }}
                    placeholder={t.addAlternativeNameContractorPlaceholder}
                    searchPlaceholder={t.revContractorSearch}
                    emptyText={t.revNoContractors}
                  />
                </FormField>
                <FormField label={t.addAlternativeNameLabel} error={altError}>
                  <input
                    type="text"
                    value={altName}
                    onChange={(e) => { setAltName((e.target as HTMLInputElement).value); if (altError) setAltError(null); }}
                    placeholder={t.addAlternativeNamePlaceholder}
                  />
                </FormField>
              </FormRow>
              <div className="inline-form__actions">
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => setAltFormOpen(false)}
                  disabled={altSaving}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="button button-small button-success"
                  onClick={submitAltName}
                  disabled={altSaving || !altContractorId || !altName.trim()}
                >
                  <Icon name={altSaving ? 'loader' : 'check'} size={13} className={altSaving ? 'icon-spin' : undefined} />{' '}
                  {t.addAlternativeNameSave}
                </button>
              </div>
            </div>
          )}
          {trn.transactionType === 'expense' && altSaved && !altFormOpen && (
            <div className="inline-status is-success">
              <Icon name="check-circle" size={14} /> {t.addAlternativeNameSaved}
            </div>
          )}

          {/* Current Decision Status */}
          {currentDecision && (() => {
            let tone = 'is-success';
            let iconName: React.ComponentProps<typeof Icon>['name'] = 'check-circle';
            let label: string = t.revStatusAccepted;

            if (currentDecision.action === 'reject') {
              tone = 'is-danger';
              iconName = 'x-circle';
              label = t.revStatusRejected;
            } else if (currentDecision.action === 'clarify') {
              tone = 'is-warning';
              iconName = 'info';
              label = t.revStatusClarify;
            } else if (currentDecision.action === 'manual') {
              tone = 'is-manual';
              iconName = 'edit';
              if (trn.transactionType === 'income' && currentDecision.manualRemainingIncomeId) {
                const entry = remainingIncomeEntries.find(k => k.id === currentDecision.manualRemainingIncomeId);
                label = `${t.revStatusOtherIncome}: ${entry?.nazwa || t.revUnknown} (${entry?.kontoKontrahenta || ''})`;
              } else if (trn.transactionType === 'income' && mappingChoice) {
                const account = resolveApartmentAccount(
                  mappingChoice.apartmentNumber,
                  mappingChoice.kontoLokalu ?? null,
                  apartmentPrefix,
                );
                label = `${t.mappingChoiceStatus}: ${mappingChoice.apartmentNumber}${account ? ` → ${account}` : ''}`;
              } else if (trn.transactionType === 'income' && currentDecision.manualApartmentNumber) {
                label = `${t.revStatusManualApartment}: ${currentDecision.manualApartmentNumber}`;
              } else if (trn.transactionType === 'expense' && currentDecision.manualRemainingCostId) {
                const entry = remainingCostEntries.find(k => k.id === currentDecision.manualRemainingCostId);
                label = `${t.revStatusOtherCost}: ${entry?.nazwa || t.revUnknown} (${entry?.kontoKontrahenta || ''})`;
              } else if (trn.transactionType === 'expense' && currentDecision.manualContractorId) {
                const selectedContractor = kontrahenci.find(k => k.id === currentDecision.manualContractorId);
                label = `${t.revStatusManualContractor}: ${selectedContractor?.nazwa || t.revUnknown}`;
              } else {
                label = t.revStatusManual;
              }
            }

            return (
              <div className={`review-card__status ${tone}`} role="status">
                <Icon name={iconName} size={14} />
                <span>{label}</span>
              </div>
            );
          })()}
        </div>
      );
    })()}
  </article>
  );
};

interface TransactionReviewScreenProps {
  reviewData: ConversionReviewData;
  language: Language;
  hasMoreFiles: boolean;
  remainingCount: number;
  onFinalizeAndNext: (decisions: ReviewDecision[]) => Promise<void>;
  onFinalizeAndStop: (decisions: ReviewDecision[]) => Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
}

export const TransactionReviewScreen: React.FC<TransactionReviewScreenProps> = ({
  reviewData,
  language,
  hasMoreFiles,
  remainingCount,
  onFinalizeAndNext,
  onFinalizeAndStop,
  onSkip,
  onCancel,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [decisions, setDecisions] = useState<Map<number, ReviewDecision>>(new Map());
  
  // Manual inputs start empty - extracted values are shown in the input field as default
  const [manualInputs, setManualInputs] = useState<Map<number, string>>(new Map());
  /**
   * "Konto lokalu" suffixes typed per row — the part after the prefix, e.g. "00017A".
   * Kept apart from manualInputs because the two are different statements: one names
   * the apartment and lets the app derive the account, the other names the account
   * outright. Lettered apartments can only be booked through this one.
   */
  const [manualAccounts, setManualAccounts] = useState<Map<number, string>>(new Map());
  const [manualContractorIds, setManualContractorIds] = useState<Map<number, number | null>>(new Map());
  const [manualRemainingIncomeIds, setManualRemainingIncomeIds] = useState<Map<number, number | null>>(new Map());
  const [manualRemainingCostIds, setManualRemainingCostIds] = useState<Map<number, number | null>>(new Map());
  /**
   * Which apartment the user picked for a row matched by a rule that names several
   * of them. Its own map rather than a manualInput, because the pair (apartment,
   * account) comes from the rule as one unit — the two manual fields are mutually
   * exclusive precisely so a hand-typed pair can never disagree, and a pick from a
   * rule needs both halves at once.
   */
  const [mappingChoices, setMappingChoices] = useState<Map<number, ApartmentMappingTarget>>(new Map());
  
  const [kontrahenci, setKontrahenci] = useState<Kontrahent[]>([]);
  const [contractorSortOrder, setContractorSortOrder] = useState<ContractorSortOrder>('name-asc');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRerunningExpenseAI, setIsRerunningExpenseAI] = useState(false);
  const [rerunProgress, setRerunProgress] = useState<{ label: string; percent: number } | null>(null);
  // Frozen at the start of a run: the candidate list shrinks once results merge,
  // and the loader should keep showing what it actually set out to process.
  const [expenseRerunCount, setExpenseRerunCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'undecided'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [addressMappings, setAddressMappings] = useState<ApartmentMapping[]>([]);

  // Fixed part of every apartment account in this conversion, decided by the
  // account type of the community account the file belongs to.
  const apartmentPrefix = reviewData.apartmentPrefix || DEFAULT_ACCOUNT_CONFIG.apartmentPrefix;

  // Filter kontrahenci by type, then order per the user's preference so every
  // pick-list in the review screen is sorted consistently. A contractor can hold
  // several roles (`typy`), so it may legitimately appear in more than one list.
  // Memoized so the three filters + sorts don't re-run on every keystroke/click.
  const contractorEntries = useMemo(
    () => sortKontrahenci(kontrahenci.filter(k => hasTyp(k, 'Kontrahent')), contractorSortOrder),
    [kontrahenci, contractorSortOrder],
  );
  const remainingIncomeEntries = useMemo(
    () => sortKontrahenci(kontrahenci.filter(k => hasTyp(k, 'Pozostałe przychody')), contractorSortOrder),
    [kontrahenci, contractorSortOrder],
  );
  const remainingCostEntries = useMemo(
    () => sortKontrahenci(kontrahenci.filter(k => hasTyp(k, 'Pozostałe koszty')), contractorSortOrder),
    [kontrahenci, contractorSortOrder],
  );

  // Load kontrahenci + sort preference on mount
  useEffect(() => {
    const loadData = async () => {
      const [result, settings] = await Promise.all([
        window.electronAPI.getKontrahenci(),
        window.electronAPI.getSettings(),
      ]);
      setKontrahenci(result);
      setContractorSortOrder(settings.contractorSortOrder ?? 'name-asc');
    };
    loadData();
  }, []);

  // Load the current apartment-mapping rules of the address this acceptance
  // concerns, so matched income rows can offer "edit rule" instead of "add".
  useEffect(() => {
    if (reviewData.adresId == null) {
      setAddressMappings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const adresy = await window.electronAPI.getAdresy();
      const adres = adresy.find(a => a.id === reviewData.adresId);
      if (!cancelled) setAddressMappings(adres?.apartmentMappings || []);
    })();
    return () => { cancelled = true; };
  }, [reviewData.adresId]);

  // Progress for the on-demand expense re-match. The main process reports it on
  // the same channel a conversion uses, so it is filtered down to this file.
  useEffect(() => {
    if (!window.electronAPI?.onConversionProgress) return;
    const unsubscribe = window.electronAPI.onConversionProgress((p: any) => {
      if (p?.fileName !== reviewData.fileName) return;
      setRerunProgress({ label: p.label, percent: p.percent });
    });
    return () => {
      try { unsubscribe?.(); } catch { /* ignore */ }
    };
  }, [reviewData.fileName]);

  /**
   * Expenses worth sending back to the AI: still without a contractor, and not
   * touched by the user in this session. Anything the user already decided,
   * picked a contractor for, or typed into is left alone — a re-match must never
   * overwrite work done two minutes ago in this very screen. Computed over the
   * whole set, not the filtered view, so the active filter can't silently
   * shrink the batch.
   */
  const expenseRerunIndices = useMemo(() => {
    const untouched = (index: number) =>
      !decisions.has(index) &&
      !manualContractorIds.has(index) &&
      !manualRemainingCostIds.has(index) &&
      !manualInputs.has(index);
    return reviewData.transactions
      .filter(
        (trn) =>
          trn.transactionType === 'expense' &&
          !trn.matchedContractor?.contractorName &&
          untouched(trn.index),
      )
      .map((trn) => trn.index);
  }, [reviewData.transactions, decisions, manualContractorIds, manualRemainingCostIds, manualInputs]);

  const handleRerunExpenseAI = async () => {
    if (isRerunningExpenseAI || expenseRerunIndices.length === 0) return;

    setIsRerunningExpenseAI(true);
    setExpenseRerunCount(expenseRerunIndices.length);
    setRerunProgress({ label: t.rerunExpenseAIStarting, percent: 0 });
    try {
      const result = await window.electronAPI.rerunExpenseAI(
        reviewData.tempConversionId,
        expenseRerunIndices,
        reviewData.fileName,
      );

      if (!result.success) {
        notify.error(`${t.rerunExpenseAIFailed}: ${result.error ?? ''}`);
        return;
      }

      // Merge the refreshed rows in place, matching how the apartment-mapping
      // rule flow updates this screen. Indices are stable, so all per-row local
      // state (decisions, manual picks) stays aligned.
      for (const updated of result.updated ?? []) {
        const target = reviewData.transactions.find((trn) => trn.index === updated.index);
        if (target) {
          target.extracted = updated.extracted;
          target.matchedContractor = updated.matchedContractor;
        }
      }

      const matched = result.matchedCount ?? 0;
      const processed = result.processedCount ?? 0;
      if (matched > 0) {
        notify.success(`${t.rerunExpenseAIMatched} ${matched}/${processed}`);
      } else {
        notify.warning(t.rerunExpenseAINoMatches);
      }
    } catch (error) {
      notify.error(
        `${t.rerunExpenseAIFailed}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRerunningExpenseAI(false);
      setRerunProgress(null);
    }
  };

  // Free-text search across every field of a transaction.
  const matchesSearch = (trn: TransactionForReview): boolean => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      trn.original.date,
      String(trn.original.amount),
      trn.original.description,
      trn.original.counterparty,
      trn.extracted.apartmentNumber,
      trn.extracted.fullAddress,
      trn.extracted.streetName,
      trn.extracted.buildingNumber,
      trn.extracted.tenantName,
      trn.matchedContractor?.contractorName,
      trn.matchedContractor?.contractorAccount,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  };

  // Stable position of each transaction in the original list — built once so the
  // render loops below don't do an O(n) indexOf per row (was O(n²) per render).
  const transactionPosition = useMemo(() => {
    const m = new Map<TransactionForReview, number>();
    reviewData.transactions.forEach((trn, i) => m.set(trn, i));
    return m;
  }, [reviewData.transactions]);

  // Filter transactions based on selected filter + search term. Memoized so a
  // keystroke/decision doesn't re-scan every transaction five times per render.
  const filteredTransactions = useMemo(() => reviewData.transactions.filter(trn => {
    if (!matchesSearch(trn)) return false;
    if (filter === 'all') return true;
    if (filter === 'undecided') return !decisions.has(trn.index);
    return trn.transactionType === filter;
  }), [reviewData.transactions, filter, decisions, searchTerm]);

  // Group transactions by type
  const incomeTransactions = useMemo(
    () => filteredTransactions.filter(trn => trn.transactionType === 'income'),
    [filteredTransactions],
  );
  const expenseTransactions = useMemo(
    () => filteredTransactions.filter(trn => trn.transactionType === 'expense'),
    [filteredTransactions],
  );

  // Count totals for filter badges
  const { totalIncome, totalExpense } = useMemo(() => ({
    totalIncome: reviewData.transactions.filter(trn => trn.transactionType === 'income').length,
    totalExpense: reviewData.transactions.filter(trn => trn.transactionType === 'expense').length,
  }), [reviewData.transactions]);
  const totalUndecided = useMemo(
    () => reviewData.transactions.filter(trn => !decisions.has(trn.index)).length,
    [reviewData.transactions, decisions],
  );

  const handleDecision = (index: number, action: 'accept' | 'reject' | 'clarify') => {
    const newDecisions = new Map(decisions);
    newDecisions.set(index, { index, action });
    setDecisions(newDecisions);
    
    // Clear manual input if switching away from manual
    if (manualInputs.has(index)) {
      const newManualInputs = new Map(manualInputs);
      newManualInputs.delete(index);
      setManualInputs(newManualInputs);
    }

    // Accept/reject/clarify replace the destination outright, so a pick from a
    // multi-apartment rule must not stay highlighted as if it still applied.
    if (mappingChoices.has(index)) {
      const next = new Map(mappingChoices);
      next.delete(index);
      setMappingChoices(next);
    }

    if (manualAccounts.has(index)) {
      const newManualAccounts = new Map(manualAccounts);
      newManualAccounts.delete(index);
      setManualAccounts(newManualAccounts);
    }

    // Clear manual contractor selection if switching away from manual
    if (manualContractorIds.has(index)) {
      const newManualContractorIds = new Map(manualContractorIds);
      newManualContractorIds.delete(index);
      setManualContractorIds(newManualContractorIds);
    }
    
    // Clear remaining income/cost selections
    if (manualRemainingIncomeIds.has(index)) {
      const newIds = new Map(manualRemainingIncomeIds);
      newIds.delete(index);
      setManualRemainingIncomeIds(newIds);
    }
    if (manualRemainingCostIds.has(index)) {
      const newIds = new Map(manualRemainingCostIds);
      newIds.delete(index);
      setManualRemainingCostIds(newIds);
    }
  };

  /** Forget a rule pick for this row — used whenever a competing assignment wins. */
  const clearMappingChoice = (index: number) => {
    setMappingChoices(prev => {
      if (!prev.has(index)) return prev;
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  };

  /**
   * Book this row onto one of the apartments its rule names (null clears the pick).
   *
   * The decision carries both halves of the rule's entry: the account symbol is
   * what the exporters book to, the number is what makes the record readable. They
   * come from one rule entry, so unlike two hand-typed fields they cannot disagree.
   * A lettered apartment with no account on the rule is not offered at all — there
   * would be nothing to book it to — so `resolveApartmentAccount` never fails here.
   */
  const handleMappingChoice = (index: number, target: ApartmentMappingTarget | null) => {
    const newDecisions = new Map(decisions);

    if (!target) {
      setMappingChoices(prev => {
        const next = new Map(prev);
        next.delete(index);
        return next;
      });
      newDecisions.delete(index);
      setDecisions(newDecisions);
      return;
    }

    const account = resolveApartmentAccount(
      target.apartmentNumber,
      target.kontoLokalu ?? null,
      apartmentPrefix,
    );
    if (!account) return;

    setMappingChoices(prev => new Map(prev).set(index, target));
    // The other ways of resolving this row are mutually exclusive with the pick.
    setManualInputs(prev => { const m = new Map(prev); m.delete(index); return m; });
    setManualAccounts(prev => { const m = new Map(prev); m.delete(index); return m; });
    setManualRemainingIncomeIds(prev => { const m = new Map(prev); m.delete(index); return m; });
    newDecisions.set(index, {
      index,
      action: 'manual',
      manualApartmentNumber: target.apartmentNumber,
      manualApartmentAccount: account,
    });
    setDecisions(newDecisions);
  };

  const handleManualInput = (index: number, value: string) => {
    const newManualInputs = new Map(manualInputs);
    const newDecisions = new Map(decisions);
    clearMappingChoice(index);

    // If value is empty or only whitespace, remove from manual inputs and clear decision
    if (!value || value.trim().length === 0) {
      newManualInputs.delete(index);
      newDecisions.delete(index);
    } else {
      // Set manual input and create manual decision
      newManualInputs.set(index, value);
      // A lettered number ("17A") names the apartment but not its account, and the
      // app must not invent one — the row stays undecided until the user uses
      // "Konto lokalu" instead. The field shows why.
      if (isLetteredApartment(value.trim())) {
        newDecisions.delete(index);
      } else {
        newDecisions.set(index, {
          index,
          action: 'manual',
          manualApartmentNumber: value,
        });
      }
    }

    setManualInputs(newManualInputs);
    setDecisions(newDecisions);
  };

  /**
   * "Konto lokalu": the user states the account symbol outright. Used for lettered
   * apartments, whose symbol the app is not allowed to derive — see
   * resolveApartmentAccount. The value stored is the suffix; the prefix is fixed by
   * the account type and only shown.
   */
  const handleManualAccountInput = (index: number, value: string) => {
    const newManualAccounts = new Map(manualAccounts);
    const newDecisions = new Map(decisions);
    clearMappingChoice(index);

    const account = composeApartmentAccount(apartmentPrefix, value);
    if (!value || value.trim().length === 0) {
      newManualAccounts.delete(index);
      newDecisions.delete(index);
    } else {
      newManualAccounts.set(index, value);
      // While the symbol is still incomplete there is nothing to book yet, so no
      // decision is recorded — the row stays undecided rather than half-decided.
      if (account) {
        newDecisions.set(index, {
          index,
          action: 'manual',
          manualApartmentAccount: account,
        });
      } else {
        newDecisions.delete(index);
      }
    }

    setManualAccounts(newManualAccounts);
    setDecisions(newDecisions);
  };

  const handleManualContractorSelect = (index: number, contractorId: number | null) => {
    const newManualContractorIds = new Map(manualContractorIds);
    const newDecisions = new Map(decisions);
    
    // If contractorId is null, remove from manual selections and clear decision
    if (contractorId === null) {
      newManualContractorIds.delete(index);
      newDecisions.delete(index);
    } else {
      // Set manual contractor selection and create manual decision
      newManualContractorIds.set(index, contractorId);
      newDecisions.set(index, {
        index,
        action: 'manual',
        manualContractorId: contractorId,
      });
    }
    
    setManualContractorIds(newManualContractorIds);
    setDecisions(newDecisions);
  };

  const handleManualRemainingIncomeSelect = (index: number, entryId: number | null) => {
    const newIds = new Map(manualRemainingIncomeIds);
    const newDecisions = new Map(decisions);
    clearMappingChoice(index);
    
    if (entryId === null) {
      newIds.delete(index);
      newDecisions.delete(index);
    } else {
      newIds.set(index, entryId);
      newDecisions.set(index, {
        index,
        action: 'manual',
        manualRemainingIncomeId: entryId,
      });
    }
    
    setManualRemainingIncomeIds(newIds);
    setDecisions(newDecisions);
  };

  const handleManualRemainingCostSelect = (index: number, entryId: number | null) => {
    const newIds = new Map(manualRemainingCostIds);
    const newDecisions = new Map(decisions);
    
    if (entryId === null) {
      newIds.delete(index);
      newDecisions.delete(index);
    } else {
      newIds.set(index, entryId);
      newDecisions.set(index, {
        index,
        action: 'manual',
        manualRemainingCostId: entryId,
      });
    }
    
    setManualRemainingCostIds(newIds);
    setDecisions(newDecisions);
  };

  // Save a new apartment-mapping rule under the address this acceptance concerns.
  // The rule is auto-attached to reviewData.adresId (no address picker needed).
  // Afterwards the current transaction is treated as a confirmed match (same as
  // on subsequent runs): apartment filled in, flagged, and accepted.
  /**
   * Append a spelling to a contractor's alternative names, so the deterministic
   * matcher resolves this vendor on every future statement without an AI call.
   * The expense-side twin of handleSaveApartmentMapping.
   */
  const handleSaveAlternativeName = async (index: number, contractorId: number, alternativeName: string) => {
    const phrase = alternativeName.trim();
    if (!phrase) throw new Error(t.fillAllFields);

    // Re-read rather than trust the list loaded on mount: the contractor may
    // have been edited elsewhere since, and we are about to write its whole
    // alternativeNames array back.
    const all = await window.electronAPI.getKontrahenci();
    const contractor = all.find((k) => k.id === contractorId);
    if (!contractor) throw new Error(t.addAlternativeNameMissingContractor);

    const existing = contractor.alternativeNames || [];
    const normalized = phrase.toLowerCase();
    if (
      contractor.nazwa.trim().toLowerCase() === normalized ||
      existing.some((n) => n.trim().toLowerCase() === normalized)
    ) {
      throw new Error(t.addAlternativeNameDuplicate);
    }

    const nextAlternatives = [...existing, phrase];
    await window.electronAPI.updateKontrahent(
      contractor.id,
      contractor.nazwa,
      contractor.kontoKontrahenta,
      contractor.nip,
      nextAlternatives,
      contractor.typy,
    );

    // Reflect it locally so the pick-lists and any later save use fresh data.
    setKontrahenci(all.map((k) => (k.id === contractorId ? { ...k, alternativeNames: nextAlternatives } : k)));

    // Resolve this row too: teaching the matcher is almost always done right
    // after deciding which contractor it is, so assign it instead of making the
    // user pick the same contractor a second time in the dropdown.
    handleManualContractorSelect(index, contractorId);
  };

  const handleSaveApartmentMapping = async (
    index: number,
    matchText: string,
    targets: ApartmentMappingTarget[],
    editId?: string,
  ) => {
    if (reviewData.adresId == null) throw new Error(t.apartmentMappingNeedsAddress);
    const adresy = await window.electronAPI.getAdresy();
    const adres = adresy.find(a => a.id === reviewData.adresId);
    if (!adres) throw new Error('Address not found');
    const current = adres.apartmentMappings || [];
    // Block duplicate phrase (case-insensitive) against *other* rules.
    const normalized = matchText.trim().toLowerCase();
    if (current.some(m => m.id !== editId && m.matchText.trim().toLowerCase() === normalized)) {
      throw new Error(t.apartmentMappingDuplicate);
    }
    // Editing rebuilds the rule from the form, so clearing an account or removing an
    // apartment actually takes effect; only the note (which this form has no field
    // for) is carried over from the stored rule.
    const edited = editId ? current.find(m => m.id === editId) : undefined;
    const mapping = buildApartmentMapping(
      {
        id: editId
          || ((typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        matchText,
        note: edited?.note,
      },
      targets,
    );
    if (!mapping) throw new Error(t.fillAllFields);
    const nextMappings = editId
      ? current.map(m => (m.id === editId ? mapping : m))
      : [...current, mapping];
    await window.electronAPI.updateAdres(
      adres.id,
      adres.nazwa,
      adres.alternativeNames || [],
      adres.swrkIdentifiers || [],
      adres.bankId ?? null,
      adres.accountNumbers || [],
      nextMappings,
    );
    setAddressMappings(nextMappings);

    // Reflect the rule immediately in this view: the transaction now counts as a
    // match (flagged, apartment filled), just like it would on the next run.
    const ruleTargets = mappingTargets(mapping);
    const single = ruleTargets.length === 1 ? ruleTargets[0] : null;
    const trn = reviewData.transactions.find(t => t.index === index);
    if (trn) {
      trn.extracted.matchedByManualMapping = true;
      trn.extracted.confidence = 95;
      // Several apartments ⇒ the row has a shortlist, not an answer: exactly the
      // state the matcher produces for such a rule, so this screen behaves the same
      // whether the rule was written now or before the conversion ran.
      trn.extracted.apartmentNumber = single ? single.apartmentNumber : null;
      trn.extracted.accountOverride = single?.kontoLokalu ?? null;
      trn.extracted.needsAccount = false;
    }
    // Clear any manual override for this transaction, then book it.
    setManualInputs(prev => { const m = new Map(prev); m.delete(index); return m; });
    setManualAccounts(prev => { const m = new Map(prev); m.delete(index); return m; });
    setManualRemainingIncomeIds(prev => { const m = new Map(prev); m.delete(index); return m; });
    clearMappingChoice(index);
    setDecisions(prev => {
      const m = new Map(prev);
      if (!single) {
        // Nothing to book yet — the user has just said this payer owns several
        // apartments, and the picker now asks which one this transfer is for.
        m.delete(index);
        return m;
      }
      // Carry the value explicitly instead of a bare 'accept'. The rule was created
      // after the conversion ran, so the main process still holds the pre-rule
      // extraction for this row; 'accept' would book that, not what was just
      // defined — and for a lettered apartment there would be nothing to book.
      m.set(index, single.kontoLokalu
        ? { index, action: 'manual', manualApartmentAccount: single.kontoLokalu }
        : { index, action: 'manual', manualApartmentNumber: single.apartmentNumber });
      return m;
    });
  };

  const handleFinalizeAndNext = async () => {
    setIsProcessing(true);
    try {
      const decisionsArray = Array.from(decisions.values());
      await onFinalizeAndNext(decisionsArray);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinalizeAndStop = async () => {
    setIsProcessing(true);
    try {
      const decisionsArray = Array.from(decisions.values());
      await onFinalizeAndStop(decisionsArray);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkAllExpensesAsUnrecognized = () => {
    const newDecisions = new Map(decisions);
    const expenseTransactionsAll = reviewData.transactions.filter(trn => trn.transactionType === 'expense');
    
    expenseTransactionsAll.forEach(trn => {
      newDecisions.set(trn.index, {
        index: trn.index,
        action: 'reject',
      });
    });
    
    setDecisions(newDecisions);
    
    // Clear any manual inputs for expenses
    const newManualInputs = new Map(manualInputs);
    expenseTransactionsAll.forEach(trn => {
      newManualInputs.delete(trn.index);
    });
    setManualInputs(newManualInputs);
  };

  const allDecided = decisions.size === reviewData.transactions.length;

  const filterOptions: { key: typeof filter; label: string; count: number; icon?: React.ComponentProps<typeof Icon>['name'] }[] = [
    { key: 'all', label: t.revFilterAll, count: reviewData.transactions.length },
    { key: 'income', label: t.revFilterIncome, count: totalIncome, icon: 'coins' },
    { key: 'expense', label: t.revFilterExpense, count: totalExpense, icon: 'arrow-right' },
    { key: 'undecided', label: t.revFilterUndecided, count: totalUndecided, icon: 'alert-circle' },
  ];

  const renderCard = (trn: TransactionForReview) => {
    const isExpense = trn.transactionType === 'expense';
    return (
      <TransactionCard
        key={trn.index}
        trn={trn}
        idx={transactionPosition.get(trn) ?? -1}
        currentDecision={decisions.get(trn.index)}
        manualInput={manualInputs.get(trn.index)}
        manualAccount={manualAccounts.get(trn.index)}
        apartmentPrefix={apartmentPrefix}
        manualContractorId={isExpense ? manualContractorIds.get(trn.index) ?? undefined : undefined}
        manualRemainingIncomeId={isExpense ? undefined : manualRemainingIncomeIds.get(trn.index) ?? undefined}
        manualRemainingCostId={isExpense ? manualRemainingCostIds.get(trn.index) ?? undefined : undefined}
        kontrahenci={contractorEntries}
        remainingIncomeEntries={remainingIncomeEntries}
        remainingCostEntries={remainingCostEntries}
        handleDecision={handleDecision}
        handleManualInput={handleManualInput}
        handleManualAccountInput={handleManualAccountInput}
        handleManualContractorSelect={handleManualContractorSelect}
        handleManualRemainingIncomeSelect={handleManualRemainingIncomeSelect}
        handleManualRemainingCostSelect={handleManualRemainingCostSelect}
        language={language}
        pdfLines={reviewData.pdfLines}
        adresId={reviewData.adresId}
        addressMappings={addressMappings}
        onSaveApartmentMapping={handleSaveApartmentMapping}
        mappingChoice={mappingChoices.get(trn.index)}
        onChooseMappingTarget={handleMappingChoice}
        onSaveAlternativeName={handleSaveAlternativeName}
      />
    );
  };

  return (
    <div className="review-screen" role="dialog" aria-label={t.revTitle}>
      {/* Header — which community and which file is being reviewed. */}
      <header className="review-screen__head">
        <ModalHeader
          icon="check-circle"
          title={reviewData.adresName ? `${t.revTitle}: ${reviewData.adresName}` : t.revTitle}
          subtitle={
            <span className="modal-header__meta">
              <span>{t.revFile}: <strong>{reviewData.fileName}</strong></span>
              <span>{t.revBank}: <strong>{reviewData.bankName}</strong></span>
              <span className="form-section__badge">
                {t.revToReview}: {reviewData.transactions.length}
              </span>
              {/* The attached statement PDF, opened in the system's PDF viewer —
                  beside the in-screen lookup, for reading it whole. */}
              {reviewData.pdfPath && (
                <button
                  type="button"
                  className="button button-small button-secondary review-screen__pdf"
                  title={reviewData.pdfPath}
                  onClick={async () => {
                    const ok = await window.electronAPI.openFile(reviewData.pdfPath!);
                    if (!ok) notify.error(t.fileNotFound);
                  }}
                >
                  <Icon name="file-text" size={13} /> {t.revOpenPdf}
                </button>
              )}
            </span>
          }
        />
        <button type="button" className="modal-close" onClick={onCancel} title={t.close} aria-label={t.close}>
          <Icon name="x" size={18} />
        </button>
      </header>

      {/* Search + filters, together — both narrow the same list. */}
      <div className="review-screen__toolbar">
        <div className="input-icon review-screen__search">
          <Icon name="search" size={16} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm((e.target as HTMLInputElement).value)}
            placeholder={t.searchReviewPlaceholder}
            aria-label={t.searchReviewPlaceholder}
          />
          {searchTerm && (
            <span className="review-screen__search-meta">
              {filteredTransactions.length} / {reviewData.transactions.length}
              <button
                type="button"
                className="button button-ghost button-icon"
                onClick={() => setSearchTerm('')}
                title={t.revSearchClear}
                aria-label={t.revSearchClear}
              >
                <Icon name="x" size={14} />
              </button>
            </span>
          )}
        </div>
        <div className="zad-seg" role="group" aria-label={t.revFilterLabel}>
          {filterOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`zad-seg__btn${filter === o.key ? ' is-active' : ''}${o.count === 0 ? ' is-empty' : ''}`}
              aria-pressed={filter === o.key}
              onClick={() => setFilter(o.key)}
            >
              {o.icon && <Icon name={o.icon} size={12} />}
              {o.label}
              <span className="zad-seg__count">{o.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Transactions list */}
      <div className="review-screen__body">
        <div className="page-form review-screen__list">
          {(filter === 'all' || filter === 'income' || filter === 'undecided') && incomeTransactions.length > 0 && (
            <FormSection icon="coins" title={t.revIncomeTitle} description={t.revIncomeDesc}>
              {incomeTransactions.map(renderCard)}
            </FormSection>
          )}

          {(filter === 'all' || filter === 'expense' || filter === 'undecided') && expenseTransactions.length > 0 && (
            <FormSection
              icon="arrow-right"
              title={t.revExpenseTitle}
              description={t.revExpenseDesc}
              aside={
                <div className="form-section__actions">
                  <button
                    type="button"
                    onClick={handleMarkAllExpensesAsUnrecognized}
                    className="button button-small button-ghost icon-danger"
                    disabled={isRerunningExpenseAI}
                  >
                    <Icon name="x" size={13} /> {t.markAllExpensesAsUnrecognized}
                  </button>
                  <button
                    type="button"
                    onClick={handleRerunExpenseAI}
                    className="button button-small button-secondary"
                    disabled={isRerunningExpenseAI || expenseRerunIndices.length === 0}
                    title={expenseRerunIndices.length === 0 ? t.rerunExpenseAINothingToDo : t.rerunExpenseAITooltip}
                  >
                    <Icon name="bot" size={13} />{' '}
                    {isRerunningExpenseAI ? t.rerunExpenseAIRunning : `${t.rerunExpenseAI} (${expenseRerunIndices.length})`}
                  </button>
                </div>
              }
            >
              {/* Same loader as the file list on the converter view, so a long
                  re-match reads as "the app is working", not as a frozen screen. */}
              {isRerunningExpenseAI && (
                <div className="processing-row review-screen__rerun">
                  <div className="processing-loader">
                    <div className="loader-spinner"></div>
                    <div className="loader-content processing-loader__body">
                      <span className="loader-text">
                        {t.rerunExpenseAILoaderTitle}: <strong>{expenseRerunCount}</strong>
                      </span>
                      <span className="loader-subtext">{rerunProgress?.label ?? t.rerunExpenseAIStarting}</span>
                      <div className="conversion-progress-bar">
                        <div
                          className="conversion-progress-bar-fill"
                          style={{ width: `${rerunProgress?.percent ?? 0}%` }}
                        />
                        <span className="conversion-progress-bar-text">{rerunProgress?.percent ?? 0}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {expenseTransactions.map(renderCard)}
            </FormSection>
          )}
        </div>
      </div>

      {/* Footer — where the decisions stand, then what to do with the file. */}
      <ModalFooter
        className="review-screen__foot"
        note={
          <span className="review-screen__progress">
            <span className={`action-note${allDecided ? ' action-note--success' : ' action-note--warning'}`}>
              <Icon name={allDecided ? 'check-circle' : 'loader'} size={14} />
              {allDecided ? t.revAllDecided : t.revDecisions}: {decisions.size}/{reviewData.transactions.length}
            </span>
            {hasMoreFiles && (
              <span className="action-note">
                <Icon name="folder" size={14} /> {t.filesRemaining}: {remainingCount}
              </span>
            )}
          </span>
        }
        onCancel={hasMoreFiles ? onSkip : undefined}
        cancelLabel={t.skipFile}
        secondaryAction={
          hasMoreFiles ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={handleFinalizeAndStop}
              disabled={!allDecided || isProcessing}
            >
              {isProcessing ? t.revProcessing : t.finalizeAndStop}
            </button>
          ) : undefined
        }
        onSubmit={handleFinalizeAndNext}
        submitLabel={isProcessing ? t.revProcessing : hasMoreFiles ? t.finalizeAndNext : t.finalizeFile}
        submitIcon={hasMoreFiles ? 'arrow-right' : 'check'}
        submitDisabled={!allDecided}
        submitTitle={`${t.revDecisions}: ${decisions.size}/${reviewData.transactions.length}`}
        busy={isProcessing}
      />
    </div>
  );
};
