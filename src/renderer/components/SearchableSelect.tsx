import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDropdownPlacement } from '../hooks/useDropdownPlacement';

export interface SearchableOption {
  /** Option value. Numbers should be pre-stringified by the caller. */
  value: string;
  label: string;
  /** Second line under the label — a mailbox, a symbol, a lead-in sentence. */
  hint?: string;
  /** Extra text the filter should match beyond label + hint. */
  keywords?: string;
}

interface SearchableSelectProps {
  value: string | number | null | undefined;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown inside the menu when the query matches nothing. */
  emptyText?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * `Select` plus a filter box in the open menu — the same dropdown the review
 * screen uses for contractors, extracted so every long list in the app is picked
 * the same way. Long dictionaries (communities, dynamic fields) are unusable as a
 * plain option list: you cannot scan a hundred entries, you type two letters.
 *
 * Keeping the caller in control of `value` also makes this usable as an *action*
 * picker: pass a permanently empty value and the trigger stays on its
 * placeholder, so the same widget works for "insert a field here".
 */
const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  size = 'md',
  disabled = false,
  title,
  ariaLabel,
  style,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const placement = useDropdownPlacement(containerRef, isOpen, 300);

  const valueStr = value == null ? '' : String(value);
  const selected = options.find((o) => o.value === valueStr);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const open = () => {
    setIsOpen(true);
    setQuery('');
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === valueStr)));
  };

  const pick = (v: string) => {
    onChange(v);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) pick(filtered[activeIndex].value);
    }
  };

  const sizeClass = size === 'sm' ? 'ui-select--sm' : size === 'lg' ? 'ui-select--lg' : '';

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
        onKeyDown={(e) => {
          if (disabled) return;
          if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            open();
          }
        }}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={`ui-select__value ${selected ? '' : 'ui-select__value--placeholder'}`}>
          {selected ? selected.label : placeholder ?? ''}
        </span>
      </button>

      {isOpen && (
        <div
          className="ui-select__menu ui-select__menu--searchable"
          style={{
            top: placement.top,
            bottom: placement.bottom,
            marginTop: placement.marginTop,
            marginBottom: placement.marginBottom,
            maxHeight: placement.maxHeight,
          }}
        >
          <input
            className="ui-select__search"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder ?? ''}
            autoFocus
          />
          <div className="ui-select__options" role="listbox">
            {filtered.map((opt, i) => (
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
                title={opt.hint ? `${opt.label} — ${opt.hint}` : opt.label}
              >
                <div className="ui-select__option-label">{opt.label}</div>
                {opt.hint && <div className="ui-select__option-hint">{opt.hint}</div>}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="ui-select__empty">{emptyText ?? ''}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
