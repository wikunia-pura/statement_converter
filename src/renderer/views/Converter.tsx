import React, { useState, useEffect, useRef } from 'react';
import { FileEntry, Bank, Adres, ConversionReviewData, ReviewDecision } from '../../shared/types';
import { translations, Language } from '../translations';
import { generateId } from '../../shared/utils';
import { TransactionReviewScreen } from '../components/TransactionReviewScreen';

interface SearchableAdresSelectProps {
  adresy: Adres[];
  selectedAdresId: number | null;
  onChange: (adresId: number | null) => void;
  placeholder: string;
  searchPlaceholder: string;
}

const SearchableAdresSelect: React.FC<SearchableAdresSelectProps> = ({ 
  adresy, 
  selectedAdresId, 
  onChange, 
  placeholder,
  searchPlaceholder 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(document.body.classList.contains('dark-mode'));
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.body.classList.contains('dark-mode'));
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    return () => observer.disconnect();
  }, []);

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

  // Theme colors
  const colors = isDarkMode ? {
    background: '#161b22',
    border: '#30363d',
    text: '#e0e0e0',
    textMuted: '#8b949e',
    hover: '#0d1117',
    selected: '#21262d'
  } : {
    background: '#fff',
    border: '#ddd',
    text: '#000',
    textMuted: '#999',
    hover: '#f8f8f8',
    selected: '#f0f0f0'
  };

  const selectedAdres = adresy.find(a => a.id === selectedAdresId);

  const filteredAdresy = adresy.filter(adres => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      adres.nazwa.toLowerCase().includes(search) ||
      (adres.alternativeNames && adres.alternativeNames.some(alt => alt.toLowerCase().includes(search)))
    );
  });

  const handleSelect = (adresId: number | null) => {
    onChange(adresId);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '6px 10px',
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: colors.background,
          minHeight: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ color: selectedAdres ? colors.text : colors.textMuted }}>
          {selectedAdres ? selectedAdres.nazwa : placeholder}
        </span>
        <span style={{ fontSize: '10px', color: colors.textMuted }}>▼</span>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: colors.background,
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            marginTop: '2px',
            maxHeight: '250px',
            overflow: 'hidden',
            zIndex: 1000,
            boxShadow: isDarkMode ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)'
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
              borderBottom: `1px solid ${colors.border}`,
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: colors.background,
              color: colors.text
            }}
          />
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            <div
              onClick={() => handleSelect(null)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                backgroundColor: selectedAdresId === null ? colors.selected : colors.background,
                borderBottom: `1px solid ${colors.border}`
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.hover}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedAdresId === null ? colors.selected : colors.background}
            >
              <em style={{ color: colors.textMuted }}>{placeholder}</em>
            </div>
            {filteredAdresy.map((adres) => (
              <div
                key={adres.id}
                onClick={() => handleSelect(adres.id)}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  backgroundColor: adres.id === selectedAdresId ? colors.selected : colors.background,
                  borderBottom: `1px solid ${colors.border}`
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.hover}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = adres.id === selectedAdresId ? colors.selected : colors.background}
              >
                <div style={{ color: colors.text }}>{adres.nazwa}</div>
                {adres.alternativeNames && adres.alternativeNames.length > 0 && (
                  <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '2px' }}>
                    {adres.alternativeNames.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {filteredAdresy.length === 0 && (
              <div style={{ padding: '8px 10px', color: colors.textMuted, textAlign: 'center' }}>
                Brak wyników
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ConverterProps {
  language: Language;
  files: FileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  selectedBank: number | null;
  setSelectedBank: React.Dispatch<React.SetStateAction<number | null>>;
}

const Converter: React.FC<ConverterProps> = ({ language, files, setFiles, selectedBank, setSelectedBank }) => {
  const t = translations[language];
  const [banks, setBanks] = useState<Bank[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [showAIWarningModal, setShowAIWarningModal] = useState(false);
  const [filesNeedingAI, setFilesNeedingAI] = useState<{fileName: string; fileId: string; totalTransactions: number; lowConfidenceCount: number}[]>([]);
  const [reviewData, setReviewData] = useState<ConversionReviewData | null>(null);
  const [conversionQueue, setConversionQueue] = useState<string[]>([]);
  const [skipUserApproval, setSkipUserApproval] = useState(false);
  const [outputFolder, setOutputFolder] = useState('');
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(document.body.classList.contains('dark-mode'));
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<FileEntry[]>(files);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Detect dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.body.classList.contains('dark-mode'));
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    return () => observer.disconnect();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openDropdownId]);

  useEffect(() => {
    loadBanks();
    loadAdresy();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      setSkipUserApproval(settings.skipUserApproval ?? false);
      setOutputFolder(settings.outputFolder ?? '');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadBanks = async () => {
    setIsLoading(true);
    try {
      const banksData = await window.electronAPI.getBanks();
      setBanks(banksData);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdresy = async () => {
    try {
      const adresyData = await window.electronAPI.getAdresy();
      setAdresy(adresyData);
    } catch (error) {
      console.error('Error loading addresses:', error);
    }
  };

  const checkForDuplicates = (newFiles: { fileName: string; filePath: string }[]) => {
    const existingFileNames = files.map(f => f.fileName.toLowerCase());
    const duplicates: string[] = [];
    const uniqueFiles: { fileName: string; filePath: string }[] = [];

    newFiles.forEach(file => {
      if (existingFileNames.includes(file.fileName.toLowerCase())) {
        duplicates.push(file.fileName);
      } else {
        uniqueFiles.push(file);
      }
    });

    return { duplicates, uniqueFiles };
  };

  const handleFileSelect = async () => {
    const selectedFiles = await window.electronAPI.selectFiles();
    if (selectedFiles.length > 0 && selectedBank) {
      const { duplicates, uniqueFiles } = checkForDuplicates(selectedFiles);
      
      if (duplicates.length > 0) {
        setDuplicateFiles(duplicates);
        setShowDuplicatesModal(true);
      }
      
      if (uniqueFiles.length > 0) {
        addFiles(uniqueFiles, selectedBank);
      }
    }
  };

  const addFiles = (newFiles: { fileName: string; filePath: string }[], bankId: number) => {
    const bank = banks.find((b) => b.id === bankId);
    const fileEntries: FileEntry[] = newFiles.map((file) => ({
      id: generateId(),
      fileName: file.fileName,
      filePath: file.filePath,
      bankId: bankId,
      bankName: bank?.name || null,
      adresId: null,
      status: 'pending',
    }));
    setFiles([...files, ...fileEntries]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (!selectedBank) {
      alert(t.pleaseSelectBank);
      return;
    }

    const droppedFiles = Array.from(e.dataTransfer.files).map((file) => ({
      fileName: file.name,
      filePath: (file as any).path,
    }));

    const { duplicates, uniqueFiles } = checkForDuplicates(droppedFiles);
    
    if (duplicates.length > 0) {
      setDuplicateFiles(duplicates);
      setShowDuplicatesModal(true);
    }
    
    if (uniqueFiles.length > 0) {
      addFiles(uniqueFiles, selectedBank);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleBankChange = (fileId: string, bankId: number) => {
    setFiles(
      files.map((file) => {
        if (file.id === fileId) {
          const bank = banks.find((b) => b.id === bankId);
          return { ...file, bankId, bankName: bank?.name || null };
        }
        return file;
      })
    );
  };

  const handleAdresChange = (fileId: string, adresId: number | null) => {
    setFiles(
      files.map((file) => 
        file.id === fileId ? { ...file, adresId } : file
      )
    );
  };

  const handleConvert = async (fileId: string) => {
    // Get file from ref to ensure we have latest state
    const currentFile = filesRef.current.find((f) => f.id === fileId);
    
    if (!currentFile || !currentFile.bankId || !currentFile.adresId) return;

    // First analyze file to check if AI is needed
    try {
      const summary = await window.electronAPI.analyzeFile(
        currentFile.filePath,
        currentFile.bankId,
        currentFile.adresId
      );

      // If AI is needed, show warning modal
      if (summary.needsAI) {
        setFilesNeedingAI([{
          fileName: currentFile.fileName,
          fileId: currentFile.id,
          totalTransactions: summary.totalTransactions,
          lowConfidenceCount: summary.lowConfidenceCount
        }]);
        setShowAIWarningModal(true);
        return;
      }

      // Otherwise proceed with normal conversion
      await performConversion(fileId, false);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.id === fileId
            ? { ...f, status: 'error' as const, errorMessage }
            : f
        )
      );
      alert(`Błąd analizy pliku: ${errorMessage}`);
    }
  };

  const handleFinalizeAndNext = async (decisions: ReviewDecision[]) => {
    if (!reviewData) return;
    
    try {
      const result = await window.electronAPI.finalizeConversion(
        reviewData.tempConversionId,
        decisions
      );

      if (result.success) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.fileName === reviewData.fileName
              ? {
                  ...f,
                  status: 'success' as const,
                  outputPath: result.outputPath,
                  errorMessage: result.duplicateWarning
                    ? t.fileExistsTimestamp
                    : undefined,
                }
              : f
          )
        );
        setReviewData(null);
        processNextInQueue();
      } else {
        alert(`${t.conversionFailed}: ${result.error}\n${t.checkBankConverter}`);
        setReviewData(null);
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.fileName === reviewData.fileName
              ? { ...f, status: 'error' as const, errorMessage: result.error }
              : f
          )
        );
        processNextInQueue();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.conversionFailed}: ${errorMessage}`);
      setReviewData(null);
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.fileName === reviewData.fileName
            ? { ...f, status: 'error' as const, errorMessage }
            : f
        )
      );
      processNextInQueue();
    }
  };

  const handleFinalizeAndStop = async (decisions: ReviewDecision[]) => {
    if (!reviewData) return;
    
    try {
      const result = await window.electronAPI.finalizeConversion(
        reviewData.tempConversionId,
        decisions
      );

      if (result.success) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.fileName === reviewData.fileName
              ? {
                  ...f,
                  status: 'success' as const,
                  outputPath: result.outputPath,
                  errorMessage: result.duplicateWarning
                    ? t.fileExistsTimestamp
                    : undefined,
                }
              : f
          )
        );
        setReviewData(null);
        // Stop processing - clear queue
        setConversionQueue([]);
        setIsProcessingQueue(false);
      } else {
        alert(`${t.conversionFailed}: ${result.error}\n${t.checkBankConverter}`);
        setReviewData(null);
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.fileName === reviewData.fileName
              ? { ...f, status: 'error' as const, errorMessage: result.error }
              : f
          )
        );
        setConversionQueue([]);
        setIsProcessingQueue(false);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.conversionFailed}: ${errorMessage}`);
      setReviewData(null);
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.fileName === reviewData.fileName
            ? { ...f, status: 'error' as const, errorMessage }
            : f
        )
      );
      setConversionQueue([]);
      setIsProcessingQueue(false);
    }
  };

  const handleSkipFile = () => {
    if (!reviewData) return;
    
    // Mark file as pending so user can try again later
    setFiles((prevFiles) =>
      prevFiles.map((f) =>
        f.fileName === reviewData.fileName
          ? { ...f, status: 'pending' as const, errorMessage: undefined }
          : f
      )
    );
    
    setReviewData(null);
    processNextInQueue();
  };

  const handleCancelReview = () => {
    if (!reviewData) return;
    
    // Revert file status back to pending so user can try again
    setFiles((prevFiles) =>
      prevFiles.map((f) =>
        f.fileName === reviewData.fileName
          ? { ...f, status: 'pending' as const, errorMessage: undefined }
          : f
      )
    );
    
    setReviewData(null);
    
    // Clear queue and stop processing
    setConversionQueue([]);
    setIsProcessingQueue(false);
  };

  const processNextInQueue = () => {
    setConversionQueue((prevQueue) => {
      if (prevQueue.length === 0) {
        setIsProcessingQueue(false);
        return [];
      }
      
      const [nextFileId, ...remainingQueue] = prevQueue;
      
      // Process next file in background
      setTimeout(() => {
        performConversion(nextFileId, false);
      }, 100);
      
      return remainingQueue;
    });
  };

  const performConversion = async (fileId: string, useAI: boolean) => {
    // Get file from ref to ensure we have latest state
    const currentFile = filesRef.current.find((f) => f.id === fileId);
    
    if (!currentFile || !currentFile.bankId || !currentFile.adresId) return;

    // Update status to processing
    setFiles((prevFiles) =>
      prevFiles.map((f) => (f.id === fileId ? { ...f, status: 'processing' as const } : f))
    );

    const startTime = Date.now();

    try {
      const result = useAI
        ? await window.electronAPI.convertFileWithAI(
            currentFile.filePath,
            currentFile.bankId,
            currentFile.fileName,
            currentFile.adresId
          )
        : await window.electronAPI.convertFile(
            currentFile.filePath,
            currentFile.bankId,
            currentFile.fileName,
            currentFile.adresId
          );

      // Ensure minimum 1 second display time for loader
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsed);
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }

      // Check if review is needed
      if (result.needsReview && result.reviewData) {
        // If skipUserApproval is enabled, auto-finalize without showing review screen
        if (skipUserApproval) {
          // Auto-approve all transactions
          const autoDecisions: ReviewDecision[] = result.reviewData.transactions.map(tx => ({
            index: tx.index,
            action: 'accept' as const,
          }));
          
          try {
            const finalizeResult = await window.electronAPI.finalizeConversion(
              result.reviewData.tempConversionId,
              autoDecisions
            );
            
            if (finalizeResult.success) {
              setFiles((prevFiles) =>
                prevFiles.map((f) =>
                  f.id === fileId
                    ? {
                        ...f,
                        status: 'success' as const,
                        outputPath: finalizeResult.outputPath,
                        errorMessage: finalizeResult.duplicateWarning
                          ? t.fileExistsTimestamp
                          : undefined,
                      }
                    : f
                )
              );
            } else {
              setFiles((prevFiles) =>
                prevFiles.map((f) =>
                  f.id === fileId
                    ? { ...f, status: 'error' as const, errorMessage: finalizeResult.error }
                    : f
                )
              );
            }
            processNextInQueue();
            return;
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setFiles((prevFiles) =>
              prevFiles.map((f) =>
                f.id === fileId
                  ? { ...f, status: 'error' as const, errorMessage }
                  : f
              )
            );
            processNextInQueue();
            return;
          }
        }
        
        // Show review screen if skipUserApproval is disabled
        setReviewData(result.reviewData);
        // Keep status as processing to show file is being handled
        return;
      }

      if (result.success) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: 'success' as const,
                  outputPath: result.outputPath,
                  errorMessage: result.duplicateWarning
                    ? t.fileExistsTimestamp
                    : undefined,
                }
              : f
          )
        );
        
        // Process next file in queue if no review was needed
        processNextInQueue();
      } else {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId
              ? { ...f, status: 'error' as const, errorMessage: result.error }
              : f
          )
        );
        alert(`${t.conversionFailed}: ${result.error}\n${t.checkBankConverter}`);
        
        // Process next file even on error
        processNextInQueue();
      }
    } catch (error: unknown) {
      // Ensure minimum 1 second display time for loader even on error
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsed);
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.id === fileId
            ? { ...f, status: 'error' as const, errorMessage }
            : f
        )
      );
      alert(`${t.conversionFailed}: ${errorMessage}`);
      
      // Process next file even on error
      processNextInQueue();
    }
  };

  const handleConvertAll = async () => {
    // Get files that need conversion from current ref state
    const filesToConvert = filesRef.current
      .filter((f) => (f.status === 'pending' || f.status === 'error') && f.bankId);
    
    if (filesToConvert.length === 0) return;

    // Analyze all files first
    const analysisResults: {fileName: string; fileId: string; totalTransactions: number; lowConfidenceCount: number}[] = [];
    
    for (const file of filesToConvert) {
      try {
        const summary = await window.electronAPI.analyzeFile(
          file.filePath,
          file.bankId!,
          file.adresId
        );

        if (summary.needsAI) {
          analysisResults.push({
            fileName: file.fileName,
            fileId: file.id,
            totalTransactions: summary.totalTransactions,
            lowConfidenceCount: summary.lowConfidenceCount
          });
        }
      } catch (error) {
        console.error(`Error analyzing ${file.fileName}:`, error);
      }
    }

    // If any files need AI, show warning modal
    if (analysisResults.length > 0) {
      setFilesNeedingAI(analysisResults);
      setShowAIWarningModal(true);
      return;
    }

    // Convert files sequentially - start with first, rest go to queue
    setIsProcessingQueue(true);
    if (filesToConvert.length > 0) {
      const [firstFile, ...restFiles] = filesToConvert;
      setConversionQueue(restFiles.map(f => f.id));
      await performConversion(firstFile.id, false);
    }
  };

  const handleProceedWithAI = async (fileIds: string[]) => {
    setShowAIWarningModal(false);
    // Convert files sequentially - start with first, rest go to queue
    setIsProcessingQueue(true);
    if (fileIds.length > 0) {
      const [firstFile, ...restFiles] = fileIds;
      setConversionQueue(restFiles);
      await performConversion(firstFile, true);
    }
  };

  const handleSkipAI = async (fileIds: string[]) => {
    setShowAIWarningModal(false);
    // Convert files sequentially without AI
    setIsProcessingQueue(true);
    if (fileIds.length > 0) {
      const [firstFile, ...restFiles] = fileIds;
      setConversionQueue(restFiles);
      await performConversion(firstFile, false);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles(files.filter((f) => f.id !== fileId));
  };

  const handleClearAll = () => {
    setFiles([]);
  };

  const handleOpenFile = async (fileId: string, type: 'preview' | 'accounting') => {
    const file = files.find((f) => f.id === fileId);
    if (file && file.status === 'success' && file.outputPath) {
      const suffix = type === 'preview' ? '-podglad.txt' : '-accounting.txt';
      const filePath = file.outputPath.replace(/\.txt$/i, suffix);
      
      const success = await window.electronAPI.openFile(filePath);
      if (!success) {
        alert(t.fileNotFound);
      }
    } else {
      alert(t.fileNotFound);
    }
    setOpenDropdownId(null);
  };

  return (
    <div className="content-body">
        {isLoading ? (
          <div className="card">
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              Loading...
            </div>
          </div>
        ) : !selectedBank ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🏦</div>
            <h2 style={{ marginBottom: '10px', fontSize: '24px', color: '#667eea' }}>
              {t.selectBank}
            </h2>
            <p style={{ color: '#7b87a1', marginBottom: '30px', fontSize: '16px' }}>
              Wybierz bank, aby rozpocząć konwersję plików
            </p>
            <div style={{ maxWidth: '400px', margin: '0 auto' }}>
              <select
                value={selectedBank || ''}
                onChange={(e) => setSelectedBank(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  fontSize: '16px',
                  borderRadius: '12px',
                  border: '2px solid #e8ecf1',
                  cursor: 'pointer',
                }}
              >
                <option value="">{t.chooseBank}</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#667eea' }}>{t.addFiles}</h2>
            <div className="bank-selector-inline">
              <label style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px', display: 'block' }}>
                {t.selectBank}
              </label>
              <select
                value={selectedBank || ''}
                onChange={(e) => setSelectedBank(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  borderRadius: '10px',
                  border: '2px solid #e8ecf1',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleFileSelect}
          >
            <div className="drop-zone-icon">📁</div>
            <div className="drop-zone-text">
              {t.dragDropFiles}
            </div>
          </div>
        </div>

        {files.length > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2>{t.files}</h2>
              <div className="button-group" style={{ margin: 0 }}>
                <button 
                  className="button button-secondary"
                  onClick={() => outputFolder && window.electronAPI.openFile(outputFolder)}
                  disabled={!outputFolder}
                  title={outputFolder || 'Folder wyjściowy nie został skonfigurowany'}
                >
                  📂 {t.openOutputFolder}
                </button>
                <button 
                  className="button button-success" 
                  onClick={handleConvertAll}
                  disabled={files.every(f => f.status === 'success') || files.some(f => !f.adresId)}
                  title={
                    files.every(f => f.status === 'success') 
                      ? 'Wszystkie pliki są już skonwertowane' 
                      : files.some(f => !f.adresId) 
                      ? 'Niektóre pliki nie mają wybranego adresu' 
                      : ''
                  }
                  style={(files.every(f => f.status === 'success') || files.some(f => !f.adresId)) ? { 
                    opacity: 0.5, 
                    cursor: 'not-allowed' 
                  } : {}}
                >
                  {t.convertAll}
                </button>
                <button className="button button-secondary" onClick={handleClearAll}>
                  {t.clearAll}
                </button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t.fileName}</th>
                  <th>{t.bank}</th>
                  <th>{t.adres}</th>
                  <th>{t.status}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => (
                  <tr key={file.id} className={file.status === 'processing' ? 'processing-row' : ''}>
                    {file.status === 'processing' ? (
                      <td colSpan={6}>
                        <div className="processing-loader">
                          <div className="loader-spinner"></div>
                          <div className="loader-content">
                            <span className="loader-text">Przetwarzanie pliku: <strong>{file.fileName}</strong></span>
                            <span className="loader-subtext">Proszę czekać...</span>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>{index + 1}</td>
                        <td>{file.fileName}</td>
                        <td>
                          <select
                            value={file.bankId || ''}
                            onChange={(e) => handleBankChange(file.id, Number(e.target.value))}
                          >
                            <option value="">{t.chooseBank}</option>
                            {banks.map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                {bank.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <SearchableAdresSelect
                            adresy={adresy}
                            selectedAdresId={file.adresId}
                            onChange={(adresId) => handleAdresChange(file.id, adresId)}
                            placeholder={t.chooseAdres}
                            searchPlaceholder={t.searchAdres}
                          />
                        </td>
                        <td>
                          <span
                            className={`status-badge status-${
                              file.status === 'success'
                                ? 'success'
                                : file.status === 'error'
                                ? 'error'
                                : 'pending'
                            }`}
                          >
                            {file.status === 'success' ? t.success : file.status === 'error' ? t.error : t.pending}
                          </span>
                          {file.errorMessage && (
                            <div 
                              style={{ 
                                fontSize: '12px', 
                                color: '#7f8c8d', 
                                marginTop: '10px',
                                cursor: 'pointer',
                                wordBreak: 'break-word'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(file.errorMessage || '');
                                alert('Błąd skopiowany do schowka');
                              }}
                              title="Kliknij aby skopiować błąd"
                            >
                              {file.errorMessage}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {file.status === 'success' && (
                              <>
                                <div style={{ position: 'relative' }} ref={openDropdownId === file.id ? dropdownRef : undefined}>
                                  <button
                                    className="button button-small button-primary"
                                    onClick={() => setOpenDropdownId(openDropdownId === file.id ? null : file.id)}
                                  >
                                    {t.open} ▾
                                  </button>
                                  {openDropdownId === file.id && (
                                    <div style={{
                                      position: 'absolute',
                                      top: '100%',
                                      left: 0,
                                      zIndex: 1000,
                                      background: isDarkMode ? '#161b22' : '#fff',
                                      border: `1px solid ${isDarkMode ? '#30363d' : '#ddd'}`,
                                      borderRadius: '4px',
                                      boxShadow: isDarkMode ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.15)',
                                      minWidth: '120px',
                                      marginTop: '2px',
                                    }}>
                                      <button
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '8px 12px',
                                          border: 'none',
                                          background: 'none',
                                          textAlign: 'left',
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          color: isDarkMode ? '#c9d1d9' : 'inherit',
                                        }}
                                        onClick={() => handleOpenFile(file.id, 'preview')}
                                        onMouseEnter={(e) => e.currentTarget.style.background = isDarkMode ? '#30363d' : '#f5f5f5'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        📄 {t.openPreview}
                                      </button>
                                      <button
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '8px 12px',
                                          border: 'none',
                                          background: 'none',
                                          textAlign: 'left',
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          color: isDarkMode ? '#c9d1d9' : 'inherit',
                                        }}
                                        onClick={() => handleOpenFile(file.id, 'accounting')}
                                        onMouseEnter={(e) => e.currentTarget.style.background = isDarkMode ? '#30363d' : '#f5f5f5'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        📊 {t.openAccounting}
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <button
                                  className="button button-small button-secondary"
                                  onClick={() => handleConvert(file.id)}
                                >
                                  {t.convertAgain}
                                </button>
                              </>
                            )}
                            {(file.status === 'pending' || file.status === 'error') && (
                              <button
                                className="button button-small button-success"
                                onClick={() => handleConvert(file.id)}
                                disabled={!file.bankId || !file.adresId}
                                title={!file.bankId ? 'Wybierz bank' : !file.adresId ? 'Wybierz adres' : ''}
                                style={(!file.bankId || !file.adresId) ? { 
                                  opacity: 0.5, 
                                  cursor: 'not-allowed' 
                                } : {}}
                              >
                                {t.convert}
                              </button>
                            )}
                            <button
                              className="button button-small button-danger"
                              onClick={() => handleRemoveFile(file.id)}
                            >
                              {t.remove}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {files.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-text">{t.noFilesAdded}</div>
          </div>
        )}
          </>
        )}

        {/* Transaction Review Screen */}
        {reviewData && (
          <TransactionReviewScreen
            reviewData={reviewData}
            language={language}
            hasMoreFiles={conversionQueue.length > 0}
            remainingCount={conversionQueue.length}
            onFinalizeAndNext={handleFinalizeAndNext}
            onFinalizeAndStop={handleFinalizeAndStop}
            onSkip={handleSkipFile}
            onCancel={handleCancelReview}
          />
        )}

        {/* AI Warning Modal */}
        {showAIWarningModal && (
          <div className="modal-overlay" onClick={() => setShowAIWarningModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 style={{ margin: 0 }}>😱 O Cie Huj</h2>
              </div>
              <div className="modal-body" style={{ padding: '20px' }}>
                <p style={{ marginBottom: '15px', fontSize: '14px', color: '#6c757d' }}>
                  Niektóre transakcje mają bardzo niską pewność rozpoznania (poniżej 60%) i będą wymagać ręcznej weryfikacji.
                </p>
                <div style={{
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '8px',
                  padding: '15px',
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {filesNeedingAI.map((file, index) => (
                    <div key={index} style={{
                      padding: '12px',
                      marginBottom: '10px',
                      background: 'white',
                      borderRadius: '4px',
                      fontSize: '13px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>📄</span>
                          <span style={{ fontWeight: '600', fontSize: '14px' }}>{file.fileName}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="button button-small button-success"
                            onClick={() => {
                              setShowAIWarningModal(false);
                              performConversion(file.fileId, true);
                            }}
                          >
                            🤖 Użyj AI
                          </button>
                          <button
                            className="button button-small button-secondary"
                            onClick={() => {
                              setShowAIWarningModal(false);
                              performConversion(file.fileId, false);
                            }}
                          >
                            Bez AI
                          </button>
                        </div>
                      </div>
                      <div style={{ paddingLeft: '24px', fontSize: '12px', color: '#6c757d' }}>
                        <div>Transakcje: {file.totalTransactions}</div>
                        <div style={{ color: '#dc3545', fontWeight: '500' }}>
                          Wymaga weryfikacji (confidence {'<'} 60%): {file.lowConfidenceCount}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer" style={{ padding: '15px 20px', borderTop: '1px solid #e8ecf1', display: 'flex', justifyContent: 'space-between' }}>
                <button 
                  className="button button-secondary" 
                  onClick={() => setShowAIWarningModal(false)}
                >
                  Zamknij
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    className="button button-secondary" 
                    onClick={() => handleSkipAI(filesNeedingAI.map(f => f.fileId))}
                  >
                    Bez AI dla wszystkich
                  </button>
                  <button 
                    className="button button-success" 
                    onClick={() => handleProceedWithAI(filesNeedingAI.map(f => f.fileId))}
                  >
                    Użyj AI dla wszystkich
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Duplicates Modal */}
        {showDuplicatesModal && (
          <div className="modal-overlay" onClick={() => setShowDuplicatesModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 style={{ margin: 0 }}>⚠️ Wykryto duplikaty</h2>
              </div>
              <div className="modal-body" style={{ padding: '20px' }}>
                <p style={{ marginBottom: '15px', fontSize: '14px', color: '#6c757d' }}>
                  Następujące pliki zostały już dodane do listy i nie zostaną dodane ponownie:
                </p>
                <div style={{
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '8px',
                  padding: '15px',
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {duplicateFiles.map((fileName, index) => (
                    <div key={index} style={{
                      padding: '8px 12px',
                      marginBottom: '8px',
                      background: 'white',
                      borderRadius: '4px',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '16px' }}>📄</span>
                      <span style={{ fontWeight: '500' }}>{fileName}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer" style={{ padding: '15px 20px', borderTop: '1px solid #e8ecf1', display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  className="button button-primary" 
                  onClick={() => setShowDuplicatesModal(false)}
                >
                  Rozumiem
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default Converter;
