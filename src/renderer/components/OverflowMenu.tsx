import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon, { IconName } from './Icon';

export interface OverflowMenuItem {
  icon: IconName;
  label: string;
  onClick: () => void;
  /** Hover explanation of what the item does. */
  title?: string;
  disabled?: boolean;
  /** Destructive (delete): red, and kept last behind a divider. */
  danger?: boolean;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** The trigger's accessible name ("Więcej akcji"). */
  label: string;
  disabled?: boolean;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * "⋯" — the actions a row or card offers but rarely needs: clone, a state
 * change, delete. Keeping them here leaves one visible action per row.
 *
 * The menu is drawn on `document.body`, pinned to the trigger, so a scrolling
 * panel (the calendar's day list, a modal body) never clips it.
 */
const OverflowMenu: React.FC<OverflowMenuProps> = ({ items, label, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Right-aligned under the trigger; flipped above it near the window's bottom.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = menu?.width ?? 200;
      const height = menu?.height ?? 0;
      const below = trigger.bottom + MENU_GAP;
      const top =
        below + height > window.innerHeight - VIEWPORT_MARGIN && trigger.top - MENU_GAP - height > VIEWPORT_MARGIN
          ? trigger.top - MENU_GAP - height
          : below;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(trigger.right - width, window.innerWidth - width - VIEWPORT_MARGIN));
      setPos({ top, left });
    };
    place();
    // Once more after the menu has a size to measure.
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    // A fixed menu would float away from a trigger that scrolls; closing is simpler.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const regular = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);

  const renderItem = (item: OverflowMenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={`menu-popover__item${item.danger ? ' is-danger' : ''}`}
      title={item.title}
      disabled={item.disabled}
      onClick={() => {
        setOpen(false);
        item.onClick();
      }}
    >
      <Icon name={item.icon} size={14} /> {item.label}
    </button>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`button button-ghost button-icon overflow-menu__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more" size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu-popover overflow-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              right: 'auto',
              zIndex: 3000,
            }}
          >
            {regular.map(renderItem)}
            {regular.length > 0 && danger.length > 0 && <div className="overflow-menu__divider" />}
            {danger.map(renderItem)}
          </div>,
          document.body,
        )}
    </>
  );
};

export default OverflowMenu;
