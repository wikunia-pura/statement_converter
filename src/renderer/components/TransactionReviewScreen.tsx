import React, { useState, useEffect, useRef } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview, Kontrahent } from '../../shared/types';
import { translations, Language } from '../translations';
import { searchTransactionInPdf, PdfSearchMatch } from '../../shared/pdf-search';
import Icon from './Icon';

// SearchableContractorSelect component
interface SearchableContractorSelectProps {
  kontrahenci: Kontrahent[];
  selectedContractorId: number | null;
  onChange: (contractorId: number | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
}

const SearchableContractorSelect: React.FC<SearchableContractorSelectProps> = ({
  kontrahenci,
  selectedContractorId,
  onChange,
  placeholder,
  searchPlaceholder,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedContractor = kontrahenci.find(k => k.id === selectedContractorId);

  const filteredKontrahenci = kontrahenci.filter(kontrahent => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const nameMatch = kontrahent.nazwa.toLowerCase().includes(search);
    const altNamesMatch = kontrahent.alternativeNames && kontrahent.alternativeNames.some(alt => alt.toLowerCase().includes(search));
    const nipMatch = kontrahent.nip && kontrahent.nip.includes(searchTerm);
    return nameMatch || altNamesMatch || nipMatch;
  });

  const handleSelect = (contractorId: number | null) => {
    onChange(contractorId);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', opacity: disabled ? 0.5 : 1 }}>
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          padding: '6px 10px',
          border: '1px solid var(--border-default)',
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          backgroundColor: disabled ? 'var(--bg-surface-sunken)' : 'var(--bg-surface)',
          minHeight: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ color: selectedContractor ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          {selectedContractor ? selectedContractor.nazwa : placeholder}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>▼</span>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            marginTop: '2px',
            maxHeight: '250px',
            overflow: 'hidden',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
          }}
        >
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            style={{
              width: '100%',
              padding: '8px',
              border: 'none',
              borderBottom: '1px solid var(--border-default)',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)'
            }}
          />
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            <div
              onClick={() => handleSelect(null)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                backgroundColor: selectedContractorId === null ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                borderBottom: '1px solid var(--border-default)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-surface-sunken)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedContractorId === null ? 'var(--accent-subtle)' : 'var(--bg-surface)'}
            >
              <em style={{ color: 'var(--text-tertiary)' }}>{placeholder}</em>
            </div>
            {filteredKontrahenci.map((kontrahent) => (
              <div
                key={kontrahent.id}
                onClick={() => handleSelect(kontrahent.id)}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  backgroundColor: kontrahent.id === selectedContractorId ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border-default)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-surface-sunken)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = kontrahent.id === selectedContractorId ? 'var(--accent-subtle)' : 'var(--bg-surface)'}
              >
                <div style={{ color: 'var(--text-primary)' }}>{kontrahent.nazwa}</div>
                {kontrahent.nip && (
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    NIP: {kontrahent.nip}
                  </div>
                )}
                {kontrahent.alternativeNames && kontrahent.alternativeNames.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {kontrahent.alternativeNames.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {filteredKontrahenci.length === 0 && (
              <div style={{ padding: '8px 10px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Brak kontrahentów
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// PdfPanel sub-component - shows PDF search result
interface PdfPanelProps {
  searchResult: PdfSearchMatch | null;
  searching: boolean;
  searchField: string; // which field triggered the search
  onClose: () => void;
  highlightTokens: string[];
}

const PdfPanel: React.FC<PdfPanelProps> = ({ searchResult, searching, searchField, onClose, highlightTokens }) => {
  if (searching) {
    return (
      <div style={{
        padding: '15px',
        backgroundColor: 'var(--info-bg)',
        border: '1px solid var(--info-border)',
        borderRadius: '6px',
        marginTop: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: 'var(--info)', fontWeight: 600, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="search" size={14} /> Szukam w PDF...
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'inline-flex' }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Proszę czekać...</div>
      </div>
    );
  }

  if (!searchResult) {
    return (
      <div style={{
        padding: '15px',
        backgroundColor: 'var(--danger-bg)',
        border: '1px solid var(--danger-border)',
        borderRadius: '6px',
        marginTop: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="alert-circle" size={14} /> Nie znaleziono w PDF
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'inline-flex' }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Nie znaleziono pasującej transakcji w dokumencie PDF.</div>
      </div>
    );
  }

  // Highlight matching tokens in the text
  const highlightText = (text: string): React.ReactNode => {
    if (highlightTokens.length === 0) return text;
    
    const escapedTokens = highlightTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => {
      if (regex.test(part)) {
        return <span key={i} style={{ backgroundColor: 'rgba(255, 213, 79, 0.3)', color: 'var(--warning)', fontWeight: 600, padding: '0 2px', borderRadius: '2px' }}>{part}</span>;
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
    style: React.CSSProperties,
    highlight: boolean,
  ) => {
    const elements: React.ReactNode[] = [];
    lineArr.forEach((line, i) => {
      // Add separator before transaction starts (but not the very first line)
      if (i > 0 && isTransactionStart(line)) {
        elements.push(
          <div key={`${prefix}-sep-${i}`} style={{
            borderTop: '1px solid var(--border-default)',
            margin: '6px 0',
            opacity: 0.6,
          }} />
        );
      }
      elements.push(
        <div key={`${prefix}-${i}`} style={style}>
          {highlight ? (highlightText(line) || '\u00A0') : (line || '\u00A0')}
        </div>
      );
    });
    return elements;
  };

  const contextLineStyle: React.CSSProperties = {
    color: 'var(--text-tertiary)',
    fontSize: '12px',
    lineHeight: '1.5',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  };

  return (
    <div style={{
      padding: '15px',
      backgroundColor: 'var(--info-bg)',
      border: '1px solid var(--info-border)',
      borderRadius: '6px',
      marginTop: '10px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--info)', fontWeight: 600, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="file-text" size={14} /> Dane z PDF ({searchField})
          </span>
          <span style={{
            color: searchResult.score >= 60 ? 'var(--success)' : 'var(--warning)',
            fontSize: '12px',
            backgroundColor: searchResult.score >= 60 ? 'rgba(78, 201, 176, 0.15)' : 'rgba(220, 220, 170, 0.15)',
            padding: '2px 8px',
            borderRadius: '10px',
          }}>
            trafność: {searchResult.score}%
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'inline-flex' }}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div style={{
        backgroundColor: 'var(--bg-surface-sunken)',
        borderRadius: '6px',
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid var(--accent-subtle)',
      }}>
        {/* Before context */}
        {beforeLines.length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px dashed var(--border-default)' }}>
            {renderLinesWithSeparators(beforeLines, 'before', contextLineStyle, false)}
          </div>
        )}

        {/* Core match — highlighted block */}
        <div style={{
          padding: '10px 12px',
          backgroundColor: 'rgba(91, 155, 213, 0.08)',
          borderLeft: '3px solid var(--info)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: '4px',
            right: '8px',
            fontSize: '10px',
            color: 'var(--info)',
            opacity: 0.7,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            znaleziony wpis
          </div>
          {renderLinesWithSeparators(coreLines, 'core', {
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              fontSize: '13px',
              lineHeight: '1.7',
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }, true)}
        </div>

        {/* After context */}
        {afterLines.length > 0 && (
          <div style={{ padding: '8px 12px', borderTop: '1px dashed var(--border-default)' }}>
            {renderLinesWithSeparators(afterLines, 'after', contextLineStyle, false)}
          </div>
        )}
      </div>
    </div>
  );
};

// TransactionCard sub-component
interface TransactionCardProps {
  trn: TransactionForReview;
  idx: number;
  currentDecision: ReviewDecision | undefined;
  manualInput: string | undefined;
  manualContractorId: number | undefined;
  manualRemainingIncomeId: number | undefined;
  manualRemainingCostId: number | undefined;
  kontrahenci: Kontrahent[];
  remainingIncomeEntries: Kontrahent[];
  remainingCostEntries: Kontrahent[];
  handleDecision: (index: number, action: 'accept' | 'reject') => void;
  handleManualInput: (index: number, value: string) => void;
  handleManualContractorSelect: (index: number, contractorId: number | null) => void;
  handleManualRemainingIncomeSelect: (index: number, entryId: number | null) => void;
  handleManualRemainingCostSelect: (index: number, entryId: number | null) => void;
  language: Language;
  pdfLines?: string[];
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  trn,
  idx,
  currentDecision,
  manualInput,
  manualContractorId,
  manualRemainingIncomeId,
  manualRemainingCostId,
  kontrahenci,
  remainingIncomeEntries,
  remainingCostEntries,
  handleDecision,
  handleManualInput,
  handleManualContractorSelect,
  handleManualRemainingIncomeSelect,
  handleManualRemainingCostSelect,
  language,
  pdfLines,
}) => {
  const [pdfResult, setPdfResult] = useState<PdfSearchMatch | null>(null);
  const [pdfSearching, setPdfSearching] = useState(false);
  const [pdfVisible, setPdfVisible] = useState(false);
  const [pdfSearchField, setPdfSearchField] = useState('');
  const [pdfHighlightTokens, setPdfHighlightTokens] = useState<string[]>([]);

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

  // Determine card colors based on decision
  const getCardColors = () => {
    if (!currentDecision) {
      return { bg: 'var(--bg-surface-hover)', border: 'var(--border-default)' };
    }
    
    switch (currentDecision.action) {
      case 'accept':
        return { bg: 'rgba(76, 175, 80, 0.1)', border: 'var(--success)' }; // green
      case 'reject':
        return { bg: 'rgba(244, 67, 54, 0.1)', border: 'var(--danger)' }; // red
      case 'manual':
        return { bg: 'rgba(156, 39, 176, 0.1)', border: 'var(--accent)' }; // purple
      default:
        return { bg: 'var(--bg-surface-hover)', border: 'var(--border-default)' };
    }
  };
  
  const cardColors = getCardColors();
  
  return (
  <div
    style={{
      backgroundColor: cardColors.bg,
      border: `2px solid ${cardColors.border}`,
      borderRadius: '4px',
      padding: '15px',
      marginBottom: '15px',
    }}
  >
    {/* Transaction Header */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '15px',
      paddingBottom: '10px',
      borderBottom: '1px solid var(--border-default)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h3 style={{ margin: 0, color: trn.transactionType === 'income' ? 'var(--success)' : 'var(--warning)' }}>
          Transakcja #{idx + 1} ({trn.transactionType === 'income' ? 'WPŁATA' : 'WYDATEK'})
        </h3>
        {(() => {
          // Get confidence based on transaction type
          const conf = trn.transactionType === 'income' 
            ? trn.extracted.confidence 
            : (trn.matchedContractor?.confidence || 0);
          
          const color = conf >= 85 ? 'var(--success)' : conf >= 60 ? 'var(--warning)' : 'var(--danger)';
          const bgColor = conf >= 85 ? 'rgba(78, 201, 176, 0.15)' : conf >= 60 ? 'rgba(220, 220, 170, 0.15)' : 'rgba(244, 71, 71, 0.15)';
          const borderColor = conf >= 85 ? 'rgba(78, 201, 176, 0.4)' : conf >= 60 ? 'rgba(220, 220, 170, 0.4)' : 'rgba(244, 71, 71, 0.4)';
          
          return (
            <span style={{
              color,
              backgroundColor: bgColor,
              border: `1px solid ${borderColor}`,
              borderRadius: '12px',
              padding: '3px 10px',
              fontSize: '13px',
              fontWeight: 600,
            }}>
              {trn.transactionType === 'income' ? 'Pewność' : 'Dopasowanie'}: {conf}%
            </span>
          );
        })()}
      </div>
    </div>

    {/* Original Data */}
    <div style={{ marginBottom: '15px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: 'var(--info)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="file-text" size={16} /> Dane z wyciągu:
        {pdfLines && pdfLines.length > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--info)', marginLeft: '10px', fontWeight: 400 }}>
            (kliknij opis lub kontrahenta aby sprawdzić w PDF)
          </span>
        )}
      </h4>
      <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
        <div><strong>Data:</strong> {trn.original.date}</div>
        <div><strong>Kwota:</strong> {trn.original.amount} PLN</div>
        <div>
          <strong>Opis:</strong>{' '}
          {pdfLines && pdfLines.length > 0 ? (
            <span
              onClick={() => handlePdfLookup('opis')}
              style={{
                cursor: 'pointer',
                borderBottom: '1px dashed var(--info)',
                color: pdfVisible && pdfSearchField === 'opis' ? 'var(--info)' : undefined,
                transition: 'color 0.2s',
              }}
              title="Kliknij aby wyszukać w PDF"
            >
              {trn.original.description}
            </span>
          ) : (
            trn.original.description
          )}
        </div>
        <div>
          <strong>Kontrahent:</strong>{' '}
          {pdfLines && pdfLines.length > 0 ? (
            <span
              onClick={() => handlePdfLookup('kontrahent')}
              style={{
                cursor: 'pointer',
                borderBottom: '1px dashed var(--info)',
                color: pdfVisible && pdfSearchField === 'kontrahent' ? 'var(--info)' : undefined,
                transition: 'color 0.2s',
              }}
              title="Kliknij aby wyszukać w PDF"
            >
              {trn.original.counterparty}
            </span>
          ) : (
            trn.original.counterparty
          )}
        </div>
      </div>
      
      {/* PDF Search Result Panel */}
      {pdfVisible && (
        <PdfPanel
          searchResult={pdfSearching ? null : pdfResult}
          searching={pdfSearching}
          searchField={pdfSearchField}
          onClose={() => setPdfVisible(false)}
          highlightTokens={pdfHighlightTokens}
        />
      )}
    </div>

    {/* Extracted Data */}
    {trn.transactionType === 'income' && (
      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="search" size={16} /> {language === 'pl' ? 'Wyekstrahowane dane' : 'Extracted data'}:
        </h4>
        <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          <div>{language === 'pl' ? 'Adres' : 'Address'}: {trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}</div>
          <div>{language === 'pl' ? 'Ulica' : 'Street'}: {trn.extracted.streetName || 'N/A'}</div>
          <div>{language === 'pl' ? 'Numer budynku' : 'Building number'}: {trn.extracted.buildingNumber || 'N/A'}</div>
          <div>{language === 'pl' ? 'Numer mieszkania' : 'Apartment number'}: {trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}</div>
          <div>{language === 'pl' ? 'Najemca' : 'Tenant'}: {trn.extracted.tenantName || 'N/A'}</div>
          {trn.extracted.reasoning && (
            <div style={{ 
              marginTop: '12px',
              padding: '10px 12px',
              backgroundColor: 'rgba(220, 220, 170, 0.15)',
              border: '1px solid rgba(220, 220, 170, 0.3)',
              borderRadius: '4px',
              color: 'var(--warning)',
              fontSize: '13px',
              fontStyle: 'italic',
              lineHeight: '1.5',
            }}>
              <strong style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Icon name="sparkles" size={12} /> {language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:
              </strong> {trn.extracted.reasoning}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Contractor Data (for expenses) */}
    {trn.transactionType === 'expense' && trn.matchedContractor && (
      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="briefcase" size={16} /> Dopasowany kontrahent:
        </h4>
        <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          <div>Nazwa: {trn.matchedContractor.contractorName || 'NIE ZNALEZIONO'}</div>
          <div>Konto: {trn.matchedContractor.contractorAccount || 'N/A'}</div>
          <div>Confidence: {trn.matchedContractor.confidence}%</div>
          {trn.extracted.reasoning && (
            <div style={{ 
              marginTop: '12px',
              padding: '10px 12px',
              backgroundColor: 'rgba(220, 220, 170, 0.15)',
              border: '1px solid rgba(220, 220, 170, 0.3)',
              borderRadius: '4px',
              color: 'var(--warning)',
              fontSize: '13px',
              fontStyle: 'italic',
              lineHeight: '1.5',
            }}>
              <strong style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Icon name="sparkles" size={12} /> {language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:
              </strong> {trn.extracted.reasoning}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Highlighted Apartment Number Box (for income) */}
    {trn.transactionType === 'income' && (() => {
      const extractedApt = trn.extracted.apartmentNumber;
      const manualApt = manualInput?.trim();
      const isManuallyEdited = manualApt && manualApt.length > 0 && manualApt !== extractedApt;
      const displayValue = isManuallyEdited ? manualApt : extractedApt;
      
      if (displayValue && displayValue.length > 0) {
        return (
          <div style={{ marginBottom: '15px' }}>
            <div style={{ 
              padding: '12px 16px',
              backgroundColor: isManuallyEdited ? 'rgba(197, 134, 192, 0.2)' : 'rgba(78, 201, 176, 0.2)',
              border: isManuallyEdited ? '2px solid var(--accent)' : '2px solid var(--success)',
              borderRadius: '6px',
            }}>
              <div style={{
                fontSize: '11px',
                color: isManuallyEdited ? 'var(--accent)' : 'var(--success)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <Icon name={isManuallyEdited ? 'edit' : 'check-circle'} size={12} />
                {isManuallyEdited
                  ? (language === 'pl' ? 'Numer lokalu (ręcznie wpisany)' : 'Apartment number (manually entered)')
                  : (language === 'pl' ? 'Zmatchowany numer lokalu' : 'Matched apartment number')
                }
              </div>
              <div style={{ 
                fontSize: '24px', 
                fontWeight: 700,
                color: isManuallyEdited ? 'var(--accent)' : 'var(--success)',
                letterSpacing: '1px',
              }}>
                {displayValue}
              </div>
            </div>
          </div>
        );
      } else {
        // Show "NOT FOUND" box when no apartment number is available
        return (
          <div style={{ marginBottom: '15px' }}>
            <div style={{ 
              padding: '12px 16px',
              backgroundColor: 'rgba(244, 71, 71, 0.2)',
              border: '2px solid var(--danger)',
              borderRadius: '6px',
            }}>
              <div style={{ 
                fontSize: '11px', 
                color: 'var(--danger)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>
                <Icon name="alert-triangle" size={12} /> {language === 'pl' ? 'Numer lokalu' : 'Apartment number'}
              </div>
              <div style={{ 
                fontSize: '24px', 
                fontWeight: 700,
                color: 'var(--danger)',
                letterSpacing: '1px',
              }}>
                {language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND'}
              </div>
            </div>
          </div>
        );
      }
    })()}

    {/* Action zone — decision + manual input + status */}
    {(() => {
      const hasManualOverride = !!(manualInput && manualInput.trim().length > 0)
        || manualContractorId !== undefined
        || manualRemainingIncomeId !== undefined
        || manualRemainingCostId !== undefined;

      return (
        <div className="review-card__actions">
          <h4 className="review-card__actions-title">
            <Icon name="check-circle" size={12} /> Decyzja
          </h4>

          <div className="review-card__actions-row">
            {((trn.transactionType === 'expense' && trn.matchedContractor?.contractorName) || (trn.transactionType === 'income' && trn.extracted.apartmentNumber)) && (
              <button
                onClick={() => handleDecision(trn.index, 'accept')}
                disabled={hasManualOverride}
                className={`button button-success${currentDecision?.action === 'accept' ? ' is-selected' : ''}`}
              >
                <Icon name="check" size={14} /> Akceptuj
              </button>
            )}
            <button
              onClick={() => handleDecision(trn.index, 'reject')}
              disabled={hasManualOverride}
              className={`button button-danger${currentDecision?.action === 'reject' ? ' is-selected' : ''}`}
            >
              <Icon name="x" size={14} /> Oznacz jako nierozpoznane
            </button>
          </div>

          {hasManualOverride && (
            <div style={{ fontSize: '12px', color: 'var(--warning)', marginBottom: 'var(--s-3)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="alert-triangle" size={12} /> Wyczyść ręczne przypisanie, aby użyć przycisków akceptuj/odrzuć
            </div>
          )}

          {/* Manual Input (only for income) */}
          {trn.transactionType === 'income' && (
            <div className="review-card__manual">
              <div className="review-card__manual-field" style={{ maxWidth: 220 }}>
                <label className="review-card__manual-label">Numer mieszkania</label>
                <input
                  type="text"
                  value={manualInput || ''}
                  onChange={(e) => handleManualInput(trn.index, (e.target as HTMLInputElement).value)}
                  placeholder="np. 42, ZGN"
                  disabled={manualRemainingIncomeId !== undefined}
                />
              </div>
              <div className="review-card__manual-field" style={{ maxWidth: 350 }}>
                <label className="review-card__manual-label">
                  {language === 'pl' ? 'Pozostałe przychody' : 'Remaining income'}
                </label>
                <SearchableContractorSelect
                  kontrahenci={remainingIncomeEntries}
                  selectedContractorId={manualRemainingIncomeId !== undefined ? manualRemainingIncomeId : null}
                  onChange={(entryId) => handleManualRemainingIncomeSelect(trn.index, entryId)}
                  placeholder={language === 'pl' ? 'Wybierz pozostały przychód...' : 'Select remaining income...'}
                  searchPlaceholder={language === 'pl' ? 'Szukaj po nazwie...' : 'Search by name...'}
                  disabled={!!(manualInput && manualInput.trim().length > 0)}
                />
              </div>
            </div>
          )}

          {/* Manual Contractor Selection (only for expense) */}
          {trn.transactionType === 'expense' && (
            <div className="review-card__manual">
              <div className="review-card__manual-field">
                <label className="review-card__manual-label">
                  Wybierz kontrahenta {trn.matchedContractor?.contractorName ? '(możesz zmienić)' : '(wybierz ręcznie)'}
                </label>
                <SearchableContractorSelect
                  kontrahenci={kontrahenci}
                  selectedContractorId={manualContractorId !== undefined ? manualContractorId : null}
                  onChange={(contractorId) => handleManualContractorSelect(trn.index, contractorId)}
                  placeholder="Brak przypisania"
                  searchPlaceholder="Szukaj kontrahenta po nazwie lub NIP..."
                  disabled={manualRemainingCostId !== undefined}
                />
              </div>
              <div className="review-card__manual-field">
                <label className="review-card__manual-label">
                  {language === 'pl' ? 'Pozostałe koszty' : 'Remaining costs'}
                </label>
                <SearchableContractorSelect
                  kontrahenci={remainingCostEntries}
                  selectedContractorId={manualRemainingCostId !== undefined ? manualRemainingCostId : null}
                  onChange={(entryId) => handleManualRemainingCostSelect(trn.index, entryId)}
                  placeholder={language === 'pl' ? 'Wybierz pozostały koszt...' : 'Select remaining cost...'}
                  searchPlaceholder={language === 'pl' ? 'Szukaj po nazwie...' : 'Search by name...'}
                  disabled={manualContractorId !== undefined}
                />
              </div>
            </div>
          )}

          {/* Current Decision Status */}
          {currentDecision && (() => {
            const isReject = currentDecision.action === 'reject';
            const bg = isReject ? 'var(--danger-bg)' : 'var(--success-bg)';
            const fg = isReject ? 'var(--danger)' : 'var(--success)';

            let iconName: React.ComponentProps<typeof Icon>['name'] = 'check-circle';
            let label: string = 'Zaakceptowano wyekstrahowane dane';

            if (currentDecision.action === 'reject') {
              iconName = 'x-circle';
              label = 'Oznaczono jako NIEROZPOZNANE';
            } else if (currentDecision.action === 'manual') {
              iconName = 'edit';
              if (trn.transactionType === 'income' && currentDecision.manualRemainingIncomeId) {
                const entry = remainingIncomeEntries.find(k => k.id === currentDecision.manualRemainingIncomeId);
                label = `Pozostały przychód: ${entry?.nazwa || 'Nieznany'} (${entry?.kontoKontrahenta || ''})`;
              } else if (trn.transactionType === 'income' && currentDecision.manualApartmentNumber) {
                label = `Ręcznie wpisano mieszkanie: ${currentDecision.manualApartmentNumber}`;
              } else if (trn.transactionType === 'expense' && currentDecision.manualRemainingCostId) {
                const entry = remainingCostEntries.find(k => k.id === currentDecision.manualRemainingCostId);
                label = `Pozostały koszt: ${entry?.nazwa || 'Nieznany'} (${entry?.kontoKontrahenta || ''})`;
              } else if (trn.transactionType === 'expense' && currentDecision.manualContractorId) {
                const selectedContractor = kontrahenci.find(k => k.id === currentDecision.manualContractorId);
                label = `Ręcznie wybrano kontrahenta: ${selectedContractor?.nazwa || 'Nieznany'}`;
              } else {
                label = 'Ręcznie edytowano';
              }
            }

            return (
              <div className="review-card__status" style={{ backgroundColor: bg, color: fg }}>
                <Icon name={iconName} size={14} />
                <span>{label}</span>
              </div>
            );
          })()}
        </div>
      );
    })()}
  </div>
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
  const [decisions, setDecisions] = useState<Map<number, ReviewDecision>>(new Map());
  
  // Manual inputs start empty - extracted values are shown in the input field as default
  const [manualInputs, setManualInputs] = useState<Map<number, string>>(new Map());
  const [manualContractorIds, setManualContractorIds] = useState<Map<number, number | null>>(new Map());
  const [manualRemainingIncomeIds, setManualRemainingIncomeIds] = useState<Map<number, number | null>>(new Map());
  const [manualRemainingCostIds, setManualRemainingCostIds] = useState<Map<number, number | null>>(new Map());
  
  const [kontrahenci, setKontrahenci] = useState<Kontrahent[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');

  // Filter kontrahenci by type
  const contractorEntries = kontrahenci.filter(k => (k.typ || 'Kontrahent') === 'Kontrahent');
  const remainingIncomeEntries = kontrahenci.filter(k => k.typ === 'Pozostałe przychody');
  const remainingCostEntries = kontrahenci.filter(k => k.typ === 'Pozostałe koszty');

  // Load kontrahenci on mount
  useEffect(() => {
    const loadKontrahenci = async () => {
      const result = await window.electronAPI.getKontrahenci();
      setKontrahenci(result);
    };
    loadKontrahenci();
  }, []);

  // Filter transactions based on selected filter
  const filteredTransactions = reviewData.transactions.filter(trn => {
    if (filter === 'all') return true;
    return trn.transactionType === filter;
  });

  // Group transactions by type
  const incomeTransactions = filteredTransactions.filter(trn => trn.transactionType === 'income');
  const expenseTransactions = filteredTransactions.filter(trn => trn.transactionType === 'expense');

  // Count totals for filter badges
  const totalIncome = reviewData.transactions.filter(trn => trn.transactionType === 'income').length;
  const totalExpense = reviewData.transactions.filter(trn => trn.transactionType === 'expense').length;

  const handleDecision = (index: number, action: 'accept' | 'reject') => {
    const newDecisions = new Map(decisions);
    newDecisions.set(index, { index, action });
    setDecisions(newDecisions);
    
    // Clear manual input if switching away from manual
    if (manualInputs.has(index)) {
      const newManualInputs = new Map(manualInputs);
      newManualInputs.delete(index);
      setManualInputs(newManualInputs);
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

  const handleManualInput = (index: number, value: string) => {
    const newManualInputs = new Map(manualInputs);
    const newDecisions = new Map(decisions);
    
    // If value is empty or only whitespace, remove from manual inputs and clear decision
    if (!value || value.trim().length === 0) {
      newManualInputs.delete(index);
      newDecisions.delete(index);
    } else {
      // Set manual input and create manual decision
      newManualInputs.set(index, value);
      newDecisions.set(index, {
        index,
        action: 'manual',
        manualApartmentNumber: value,
      });
    }
    
    setManualInputs(newManualInputs);
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

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'var(--bg-surface)',
      color: 'var(--text-primary)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-surface-sunken)',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        {/* Breadcrumbs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 500,
              padding: 0,
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.textDecoration = 'underline';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.textDecoration = 'none';
            }}
          >
            Konwerter
          </button>
          <span style={{ color: 'var(--border-strong)', fontSize: '16px', userSelect: 'none' }}>/</span>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>Przegląd transakcji</h2>
        </div>
        
        {/* Close button */}
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '4px 8px',
            transition: 'color 0.2s ease',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="Zamknij"
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      
      {/* Selected address */}
      {reviewData.adresName && (
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-strong)',
          backgroundColor: 'var(--bg-surface-hover)',
          textAlign: 'center',
          fontSize: '16px',
          color: 'var(--text-primary)',
          fontWeight: 600,
          letterSpacing: '0.3px',
          flexShrink: 0,
        }}>
          {reviewData.adresName}
        </div>
      )}
      
      {/* File info */}
      <div style={{
        padding: '8px 20px',
        borderBottom: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-surface-sunken)',
        flexShrink: 0,
      }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
          Plik: <strong>{reviewData.fileName}</strong> | Bank: <strong>{reviewData.bankName}</strong> | <span style={{ color: 'var(--warning)' }}>{reviewData.transactions.length} transakcji do zaakceptowania</span>
        </p>
      </div>

      {/* Transactions list */}
      <div style={{ 
        padding: '20px',
        flex: 1,
        overflowY: 'auto',
      }}>
        {/* Income Section */}
        {(filter === 'all' || filter === 'income') && incomeTransactions.length > 0 && (
          <>
            <div style={{
              backgroundColor: 'var(--success-bg)',
              padding: '12px 16px',
              marginBottom: '15px',
              borderRadius: '6px',
              borderLeft: '4px solid var(--success)',
            }}>
              <h3 style={{ margin: 0, color: 'var(--success)', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="coins" size={18} /> WPŁATY ({incomeTransactions.length})
              </h3>
            </div>
            {incomeTransactions.map((trn) => {
              const currentDecision = decisions.get(trn.index);
              const manualInput = manualInputs.get(trn.index);
              const manualRemainingIncomeId = manualRemainingIncomeIds.get(trn.index) ?? undefined;
              const idx = reviewData.transactions.indexOf(trn);
              
              return (
                <TransactionCard
                  key={trn.index}
                  trn={trn}
                  idx={idx}
                  currentDecision={currentDecision}
                  manualInput={manualInput}
                  manualContractorId={undefined}
                  manualRemainingIncomeId={manualRemainingIncomeId}
                  manualRemainingCostId={undefined}
                  kontrahenci={contractorEntries}
                  remainingIncomeEntries={remainingIncomeEntries}
                  remainingCostEntries={remainingCostEntries}
                  handleDecision={handleDecision}
                  handleManualInput={handleManualInput}
                  handleManualContractorSelect={handleManualContractorSelect}
                  handleManualRemainingIncomeSelect={handleManualRemainingIncomeSelect}
                  handleManualRemainingCostSelect={handleManualRemainingCostSelect}
                  language={language}
                  pdfLines={reviewData.pdfLines}
                />
              );
            })}
          </>
        )}

        {/* Expense Section */}
        {(filter === 'all' || filter === 'expense') && expenseTransactions.length > 0 && (
          <>
            <div style={{
              backgroundColor: 'var(--warning-bg)',
              padding: '12px 16px',
              marginBottom: '15px',
              marginTop: filter === 'all' && incomeTransactions.length > 0 ? '30px' : '0',
              borderRadius: '6px',
              borderLeft: '4px solid var(--warning)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, color: 'var(--warning)', fontSize: '18px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Icon name="arrow-right" size={18} /> WYDATKI ({expenseTransactions.length})
                </span>
              </h3>
              <button
                onClick={handleMarkAllExpensesAsUnrecognized}
                className="button button-danger button-small"
              >
                <Icon name="x" size={14} /> {t.markAllExpensesAsUnrecognized}
              </button>
            </div>
            {expenseTransactions.map((trn) => {
              const currentDecision = decisions.get(trn.index);
              const manualInput = manualInputs.get(trn.index);
              const manualContractorId = manualContractorIds.get(trn.index) ?? undefined;
              const manualRemainingCostId = manualRemainingCostIds.get(trn.index) ?? undefined;
              const idx = reviewData.transactions.indexOf(trn);
              
              return (
                <TransactionCard
                  key={trn.index}
                  trn={trn}
                  idx={idx}
                  currentDecision={currentDecision}
                  manualInput={manualInput}
                  manualContractorId={manualContractorId}
                  manualRemainingIncomeId={undefined}
                  manualRemainingCostId={manualRemainingCostId}
                  kontrahenci={contractorEntries}
                  remainingIncomeEntries={remainingIncomeEntries}
                  remainingCostEntries={remainingCostEntries}
                  handleDecision={handleDecision}
                  handleManualInput={handleManualInput}
                  handleManualContractorSelect={handleManualContractorSelect}
                  handleManualRemainingIncomeSelect={handleManualRemainingIncomeSelect}
                  handleManualRemainingCostSelect={handleManualRemainingCostSelect}
                  language={language}
                  pdfLines={reviewData.pdfLines}
                />
              );
            })}
          </>
        )}
      </div>

      {/* Footer with filters and actions */}
      <div style={{
        padding: '10px 20px',
        borderTop: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-surface-sunken)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        gap: '16px',
      }}>
        {/* Left: Filter buttons */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '12px', marginRight: '4px' }}>Filtruj:</span>
            <button
              onClick={() => setFilter('all')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: filter === 'all' ? 'var(--accent)' : 'var(--border-default)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: filter === 'all' ? 'bold' : 'normal',
              }}
            >
              Wszystkie ({reviewData.transactions.length})
            </button>
            <button
              onClick={() => setFilter('income')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: filter === 'income' ? 'var(--success)' : 'var(--border-default)',
                color: filter === 'income' ? 'var(--bg-surface)' : 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: filter === 'income' ? 'bold' : 'normal',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Icon name="coins" size={12} /> Wpłaty ({totalIncome})
            </button>
            <button
              onClick={() => setFilter('expense')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: filter === 'expense' ? 'var(--warning)' : 'var(--border-default)',
                color: filter === 'expense' ? 'var(--bg-surface)' : 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: filter === 'expense' ? 'bold' : 'normal',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Icon name="arrow-right" size={12} /> Wydatki ({totalExpense})
            </button>
          </div>
        </div>
        
        {/* Right: Decision status and action buttons */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
          {/* Files remaining badge */}
          {hasMoreFiles && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 18px',
              backgroundColor: 'var(--accent-subtle)',
              border: '1px solid var(--warning)',
              borderRadius: '3px',
              boxSizing: 'border-box',
            }}>
              <span style={{
                color: 'var(--warning)',
                fontSize: '14px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <Icon name="folder" size={14} /> {t.filesRemaining}: {remainingCount}
              </span>
            </div>
          )}
          {/* Decision status badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 18px',
            backgroundColor: allDecided ? 'var(--success-bg)' : 'var(--warning-bg)',
            border: allDecided ? '1px solid var(--success)' : '1px solid var(--warning)',
            borderRadius: '3px',
            minWidth: '150px',
            boxSizing: 'border-box',
          }}>
            <span style={{ lineHeight: 0, color: allDecided ? 'var(--success)' : 'var(--warning)' }}>
              <Icon name={allDecided ? 'check-circle' : 'loader'} size={16} />
            </span>
            <span style={{ 
              color: 'var(--text-primary)', 
              fontSize: '14px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}>
              {allDecided ? 'Gotowe' : 'Decyzje'}: {decisions.size}/{reviewData.transactions.length}
            </span>
          </div>
          
          {hasMoreFiles ? (
            <>
              <button
                onClick={onSkip}
                disabled={isProcessing}
                style={{
                  padding: '12px 24px',
                  backgroundColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  opacity: isProcessing ? 0.5 : 1,
                }}
              >
                {t.skipFile}
              </button>
              <button
                onClick={handleFinalizeAndStop}
                disabled={!allDecided || isProcessing}
                style={{
                  padding: '12px 24px',
                  backgroundColor: allDecided && !isProcessing ? 'var(--danger)' : 'var(--border-default)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: allDecided && !isProcessing ? 'pointer' : 'not-allowed',
                  opacity: allDecided && !isProcessing ? 1 : 0.5,
                }}
              >
                {isProcessing ? 'Przetwarzanie...' : t.finalizeAndStop}
              </button>
              <button
                onClick={handleFinalizeAndNext}
                disabled={!allDecided || isProcessing}
                style={{
                  padding: '12px 24px',
                  backgroundColor: allDecided && !isProcessing ? 'var(--accent)' : 'var(--border-default)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: allDecided && !isProcessing ? 'pointer' : 'not-allowed',
                  opacity: allDecided && !isProcessing ? 1 : 0.5,
                  fontWeight: 'bold',
                }}
              >
                {isProcessing ? 'Przetwarzanie...' : t.finalizeAndNext}
              </button>
            </>
          ) : (
            <button
              onClick={handleFinalizeAndNext}
              disabled={!allDecided || isProcessing}
              style={{
                padding: '12px 24px',
                backgroundColor: allDecided && !isProcessing ? 'var(--accent)' : 'var(--border-default)',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: allDecided && !isProcessing ? 'pointer' : 'not-allowed',
                opacity: allDecided && !isProcessing ? 1 : 0.5,
                fontWeight: 'bold',
              }}
            >
              {isProcessing ? 'Przetwarzanie...' : t.finalizeFile}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
