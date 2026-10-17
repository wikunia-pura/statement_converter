import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { shownText } from '../ipcError';
import { ModalCloseLabelContext, ModalFooter, ModalHeader } from './Modal';

/**
 * In-app notification system replacing native window.alert().
 *
 * Hybrid presentation:
 *   - success / info / warning  → non-blocking toasts (top-right, auto-dismiss)
 *   - error                     → blocking centered modal with an OK button,
 *                                 matching the acknowledge-and-continue feel of
 *                                 the alerts they replace.
 *
 * Usage: const notify = useNotify(); notify.error('...'); notify.success('...');
 *
 * A toast about a file the app just wrote takes the file along —
 * `notify.success('Zapisano…', { file })` — and gets an "Otwórz" button, so the
 * user does not have to go looking for it in Downloads.
 */

type ToastLevel = 'success' | 'info' | 'warning';

interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  /** Absolute path of a file the message is about — shows the "Otwórz" button. */
  file?: string;
}

export interface ToastOptions {
  /** The file just saved; the toast offers to open it. */
  file?: string | null;
}

interface ErrorDialog {
  id: number;
  title?: string;
  message: string;
}

interface ConfirmDialog {
  id: number;
  message: string;
  options: ConfirmOptions;
  /** Set for an unsaved-changes question: the footer adds the save button. */
  unsaved?: UnsavedOptions;
  resolve: (value: UnsavedChoice) => void;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red) and focus Cancel by default. */
  danger?: boolean;
}

/** What the user picked when leaving with unsaved changes. */
export type UnsavedChoice = 'save' | 'discard' | 'keep';

export interface UnsavedOptions {
  title?: string;
  /** "Zapisz i wyjdź". */
  saveLabel: string;
  /** "Wyjdź bez zapisywania". */
  discardLabel: string;
  /** "Wróć do edycji" — defaults to the provider's cancel label. */
  keepLabel?: string;
  /** False when the form cannot be saved yet (required fields missing): only discard or keep. */
  canSave?: boolean;
}

export interface NotifyApi {
  success: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  /** Blocking modal. Optional title overrides the default error heading. */
  error: (message: string, title?: string) => void;
  /** Blocking yes/no modal; resolves true on confirm, false on cancel. */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Leaving with unsaved changes: save and leave, leave without saving, or stay. */
  unsaved: (message: string, options: UnsavedOptions) => Promise<UnsavedChoice>;
}

const NotificationContext = createContext<NotifyApi | null>(null);

export const useNotify = (): NotifyApi => {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotify must be used within a NotificationProvider');
  }
  return ctx;
};

const TOAST_TTL_MS = 4500;
/** Long enough to reach for the "Otwórz" button after reading the message. */
const FILE_TOAST_TTL_MS = 10000;

const TOAST_ICON: Record<ToastLevel, React.ComponentProps<typeof Icon>['name']> = {
  success: 'check-circle',
  info: 'alert-circle',
  warning: 'alert-triangle',
};

interface NotificationProviderProps {
  children: React.ReactNode;
  /** Default heading for error modals (localized by the caller). */
  errorTitle?: string;
  okLabel?: string;
  cancelLabel?: string;
  dismissLabel?: string;
  /** The button on a toast that carries a file. */
  openFileLabel?: string;
  /** Shown when that file is gone by the time the button is pressed. */
  fileMissingLabel?: string;
  /** Default heading of a confirm dialog, and of a destructive one. */
  confirmTitle?: string;
  confirmDangerTitle?: string;
  /** Default label of the confirm button. */
  confirmLabel?: string;
  /** The header's second line, under the heading. */
  errorSubtitle?: string;
  confirmSubtitle?: string;
  confirmDangerSubtitle?: string;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  errorTitle = 'Błąd',
  okLabel = 'OK',
  cancelLabel = 'Anuluj',
  dismissLabel = 'Zamknij',
  openFileLabel = 'Otwórz',
  fileMissingLabel = 'Nie udało się otworzyć pliku — mógł zostać przeniesiony albo usunięty.',
  confirmTitle = 'Potwierdź',
  confirmDangerTitle = 'Na pewno?',
  confirmLabel = 'Potwierdź',
  errorSubtitle,
  confirmSubtitle,
  confirmDangerSubtitle,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [errors, setErrors] = useState<ErrorDialog[]>([]);
  const [confirms, setConfirms] = useState<ConfirmDialog[]>([]);
  const idRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (level: ToastLevel, message: string, options?: ToastOptions) => {
      const id = ++idRef.current;
      const file = options?.file || undefined;
      setToasts((prev) => [...prev, { id, level, message: shownText(message), file }]);
      setTimeout(() => removeToast(id), file ? FILE_TOAST_TTL_MS : TOAST_TTL_MS);
    },
    [removeToast]
  );

  const openToastFile = useCallback(
    async (toast: Toast) => {
      if (!toast.file) return;
      removeToast(toast.id);
      let ok = false;
      try {
        ok = await window.electronAPI.openFile(toast.file);
      } catch {
        ok = false;
      }
      if (!ok) pushToast('warning', fileMissingLabel);
    },
    [removeToast, pushToast, fileMissingLabel]
  );

  const api = useMemo<NotifyApi>(
    () => ({
      success: (message: string, options?: ToastOptions) => pushToast('success', message, options),
      info: (message: string, options?: ToastOptions) => pushToast('info', message, options),
      warning: (message: string, options?: ToastOptions) => pushToast('warning', message, options),
      error: (message: string, title?: string) =>
        setErrors((prev) => [...prev, { id: ++idRef.current, title, message: shownText(message) }]),
      confirm: (message: string, options: ConfirmOptions = {}) =>
        new Promise<boolean>((resolve) => {
          setConfirms((prev) => [
            ...prev,
            { id: ++idRef.current, message, options, resolve: (choice) => resolve(choice === 'save') },
          ]);
        }),
      unsaved: (message: string, options: UnsavedOptions) =>
        new Promise<UnsavedChoice>((resolve) => {
          setConfirms((prev) => [
            ...prev,
            { id: ++idRef.current, message, options: { title: options.title, danger: true }, unsaved: options, resolve },
          ]);
        }),
    }),
    [pushToast]
  );

  // Errors queue and show one at a time so a burst never stacks overlays.
  const currentError = errors[0] ?? null;
  const dismissError = useCallback(() => setErrors((prev) => prev.slice(1)), []);

  // Confirms also queue; resolving the promise dequeues the dialog.
  // `save` is a confirm's "yes", `keep` its "no".
  const currentConfirm = confirms[0] ?? null;
  const resolveConfirm = useCallback((value: UnsavedChoice) => {
    setConfirms((prev) => {
      const [head, ...rest] = prev;
      head?.resolve(value);
      return rest;
    });
  }, []);

  // Escape closes the topmost dialog (confirm takes priority over an error),
  // matching the native alert()/confirm() it replaces.
  useEffect(() => {
    if (!currentError && !currentConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (currentConfirm) resolveConfirm('keep');
      else dismissError();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentError, currentConfirm, dismissError, resolveConfirm]);

  return (
    <NotificationContext.Provider value={api}>
      {/* Every modal's X takes its name from here, in the app's language. */}
      <ModalCloseLabelContext.Provider value={dismissLabel}>{children}</ModalCloseLabelContext.Provider>

      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.level}`} role="status">
            <span className="toast-icon">
              <Icon name={TOAST_ICON[toast.level]} size={18} />
            </span>
            <span className="toast-message">{toast.message}</span>
            {toast.file && (
              <button
                type="button"
                className="toast-action"
                onClick={() => void openToastFile(toast)}
                data-tip={toast.file}
              >
                {openFileLabel}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label={dismissLabel}
              data-tip={dismissLabel}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
      </div>

      {currentError && (
        <div
          className="modal-overlay"
          role="alertdialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) dismissError();
          }}
        >
          <div className="modal notification-dialog">
            <ModalHeader
              icon="alert-circle"
              tone="danger"
              title={currentError.title ?? errorTitle}
              subtitle={errorSubtitle}
            />
            {/* The message is a card on the sunken body, like every other modal's content. */}
            <div className="modal-body modal-body--sectioned">
              <p className="notification-dialog__message">{currentError.message}</p>
            </div>
            <ModalFooter onCancel={dismissError} cancelLabel={okLabel} autoFocus="cancel" />
          </div>
        </div>
      )}

      {currentConfirm && (
        <div
          className="modal-overlay"
          role="alertdialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) resolveConfirm('keep');
          }}
        >
          <div className="modal notification-dialog">
            <ModalHeader
              icon={currentConfirm.options.danger ? 'alert-triangle' : 'info'}
              tone={currentConfirm.options.danger ? 'danger' : 'accent'}
              title={currentConfirm.options.title ?? (currentConfirm.options.danger ? confirmDangerTitle : confirmTitle)}
              subtitle={currentConfirm.options.danger ? confirmDangerSubtitle : confirmSubtitle}
            />
            <div className="modal-body modal-body--sectioned">
              <p className="notification-dialog__message">{currentConfirm.message}</p>
            </div>
            {currentConfirm.unsaved ? (
              // Save is the safe default, so it takes Enter; discarding is the red one in the middle.
              <ModalFooter
                onCancel={() => resolveConfirm('keep')}
                cancelLabel={currentConfirm.unsaved.keepLabel ?? cancelLabel}
                secondaryAction={
                  <button type="button" className="button button-danger" onClick={() => resolveConfirm('discard')}>
                    {currentConfirm.unsaved.discardLabel}
                  </button>
                }
                onSubmit={currentConfirm.unsaved.canSave === false ? undefined : () => resolveConfirm('save')}
                submitLabel={currentConfirm.unsaved.saveLabel}
                submitIcon="save"
                autoFocus={currentConfirm.unsaved.canSave === false ? 'cancel' : 'submit'}
              />
            ) : (
            /* A destructive question starts on Cancel, so Enter never deletes by reflex. */
            <ModalFooter
              onCancel={() => resolveConfirm('keep')}
              cancelLabel={currentConfirm.options.cancelLabel ?? cancelLabel}
              onSubmit={() => resolveConfirm('save')}
              submitLabel={currentConfirm.options.confirmLabel ?? confirmLabel}
              submitIcon="check"
              submitTone={currentConfirm.options.danger ? 'danger' : 'success'}
              autoFocus={currentConfirm.options.danger ? 'cancel' : 'submit'}
            />
            )}
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
