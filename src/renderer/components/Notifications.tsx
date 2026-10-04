import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { ModalFooter, ModalHeader } from './Modal';

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
  resolve: (value: boolean) => void;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red) and focus Cancel by default. */
  danger?: boolean;
}

export interface NotifyApi {
  success: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  /** Blocking modal. Optional title overrides the default error heading. */
  error: (message: string, title?: string) => void;
  /** Blocking yes/no modal; resolves true on confirm, false on cancel. */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
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
      setToasts((prev) => [...prev, { id, level, message, file }]);
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
        setErrors((prev) => [...prev, { id: ++idRef.current, title, message }]),
      confirm: (message: string, options: ConfirmOptions = {}) =>
        new Promise<boolean>((resolve) => {
          setConfirms((prev) => [...prev, { id: ++idRef.current, message, options, resolve }]);
        }),
    }),
    [pushToast]
  );

  // Errors queue and show one at a time so a burst never stacks overlays.
  const currentError = errors[0] ?? null;
  const dismissError = useCallback(() => setErrors((prev) => prev.slice(1)), []);

  // Confirms also queue; resolving the promise dequeues the dialog.
  const currentConfirm = confirms[0] ?? null;
  const resolveConfirm = useCallback((value: boolean) => {
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
      if (currentConfirm) resolveConfirm(false);
      else dismissError();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentError, currentConfirm, dismissError, resolveConfirm]);

  return (
    <NotificationContext.Provider value={api}>
      {children}

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
                title={toast.file}
              >
                {openFileLabel}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label={dismissLabel}
              title={dismissLabel}
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
            if (e.target === e.currentTarget) resolveConfirm(false);
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
            {/* A destructive question starts on Cancel, so Enter never deletes by reflex. */}
            <ModalFooter
              onCancel={() => resolveConfirm(false)}
              cancelLabel={currentConfirm.options.cancelLabel ?? cancelLabel}
              onSubmit={() => resolveConfirm(true)}
              submitLabel={currentConfirm.options.confirmLabel ?? confirmLabel}
              submitIcon="check"
              submitTone={currentConfirm.options.danger ? 'danger' : 'success'}
              autoFocus={currentConfirm.options.danger ? 'cancel' : 'submit'}
            />
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
