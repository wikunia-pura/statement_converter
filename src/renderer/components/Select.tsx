import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownPlacement } from '../hooks/useDropdownPlacement';

export interface SelectOption {
  /** Option value. Numbers should be pre-stringified by the caller. */
  value: string;
  label: React.ReactNode;
  /** Plain-text used for the trigger when label is a node; defaults to label if it's a string. */
  triggerLabel?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string | number | null | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
  /**
   * Draw the menu on top of everything, as `SearchableSelect`'s `overlay` does:
   * rendered on `document.body` and pinned to the field, so a modal's scrolling
   * body neither clips it nor grows a scrollbar around it.
   */
  overlay?: boolean;
}

/**
 * Design-system dropdown that replaces the native <select>. A native select's
 * open option list is an OS popup that CSS can't restyle; this renders the list
 * itself so it matches the app in both themes. Click / keyboard driven, closes
 * on outside-click or Escape, and flips up near the viewport edge.
 */
const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  size = 'md',
  disabled = false,
  title,
  ariaLabel,
  style,
  className,
  overlay = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where the field is on screen, for the overlay menu (viewport coordinates).
  const [anchor, setAnchor] = useState<{
    left: number;
    width: number;
    top: number;
    bottom: number;
  } | null>(null);
  const placement = useDropdownPlacement(containerRef, isOpen);

  const valueStr = value == null ? '' : String(value);
  const selected = options.find((o) => o.value === valueStr);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // The overlay menu lives outside the container, so it needs its own check.
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Follows the field while the overlay menu is open: the modal body can scroll
  // under a fixed menu, and one that stays behind would float over nothing.
  useLayoutEffect(() => {
    if (!isOpen || !overlay) return;
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setAnchor({ left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    // Capture: scrolling happens in an inner container, and scroll does not bubble.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, overlay]);

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const pick = (v: string) => {
    onChange(v);
    close();
  };

  const open = () => {
    setIsOpen(true);
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === valueStr)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) pick(options[activeIndex].value);
    }
  };

  const sizeClass = size === 'sm' ? 'ui-select--sm' : size === 'lg' ? 'ui-select--lg' : '';
  const triggerText = selected
    ? selected.triggerLabel ?? selected.label
    : placeholder ?? '';

  const menuStyle: React.CSSProperties =
    overlay && anchor
      ? {
          position: 'fixed',
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - anchor.width - 8)),
          right: 'auto',
          width: anchor.width,
          ...(placement.bottom !== undefined
            ? { bottom: window.innerHeight - anchor.top + 2 }
            : { top: anchor.bottom + 2 }),
          maxHeight: placement.maxHeight,
          // Above the modal overlay (1000) that the field itself may sit in.
          zIndex: 3000,
        }
      : {
          top: placement.top,
          bottom: placement.bottom,
          marginTop: placement.marginTop,
          marginBottom: placement.marginBottom,
          maxHeight: placement.maxHeight,
        };

  const menu = (
    <div ref={menuRef} className="ui-select__menu" role="listbox" style={menuStyle}>
      {options.map((opt, i) => (
        <div
          key={opt.value}
          role="option"
          aria-selected={opt.value === valueStr}
          className={
            'ui-select__option' +
            (opt.value === valueStr ? ' is-selected' : '') +
            (i === activeIndex ? ' is-active' : '')
          }
          onClick={() => pick(opt.value)}
          onMouseEnter={() => setActiveIndex(i)}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`ui-select ${sizeClass} ${disabled ? 'ui-select--disabled' : ''} ${className || ''}`.trim()}
      style={style}
    >
      <button
        type="button"
        className="ui-select__trigger"
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={`ui-select__value ${selected ? '' : 'ui-select__value--placeholder'}`}>
          {triggerText}
        </span>
      </button>

      {isOpen && (overlay ? (anchor ? createPortal(menu, document.body) : null) : menu)}
    </div>
  );
};

export default Select;
