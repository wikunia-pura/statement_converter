import React, { useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';

/** The id a separator has in a saved order. Views appear once; separators as often as wanted. */
export const SIDEBAR_DIVIDER = 'divider';

export interface SidebarOrderItem {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Icon>['name'];
}

/** A row in the dialog: a menu item or a separator, with a key of its own. */
interface Row extends SidebarOrderItem {
  key: string;
}

/**
 * The menu's order, to be arranged. Edited locally and written once, on the save
 * button — a half-finished drag must not rearrange the menu the person is
 * clicking through. Same shape as the priority queue's dialog.
 */
const SidebarOrderModal: React.FC<{
  /** Every item, in the order the menu has now. */
  items: SidebarOrderItem[];
  /** The order the menu starts in, for "restore default". */
  defaultOrder: string[];
  language: Language;
  saving: boolean;
  /** null = back to the default. */
  onSave: (order: string[] | null) => void;
  onClose: () => void;
}> = ({ items, defaultOrder, language, saving, onSave, onClose }) => {
  const t = translations[language];
  const dividerCount = useRef(0);
  const newDivider = (): Row => ({
    key: `${SIDEBAR_DIVIDER}-${dividerCount.current++}`,
    id: SIDEBAR_DIVIDER,
    label: t.sidebarOrderDivider,
    icon: 'align-justify',
  });
  const [order, setOrder] = useState<Row[]>(() =>
    items.map((item) => (item.id === SIDEBAR_DIVIDER ? newDivider() : { ...item, key: item.id })),
  );
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const resetToDefault = () => {
    const byId = new Map(items.map((i) => [i.id, i] as const));
    setOrder(
      defaultOrder.flatMap((id): Row[] => {
        if (id === SIDEBAR_DIVIDER) return [newDivider()];
        const item = byId.get(id);
        return item ? [{ ...item, key: item.id }] : [];
      }),
    );
  };

  const removeAt = (index: number) => setOrder((prev) => prev.filter((_, i) => i !== index));

  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
  const ids = order.map((r) => r.id);
  const changed = !sameIds(ids, items.map((i) => i.id));
  const isDefault = sameIds(ids, defaultOrder);

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal ks-prio-modal" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <div className="modal-header">
          <span className="ks-notice__title">
            <Icon name="menu" size={20} /> {t.sidebarOrderTitle}
          </span>
        </div>
        <div className="modal-body">
          <p className="ks-prio-modal__hint">{t.sidebarOrderHint}</p>
          <ol className="ks-prio-list">
            {order.map((item, index) => (
              <li
                key={item.key}
                className={`ks-prio-item${item.id === SIDEBAR_DIVIDER ? ' ks-prio-item--divider' : ''}${dragFrom === index ? ' is-dragging' : ''}${
                  dragOver === index && dragFrom !== null && dragFrom !== index ? ' is-over' : ''
                }`}
                draggable={!saving}
                onDragStart={(e) => {
                  setDragFrom(index);
                  e.dataTransfer.effectAllowed = 'move';
                  // Some engines refuse a drag that carries no payload.
                  e.dataTransfer.setData('text/plain', item.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== index) setDragOver(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, index);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <span className="ks-prio-item__grip" aria-hidden="true">
                  <Icon name="grip" size={16} />
                </span>
                {item.id === SIDEBAR_DIVIDER ? (
                  <span className="ks-prio-item__text">
                    <span className="ks-prio-item__rule" aria-hidden="true" />
                    <span className="ks-prio-item__note">{item.label}</span>
                  </span>
                ) : (
                  <>
                    <span className="ks-prio-item__grip" aria-hidden="true">
                      <Icon name={item.icon} size={16} />
                    </span>
                    <span className="ks-prio-item__text">
                      <span className="ks-prio-item__name">{item.label}</span>
                    </span>
                  </>
                )}
                <span className="ks-prio-item__moves">
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={saving || index === 0}
                    title={t.sidebarMoveUp}
                    aria-label={`${t.sidebarMoveUp}: ${item.label}`}
                  >
                    <Icon name="arrow-up" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={saving || index === order.length - 1}
                    title={t.sidebarMoveDown}
                    aria-label={`${t.sidebarMoveDown}: ${item.label}`}
                  >
                    <Icon name="arrow-down" size={15} />
                  </button>
                  {item.id === SIDEBAR_DIVIDER && (
                    <button
                      type="button"
                      onClick={() => removeAt(index)}
                      disabled={saving}
                      title={t.sidebarOrderRemoveDivider}
                      aria-label={t.sidebarOrderRemoveDivider}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="button button-secondary button-small"
            style={{ marginTop: 'var(--s-3)' }}
            disabled={saving}
            onClick={() => setOrder((prev) => [...prev, newDivider()])}
          >
            <Icon name="plus" size={13} /> {t.sidebarOrderAddDivider}
          </button>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={resetToDefault}
            disabled={saving || isDefault}
          >
            <Icon name="undo" size={14} /> {t.sidebarOrderReset}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={saving || !changed}
            onClick={() => onSave(isDefault ? null : ids)}
          >
            {t.sidebarOrderSave}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarOrderModal;
