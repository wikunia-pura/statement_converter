import React, { useState } from 'react';
import { AddressBookingGroup } from '../../shared/bookings';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';

/**
 * The priority queue, and nothing else: only the communities that already carry
 * a flag, in their order, to be moved. Kept apart from the dashboard list so
 * that re-ordering five priorities is not a matter of scrolling past sixty
 * communities that have none.
 *
 * The order is edited locally and written once, on "Zapisz kolejność" — a
 * half-finished drag must not renumber the queue the whole team is working from.
 */
const PriorityOrderModal: React.FC<{
  /** The month's flagged communities, already in queue order. */
  groups: AddressBookingGroup[];
  monthLabel: string;
  language: Language;
  saving: boolean;
  onSave: (orderedPriorityIds: number[]) => void;
  onClose: () => void;
}> = ({ groups, monthLabel, language, saving, onSave, onClose }) => {
  const t = translations[language];
  const [order, setOrder] = useState<AddressBookingGroup[]>(groups);
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

  const changed = order.some((g, i) => g.priority?.id !== groups[i]?.priority?.id);

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal ks-prio-modal" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <div className="modal-header">
          <span className="ks-notice__title">
            <Icon name="flag" size={20} /> {t.ksPrioOrderTitle} · {monthLabel}
          </span>
        </div>
        <div className="modal-body">
          <p className="ks-prio-modal__hint">{t.ksPrioOrderHint}</p>
          {order.length === 0 ? (
            <p>{t.ksPrioOrderEmpty}</p>
          ) : (
            <ol className="ks-prio-list">
              {order.map((group, index) => (
                <li
                  key={group.priority!.id}
                  className={`ks-prio-item${dragFrom === index ? ' is-dragging' : ''}${
                    dragOver === index && dragFrom !== null && dragFrom !== index ? ' is-over' : ''
                  }`}
                  draggable={!saving}
                  onDragStart={(e) => {
                    setDragFrom(index);
                    e.dataTransfer.effectAllowed = 'move';
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
                  <span className="ks-prio-item__rank">{index + 1}</span>
                  <span className="ks-prio-item__text">
                    <span className="ks-prio-item__name">{group.nazwa}</span>
                    {group.priority?.notatka && (
                      <span className="ks-prio-item__note">{group.priority.notatka}</span>
                    )}
                  </span>
                  <span className="ks-prio-item__moves">
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={saving || index === 0}
                      title={t.ksPrioMoveUp}
                      aria-label={`${t.ksPrioMoveUp}: ${group.nazwa}`}
                    >
                      <Icon name="arrow-up" size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={saving || index === order.length - 1}
                      title={t.ksPrioMoveDown}
                      aria-label={`${t.ksPrioMoveDown}: ${group.nazwa}`}
                    >
                      <Icon name="arrow-down" size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={saving || !changed}
            onClick={() => onSave(order.map((g) => g.priority!.id))}
          >
            {t.ksPrioOrderSave}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PriorityOrderModal;
