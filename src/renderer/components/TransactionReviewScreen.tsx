import React, { useState, useEffect, useRef } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview, Kontrahent } from '../../shared/types';
import { translations, Language } from '../translations';
import { searchTransactionInPdf, PdfSearchMatch } from '../../shared/pdf-search';

// SearchableContractorSelect component
interface SearchableContractorSelectProps {
  kontrahenci: Kontrahent[];
  selectedContractorId: number | null;
  onChange: (contractorId: number | null) => void;
  placeholder: string;
  searchPlaceholder: string;
}

const SearchableContractorSelect: React.FC<SearchableContractorSelectProps> = ({
  kontrahenci,
  selectedContractorId,
  onChange,
  placeholder,
  searchPlaceholder
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
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '6px 10px',
          border: '1px solid #3c3c3c',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: '#1e1e1e',
          minHeight: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ color: selectedContractor ? '#e0e0e0' : '#888' }}>
          {selectedContractor ? selectedContractor.nazwa : placeholder}
        </span>
        <span style={{ fontSize: '10px', color: '#888' }}>▼</span>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: '#1e1e1e',
            border: '1px solid #3c3c3c',
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
              borderBottom: '1px solid #3c3c3c',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: '#1e1e1e',
              color: '#e0e0e0'
            }}
          />
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            <div
              onClick={() => handleSelect(null)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                backgroundColor: selectedContractorId === null ? '#21262d' : '#1e1e1e',
                borderBottom: '1px solid #3c3c3c'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#0d1117'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedContractorId === null ? '#21262d' : '#1e1e1e'}
            >
              <em style={{ color: '#888' }}>{placeholder}</em>
            </div>
            {filteredKontrahenci.map((kontrahent) => (
              <div
                key={kontrahent.id}
                onClick={() => handleSelect(kontrahent.id)}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  backgroundColor: kontrahent.id === selectedContractorId ? '#21262d' : '#1e1e1e',
                  borderBottom: '1px solid #3c3c3c'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#0d1117'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = kontrahent.id === selectedContractorId ? '#21262d' : '#1e1e1e'}
              >
                <div style={{ color: '#e0e0e0' }}>{kontrahent.nazwa}</div>
                {kontrahent.nip && (
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                    NIP: {kontrahent.nip}
                  </div>
                )}
                {kontrahent.alternativeNames && kontrahent.alternativeNames.length > 0 && (
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                    {kontrahent.alternativeNames.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {filteredKontrahenci.length === 0 && (
              <div style={{ padding: '8px 10px', color: '#888', textAlign: 'center' }}>
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
        backgroundColor: '#1a2332',
        border: '1px solid #2a5a8a',
        borderRadius: '6px',
        marginTop: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: '#5B9BD5', fontWeight: 600, fontSize: '13px' }}>📄 Szukam w PDF...</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>✕</button>
        </div>
        <div style={{ color: '#888', fontSize: '13px' }}>Proszę czekać...</div>
      </div>
    );
  }

  if (!searchResult) {
    return (
      <div style={{
        padding: '15px',
        backgroundColor: '#2a1a1a',
        border: '1px solid #8a2a2a',
        borderRadius: '6px',
        marginTop: '10px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ color: '#F44747', fontWeight: 600, fontSize: '13px' }}>📄 Nie znaleziono w PDF</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>✕</button>
        </div>
        <div style={{ color: '#888', fontSize: '13px' }}>Nie znaleziono pasującej transakcji w dokumencie PDF.</div>
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
        return <span key={i} style={{ backgroundColor: 'rgba(255, 213, 79, 0.3)', color: '#FFD54F', fontWeight: 600, padding: '0 2px', borderRadius: '2px' }}>{part}</span>;
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
            borderTop: '1px solid #30363d',
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
    color: '#666',
    fontSize: '12px',
    lineHeight: '1.5',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  };

  return (
    <div style={{
      padding: '15px',
      backgroundColor: '#1a2332',
      border: '1px solid #2a5a8a',
      borderRadius: '6px',
      marginTop: '10px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#5B9BD5', fontWeight: 600, fontSize: '13px' }}>
            📄 Dane z PDF ({searchField})
          </span>
          <span style={{
            color: searchResult.score >= 60 ? '#4EC9B0' : '#DCDCAA',
            fontSize: '12px',
            backgroundColor: searchResult.score >= 60 ? 'rgba(78, 201, 176, 0.15)' : 'rgba(220, 220, 170, 0.15)',
            padding: '2px 8px',
            borderRadius: '10px',
          }}>
            trafność: {searchResult.score}%
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>✕</button>
      </div>

      <div style={{
        backgroundColor: '#0d1117',
        borderRadius: '6px',
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid #21262d',
      }}>
        {/* Before context */}
        {beforeLines.length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px dashed #30363d' }}>
            {renderLinesWithSeparators(beforeLines, 'before', contextLineStyle, false)}
          </div>
        )}

        {/* Core match — highlighted block */}
        <div style={{
          padding: '10px 12px',
          backgroundColor: 'rgba(91, 155, 213, 0.08)',
          borderLeft: '3px solid #5B9BD5',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: '4px',
            right: '8px',
            fontSize: '10px',
            color: '#5B9BD5',
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
              color: '#e0e0e0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }, true)}
        </div>

        {/* After context */}
        {afterLines.length > 0 && (
          <div style={{ padding: '8px 12px', borderTop: '1px dashed #30363d' }}>
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
  kontrahenci: Kontrahent[];
  handleDecision: (index: number, action: 'accept' | 'reject') => void;
  handleManualInput: (index: number, value: string) => void;
  handleManualContractorSelect: (index: number, contractorId: number | null) => void;
  language: Language;
  pdfLines?: string[];
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  trn,
  idx,
  currentDecision,
  manualInput,
  manualContractorId,
  kontrahenci,
  handleDecision,
  handleManualInput,
  handleManualContractorSelect,
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
      return { bg: '#2d2d30', border: '#3c3c3c' };
    }
    
    switch (currentDecision.action) {
      case 'accept':
        return { bg: 'rgba(76, 175, 80, 0.1)', border: '#4CAF50' }; // green
      case 'reject':
        return { bg: 'rgba(244, 67, 54, 0.1)', border: '#f44336' }; // red
      case 'manual':
        return { bg: 'rgba(156, 39, 176, 0.1)', border: '#9C27B0' }; // purple
      default:
        return { bg: '#2d2d30', border: '#3c3c3c' };
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
      borderBottom: '1px solid #3c3c3c',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h3 style={{ margin: 0, color: trn.transactionType === 'income' ? '#4EC9B0' : '#CE9178' }}>
          Transakcja #{idx + 1} ({trn.transactionType === 'income' ? 'WPŁATA' : 'WYDATEK'})
        </h3>
        {(() => {
          // Get confidence based on transaction type
          const conf = trn.transactionType === 'income' 
            ? trn.extracted.confidence 
            : (trn.matchedContractor?.confidence || 0);
          
          const color = conf >= 85 ? '#4EC9B0' : conf >= 60 ? '#DCDCAA' : '#F44747';
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
      <h4 style={{ margin: '0 0 10px 0', color: '#569CD6' }}>
        📄 Dane z wyciągu:
        {pdfLines && pdfLines.length > 0 && (
          <span style={{ fontSize: '11px', color: '#5B9BD5', marginLeft: '10px', fontWeight: 400 }}>
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
                borderBottom: '1px dashed #5B9BD5',
                color: pdfVisible && pdfSearchField === 'opis' ? '#5B9BD5' : undefined,
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
                borderBottom: '1px dashed #5B9BD5',
                color: pdfVisible && pdfSearchField === 'kontrahent' ? '#5B9BD5' : undefined,
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
        <h4 style={{ margin: '0 0 10px 0', color: '#DCDCAA' }}>🔍 {language === 'pl' ? 'Wyekstrahowane dane' : 'Extracted data'}:</h4>
        <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#858585' }}>
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
              color: '#DCDCAA',
              fontSize: '13px',
              fontStyle: 'italic',
              lineHeight: '1.5',
            }}>
              <strong style={{ color: '#DCDCAA' }}>💡 {language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:</strong> {trn.extracted.reasoning}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Contractor Data (for expenses) */}
    {trn.transactionType === 'expense' && trn.matchedContractor && (
      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#DCDCAA' }}>💼 Dopasowany kontrahent:</h4>
        <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#858585' }}>
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
              color: '#DCDCAA',
              fontSize: '13px',
              fontStyle: 'italic',
              lineHeight: '1.5',
            }}>
              <strong style={{ color: '#DCDCAA' }}>💡 {language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:</strong> {trn.extracted.reasoning}
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
              border: isManuallyEdited ? '2px solid #C586C0' : '2px solid #4EC9B0',
              borderRadius: '6px',
            }}>
              <div style={{ 
                fontSize: '11px', 
                color: isManuallyEdited ? '#C586C0' : '#4EC9B0',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>
                {isManuallyEdited 
                  ? (language === 'pl' ? '✏️ Numer lokalu (ręcznie wpisany)' : '✏️ Apartment number (manually entered)')
                  : (language === 'pl' ? '🏠 Zmatchowany numer lokalu' : '🏠 Matched apartment number')
                }
              </div>
              <div style={{ 
                fontSize: '24px', 
                fontWeight: 700,
                color: isManuallyEdited ? '#C586C0' : '#4EC9B0',
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
              border: '2px solid #F44747',
              borderRadius: '6px',
            }}>
              <div style={{ 
                fontSize: '11px', 
                color: '#F44747',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>
                {language === 'pl' ? '⚠️ Numer lokalu' : '⚠️ Apartment number'}
              </div>
              <div style={{ 
                fontSize: '24px', 
                fontWeight: 700,
                color: '#F44747',
                letterSpacing: '1px',
              }}>
                {language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND'}
              </div>
            </div>
          </div>
        );
      }
    })()}

    {/* Decision Buttons */}
    <div style={{ marginTop: '15px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: '#C586C0' }}>✅ Decyzja:</h4>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        {/* Show Accept only when there's meaningful extracted data to accept */}
        {((trn.transactionType === 'expense' && trn.matchedContractor?.contractorName) || (trn.transactionType === 'income' && trn.extracted.apartmentNumber)) && (
          <button
            onClick={() => handleDecision(trn.index, 'accept')}
            disabled={!!(manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined}
            style={{
              padding: '10px 20px',
              backgroundColor: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined)
                ? '#555'
                : currentDecision?.action === 'accept' ? '#2e7d32' : '#4CAF50',
              color: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? '#888' : 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? 'not-allowed' : 'pointer',
              fontWeight: currentDecision?.action === 'accept' ? 'bold' : 'normal',
              opacity: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? 0.5 : 1,
            }}
          >
            ✓ Akceptuj
          </button>
        )}
        <button
          onClick={() => handleDecision(trn.index, 'reject')}
          disabled={!!(manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined}
          style={{
            padding: '10px 20px',
            backgroundColor: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined)
              ? '#555'
              : currentDecision?.action === 'reject' ? '#b71c1c' : '#d32f2f',
            color: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? '#888' : 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? 'not-allowed' : 'pointer',
            fontWeight: currentDecision?.action === 'reject' ? 'bold' : 'normal',
            opacity: ((manualInput && manualInput.trim().length > 0) || manualContractorId !== undefined) ? 0.5 : 1,
          }}
        >
          ✗ Oznacz jako nierozpoznane
        </button>
      </div>
      {(manualInput && manualInput.trim().length > 0) && (
        <div style={{ fontSize: '12px', color: '#DCDCAA', marginBottom: '10px', fontStyle: 'italic' }}>
          ⚠ Wyczyść pole ręcznego wprowadzania, aby użyć przycisków akceptuj/odrzuć
        </div>
      )}
      {manualContractorId !== undefined && (
        <div style={{ fontSize: '12px', color: '#DCDCAA', marginBottom: '10px', fontStyle: 'italic' }}>
          ⚠ Resetuj wybór kontrahenta ("Brak przypisania"), aby użyć przycisków akceptuj/odrzuć
        </div>
      )}

      {/* Manual Input (only for income) */}
      {trn.transactionType === 'income' && (
        <div>
          <label style={{ display: 'block', marginBottom: '5px', color: '#C586C0' }}>
            Numer mieszkania {trn.extracted.apartmentNumber ? '(możesz edytować)' : '(wpisz ręcznie)'}:
          </label>
          <input
            type="text"
            value={manualInput || ''}
            onChange={(e) => handleManualInput(trn.index, (e.target as HTMLInputElement).value)}
            placeholder="np. 42, ZGN"
            style={{
              padding: '8px',
              backgroundColor: '#3c3c3c',
              color: '#d4d4d4',
              border: '1px solid #555',
              borderRadius: '3px',
              width: '200px',
            }}
          />
        </div>
      )}

      {/* Manual Contractor Selection (only for expense) */}
      {trn.transactionType === 'expense' && (
        <div>
          <label style={{ display: 'block', marginBottom: '5px', color: '#C586C0' }}>
            Wybierz kontrahenta {trn.matchedContractor?.contractorName ? '(możesz zmienić)' : '(wybierz ręcznie)'}:
          </label>
          <SearchableContractorSelect
            kontrahenci={kontrahenci}
            selectedContractorId={manualContractorId !== undefined ? manualContractorId : null}
            onChange={(contractorId) => handleManualContractorSelect(trn.index, contractorId)}
            placeholder="Brak przypisania"
            searchPlaceholder="Szukaj kontrahenta po nazwie lub NIP..."
          />
        </div>
      )}

      {/* Current Decision Display */}
      {currentDecision && (
        <div style={{
          marginTop: '10px',
          padding: '8px',
          backgroundColor: '#1e3a1e',
          color: '#4EC9B0',
          borderRadius: '3px',
          fontSize: '14px',
        }}>
          {currentDecision.action === 'accept' && '✓ Zaakceptowano wyekstrahowane dane'}
          {currentDecision.action === 'reject' && '✗ Oznaczono jako NIEROZPOZNANE'}
          {currentDecision.action === 'manual' && (() => {
            if (trn.transactionType === 'income' && currentDecision.manualApartmentNumber) {
              return `✏️  Ręcznie wpisano mieszkanie: ${currentDecision.manualApartmentNumber}`;
            } else if (trn.transactionType === 'expense' && currentDecision.manualContractorId) {
              const selectedContractor = kontrahenci.find(k => k.id === currentDecision.manualContractorId);
              return `✏️  Ręcznie wybrano kontrahenta: ${selectedContractor?.nazwa || 'Nieznany'}`;
            }
            return '✏️  Ręcznie edytowano';
          })()}
        </div>
      )}
    </div>
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
  
  const [kontrahenci, setKontrahenci] = useState<Kontrahent[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');

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
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid #3c3c3c',
        backgroundColor: '#252526',
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
              color: '#858585',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 500,
              padding: 0,
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#b0b0b0';
              e.currentTarget.style.textDecoration = 'underline';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#858585';
              e.currentTarget.style.textDecoration = 'none';
            }}
          >
            Konwerter
          </button>
          <span style={{ color: '#555', fontSize: '16px', userSelect: 'none' }}>/</span>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 500, color: '#e0e0e0' }}>Przegląd transakcji</h2>
        </div>
        
        {/* Close button */}
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: '#858585',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '4px 8px',
            transition: 'color 0.2s ease',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#e0e0e0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#858585';
          }}
          title="Zamknij"
        >
          ✕
        </button>
      </div>
      
      {/* Selected address */}
      {reviewData.adresName && (
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #4a4a4a',
          backgroundColor: '#373738',
          textAlign: 'center',
          fontSize: '16px',
          color: '#e0e0e0',
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
        borderBottom: '1px solid #3c3c3c',
        backgroundColor: '#252526',
        flexShrink: 0,
      }}>
        <p style={{ margin: 0, color: '#858585', fontSize: '13px' }}>
          Plik: <strong>{reviewData.fileName}</strong> | Bank: <strong>{reviewData.bankName}</strong> | <span style={{ color: '#ffa500' }}>{reviewData.transactions.length} transakcji do zaakceptowania</span>
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
              backgroundColor: '#1e3a2e',
              padding: '12px 16px',
              marginBottom: '15px',
              borderRadius: '6px',
              borderLeft: '4px solid #4EC9B0',
            }}>
              <h3 style={{ margin: 0, color: '#4EC9B0', fontSize: '18px' }}>
                💰 WPŁATY ({incomeTransactions.length})
              </h3>
            </div>
            {incomeTransactions.map((trn) => {
              const currentDecision = decisions.get(trn.index);
              const manualInput = manualInputs.get(trn.index);
              const idx = reviewData.transactions.indexOf(trn);
              
              return (
                <TransactionCard
                  key={trn.index}
                  trn={trn}
                  idx={idx}
                  currentDecision={currentDecision}
                  manualInput={manualInput}
                  handleDecision={handleDecision}
                  handleManualInput={handleManualInput}
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
              backgroundColor: '#3a2e1e',
              padding: '12px 16px',
              marginBottom: '15px',
              marginTop: filter === 'all' && incomeTransactions.length > 0 ? '30px' : '0',
              borderRadius: '6px',
              borderLeft: '4px solid #CE9178',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, color: '#CE9178', fontSize: '18px' }}>
                💸 WYDATKI ({expenseTransactions.length})
              </h3>
              <button
                onClick={handleMarkAllExpensesAsUnrecognized}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#d32f2f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                ✗ {t.markAllExpensesAsUnrecognized}
              </button>
            </div>
            {expenseTransactions.map((trn) => {
              const currentDecision = decisions.get(trn.index);
              const manualInput = manualInputs.get(trn.index);
              const manualContractorId = manualContractorIds.get(trn.index);
              const idx = reviewData.transactions.indexOf(trn);
              
              return (
                <TransactionCard
                  key={trn.index}
                  trn={trn}
                  idx={idx}
                  currentDecision={currentDecision}
                  manualInput={manualInput}
                  manualContractorId={manualContractorId}
                  kontrahenci={kontrahenci}
                  handleDecision={handleDecision}
                  handleManualInput={handleManualInput}
                  handleManualContractorSelect={handleManualContractorSelect}
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
        borderTop: '1px solid #3c3c3c',
        backgroundColor: '#252526',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        gap: '16px',
      }}>
        {/* Left: Filter buttons */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#858585', fontSize: '12px', marginRight: '4px' }}>Filtruj:</span>
            <button
              onClick={() => setFilter('all')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: filter === 'all' ? '#0e639c' : '#3c3c3c',
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
                backgroundColor: filter === 'income' ? '#4EC9B0' : '#3c3c3c',
                color: filter === 'income' ? '#1e1e1e' : 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: filter === 'income' ? 'bold' : 'normal',
              }}
            >
              💰 Wpłaty ({totalIncome})
            </button>
            <button
              onClick={() => setFilter('expense')}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: filter === 'expense' ? '#CE9178' : '#3c3c3c',
                color: filter === 'expense' ? '#1e1e1e' : 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: filter === 'expense' ? 'bold' : 'normal',
              }}
            >
              💸 Wydatki ({totalExpense})
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
              backgroundColor: '#2a2d3a',
              border: '1px solid #DCDCAA',
              borderRadius: '3px',
              boxSizing: 'border-box',
            }}>
              <span style={{ 
                color: '#DCDCAA', 
                fontSize: '14px', 
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}>
                📁 {t.filesRemaining}: {remainingCount}
              </span>
            </div>
          )}
          {/* Decision status badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 18px',
            backgroundColor: allDecided ? '#1e4620' : '#3c2a1e',
            border: allDecided ? '1px solid #4EC9B0' : '1px solid #CE9178',
            borderRadius: '3px',
            minWidth: '150px',
            boxSizing: 'border-box',
          }}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>
              {allDecided ? '✅' : '⏳'}
            </span>
            <span style={{ 
              color: '#e0e0e0', 
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
                  backgroundColor: '#3c3c3c',
                  color: '#d4d4d4',
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
                  backgroundColor: allDecided && !isProcessing ? '#d32f2f' : '#3c3c3c',
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
                  backgroundColor: allDecided && !isProcessing ? '#0e639c' : '#3c3c3c',
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
                backgroundColor: allDecided && !isProcessing ? '#0e639c' : '#3c3c3c',
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
