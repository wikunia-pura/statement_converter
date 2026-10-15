import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ConversionReviewData, FileEntry, ReviewDecision } from '../shared/types';
import { translations, Language } from './translations';
import { useNotify } from './components/Notifications';
import { useStableCallback } from './hooks/useStableCallback';

/**
 * A run of conversions — "Konwertuj wszystkie", or one file's "Konwertuj" —
 * and the review screen it may be waiting on.
 *
 * WHY a provider and not the Converter's own state: the Converter is a view,
 * and views unmount when the user looks at something else. The queue used to
 * live in it, so leaving the view in the middle of a batch left the file being
 * converted finishing into nothing — its next file never started, its review
 * screen was set on a component that no longer existed, and the row stayed on
 * "processing" with nothing behind it. Here the run belongs to whoever owns
 * the file list (the app shell for the Converter tab, the dashboard's dialog
 * for its own list), which stays mounted for as long as the list does.
 *
 * The Converter view only draws it: the list, the progress, and the review
 * screen when one is waiting — so coming back mid-batch shows the run where it
 * got to, review included.
 */
export interface ConversionSession {
  /** A conversion waiting for the user's decisions, or null. */
  reviewData: ConversionReviewData | null;
  /** Files still waiting in the current "Konwertuj wszystkie" run, in order. */
  queueLength: number;
  /** Bumped each time a run ends — the moment the history panel is worth reloading. */
  runsFinished: number;
  /** One file's "Konwertuj" / "Konwertuj ponownie". */
  convert: (fileId: string) => Promise<void>;
  /** Every waiting or failed file, one after another. */
  convertAll: () => Promise<void>;
  finalizeAndNext: (decisions: ReviewDecision[]) => Promise<void>;
  finalizeAndStop: (decisions: ReviewDecision[]) => Promise<void>;
  /** Leave the reviewed file waiting and go on with the rest. */
  skip: () => void;
  /** Leave the reviewed file waiting and stop the run. */
  cancelReview: () => void;
}

const ConversionSessionContext = createContext<ConversionSession | null>(null);

export const useConversionSession = (): ConversionSession => {
  const session = useContext(ConversionSessionContext);
  if (!session) throw new Error('useConversionSession outside ConversionSessionProvider');
  return session;
};

// A pending conversion that expired/was lost from the main-process cache is
// NOT a bank/converter misconfiguration — the file is fine, the review
// session is just gone. Tell the user plainly and let them re-run the file.
const isExpiredConversionError = (err?: string) => !!err && err.includes('not found or expired');

export const ConversionSessionProvider: React.FC<{
  files: FileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  language: Language;
  children: React.ReactNode;
}> = ({ files, setFiles, language, children }) => {
  const t = translations[language];
  const notify = useNotify();
  const [reviewData, setReviewData] = useState<ConversionReviewData | null>(null);
  const [queue, setQueueState] = useState<string[]>([]);
  const [runsFinished, setRunsFinished] = useState(0);

  // Read by the run, which outlives the render that started it: the queue is
  // advanced from inside async continuations, so it is kept in a ref that is
  // written synchronously — a state updater is no place to start the next file
  // (StrictMode runs updaters twice, and each run would convert it again).
  const queueRef = useRef<string[]>([]);
  const setQueue = (next: string[]) => {
    queueRef.current = next;
    setQueueState(next);
  };

  // The list as last rendered — a file's bank, community and account type are
  // read when its turn comes, so a change made while it waited still counts.
  const filesRef = useRef<FileEntry[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  /**
   * Whether conversions call the AI, and whether a clean file may skip the
   * review screen. Read again when a run starts: this outlives the Converter
   * view, so a change made in Ustawienia in the meantime must still count —
   * and the whole run uses one value, so a file can no longer silently fall
   * back to the non-AI path just because it wasn't first in line.
   */
  const settingsRef = useRef({ alwaysUseAI: true, skipUserApproval: false });
  const readSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      settingsRef.current = {
        alwaysUseAI: settings.alwaysUseAI !== false,
        skipUserApproval: settings.skipUserApproval ?? false,
      };
    } catch (error) {
      // The last known values stay; a settings read must never stop a conversion.
      console.error('Error loading settings:', error);
    }
  };

  // Heartbeat: while a review screen is waiting, keep its pending conversion
  // alive in the main-process cache (sliding expiration) so a long or
  // interrupted review never expires and loses the user's work — also while
  // the user is in another view.
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

  const endRun = () => {
    setQueue([]);
    setRunsFinished((n) => n + 1);
  };

  /** The output file was written but its record was not: say so, with the file, before it is converted twice. */
  const reportRecordError = (result: { recordError?: string; outputPath?: string }) => {
    if (!result.recordError) return;
    notify.error(
      t.convRecordNotSaved
        .replace('{file}', result.outputPath ?? '')
        .replace('{error}', result.recordError)
    );
  };

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

  /** Start the next queued file, or end the run when there is none. */
  const processNextInQueue = () => {
    const [nextFileId, ...remainingQueue] = queueRef.current;
    if (nextFileId === undefined) {
      endRun();
      return;
    }
    setQueue(remainingQueue);
    // Every queued file uses the same AI setting as the first one. This used
    // to be hard-coded to false, so in a multi-file batch only the first file
    // actually reached the AI — the rest silently converted without it.
    setTimeout(() => {
      void performConversion(nextFileId, settingsRef.current.alwaysUseAI);
    }, 100);
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
        endRun();
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
        // — unless the file lost lines the parser could not read, or holds a row
        // that must never be booked unseen (storno, batch entry…): those need the
        // review screen and the user's explicit word whatever the setting says.
        const mustReview =
          (result.reviewData.droppedLines?.length ?? 0) > 0 ||
          result.reviewData.transactions.some((tx) => !!tx.extracted.holdReason);
        if (settingsRef.current.skipUserApproval && !mustReview) {
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
              reportRecordError(finalizeResult);
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
        reportRecordError(result);

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

  /** The reviewed file as finalized: done, with its output — or failed, said out loud. */
  const finalizeReview = async (decisions: ReviewDecision[]): Promise<void> => {
    if (!reviewData) return;
    try {
      const result = await window.electronAPI.finalizeConversion(reviewData.tempConversionId, decisions);
      if (result.success) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.fileName === reviewData.fileName
              ? {
                  ...f,
                  status: 'success' as const,
                  outputPath: result.outputPath,
                  errorMessage: result.duplicateWarning ? t.fileExistsTimestamp : undefined,
                }
              : f
          )
        );
        reportRecordError(result);
      } else {
        reportFinalizeFailure(reviewData.fileName, result.error);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      reportFinalizeFailure(reviewData.fileName, errorMessage);
    }
    setReviewData(null);
  };

  const finalizeAndNext = async (decisions: ReviewDecision[]) => {
    if (!reviewData) return;
    await finalizeReview(decisions);
    processNextInQueue();
  };

  const finalizeAndStop = async (decisions: ReviewDecision[]) => {
    if (!reviewData) return;
    await finalizeReview(decisions);
    // Stop processing - clear queue
    endRun();
  };

  /** The reviewed file goes back to waiting, so the user can run it again later. */
  const releaseReviewedFile = () => {
    if (!reviewData) return;
    setFiles((prevFiles) =>
      prevFiles.map((f) =>
        f.fileName === reviewData.fileName
          ? { ...f, status: 'pending' as const, errorMessage: undefined }
          : f
      )
    );
    setReviewData(null);
  };

  const skip = () => {
    if (!reviewData) return;
    releaseReviewedFile();
    processNextInQueue();
  };

  const cancelReview = () => {
    if (!reviewData) return;
    releaseReviewedFile();
    // Clear queue and stop processing
    endRun();
  };

  /**
   * A click being turned into a run. The settings are read before the file is
   * marked as processing, and a second click in that moment (a double click,
   * "Konwertuj wszystkie" twice) would otherwise start the same file again —
   * two conversions, two AI runs, two output files.
   */
  const startingRef = useRef(false);
  const start = async (begin: () => Promise<void>) => {
    if (startingRef.current) return;
    startingRef.current = true;
    let run: Promise<void>;
    try {
      await readSettings();
      // Called, not awaited, before the guard drops: by then the file is marked.
      run = begin();
    } finally {
      startingRef.current = false;
    }
    await run;
  };

  const convert = async (fileId: string) => {
    // Get file from ref to ensure we have latest state
    const currentFile = filesRef.current.find((f) => f.id === fileId);
    if (!currentFile || !currentFile.bankId || !currentFile.adresId) return;
    // No pre-analysis pass here: it only ever existed to populate the AI prompt
    // modal, and its result is not reused by the AI conversion path (see the
    // memo note in converterRegistry), so running it would parse and match the
    // file a second time for nothing.
    await start(() => performConversion(fileId, settingsRef.current.alwaysUseAI));
  };

  const convertAll = async () => {
    await start(async () => {
      // Get files that need conversion from current ref state
      const filesToConvert = filesRef.current.filter(
        (f) => (f.status === 'pending' || f.status === 'error') && f.bankId
      );
      if (filesToConvert.length === 0) return;
      // Convert files sequentially - start with first, rest go to queue
      const [firstFile, ...restFiles] = filesToConvert;
      setQueue(restFiles.map((f) => f.id));
      await performConversion(firstFile.id, settingsRef.current.alwaysUseAI);
    });
  };

  // Stable identities: the context value then changes only with the state the
  // Converter draws, not with every render of the shell.
  const stable = {
    convert: useStableCallback(convert),
    convertAll: useStableCallback(convertAll),
    finalizeAndNext: useStableCallback(finalizeAndNext),
    finalizeAndStop: useStableCallback(finalizeAndStop),
    skip: useStableCallback(skip),
    cancelReview: useStableCallback(cancelReview),
  };

  const value = useMemo<ConversionSession>(
    () => ({ reviewData, queueLength: queue.length, runsFinished, ...stable }),
    // `stable` holds only stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewData, queue.length, runsFinished],
  );

  return <ConversionSessionContext.Provider value={value}>{children}</ConversionSessionContext.Provider>;
};
