import React, { createContext, useContext, useEffect, useId, useRef } from 'react';
import Icon, { IconName } from './Icon';

// Stack of currently-mounted modals. Only the topmost reacts to Escape, so
// closing a stacked modal (e.g. a nested form) doesn't also close the one
// behind it.
const modalStack: symbol[] = [];

/**
 * The X button's name in the current language. `NotificationProvider` — which
 * App mounts around every screen with its translated labels — provides it, so
 * the 50-odd modals need not pass it one by one. Polish outside a provider.
 */
export const ModalCloseLabelContext = createContext('Zamknij');

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
const ModalDismiss: React.FC<ModalDismissProps> = ({ onClose, ariaLabel }) => {
  const closeLabel = useContext(ModalCloseLabelContext);
  const label = ariaLabel ?? closeLabel;
  // Keep the latest onClose without re-running the mount effect (call sites
  // pass inline arrows, whose identity changes every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Every modal mounts this button, so it is the one place that tells assistive
  // technology what the `.modal` around it is — a modal dialog, named by its
  // header — instead of each hand-written frame having to say so. Whatever a
  // frame already declares itself is left alone.
  useEffect(() => {
    const modal = buttonRef.current?.closest('.modal');
    if (!modal) return;
    if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
    if (!modal.hasAttribute('aria-modal')) modal.setAttribute('aria-modal', 'true');
    if (!modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby')) {
      const heading = modal.querySelector('.modal-header__title[id]');
      if (heading) modal.setAttribute('aria-labelledby', heading.id);
    }
  }, []);

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
      ref={buttonRef}
      type="button"
      className="modal-close"
      onClick={onClose}
      aria-label={label}
      data-tip={label}
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
export const ModalHeader: React.FC<ModalHeaderProps> = ({ icon, title, subtitle, tone = 'accent' }) => {
  // The dialog's accessible name (ModalDismiss points the `.modal` at it).
  const titleId = useId();
  return (
    <div className="modal-header modal-header--icon">
      <span className={`modal-header__icon modal-header__icon--${tone}`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className="modal-header__text">
        <div className="modal-header__title" id={titleId}>
          {title}
        </div>
        {subtitle && <div className="modal-header__subtitle">{subtitle}</div>}
      </div>
    </div>
  );
};

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
  /** Why the submit is disabled, on hover (a `data-tip` — shown over the disabled button too). */
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
        data-tip={submitDisabled ? submitTitle : undefined}
      >
        <Icon name={busy ? 'loader' : submitIcon} size={14} className={busy ? 'icon-spin' : undefined} />
        {submitLabel}
      </button>
    )}
  </div>
);

export default ModalDismiss;
