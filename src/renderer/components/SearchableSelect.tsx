import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownPlacement } from '../hooks/useDropdownPlacement';
import { titleIfTruncated, useMenuInViewport } from '../hooks/useMenuInViewport';

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
  /**
   * Draw the menu on top of everything instead of inside the field's container.
   * The normal menu is positioned within its container, so a scrolling parent —
   * a modal's body — clips it or grows a scrollbar around it. With this on, the
   * menu is rendered on `document.body` and pinned to the field's position, so
   * it overlaps whatever is below and the modal can stay as short as its content.
   */
  overlay?: boolean;
  /**
   * With `overlay`: never let the menu be narrower than this (px). A field that
   * is only as wide as a name — a link-like trigger inside a card — would
   * otherwise open a menu as narrow as the name, too small to search in.
   */
  menuMinWidth?: number;
  /** Cap the menu's width in px — long option hints are cut with an ellipsis instead of widening it. */
  menuMaxWidth?: number;
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
  overlay = false,
  menuMinWidth = 0,
  menuMaxWidth,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where the field is on screen, for the overlay menu (viewport coordinates).
  const [anchor, setAnchor] = useState<{
    left: number;
    width: number;
    top: number;
    bottom: number;
  } | null>(null);
  const placement = useDropdownPlacement(containerRef, isOpen, 300);
  // The width the menu opened at, held while the search narrows the list: a menu
  // that shrinks with every typed letter would jump under the pointer.
  const [openWidth, setOpenWidth] = useState<number | null>(null);

  const valueStr = value == null ? '' : String(value);
  const selected = options.find((o) => o.value === valueStr);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [options, query]);
  const shift = useMenuInViewport(menuRef, isOpen, [anchor, filtered]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  // Follows the field while the menu is open: the page can scroll or resize
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

  useLayoutEffect(() => {
    if (!isOpen) {
      setOpenWidth(null);
      return;
    }
    if (openWidth === null && menuRef.current) {
      setOpenWidth(menuRef.current.getBoundingClientRect().width);
    }
  }, [isOpen, anchor, openWidth]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // The overlay menu lives outside the container, so it needs its own check.
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const open = (initialQuery = '') => {
    setIsOpen(true);
    setQuery(initialQuery);
    // Typing to open starts a search, so the first match is the one Enter takes;
    // opening to browse starts on the current value.
    setActiveIndex(
      initialQuery ? 0 : Math.max(0, options.findIndex((o) => o.value === valueStr)),
    );
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

  // The menu, built once so it can render either in place or — with `overlay` —
  // on document.body, pinned to the field.
  const menuStyle: React.CSSProperties =
    overlay && anchor
      ? {
          position: 'fixed',
          left: anchor.left,
          right: 'auto',
          // As wide as the longest option, never narrower than the field; the
          // shift below keeps it inside the window.
          minWidth: Math.max(anchor.width, menuMinWidth, openWidth ?? 0),
          maxWidth: menuMaxWidth,
          // Same flip as the in-place menu, expressed in viewport coordinates.
          ...(placement.bottom !== undefined
            ? { bottom: window.innerHeight - anchor.top + 2 }
            : { top: anchor.bottom + 2 }),
          maxHeight: placement.maxHeight,
          // Above the modal overlay (1000) that the field itself may sit in.
          zIndex: 3000,
          transform: shift ? `translateX(-${shift}px)` : undefined,
        }
      : {
          top: placement.top,
          bottom: placement.bottom,
          marginTop: placement.marginTop,
          marginBottom: placement.marginBottom,
          maxHeight: placement.maxHeight,
          minWidth: openWidth ?? undefined,
          maxWidth: menuMaxWidth,
          transform: shift ? `translateX(-${shift}px)` : undefined,
        };

  const menu = (
    <div
      ref={menuRef}
      className="ui-select__menu ui-select__menu--searchable"
      style={menuStyle}
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
        // A search opened by typing already holds its first letter; the caret
        // belongs after it, or the next letter would land in front.
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
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
        onKeyDown={(e) => {
          if (disabled) return;
          if (isOpen) return;
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Tabbed onto the field and started typing: that is a search, not a
            // keystroke to swallow. The character goes into the filter box, which
            // opens focused, so the person never has to open the list first.
            e.preventDefault();
            open(e.key);
          }
        }}
        disabled={disabled}
        title={title}
        // A value cut with an ellipsis shows in full on hover.
        onMouseEnter={title ? undefined : (e) => titleIfTruncated(e.currentTarget)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={`ui-select__value ${selected ? '' : 'ui-select__value--placeholder'}`}>
          {selected ? selected.label : placeholder ?? ''}
        </span>
      </button>

      {isOpen && (overlay ? (anchor ? createPortal(menu, document.body) : null) : menu)}
    </div>
  );
};

export default SearchableSelect;
