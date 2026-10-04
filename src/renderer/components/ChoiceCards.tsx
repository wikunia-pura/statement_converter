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
}

/**
 * A few independent on/off options as tickable cards — name + one-line hint,
 * the app checkbox, accent fill when on. For short fixed sets (recipient
 * groups, contractor kinds); long lists use CheckList.
 */
function ChoiceCards<V extends string>({ options, selected, onToggle, disabled }: ChoiceCardsProps<V>) {
  return (
    <div className="choice-cards">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={`choice-card${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
          >
            <span className={`ks-check${on ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                className="ks-check__input"
                checked={on}
                disabled={disabled}
                onChange={() => onToggle(option.value)}
              />
              <span className="ks-check__box" aria-hidden="true">
                <Icon name="check" size={12} strokeWidth={3} />
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
