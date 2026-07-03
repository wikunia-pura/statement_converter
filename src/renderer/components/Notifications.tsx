import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

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
 */

type ToastLevel = 'success' | 'info' | 'warning';

interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
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
  success: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
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
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  errorTitle = 'Błąd',
  okLabel = 'OK',
  cancelLabel = 'Anuluj',
  dismissLabel = 'Zamknij',
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [errors, setErrors] = useState<ErrorDialog[]>([]);
  const [confirms, setConfirms] = useState<ConfirmDialog[]>([]);
  const idRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (level: ToastLevel, message: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, level, message }]);
      setTimeout(() => removeToast(id), TOAST_TTL_MS);
    },
    [removeToast]
  );

  const api = useMemo<NotifyApi>(
    () => ({
      success: (message: string) => pushToast('success', message),
      info: (message: string) => pushToast('info', message),
      warning: (message: string) => pushToast('warning', message),
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
          <div className="modal notification-error-modal">
            <div className="modal-header notification-error-header">
              <span className="notification-error-icon">
                <Icon name="alert-circle" size={22} />
              </span>
              {currentError.title ?? errorTitle}
            </div>
            <div className="modal-body">
              <p className="notification-error-message">{currentError.message}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="button button-primary" autoFocus onClick={dismissError}>
                {okLabel}
              </button>
            </div>
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
          <div className="modal notification-confirm-modal">
            {currentConfirm.options.title && (
              <div className="modal-header">{currentConfirm.options.title}</div>
            )}
            <div className="modal-body">
              <p className="notification-confirm-message">{currentConfirm.message}</p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-ghost"
                autoFocus={currentConfirm.options.danger === true}
                onClick={() => resolveConfirm(false)}
              >
                {currentConfirm.options.cancelLabel ?? cancelLabel}
              </button>
              <button
                type="button"
                className={`button ${currentConfirm.options.danger ? 'button-danger' : 'button-primary'}`}
                autoFocus={currentConfirm.options.danger !== true}
                onClick={() => resolveConfirm(true)}
              >
                {currentConfirm.options.confirmLabel ?? okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
