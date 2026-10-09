import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileEntry, Bank, Adres, KontoTyp, ConversionReviewData, ReviewDecision, ConversionHistory, KsiegowanieUwaga } from '../../shared/types';
import { translations, Language } from '../translations';
import { generateId, formatDate } from '../../shared/utils';
import { TransactionReviewScreen } from '../components/TransactionReviewScreen';
import { useNotify } from '../components/Notifications';
import Icon from '../components/Icon';
import Loader from '../components/Loader';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import OverflowMenu from '../components/OverflowMenu';
import Select from '../components/Select';
import { FormSection } from '../components/FormSection';
import SearchableSelect from '../components/SearchableSelect';
import { findAdresByAccountNumbers, normalizeAccount } from '../../shared/account-extractor';
import { resolveOutputFilePath } from '../../shared/outputPaths';
import ConversionHistoryTimeline from '../components/ConversionHistoryTimeline';
import { PostingNoteNotice, PostingNoteNoticeItem, uwagaMeta } from '../components/PostingNotes';
import { openUwagiByAdresId } from '../../shared/bookings';
import { plural } from '../plural';

interface SearchableAdresSelectProps {
  adresy: Adres[];
  selectedAdresId: number | null;
  onChange: (adresId: number | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  /** When set, only addresses linked to this bankId (or unlinked addresses) are shown. */
  bankFilter?: number | null;
  disabled?: boolean;
}

/**
 * The community picker of a file row — the app's SearchableSelect, searching by
 * name and by every alternative spelling (shown as the option's second line).
 */
const SearchableAdresSelect: React.FC<SearchableAdresSelectProps> = ({
  adresy,
  selectedAdresId,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  bankFilter,
  disabled = false,
}) => {
  // Bank-scoped: if a bank is chosen for the file, only show addresses linked to that bank
  // plus addresses with no bank link (which act as "any bank"). If no bank is chosen, show all.
  const options = useMemo(
    () => [
      { value: '', label: placeholder },
      ...(bankFilter ? adresy.filter((a) => !a.bankId || a.bankId === bankFilter) : adresy).map((a) => ({
        value: String(a.id),
        label: a.nazwa,
        hint: a.alternativeNames && a.alternativeNames.length > 0 ? a.alternativeNames.join(', ') : undefined,
        keywords: (a.alternativeNames ?? []).join(' '),
      })),
    ],
    [adresy, bankFilter, placeholder],
  );
  return (
    <SearchableSelect
      overlay
      value={selectedAdresId != null ? String(selectedAdresId) : ''}
      options={options}
      onChange={(v) => onChange(v ? Number(v) : null)}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      ariaLabel={placeholder}
      menuMinWidth={280}
      disabled={disabled}
    />
  );
};

interface ConverterProps {
  language: Language;
  files: FileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  selectedBank: number | null;
  setSelectedBank: React.Dispatch<React.SetStateAction<number | null>>;
  /** Called when the user clicks "+ Add address with this account" — App.tsx switches to the Adresy view with the account pre-filled in the new-adres modal. */
  onAddAdresWithAccount?: (accountNumber: string) => void;
  /** Called when the user clicks "Full history" in the recent-activity panel — App.tsx switches to the History view. */
  onNavigateToHistory?: () => void;
  /**
   * Shown inside the dashboard's conversion dialog: the files arrive already
   * recognised (community, bank, account type, PDF), so the bank picker, the
   * drop zone and the recent-activity panel give way to the list alone.
   */
  embedded?: boolean;
}

const Converter: React.FC<ConverterProps> = ({ language, files, setFiles, selectedBank, setSelectedBank, onAddAdresWithAccount, onNavigateToHistory, embedded = false }) => {
  const t = translations[language];
  const notify = useNotify();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [kontoTypy, setKontoTypy] = useState<KontoTyp[]>([]);
  const [conversionHistory, setConversionHistory] = useState<ConversionHistory[]>([]);
  // The dashboard's conversion records — what "already processed" is judged by.
  // Not the history log: clearing that must not switch the warning off.
  const [conversionRecords, setConversionRecords] = useState<ConversionHistory[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [reviewData, setReviewData] = useState<ConversionReviewData | null>(null);
  const [conversionQueue, setConversionQueue] = useState<string[]>([]);
  const [skipUserApproval, setSkipUserApproval] = useState(false);
  // Whether conversions call the AI. Read once from settings; the whole queue
  // runs on the same value, so a file can no longer silently fall back to the
  // non-AI path just because it wasn't first in line.
  const [alwaysUseAI, setAlwaysUseAI] = useState(true);
  const [outputFolder, setOutputFolder] = useState('');
  const [, setIsProcessingQueue] = useState(false);
  // Files whose "Anuluj" was pressed and whose conversion has not stopped yet.
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [progressByFile, setProgressByFile] = useState<Record<string, { label: string; percent: number }>>({});
  // Open "uwagi do księgowania" (notes the team left on a community), read from
  // the dashboard's table. They are re-read whenever an address is recognised or
  // picked — a note written a minute ago by a colleague must still be seen.
  const [openUwagi, setOpenUwagi] = useState<KsiegowanieUwaga[]>([]);
  const openUwagiRef = useRef<KsiegowanieUwaga[]>([]);
  const [noteNotices, setNoteNotices] = useState<PostingNoteNoticeItem[]>([]);
  // Notes already announced in a message this session; the message is shown once
  // per note, while the callout under the address stays as long as it is open.
  const announcedUwagiRef = useRef<Set<number>>(new Set());
  const filesRef = useRef<FileEntry[]>(files);
  // Read from the queue callback, which outlives the render that scheduled it.
  const alwaysUseAIRef = useRef(alwaysUseAI);

  // Keep ref in sync with state
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    alwaysUseAIRef.current = alwaysUseAI;
  }, [alwaysUseAI]);

  // Heartbeat: while a review screen is open, keep its pending conversion alive
  // in the main-process cache (sliding expiration) so a long or interrupted
  // review never expires and loses the user's work.
  useEffect(() => {
    if (!reviewData?.tempConversionId || !window.electronAPI?.touchConversion) return;
    const id = reviewData.tempConversionId;
    // Touch immediately, then every 60s. TTL is hours, so this is comfortably frequent.
    window.electronAPI.touchConversion(id).catch(() => { /* ignore */ });
    const interval = setInterval(() => {
      window.electronAPI.touchConversion(id).catch(() => { /* ignore */ });
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [reviewData?.tempConversionId]);

  // Subscribe to conversion progress events from main process
  useEffect(() => {
    if (!window.electronAPI?.onConversionProgress) return;
    const unsubscribe = window.electronAPI.onConversionProgress((p) => {
      setProgressByFile((prev) => ({
        ...prev,
        [p.fileName]: { label: p.label, percent: p.percent },
      }));
    });
    return () => {
      try { unsubscribe?.(); } catch { /* ignore */ }
    };
  }, []);

  // Drop progress entries for files no longer in 'processing' state
  useEffect(() => {
    const processingNames = new Set(
      files.filter((f) => f.status === 'processing').map((f) => f.fileName),
    );
    setProgressByFile((prev) => {
      const next: typeof prev = {};
      for (const [name, value] of Object.entries(prev)) {
        if (processingNames.has(name)) next[name] = value;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [files]);

  useEffect(() => {
    loadBanks();
    loadAdresy();
    void loadUwagi();
    loadKontoTypy();
    loadSettings();
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const [data, records] = await Promise.all([
        window.electronAPI.getHistory(),
        window.electronAPI.getKsiegowaniaKonwersje().catch(() => null),
      ]);
      setConversionHistory(data);
      setConversionRecords(records ?? data);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  // Keep the recent-activity panel in sync: every conversion (success or error)
  // is written to history server-side, so reload whenever a file finishes.
  const completedFileCount = useMemo(
    () => files.filter((f) => f.status === 'success' || f.status === 'error').length,
    [files]
  );
  useEffect(() => {
    if (completedFileCount > 0) loadHistory();
  }, [completedFileCount]);

  // Map of previously-processed input files → most recent successful conversion date.
  // Keyed by lowercased file name so an uploaded file can be flagged if it was already
  // converted before (guards against accidentally booking the same statement twice).
  const processedFileDates = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of conversionRecords) {
      if (entry.status !== 'success') continue;
      const key = entry.fileName.toLowerCase();
      const existing = map.get(key);
      if (!existing || new Date(entry.convertedAt).getTime() > new Date(existing).getTime()) {
        map.set(key, entry.convertedAt);
      }
    }
    return map;
  }, [conversionRecords]);

  // Recent activity panel: only the last 30 days, so the converter view stays
  // a quick reference without turning into the full History view.
  const recentHistory = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return conversionHistory.filter((entry) => new Date(entry.convertedAt).getTime() >= cutoff);
  }, [conversionHistory]);

  const loadKontoTypy = async () => {
    try {
      const data = await window.electronAPI.getKontoTypy();
      setKontoTypy(data);
    } catch (error) {
      console.error('Error loading konto typy:', error);
    }
  };

  /**
   * Resolve the account type for a file: prefer the type of the address account
   * that matches one of the file's detected account numbers; fall back to the
   * default type (or the first configured type).
   */
  const resolveAccountTypeId = (
    adresId: number | null,
    detectedAccounts: string[] | undefined,
  ): number | null => {
    const defaultTypeId = kontoTypy.find((k) => k.isDefault)?.id ?? kontoTypy[0]?.id ?? null;
    const adres = adresy.find((a) => a.id === adresId);
    if (!adres) return defaultTypeId;
    const normDetected = (detectedAccounts ?? [])
      .map(normalizeAccount)
      .filter((x): x is string => !!x);
    const matchedAccount = (adres.accountNumbers ?? []).find((acc) => normDetected.includes(acc));
    const typeId = matchedAccount ? adres.accountTypes?.[matchedAccount] : undefined;
    return typeId ?? defaultTypeId;
  };

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      setSkipUserApproval(settings.skipUserApproval ?? false);
      setAlwaysUseAI(settings.alwaysUseAI !== false);
      setOutputFolder(settings.outputFolder ?? '');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadBanks = async () => {
    setIsLoading(true);
    try {
      const banksData = await window.electronAPI.getBanks();
      // Konwersja działa tylko dla banków z przypisanym konwerterem — banki używane wyłącznie w Homebankingu nie powinny pojawiać się tu w dropdownach.
      setBanks(banksData.filter((b) => !!b.converterId));
    } finally {
      setIsLoading(false);
    }
  };

  /** Open notes, fresh from the table; on failure, whatever was last known. */
  const loadUwagi = async (): Promise<KsiegowanieUwaga[]> => {
    try {
      const open = (await window.electronAPI.getKsiegowaniaUwagi()).filter((u) => !u.resolvedAt);
      openUwagiRef.current = open;
      setOpenUwagi(open);
      return open;
    } catch {
      return openUwagiRef.current; // a missing note list must never stop a conversion
    }
  };

  /**
   * Raise the message for communities that were just recognised (or picked) and
   * have notes not yet announced. Everything announced here is remembered, so
   * dropping a second statement of the same community does not repeat itself.
   */
  const announceUwagi = (adresIds: (number | null)[], open: KsiegowanieUwaga[], adresyList: Adres[]) => {
    const byAdres = openUwagiByAdresId(adresyList, open);
    const items: PostingNoteNoticeItem[] = [];
    for (const id of new Set(adresIds.filter((x): x is number => x !== null))) {
      const adres = adresyList.find((a) => a.id === id);
      const unseen = (byAdres.get(id) ?? []).filter((u) => !announcedUwagiRef.current.has(u.id));
      if (!adres || unseen.length === 0) continue;
      unseen.forEach((u) => announcedUwagiRef.current.add(u.id));
      items.push({ adresId: id, adresNazwa: adres.nazwa, uwagi: unseen });
    }
    if (items.length > 0) setNoteNotices((prev) => [...prev, ...items]);
  };

  /** "Sprawa rozwiązana" — the same act as on the dashboard, one click from the file. */
  const resolveUwaga = async (id: number) => {
    try {
      await window.electronAPI.setKsiegowanieUwagaResolved(id, true);
      await loadUwagi();
      notify.success(t.convNoteResolved);
    } catch {
      notify.error(t.ksUwagaError);
    }
  };

  const uwagiByAdres = useMemo(() => openUwagiByAdresId(adresy, openUwagi), [adresy, openUwagi]);

  const formatNoteDate = (iso: string): string =>
    new Date(iso).toLocaleString(language === 'en' ? 'en-GB' : 'pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

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

  const addFiles = async (newFiles: { fileName: string; filePath: string }[], bankId: number) => {
    const bank = banks.find((b) => b.id === bankId);

    // Separate PDFs from conversion files
    const pdfFiles: { fileName: string; filePath: string }[] = [];
    const conversionFiles: { fileName: string; filePath: string }[] = [];

    for (const file of newFiles) {
      if (file.fileName.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(file);
      } else {
        conversionFiles.push(file);
      }
    }

    // Build a map of PDF base names for quick lookup
    const pdfByBaseName = new Map<string, string>();
    for (const pdf of pdfFiles) {
      const baseName = pdf.fileName.replace(/\.pdf$/i, '').toLowerCase();
      pdfByBaseName.set(baseName, pdf.filePath);
    }

    // Detect community accounts in parallel for all dropped conversion files.
    // Detection is best-effort and never throws — failures yield [], which simply
    // leaves the row's adres empty (same as the pre-existing behavior).
    const detections = await Promise.all(
      conversionFiles.map(async (file) => {
        try {
          return await window.electronAPI.detectAccountNumbers(file.filePath, bankId);
        } catch {
          return [] as string[];
        }
      }),
    );

    // Read the notes now, so the message below reflects what the team wrote up to
    // this moment and not what was there when the view was opened.
    const freshUwagi = await loadUwagi();

    // Create file entries, auto-pairing PDFs by matching base name
    const fileEntries: FileEntry[] = conversionFiles.map((file, idx) => {
      const baseName = file.fileName.replace(/\.[^.]+$/, '').toLowerCase();
      const matchedPdf = pdfByBaseName.get(baseName);
      if (matchedPdf) pdfByBaseName.delete(baseName);

      const detectedAccounts = detections[idx] ?? [];
      // Resolve detected accounts → an Adres. Bank-scoped, mirroring the dropdown.
      // Duplicate prevention at save-time means at most one match here in practice.
      const match = findAdresByAccountNumbers(detectedAccounts, adresy, bankId);

      const entry: FileEntry = {
        id: generateId(),
        fileName: file.fileName,
        filePath: file.filePath,
        bankId,
        bankName: bank?.name || null,
        adresId: match.adres?.id ?? null,
        status: 'pending',
        ...(matchedPdf ? { pdfPath: matchedPdf } : {}),
      };
      if (detectedAccounts.length > 0) entry.detectedAccounts = detectedAccounts;
      if (match.adres) entry.adresAutoMatched = true;
      entry.accountTypeId = resolveAccountTypeId(match.adres?.id ?? null, detectedAccounts);
      return entry;
    });

    // Also try to match remaining PDFs to already-existing files without a PDF
    const updatedExisting = files.map(f => {
      if (f.pdfPath) return f; // already has PDF
      const baseName = f.fileName.replace(/\.[^.]+$/, '').toLowerCase();
      const matchedPdf = pdfByBaseName.get(baseName);
      if (matchedPdf) {
        pdfByBaseName.delete(baseName);
        return { ...f, pdfPath: matchedPdf };
      }
      return f;
    });

    setFiles([...updatedExisting, ...fileEntries]);

    // A community was recognised from the statement: if the team left a note on
    // it, say so before anyone starts posting.
    announceUwagi(fileEntries.map((entry) => entry.adresId), freshUwagi, adresy);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (!selectedBank) {
      notify.warning(t.pleaseSelectBank);
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
          // If the previously chosen address is linked to a different bank, clear it
          // so the user doesn't accidentally convert into the wrong community.
          const currentAdres = adresy.find((a) => a.id === file.adresId);
          const adresStillValid =
            !currentAdres || !currentAdres.bankId || currentAdres.bankId === bankId;
          return {
            ...file,
            bankId,
            bankName: bank?.name || null,
            adresId: adresStillValid ? file.adresId : null,
          };
        }
        return file;
      })
    );
  };

  const handleAdresChange = (fileId: string, adresId: number | null) => {
    // Picking a community by hand is as good a moment as recognising one.
    if (adresId !== null) {
      void loadUwagi().then((open) => announceUwagi([adresId], open, adresy));
    }
    setFiles(
      files.map((file) =>
        // A manual change drops the "auto-matched" indicator — the badge is only
        // meaningful for the value the matcher picked. Re-resolve the account type
        // for the newly-selected address.
        file.id === fileId
          ? {
              ...file,
              adresId,
              adresAutoMatched: false,
              accountTypeId: resolveAccountTypeId(adresId, file.detectedAccounts),
            }
          : file,
      ),
    );
  };

  const handleAccountTypeChange = (fileId: string, accountTypeId: number | null) => {
    setFiles(files.map((file) => (file.id === fileId ? { ...file, accountTypeId } : file)));
  };

  const handlePdfUpload = async (fileId: string) => {
    const pdfFile = await window.electronAPI.selectPdf();
    if (pdfFile) {
      setFiles(
        files.map((file) =>
          file.id === fileId ? { ...file, pdfPath: pdfFile.filePath } : file
        )
      );
    }
  };

  const handlePdfRemove = (fileId: string) => {
    setFiles(
      files.map((file) =>
        file.id === fileId ? { ...file, pdfPath: undefined } : file
      )
    );
  };

  const handleConvert = async (fileId: string) => {
    // Get file from ref to ensure we have latest state
    const currentFile = filesRef.current.find((f) => f.id === fileId);

    if (!currentFile || !currentFile.bankId || !currentFile.adresId) return;

    // No pre-analysis pass here: it only ever existed to populate the AI prompt
    // modal, and its result is not reused by the AI conversion path (see the
    // memo note in converterRegistry), so running it would parse and match the
    // file a second time for nothing.
    await performConversion(fileId, alwaysUseAIRef.current);
  };

  // A pending conversion that expired/was lost from the main-process cache is
  // NOT a bank/converter misconfiguration — the file is fine, the review
  // session is just gone. Tell the user plainly and let them re-run the file.
  const isExpiredConversionError = (err?: string) =>
    !!err && err.includes('not found or expired');

  const reportFinalizeFailure = (fileName: string, rawError?: string) => {
    const expired = isExpiredConversionError(rawError);
    const isBillingError = rawError?.includes('💸') || rawError?.includes('Brak kasiory');
    const errorMsg = expired
      ? `${t.conversionFailed}: ${t.reviewSessionExpired}`
      : isBillingError
        ? `${t.conversionFailed}: ${rawError}`
        : `${t.conversionFailed}: ${rawError}\n${t.checkBankConverter}`;
    notify.error(errorMsg);
    setFiles((prevFiles) =>
      prevFiles.map((f) =>
        f.fileName === fileName
          ? {
              // Expired sessions are recoverable by re-running, so leave the
              // file selectable (pending) rather than marking it failed.
              ...f,
              status: expired ? ('pending' as const) : ('error' as const),
              errorMessage: expired ? undefined : rawError,
            }
          : f
      )
    );
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
        reportFinalizeFailure(reviewData.fileName, result.error);
        setReviewData(null);
        processNextInQueue();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      reportFinalizeFailure(reviewData.fileName, errorMessage);
      setReviewData(null);
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
        reportFinalizeFailure(reviewData.fileName, result.error);
        setReviewData(null);
        setConversionQueue([]);
        setIsProcessingQueue(false);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      reportFinalizeFailure(reviewData.fileName, errorMessage);
      setReviewData(null);
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

      // Every queued file uses the same AI setting as the first one. This used
      // to be hard-coded to false, so in a multi-file batch only the first file
      // actually reached the AI — the rest silently converted without it.
      setTimeout(() => {
        performConversion(nextFileId, alwaysUseAIRef.current);
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
            currentFile.adresId,
            currentFile.accountTypeId
          )
        : await window.electronAPI.convertFile(
            currentFile.filePath,
            currentFile.bankId,
            currentFile.fileName,
            currentFile.adresId,
            currentFile.accountTypeId
          );

      // Cancelled: the file is waiting again, as before it was started, and the
      // rest of a "Konwertuj wszystkie" run stops with it — the user stopped
      // the operation, not one file of it.
      if (result.cancelled) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId ? { ...f, status: 'pending' as const, errorMessage: undefined } : f
          )
        );
        setProgressByFile((prev) => {
          const next = { ...prev };
          delete next[currentFile.fileName];
          return next;
        });
        setConversionQueue([]);
        setIsProcessingQueue(false);
        notify.info(t.convCancelled);
        return;
      }

      // Ensure minimum 1 second display time for loader
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsed);
      if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }

      // Check if review is needed
      if (result.needsReview && result.reviewData) {
        // Show warning message if AI fallback occurred (before review)
        if (result.warningMessage) {
          notify.warning(`${result.warningMessage}`);
        }
        
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
        // If file has PDF attached, extract text and include in reviewData
        const currentFileForPdf = filesRef.current.find(f => f.id === fileId);
        if (currentFileForPdf?.pdfPath) {
          // The file itself goes along even when its text cannot be read.
          result.reviewData.pdfPath = currentFileForPdf.pdfPath;
          try {
            const pdfResult = await window.electronAPI.extractPdfText(currentFileForPdf.pdfPath);
            if (pdfResult && pdfResult.lines.length > 0) {
              result.reviewData.pdfLines = pdfResult.lines;
            }
          } catch (err) {
            console.error('Error extracting PDF text:', err);
          }
        }
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
        
        // Show warning message if AI fallback occurred
        if (result.warningMessage) {
          notify.warning(`${result.warningMessage}`);
        }
        
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
        // Don't show "check bank/converter" for billing errors
        const isBillingError = result.error?.includes('💸') || result.error?.includes('Brak kasiory');
        const errorMsg = isBillingError 
          ? `${t.conversionFailed}: ${result.error}`
          : `${t.conversionFailed}: ${result.error}\n${t.checkBankConverter}`;
        notify.error(errorMsg);
        
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
      notify.error(`${t.conversionFailed}: ${errorMessage}`);
      
      // Process next file even on error
      processNextInQueue();
    }
  };

  // A file that left "processing" is no longer being cancelled.
  useEffect(() => {
    setCancellingIds((prev) => {
      const still = [...prev].filter((id) => files.some((f) => f.id === id && f.status === 'processing'));
      return still.length === prev.size ? prev : new Set(still);
    });
  }, [files]);

  /** "Anuluj" under a conversion's progress bar. */
  const handleCancelConversion = async (file: FileEntry) => {
    setCancellingIds((prev) => new Set(prev).add(file.id));
    const stopped = await window.electronAPI.cancelConversion(file.filePath);
    // Nothing to stop (it had just finished): the button simply goes away with
    // the progress bar when the result arrives.
    if (!stopped) {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  const handleConvertAll = async () => {
    // Get files that need conversion from current ref state
    const filesToConvert = filesRef.current
      .filter((f) => (f.status === 'pending' || f.status === 'error') && f.bankId);
    
    if (filesToConvert.length === 0) return;

    // Convert files sequentially - start with first, rest go to queue
    setIsProcessingQueue(true);
    const [firstFile, ...restFiles] = filesToConvert;
    setConversionQueue(restFiles.map(f => f.id));
    await performConversion(firstFile.id, alwaysUseAIRef.current);
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
      const filePath = resolveOutputFilePath(file.outputPath, type);

      const success = await window.electronAPI.openFile(filePath);
      if (!success) {
        notify.error(t.fileNotFound);
      }
    } else {
      notify.error(t.fileNotFound);
    }
  };

  return (
    <div className="content-body">
        {isLoading ? (
          <Loader label={t.loading} />
        ) : !selectedBank && !embedded ? (
          <div className="converter-hero">
            <span className="converter-hero__icon" aria-hidden="true">
              <Icon name="building" size={26} />
            </span>
            <h2 className="converter-hero__title">{t.selectBank}</h2>
            <p className="converter-hero__text">{t.convChooseBankIntro}</p>
            <div className="converter-hero__select">
              <Select
                size="lg"
                value={selectedBank}
                onChange={(v) => setSelectedBank(v ? Number(v) : null)}
                placeholder={t.chooseBank}
                options={banks.map((bank) => ({ value: String(bank.id), label: bank.name }))}
                ariaLabel={t.selectBank}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="card">
          {/* In the dashboard's conversion dialog the files arrive already
              recognised, so the bank picker and the drop zone give way to the list. */}
          {!embedded && (
          <>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: 'var(--accent)' }}>{t.addFiles}</h2>
            <div className="bank-selector-inline">
              <label style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px', display: 'block' }}>
                {t.selectBank}
              </label>
              <Select
                size="lg"
                value={selectedBank}
                onChange={(v) => setSelectedBank(v ? Number(v) : null)}
                placeholder={t.chooseBank}
                options={banks.map((bank) => ({ value: String(bank.id), label: bank.name }))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div
            className={`drop-zone${files.length > 0 ? ' drop-zone--compact' : ''}${dragOver ? ' drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleFileSelect}
          >
            <div className="drop-zone-icon"><Icon name="upload" size={40} /></div>
            <div className="drop-zone-text">
              {t.dragDropFiles}
            </div>
          </div>
          </>
          )}

          {files.length > 0 && (
            <>
              {!embedded && <hr className="card-separator" />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2>{t.files}</h2>
              <div className="button-group" style={{ margin: 0 }}>
                <button 
                  className="button button-secondary"
                  onClick={() => outputFolder && window.electronAPI.openFile(outputFolder)}
                  disabled={!outputFolder}
                  title={outputFolder || t.convOutputFolderMissing}
                >
                  <Icon name="folder" size={14} /> {t.openOutputFolder}
                </button>
                <button 
                  className="button button-success" 
                  onClick={handleConvertAll}
                  disabled={files.every(f => f.status === 'success') || files.some(f => !f.adresId)}
                  title={
                    files.every(f => f.status === 'success')
                      ? t.convAllConverted
                      : files.some(f => !f.adresId)
                      ? t.convSomeWithoutAdres
                      : undefined
                  }
                  style={(files.every(f => f.status === 'success') || files.some(f => !f.adresId)) ? { 
                    opacity: 0.5, 
                    cursor: 'not-allowed' 
                  } : {}}
                ><Icon name="arrow-right" size={14} />{' '}
                  {t.convertAll}
                </button>
                <button className="button button-danger" onClick={handleClearAll}>
                  <Icon name="trash" size={14} />{' '}{t.clearAll}
                </button>
              </div>
            </div>

            {/* In the dashboard's dialog the columns are fixed, so the table fits
                the dialog and the file name wraps instead of pushing it wider. */}
            <table className={`conv-table${embedded ? ' conv-table--fit' : ''}`}>
              <colgroup>
                <col className="conv-table__index" />
                <col className="conv-table__file" />
                <col className="conv-table__bank" />
                <col className="conv-table__adres" />
                <col className="conv-table__pdf" />
                <col className="conv-table__status" />
                <col className="conv-table__actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t.fileName}</th>
                  <th>{t.bank}</th>
                  <th>{t.adres}</th>
                  <th>PDF</th>
                  <th>{t.status}</th>
                  <th style={{ textAlign: 'right' }}>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => {
                  // From the dashboard the scan has already tied the statement to
                  // its community (by the account number in the file) and its bank
                  // (by the format): those stay as they are, only shown.
                  const lockBank = embedded && file.bankId != null;
                  const lockAdres = embedded && file.adresId != null;
                  const showError = file.status === 'error' && !!file.errorMessage;
                  return (
                  <React.Fragment key={file.id}>
                  <tr
                    className={
                      file.status === 'processing' ? 'processing-row' : showError ? 'conv-table__row--with-detail' : ''
                    }
                  >
                    {file.status === 'processing' ? (
                      <td colSpan={7}>
                        <div className="processing-loader">
                          <div className="loader-spinner"></div>
                          <div className="loader-content" style={{ flex: 1 }}>
                            <span className="loader-text">{t.convProcessingFile}: <strong>{file.fileName}</strong></span>
                            <span className="loader-subtext">
                              {progressByFile[file.fileName]?.label || t.convPleaseWait}
                            </span>
                            {progressByFile[file.fileName] && (
                              <div className="conversion-progress-bar">
                                <div
                                  className="conversion-progress-bar-fill"
                                  style={{ width: `${progressByFile[file.fileName].percent}%` }}
                                />
                                <span className="conversion-progress-bar-text">
                                  {progressByFile[file.fileName].percent}%
                                </span>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => void handleCancelConversion(file)}
                            disabled={cancellingIds.has(file.id)}
                            title={t.convCancelHint}
                          >
                            <Icon name="x" size={13} />{' '}
                            {cancellingIds.has(file.id) ? t.convCancelling : t.cancel}
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>{index + 1}</td>
                        <td>
                          <div className="conv-table__name" title={file.filePath}>{file.fileName}</div>
                          {(() => {
                            const processedAt = processedFileDates.get(file.fileName.toLowerCase());
                            // Not on a file converted just now: it is the one in the records.
                            if (!processedAt || file.status === 'success') return null;
                            return (
                              <div
                                style={{
                                  marginTop: '6px',
                                  padding: '3px 8px',
                                  background: 'var(--bg-surface)',
                                  color: 'var(--danger)',
                                  border: '1px solid var(--danger-border)',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  lineHeight: 1.3,
                                  maxWidth: '100%',
                                }}
                              >
                                <span>
                                  {t.alreadyProcessedWarning}, {t.alreadyProcessedOn}: {formatDate(processedAt)}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td title={lockBank ? t.convLockedFromScan : undefined}>
                          <Select
                            overlay
                            disabled={lockBank}
                            value={file.bankId}
                            onChange={(v) => handleBankChange(file.id, Number(v))}
                            placeholder={t.chooseBank}
                            options={banks.map((bank) => ({ value: String(bank.id), label: bank.name }))}
                          />
                        </td>
                        <td>
                          <div title={lockAdres ? t.convLockedFromScan : undefined}>
                          <SearchableAdresSelect
                            adresy={adresy}
                            selectedAdresId={file.adresId}
                            onChange={(adresId) => handleAdresChange(file.id, adresId)}
                            placeholder={t.chooseAdres}
                            searchPlaceholder={t.searchAdres}
                            emptyText={t.convNoResults}
                            bankFilter={file.bankId}
                            disabled={lockAdres}
                          />
                          </div>
                          {file.adresId && kontoTypy.length > 0 && (
                            <div style={{ marginTop: '6px' }}>
                              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '2px' }}>
                                {t.accountTypeColumn}
                              </label>
                              <Select
                                overlay
                                value={file.accountTypeId}
                                onChange={(v) =>
                                  handleAccountTypeChange(file.id, v ? Number(v) : null)
                                }
                                options={kontoTypy.map((typ) => ({
                                  value: String(typ.id),
                                  label: `${typ.name} (${typ.bankAccountSymbol})`,
                                }))}
                                style={{ width: '100%' }}
                              />
                            </div>
                          )}
                          {file.adresId && file.adresAutoMatched && (
                            <div
                              style={{
                                fontSize: '11px',
                                color: 'var(--accent)',
                                marginTop: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title={file.detectedAccounts?.join(', ')}
                            >
                              <Icon name="check" size={11} /> {t.autoMatchedFromAccount}
                            </div>
                          )}
                          {file.adresId && (uwagiByAdres.get(file.adresId)?.length ?? 0) > 0 && (
                            <div className="conv-note">
                              <span className="conv-note__title">
                                <Icon name="message-square" size={12} /> {t.convNoteInRow}
                              </span>
                              {uwagiByAdres.get(file.adresId)!.map((uwaga) => (
                                <div key={uwaga.id} className="conv-note__item">
                                  <p className="conv-note__text" title={uwagaMeta(uwaga, language, formatNoteDate)}>
                                    {uwaga.tresc}
                                  </p>
                                  <button
                                    type="button"
                                    className="button button-small button-secondary"
                                    title={t.ksUwagaResolveTip}
                                    onClick={() => void resolveUwaga(uwaga.id)}
                                  >
                                    <Icon name="check-circle" size={13} /> {t.ksUwagaResolve}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!file.adresId &&
                            file.detectedAccounts &&
                            file.detectedAccounts.length > 0 &&
                            onAddAdresWithAccount && (
                              <div style={{ marginTop: '6px' }}>
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--text-tertiary)',
                                    marginBottom: '4px',
                                  }}
                                >
                                  {t.accountDetectedNoMatch}
                                </div>
                                <button
                                  type="button"
                                  className="button button-small button-secondary"
                                  onClick={() => onAddAdresWithAccount(file.detectedAccounts![0])}
                                  style={{ fontSize: '11px', padding: '4px 8px' }}
                                ><Icon name="plus" size={13} />{' '}
                                  {t.accountDetectedNoMatchAction}
                                </button>
                              </div>
                            )}
                        </td>
                        <td>
                          {file.pdfPath ? (
                            <span className="pdf-chip" title={file.pdfPath}>
                              <Icon name="file-text" size={13} />
                              <span className="pdf-chip__name">{file.pdfPath.split(/[\\/]/).pop() || 'PDF'}</span>
                              <button
                                type="button"
                                className="pdf-chip__remove"
                                onClick={() => handlePdfRemove(file.id)}
                                title={t.convPdfRemove}
                                aria-label={t.convPdfRemove}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="button button-small button-secondary"
                              onClick={() => handlePdfUpload(file.id)}
                              title={t.convPdfAdd}
                            >
                              <Icon name="plus" size={13} /> {t.convPdfAddShort}
                            </button>
                          )}
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
                          {file.status === 'success' && file.conversionSummary && (
                            <div className="conv-table__meta">
                              {plural(
                                file.conversionSummary.totalTransactions,
                                language,
                                ['transakcja', 'transakcje', 'transakcji'],
                                ['transaction', 'transactions'],
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="conv-table__actions-cell">
                            {file.status === 'success' && (
                              <>
                                <button
                                  type="button"
                                  className="button button-small button-secondary"
                                  onClick={() => handleOpenFile(file.id, 'preview')}
                                >
                                  <Icon name="eye" size={13} /> {t.openPreview}
                                </button>
                                <button
                                  type="button"
                                  className="button button-small button-secondary"
                                  onClick={() => handleOpenFile(file.id, 'accounting')}
                                >
                                  <Icon name="bar-chart" size={13} /> {t.openAccounting}
                                </button>
                                <OverflowMenu
                                  label={t.convMoreActions}
                                  items={[
                                    { icon: 'refresh', label: t.convertAgain, onClick: () => handleConvert(file.id) },
                                    {
                                      icon: 'trash',
                                      label: t.convRemoveFromList,
                                      onClick: () => handleRemoveFile(file.id),
                                      danger: true,
                                    },
                                  ]}
                                />
                              </>
                            )}
                            {/* Over the dashboard the list is the work itself: its last file is not removable, or the window is left empty. */}
                            {file.status !== 'success' && !(embedded && files.length <= 1) && (
                              <button
                                type="button"
                                className="button button-ghost button-icon icon-danger"
                                onClick={() => handleRemoveFile(file.id)}
                                title={t.remove}
                                aria-label={`${t.remove}: ${file.fileName}`}
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            )}
                            {(file.status === 'pending' || file.status === 'error') && (
                              <button
                                className="button button-small button-success"
                                onClick={() => handleConvert(file.id)}
                                disabled={!file.bankId || !file.adresId}
                                title={!file.bankId ? t.convPickBankFirst : !file.adresId ? t.convPickAdresFirst : undefined}
                                style={(!file.bankId || !file.adresId) ? { 
                                  opacity: 0.5, 
                                  cursor: 'not-allowed' 
                                } : {}}
                              ><Icon name={file.status === 'error' ? 'refresh' : 'arrow-right'} size={13} />{' '}
                                {file.status === 'error' ? t.convTryAgain : t.convert}
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                  {/* The error, under its file and across the whole row. */}
                  {showError && (
                    <tr className="conv-table__detail-row">
                      <td colSpan={7}>
                        <div className="callout callout--danger">
                          <Icon name="alert-circle" size={16} />
                          <div className="callout__body conv-table__error-text">{file.errorMessage}</div>
                          <button
                            type="button"
                            className="button button-small button-subtle"
                            onClick={() => {
                              navigator.clipboard.writeText(file.errorMessage || '');
                              notify.success(t.convErrorCopied);
                            }}
                            title={t.convErrorCopy}
                          >
                            <Icon name="copy" size={13} /> {t.convCopy}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            </>
          )}

        </div>
          </>
        )}

        {/* Recent activity — last 30 days, same timeline as the full History view.
            Hidden while loading and while the full-screen review is up. */}
        {!isLoading && !reviewData && !embedded && (
          <FormSection
            icon="history"
            title={t.historyLast30Days}
            aside={
              onNavigateToHistory ? (
                <button type="button" className="button button-small button-subtle" onClick={onNavigateToHistory}>
                  {t.goToFullHistory} <Icon name="arrow-right" size={13} />
                </button>
              ) : undefined
            }
          >
            <ConversionHistoryTimeline history={recentHistory} language={language} showSearch={false} />
          </FormSection>
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

        {noteNotices.length > 0 && (
          <PostingNoteNotice
            items={noteNotices}
            language={language}
            formatDateTime={formatNoteDate}
            onClose={() => setNoteNotices([])}
          />
        )}

        {/* Duplicates Modal */}
        {showDuplicatesModal && (
          <div className="modal-overlay" onClick={() => setShowDuplicatesModal(false)}>
            <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
              <ModalDismiss onClose={() => setShowDuplicatesModal(false)} />
              <ModalHeader icon="alert-triangle" title={t.zaliczkiDuplicatesTitle} subtitle={t.zaliczkiDuplicatesMessage} />
              <div className="modal-body modal-body--sectioned">
                <ul className="record-list">
                  {duplicateFiles.map((fileName, index) => (
                    <li key={index} className="record-row">
                      <span className="record-row__icon" aria-hidden="true">
                        <Icon name="file-text" size={15} />
                      </span>
                      <div className="record-row__main">
                        <div className="record-row__title record-row__title--wrap">{fileName}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <ModalFooter onCancel={() => setShowDuplicatesModal(false)} cancelLabel={t.zaliczkiDuplicatesOk} />
            </div>
          </div>
        )}
    </div>
  );
};

export default Converter;
