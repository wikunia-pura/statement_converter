import React, { useRef, useState } from 'react';
import Icon from './Icon';

interface TagInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** Label of the inline add button, e.g. "Dodaj". */
  addLabel: string;
  /** Accessible label for each chip's remove button, e.g. "Usuń". */
  removeLabel: string;
  id?: string;
  monospace?: boolean;
}

/**
 * A list of short text values edited in one field: the values sit as chips
 * inside an input-looking box, and the user types the next one after them.
 * Enter or the inline button adds it; leaving the field adds it as well, so a
 * typed value is never lost when the user goes straight to "Zapisz".
 */
const TagInput: React.FC<TagInputProps> = ({
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  id,
  monospace,
}) => {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  return (
    <div
      className={`tag-input${monospace ? ' tag-input--mono' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) inputRef.current?.focus();
      }}
    >
      {values.map((value, index) => (
        <span key={`${value}-${index}`} className="tag-input__chip">
          <span className="tag-input__chip-text">{value}</span>
          <button
            type="button"
            className="tag-input__chip-remove"
            onClick={() => remove(index)}
            aria-label={`${removeLabel}: ${value}`}
            title={removeLabel}
          >
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="tag-input__input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : undefined}
      />
      {draft.trim() && (
        <button
          type="button"
          className="tag-input__add"
          // Keep focus in the input: the click adds, the blur must not add twice.
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
        >
          <Icon name="plus" size={12} />
          {addLabel}
          <kbd>Enter</kbd>
        </button>
      )}
    </div>
  );
};

export default TagInput;
