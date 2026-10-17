import React from 'react';

interface LoaderProps {
  /** Optional caption shown under the progress line. */
  label?: string;
  /** Draw inside the surrounding box (a modal, a section) instead of over the window. */
  inline?: boolean;
}

/** Thin indeterminate bar: a short segment running from left to right. */
const ProgressLine: React.FC = () => <div className="progress-line" aria-hidden="true" />;

/**
 * Loading indicator shown while a view fetches its data on entry: the window
 * stays visible under a soft blur and a progress line runs across its full
 * width at the vertical middle. Clicks pass through, so the sidebar still works.
 * With `inline` it draws inside its box instead — for a modal or a section.
 *
 * Only for that first fetch: a reload after a save must update the content in
 * place. Showing the loader again swaps out `.content-body`, the element that
 * scrolls, so the user would land back at the top of a long list.
 */
const Loader: React.FC<LoaderProps> = ({ label, inline }) => {
  const cls = inline ? 'inline-loader' : 'view-loader';
  return (
    <div className={cls} role="status" aria-live="polite">
      <ProgressLine />
      {label && <span className={`${cls}__text`}>{label}</span>}
    </div>
  );
};

/**
 * Blocks the whole window while a long operation (an import) runs. The window
 * stays visible under a soft blur; a progress line runs across its full width
 * at the vertical middle, with a small chip under it saying what is happening.
 */
export const BusyOverlay: React.FC<{ label: string }> = ({ label }) => (
  <div className="busy-overlay" role="status" aria-live="polite">
    <ProgressLine />
    <span className="busy-overlay__label">{label}</span>
  </div>
);

export default Loader;
