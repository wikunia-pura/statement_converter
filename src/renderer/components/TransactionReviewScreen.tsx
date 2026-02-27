import React, { useState } from 'react';
import { ConversionReviewData, ReviewDecision, TransactionForReview } from '../../shared/types';

interface TransactionReviewScreenProps {
  reviewData: ConversionReviewData;
  onFinalize: (decisions: ReviewDecision[]) => Promise<void>;
  onCancel: () => void;
}

export const TransactionReviewScreen: React.FC<TransactionReviewScreenProps> = ({
  reviewData,
  onFinalize,
  onCancel,
}) => {
  const [decisions, setDecisions] = useState<Map<number, ReviewDecision>>(new Map());
  const [manualInputs, setManualInputs] = useState<Map<number, string>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleFinalize = async () => {
    setIsProcessing(true);
    try {
      // Convert decisions map to array
      const decisionsArray = Array.from(decisions.values());
      await onFinalize(decisionsArray);
    } finally {
      setIsProcessing(false);
    }
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
      </div>

      {/* Transactions list */}
      <div style={{ padding: '20px' }}>
        {reviewData.transactions.map((trn, idx) => {
          const currentDecision = decisions.get(trn.index);
          const manualInput = manualInputs.get(trn.index);
          
          return (
            <div
              key={trn.index}
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
                <h3 style={{ margin: 0, color: trn.transactionType === 'income' ? '#4EC9B0' : '#CE9178' }}>
                  Transakcja #{idx + 1} ({trn.transactionType === 'income' ? 'WPŁATA' : 'WYDATEK'})
                </h3>
                <span style={{ 
                  color: '#858585', 
                  fontSize: '14px',
                }}>
                  Confidence: {trn.extracted.confidence}%
                </span>
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
                  <button
                    onClick={() => handleDecision(trn.index, 'reject')}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: currentDecision?.action === 'reject' ? '#b71c1c' : '#d32f2f',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontWeight: currentDecision?.action === 'reject' ? 'bold' : 'normal',
                    }}
                  >
                    ✗ Odrzuć
                  </button>
                </div>

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
                    {currentDecision.action === 'reject' && '✗ Odrzucono - będzie oznaczone jako NIEROZPOZNANE'}
                    {currentDecision.action === 'manual' && `✏️  Ręcznie wpisano: ${currentDecision.manualApartmentNumber}`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
            Anuluj
          </button>
          <button
            onClick={handleFinalize}
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
            {isProcessing ? 'Przetwarzanie...' : 'Zakończ i Generuj Pliki'}
          </button>
        </div>
      </div>
    </div>
  );
};
