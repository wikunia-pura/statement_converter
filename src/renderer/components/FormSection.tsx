import React, { useState } from 'react';
import Icon, { IconName } from './Icon';

interface FormSectionProps {
  icon: IconName;
  title: string;
  /** One sentence saying what the section is for, in the user's terms. */
  description?: string;
  /**
   * A state of the section, shown as a badge beside the title ("Zmieniono dla tej
   * wysyłki"). Status only — anything clickable belongs in `aside`.
   */
  badge?: React.ReactNode;
  /** Right side of the header — the section's count and its actions. */
  aside?: React.ReactNode;
  /** The header folds the section away — for long lists that take a screen. */
  collapsible?: boolean;
  /** Folded on first show (until the user decides otherwise, see `persistKey`). */
  defaultCollapsed?: boolean;
  /** Remember the user's fold per section across visits (this computer only). */
  persistKey?: string;
  /**
   * Shown instead of the description while folded: what the section holds
   * ("Zaznaczone: …"), so folding never hides the answer, only the controls.
   */
  collapsedSummary?: React.ReactNode;
  children: React.ReactNode;
}

const storageKey = (key: string) => `formSection.collapsed:${key}`;

function readCollapsed(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey(key));
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

/**
 * A titled, bordered group of related fields — in a modal form or a page form.
 * Splitting a long form into sections ("Dane podstawowe", "Rachunki bankowe", …)
 * makes it obvious which inputs belong together and what each group is for.
 * A `collapsible` one folds to its header, which then says what it holds.
 */
export const FormSection: React.FC<FormSectionProps> = ({
  icon,
  title,
  description,
  badge,
  aside,
  collapsible,
  defaultCollapsed,
  persistKey,
  collapsedSummary,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? readCollapsed(persistKey, !!defaultCollapsed) : false,
  );

  const toggle = () =>
    setCollapsed((was) => {
      const next = !was;
      if (persistKey) {
        try {
          window.localStorage.setItem(storageKey(persistKey), next ? '1' : '0');
        } catch {
          // Storage unavailable — the fold just isn't remembered.
        }
      }
      return next;
    });

  const shownDescription = collapsed && collapsedSummary != null ? collapsedSummary : description;
  const heading = (
    <>
      <span className="form-section__icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="form-section__heading">
        <div className="form-section__title-row">
          <h3 className="form-section__title">{title}</h3>
          {badge && <span className="form-section__badge">{badge}</span>}
        </div>
        {shownDescription && (
          <p className={`form-section__description${collapsed ? ' is-summary' : ''}`}>{shownDescription}</p>
        )}
      </div>
    </>
  );

  return (
    <section className={`form-section${collapsible ? ' is-collapsible' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      {/* A collapsible header is one target: the whole bar lights up and toggles,
          not just the title or the chevron. The toggle button stays for the keyboard
          (its click bubbles up to the bar); the aside's own controls do not toggle. */}
      <header className="form-section__header" onClick={collapsible ? toggle : undefined}>
        {collapsible ? (
          <button type="button" className="form-section__toggle" aria-expanded={!collapsed}>
            {heading}
          </button>
        ) : (
          heading
        )}
        {aside && (
          <div className="form-section__aside" onClick={collapsible ? (e) => e.stopPropagation() : undefined}>
            {aside}
          </div>
        )}
        {collapsible && (
          <span className="form-section__chevron" aria-hidden="true">
            <Icon name="chevron-down" size={16} />
          </span>
        )}
      </header>
      {!collapsed && <div className="form-section__body">{children}</div>}
    </section>
  );
};

interface FormFieldProps {
  label: string;
  /** Points the label at its input, so clicking the label focuses it. */
  htmlFor?: string;
  required?: boolean;
  /**
   * Short helper text, shown under the control: above it, a hint pushes the
   * control down and fields side by side in a `FormRow` stop lining up.
   */
  hint?: React.ReactNode;
  /** Validation message shown under the control. */
  error?: string | null;
  /**
   * A small action on the label's line, right-aligned ("Przywróć", "Dodaj
   * wszystkich", "Zarządzaj") — an action only, never a count.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** One labelled control: label (+ required mark) → control → hint → error. */
export const FormField: React.FC<FormFieldProps> = ({ label, htmlFor, required, hint, error, action, children }) => (
  <div className="form-field">
    <div className="form-field__label-row">
      <label className="form-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="form-field__required" aria-hidden="true">*</span>}
      </label>
      {action && <span className="form-field__action">{action}</span>}
    </div>
    {children}
    {hint && <div className="form-field__hint">{hint}</div>}
    {error && (
      <div className="form-field__error" role="alert">
        <Icon name="alert-circle" size={13} />
        {error}
      </div>
    )}
  </div>
);

/** Two (or more) fields side by side; collapses to one column when narrow. */
export const FormRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="form-row">{children}</div>
);

/** "* pole wymagane" — the footer note of a form that has required fields. */
export const RequiredNote: React.FC<{ label: string }> = ({ label }) => (
  <span className="form-required-note">
    <span className="form-field__required" aria-hidden="true">*</span>
    {label}
  </span>
);
