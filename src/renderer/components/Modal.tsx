import React, { useEffect, useRef } from 'react';
import Icon, { IconName } from './Icon';

// Stack of currently-mounted modals. Only the topmost reacts to Escape, so
// closing a stacked modal (e.g. a nested form) doesn't also close the one
// behind it.
const modalStack: symbol[] = [];

interface ModalDismissProps {
  /** Called when the user presses Escape or clicks the X. */
  onClose: () => void;
  ariaLabel?: string;
}

/**
 * Drop-in close affordance for any `.modal`: renders the X button (top-right)
 * and wires the Escape key. Mount it as the first child inside a `.modal`
 * element. The `.modal` must be `position: relative` (it is, globally).
 */
const ModalDismiss: React.FC<ModalDismissProps> = ({ onClose, ariaLabel = 'Zamknij' }) => {
  // Keep the latest onClose without re-running the mount effect (call sites
  // pass inline arrows, whose identity changes every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, []);

  return (
    <button
      type="button"
      className="modal-close"
      onClick={onClose}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <Icon name="x" size={18} />
    </button>
  );
};

interface ModalHeaderProps {
  /** What the modal is about — the same icon the record has elsewhere in the app. */
  icon: IconName;
  title: string;
  /** The record being edited, or one line of orientation for a new one. */
  subtitle?: React.ReactNode;
  /** Danger tone for destructive dialogs. */
  tone?: 'accent' | 'danger';
}

/** `.modal-header` with an icon tile, a title and an optional subtitle. */
export const ModalHeader: React.FC<ModalHeaderProps> = ({ icon, title, subtitle, tone = 'accent' }) => (
  <div className="modal-header modal-header--icon">
    <span className={`modal-header__icon modal-header__icon--${tone}`} aria-hidden="true">
      <Icon name={icon} size={18} />
    </span>
    <div className="modal-header__text">
      <div className="modal-header__title">{title}</div>
      {subtitle && <div className="modal-header__subtitle">{subtitle}</div>}
    </div>
  </div>
);

interface ModalFooterProps {
  /** Without it there is no cancel button — a page's action bar has none. */
  onCancel?: () => void;
  /** "Anuluj" in a form, "Zamknij" in a modal that only shows things. */
  cancelLabel?: string;
  /** Without it the footer has the cancel/close button only. */
  onSubmit?: () => void;
  submitLabel?: string;
  submitIcon?: IconName;
  submitDisabled?: boolean;
  /** Why the submit is disabled, on hover. */
  submitTitle?: string;
  /** A save is in flight: both buttons wait. */
  busy?: boolean;
  /** `danger` for a submit that destroys or replaces something (overwrite, delete). */
  submitTone?: 'success' | 'danger';
  /** A second action between cancel and submit (e.g. "Zakończ i zatrzymaj"). */
  secondaryAction?: React.ReactNode;
  /** Which button takes the focus when the modal opens (dialogs answered by Enter). */
  autoFocus?: 'cancel' | 'submit';
  /** Left side: the required-field note, or a summary of what the save will do. */
  note?: React.ReactNode;
  /** `page-action-bar` makes it the sticky action bar at the bottom of a page form. */
  className?: string;
}

/**
 * The one footer every modal uses — and, with `page-action-bar`, every page
 * form's action bar: an optional note on the left, then cancel and the primary
 * action on the right. Same order, same styles everywhere.
 */
export const ModalFooter: React.FC<ModalFooterProps> = ({
  onCancel,
  cancelLabel,
  onSubmit,
  submitLabel,
  submitIcon = 'save',
  submitDisabled,
  submitTitle,
  busy,
  note,
  className,
  submitTone = 'success',
  secondaryAction,
  autoFocus,
}) => (
  <div className={`modal-footer${className ? ` ${className}` : ''}`}>
    {note && <div className="modal-footer__note">{note}</div>}
    {onCancel && (
      <button
        type="button"
        className="button button-secondary"
        onClick={onCancel}
        disabled={busy}
        autoFocus={autoFocus === 'cancel'}
      >
        {cancelLabel}
      </button>
    )}
    {secondaryAction}
    {onSubmit && (
      <button
        type="button"
        className={`button button-${submitTone}`}
        onClick={onSubmit}
        disabled={busy || submitDisabled}
        autoFocus={autoFocus === 'submit'}
        title={submitDisabled ? submitTitle : undefined}
      >
        <Icon name={busy ? 'loader' : submitIcon} size={14} className={busy ? 'icon-spin' : undefined} />
        {submitLabel}
      </button>
    )}
  </div>
);

export default ModalDismiss;
