import React, { useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';

/** The id a separator has in a saved order. Views appear once; separators as often as wanted. */
export const SIDEBAR_DIVIDER = 'divider';
/**
 * A hidden menu item keeps its place in the saved order, written as `!<id>`, so
 * showing it again puts it back where it was. A build that predates hiding drops
 * the unknown id and re-adds the view — it shows up rather than goes missing.
 */
export const SIDEBAR_HIDDEN_PREFIX = '!';

export const isHiddenSidebarId = (id: string) => id.startsWith(SIDEBAR_HIDDEN_PREFIX);
export const sidebarIdOf = (id: string) => (isHiddenSidebarId(id) ? id.slice(SIDEBAR_HIDDEN_PREFIX.length) : id);

export interface SidebarOrderItem {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  /** Left out of the menu, still listed here so it can be shown again. */
  hidden?: boolean;
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
  /** The same dialog for another list (the dashboard's tiles): its own heading. */
  title?: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Icon>['name'];
  /** Separators belong to the menu only. */
  allowDividers?: boolean;
  /** Items that can be left out of the list (the menu); the saved order marks them `!<id>`. */
  allowHide?: boolean;
  /** Items that must stay visible — Ustawienia, the only way back to this dialog. */
  unhideableIds?: string[];
}> = ({
  items,
  defaultOrder,
  language,
  saving,
  onSave,
  onClose,
  title,
  subtitle,
  icon = 'menu',
  allowDividers = true,
  allowHide = false,
  unhideableIds = [],
}) => {
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
  const toggleHidden = (index: number) =>
    setOrder((prev) => prev.map((r, i) => (i === index ? { ...r, hidden: !r.hidden } : r)));

  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
  const encode = (r: SidebarOrderItem) => (r.hidden ? `${SIDEBAR_HIDDEN_PREFIX}${r.id}` : r.id);
  const ids = order.map(encode);
  const changed = !sameIds(ids, items.map(encode));
  const isDefault = sameIds(ids, defaultOrder);

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal ks-prio-modal" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon={icon} title={title ?? t.sidebarOrderTitle} subtitle={subtitle ?? t.sidebarOrderHint} />
        <div className="modal-body">
          <ol className="ks-prio-list">
            {order.map((item, index) => (
              <li
                key={item.key}
                className={`ks-prio-item${item.id === SIDEBAR_DIVIDER ? ' ks-prio-item--divider' : ''}${
                  item.hidden ? ' is-hidden' : ''
                }${dragFrom === index ? ' is-dragging' : ''}${
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
                      {item.hidden && <span className="ks-prio-item__note">{t.sidebarOrderHiddenNote}</span>}
                    </span>
                  </>
                )}
                <span className="ks-prio-item__moves">
                  {allowHide && item.id !== SIDEBAR_DIVIDER && !unhideableIds.includes(item.id) && (
                    <button
                      type="button"
                      className={item.hidden ? 'is-off' : undefined}
                      onClick={() => toggleHidden(index)}
                      disabled={saving}
                      title={item.hidden ? t.sidebarOrderShow : t.sidebarOrderHide}
                      aria-label={`${item.hidden ? t.sidebarOrderShow : t.sidebarOrderHide}: ${item.label}`}
                      aria-pressed={item.hidden === true}
                    >
                      <Icon name={item.hidden ? 'eye-off' : 'eye'} size={15} />
                    </button>
                  )}
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
          {allowDividers && (
          <div className="list-after">
            <button
              type="button"
              className="button button-small button-subtle"
              disabled={saving}
              onClick={() => setOrder((prev) => [...prev, newDivider()])}
            >
              <Icon name="plus" size={13} /> {t.sidebarOrderAddDivider}
            </button>
          </div>
          )}
        </div>
        <ModalFooter
          note={
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={resetToDefault}
              disabled={saving || isDefault}
            >
              <Icon name="undo" size={13} /> {t.sidebarOrderReset}
            </button>
          }
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => onSave(isDefault ? null : ids)}
          submitLabel={t.sidebarOrderSave}
          submitDisabled={!changed}
          submitTitle={t.noChangesToSave}
          busy={saving}
        />
      </div>
    </div>
  );
};

export default SidebarOrderModal;
