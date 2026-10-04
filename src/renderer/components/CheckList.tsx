import React, { useMemo, useState } from 'react';
import Icon from './Icon';

export interface CheckListItem {
  id: number;
  label: string;
  /** Short status on the right — e.g. what ticking / unticking this row will do. */
  note?: string;
  noteTone?: 'muted' | 'warning' | 'danger';
  /** A small button at the row's end (e.g. "preview this one"); it does not toggle the row. */
  action?: React.ReactNode;
  /** Marks the row the rest of the screen is about (e.g. the previewed letter). */
  highlighted?: boolean;
}

interface CheckListProps {
  items: CheckListItem[];
  selected: number[];
  onChange: (selected: number[]) => void;
  searchPlaceholder: string;
  /** "Tylko zaznaczone" — narrows the list to what is ticked, for a final check. */
  onlySelectedLabel: string;
  emptyLabel: string;
}

/**
 * Pick several records from a long list: a search box, a "ticked only" switch
 * and a scrolling list of checkbox rows, each with an optional note saying what
 * the tick changes (e.g. "przejmie od: DOM Służewiec").
 */
const CheckList: React.FC<CheckListProps> = ({
  items,
  selected,
  onChange,
  searchPlaceholder,
  onlySelectedLabel,
  emptyLabel,
}) => {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!onlySelected || selectedSet.has(item.id)) &&
        (!q || item.label.toLowerCase().includes(q)),
    );
  }, [items, query, onlySelected, selectedSet]);

  const toggle = (id: number) =>
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="check-list">
      <div className="check-list__toolbar">
        <div className="input-icon">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
        <button
          type="button"
          className={`button button-small ${onlySelected ? 'button-primary' : 'button-subtle'}`}
          onClick={() => setOnlySelected((v) => !v)}
          aria-pressed={onlySelected}
        >
          <Icon name="check" size={13} />
          {onlySelectedLabel}
        </button>
      </div>
      <div className="check-list__items" role="group">
        {visible.length === 0 ? (
          <div className="check-list__empty">{emptyLabel}</div>
        ) : (
          visible.map((item) => {
            const on = selectedSet.has(item.id);
            return (
              <label
                key={item.id}
                className={`check-list__row${on ? ' is-on' : ''}${item.highlighted ? ' is-highlighted' : ''}`}
              >
                <span className={`ks-check${on ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    className="ks-check__input"
                    checked={on}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="ks-check__box" aria-hidden="true">
                    <Icon name="check" size={12} strokeWidth={3} />
                  </span>
                </span>
                <span className="check-list__label">{item.label}</span>
                {item.note && (
                  <span className={`check-list__note check-list__note--${item.noteTone ?? 'muted'}`}>
                    {item.note}
                  </span>
                )}
                {item.action && (
                  // A click on the action is its own: inside a <label> it would
                  // otherwise also toggle the row's checkbox.
                  <span className="check-list__action" onClick={(e) => e.preventDefault()}>
                    {item.action}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CheckList;
