import React, { useEffect, useRef, useState } from 'react';
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const placement = useDropdownPlacement(containerRef, isOpen);

  const valueStr = value == null ? '' : String(value);
  const selected = options.find((o) => o.value === valueStr);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

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

      {isOpen && (
        <div
          className="ui-select__menu"
          role="listbox"
          style={{
            top: placement.top,
            bottom: placement.bottom,
            marginTop: placement.marginTop,
            marginBottom: placement.marginBottom,
            maxHeight: placement.maxHeight,
          }}
        >
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
      )}
    </div>
  );
};

export default Select;
