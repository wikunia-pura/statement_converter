import React from 'react';
import { FormField } from './FormSection';
import Icon from './Icon';

/**
 * The user's guidance for an AI draft and the button that asks for it — the
 * same box wherever the AI writes something the user then reviews and edits
 * (a statement's introduction, a plan's advance rate).
 */
export const AiWskazowkiPanel: React.FC<{
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  generateLabel: string;
  onGenerate: () => void;
  /** Closes the box; absent = it stays (offered while there is nothing to read yet). */
  onCancel?: () => void;
  cancelLabel: string;
  disabled?: boolean;
}> = ({ id, label, hint, placeholder, value, onChange, generateLabel, onGenerate, onCancel, cancelLabel, disabled }) => (
  <div className="zfin-ai-panel">
    <FormField label={label} htmlFor={id} hint={hint}>
      <textarea
        id={id}
        rows={3}
        value={value}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </FormField>
    <div className="section-actions">
      {onCancel && (
        <button type="button" className="button button-small button-secondary" onClick={onCancel} disabled={disabled}>
          {cancelLabel}
        </button>
      )}
      <button type="button" className="button button-small button-primary" onClick={onGenerate} disabled={disabled}>
        <Icon name="sparkles" size={13} /> {generateLabel}
      </button>
    </div>
  </div>
);

/** What shows while the AI works: a spinner, what it is doing, and a skeleton of the text to come. */
export const AiWorking: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="zlacz-ai-working" role="status" aria-live="polite">
    <div className="zlacz-ai-working__head">
      <span className="loader-spinner zlacz-ai-working__spinner" aria-hidden="true" />
      <span className="zlacz-ai-working__text">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
    </div>
    <div className="zlacz-ai-working__skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  </div>
);
