import React, { useState, useEffect, useRef } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview, Kontrahent } from '../../shared/types';
import { translations, Language } from '../translations';

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
}) => {
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
      <h4 style={{ margin: '0 0 10px 0', color: '#569CD6' }}>📄 Dane z wyciągu:</h4>
      <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
        <div><strong>Data:</strong> {trn.original.date}</div>
        <div><strong>Kwota:</strong> {trn.original.amount} PLN</div>
        <div><strong>Opis:</strong> {trn.original.description}</div>
        <div><strong>Kontrahent:</strong> {trn.original.counterparty}</div>
      </div>
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
      overflow: 'auto',
      zIndex: 1000,
    }}>
      {/* Header */}
      <div style={{
        padding: '20px',
        borderBottom: '1px solid #3c3c3c',
        backgroundColor: '#252526',
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>Przegląd Transakcji</h2>
        <p style={{ margin: '0 0 10px 0', color: '#858585' }}>
          Plik: <strong>{reviewData.fileName}</strong> | Bank: <strong>{reviewData.bankName}</strong>
        </p>
        {reviewData.adresName && (
          <div style={{
            marginTop: '12px',
            padding: '12px 16px',
            backgroundColor: '#1e3a5f',
            border: '2px solid #3b82f6',
            borderRadius: '8px',
          }}>
            <div style={{
              fontSize: '14px',
              color: '#93c5fd',
              marginBottom: '4px',
              fontWeight: 500,
            }}>
              🏢 Wybrany adres:
            </div>
            <div style={{
              fontSize: '18px',
              color: '#ffffff',
              fontWeight: 700,
            }}>
              {reviewData.adresName}
            </div>
          </div>
        )}
        <p style={{ margin: '10px 0 0 0', color: '#ffa500' }}>
          {reviewData.transactions.length} transakcji wymaga ręcznej weryfikacji (confidence {'<'} 60%)
        </p>
        
        {/* Filter buttons */}
        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilter('all')}
            style={{
              padding: '8px 16px',
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
              padding: '8px 16px',
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
              padding: '8px 16px',
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

      {/* Transactions list */}
      <div style={{ padding: '20px' }}>
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
                />
              );
            })}
          </>
        )}
      </div>

      {/* Footer with actions */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        padding: '20px',
        borderTop: '1px solid #3c3c3c',
        backgroundColor: '#252526',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <span style={{ color: '#858585' }}>
            Podjęto decyzje: {decisions.size} / {reviewData.transactions.length}
          </span>
          {hasMoreFiles && (
            <span style={{ color: '#DCDCAA', marginLeft: '15px', fontSize: '14px' }}>
              {t.filesRemaining}: {remainingCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onCancel}
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
            {t.cancel}
          </button>
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
