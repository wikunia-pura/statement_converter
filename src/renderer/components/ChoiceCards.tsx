import { useId } from 'react';
import Icon from './Icon';

export interface ChoiceCardOption<V extends string> {
  value: V;
  label: string;
  /** One line on what picking this means — the question a user actually has. */
  hint?: string;
}

interface ChoiceCardsProps<V extends string> {
  options: ChoiceCardOption<V>[];
  selected: V[];
  onToggle: (value: V) => void;
  disabled?: boolean;
  /** Exactly one of the options (a radio group): round marks, `onToggle` picks. */
  single?: boolean;
  /** One card per row — for options whose hints run longer than a few words. */
  stacked?: boolean;
}

/**
 * A few independent on/off options as tickable cards — name + one-line hint,
 * the app checkbox, accent fill when on. For short fixed sets (recipient
 * groups, contractor kinds); long lists use CheckList. `single` makes it a
 * pick-one group with radio marks.
 */
function ChoiceCards<V extends string>({ options, selected, onToggle, disabled, single, stacked }: ChoiceCardsProps<V>) {
  const name = useId();
  return (
    <div className={`choice-cards${stacked ? ' choice-cards--stacked' : ''}`} role={single ? 'radiogroup' : undefined}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={`choice-card${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
          >
            <span className={`ks-check${single ? ' ks-check--radio' : ''}${on ? ' is-on' : ''}`}>
              <input
                type={single ? 'radio' : 'checkbox'}
                name={single ? name : undefined}
                className="ks-check__input"
                checked={on}
                disabled={disabled}
                onChange={() => onToggle(option.value)}
              />
              <span className="ks-check__box" aria-hidden="true">
                {single ? <span className="ks-check__dot" /> : <Icon name="check" size={12} strokeWidth={3} />}
              </span>
            </span>
            <span className="choice-card__text">
              <span className="choice-card__label">{option.label}</span>
              {option.hint && <span className="choice-card__hint">{option.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default ChoiceCards;
