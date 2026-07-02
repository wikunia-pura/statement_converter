import React, { useEffect, useRef } from 'react';
import Icon from './Icon';

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

export default ModalDismiss;
