import React, { useState } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview } from '../../shared/types';
import { translations, Language } from '../translations';

// TransactionCard sub-component
interface TransactionCardProps {
  trn: TransactionForReview;
  idx: number;
  currentDecision: ReviewDecision | undefined;
  manualInput: string | undefined;
  handleDecision: (index: number, action: 'accept' | 'reject') => void;
  handleManualInput: (index: number, value: string) => void;
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  trn,
  idx,
  currentDecision,
  manualInput,
  handleDecision,
  handleManualInput,
}) => (
  <div
    style={{
      backgroundColor: '#2d2d30',
      border: `2px solid ${currentDecision ? '#4EC9B0' : '#3c3c3c'}`,
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
        <h4 style={{ margin: '0 0 10px 0', color: '#DCDCAA' }}>🔍 Wyekstrahowane dane:</h4>
        <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#858585' }}>
          <div>Adres: {trn.extracted.fullAddress || 'NIE ZNALEZIONO'}</div>
          <div>Ulica: {trn.extracted.streetName || 'N/A'}</div>
          <div>Numer budynku: {trn.extracted.buildingNumber || 'N/A'}</div>
          <div>Numer mieszkania: {trn.extracted.apartmentNumber || 'NIE ZNALEZIONO'}</div>
          <div>Najemca: {trn.extracted.tenantName || 'N/A'}</div>
          {trn.extracted.reasoning && (
            <div style={{ marginTop: '10px', color: '#858585', fontStyle: 'italic' }}>
              AI: {trn.extracted.reasoning}
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
        </div>
      </div>
    )}

    {/* Decision Buttons */}
    <div style={{ marginTop: '15px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: '#C586C0' }}>✅ Decyzja:</h4>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        {/* Show Accept only when there's meaningful extracted data to accept */}
        {(trn.transactionType === 'expense' || (trn.transactionType === 'income' && trn.extracted.apartmentNumber)) && (
          <button
            onClick={() => handleDecision(trn.index, 'accept')}
            style={{
              padding: '10px 20px',
              backgroundColor: currentDecision?.action === 'accept' ? '#0e639c' : '#007acc',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontWeight: currentDecision?.action === 'accept' ? 'bold' : 'normal',
            }}
          >
            ✓ Akceptuj
          </button>
        )}
        <button
          onClick={() => handleDecision(trn.index, 'reject')}
          disabled={!!(manualInput && manualInput.trim().length > 0)}
          style={{
            padding: '10px 20px',
            backgroundColor: (manualInput && manualInput.trim().length > 0)
              ? '#555'
              : currentDecision?.action === 'reject' ? '#b71c1c' : '#d32f2f',
            color: (manualInput && manualInput.trim().length > 0) ? '#888' : 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: (manualInput && manualInput.trim().length > 0) ? 'not-allowed' : 'pointer',
            fontWeight: currentDecision?.action === 'reject' ? 'bold' : 'normal',
            opacity: (manualInput && manualInput.trim().length > 0) ? 0.5 : 1,
          }}
        >
          ✗ Oznacz jako nierozpoznane
        </button>
      </div>
      {manualInput && manualInput.trim().length > 0 && (
        <div style={{ fontSize: '12px', color: '#DCDCAA', marginBottom: '10px', fontStyle: 'italic' }}>
          ⚠ Usuń wpisany numer mieszkania, aby oznaczyć jako nierozpoznane
        </div>
      )}

      {/* Manual Input (only for income) */}
      {trn.transactionType === 'income' && (
        <div>
          <label style={{ display: 'block', marginBottom: '5px', color: '#C586C0' }}>
            Lub wpisz numer mieszkania ręcznie:
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
          {currentDecision.action === 'manual' && `✏️  Ręcznie wpisano: ${currentDecision.manualApartmentNumber}`}
        </div>
      )}
    </div>
  </div>
);

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
  const [manualInputs, setManualInputs] = useState<Map<number, string>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');

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
  };

  const handleManualInput = (index: number, value: string) => {
    const newManualInputs = new Map(manualInputs);
    newManualInputs.set(index, value);
    setManualInputs(newManualInputs);
    
    // Update decision
    const newDecisions = new Map(decisions);
    newDecisions.set(index, {
      index,
      action: 'manual',
      manualApartmentNumber: value,
    });
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
