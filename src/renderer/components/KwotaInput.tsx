import React, { useEffect, useState } from 'react';
import { formatKwota } from '../../shared/sprawozdanie';

/** "1 234,56", "1234.56", "-12,5" → number; empty → 0. Null when it is not a number. */
export function parseKwota(text: string): number | null {
  const t = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '' || t === '-') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * An amount typed the Polish way. Shows the formatted figure ("12 345,60")
 * until focused, then the plain digits for editing; the number reaches
 * `onChange` as it is typed, so totals beside it follow along.
 */
const KwotaInput: React.FC<{
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Format without the thousands separator — for small numbers like months. */
  integer?: boolean;
  min?: number;
  max?: number;
}> = ({ value, onChange, ariaLabel, disabled, className, integer, min, max }) => {
  const shown = (n: number) => (integer ? String(Math.round(n)) : formatKwota(n));
  const [text, setText] = useState(shown(value));
  const [focused, setFocused] = useState(false);

  // An outside change (a reload, a recalculation) shows up unless the user is typing.
  useEffect(() => {
    if (!focused) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const invalid = parseKwota(text) === null;

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`kwota-input${invalid ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
      value={text}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true);
        setText(integer ? String(Math.round(value)) : String(value).replace('.', ','));
        // Select on focus so a typed number replaces the old one.
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(false);
        setText(shown(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        let n = parseKwota(e.target.value);
        if (n === null) return;
        if (integer) n = Math.round(n);
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onChange(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
};

export default KwotaInput;
