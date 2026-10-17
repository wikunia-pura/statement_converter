import React from 'react';

interface LoaderProps {
  /** Optional caption shown under the progress line. */
  label?: string;
}

/** Thin indeterminate bar: a short segment running from left to right. */
const ProgressLine: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className ? `progress-line ${className}` : 'progress-line'} aria-hidden="true" />
);

/**
 * Full-view loading indicator shown while a view fetches its data on entry:
 * a progress line across the top of the content area and a muted caption.
 *
 * Only for that first fetch: a reload after a save must update the content in
 * place. Showing the loader again swaps out `.content-body`, the element that
 * scrolls, so the user would land back at the top of a long list.
 */
const Loader: React.FC<LoaderProps> = ({ label }) => (
  <div className="view-loader" role="status" aria-live="polite">
    <ProgressLine />
    {label && <span className="view-loader__text">{label}</span>}
  </div>
);

/**
 * Blocks the whole window while a long operation (an import) runs. The window
 * stays visible under a light veil; a progress line runs along its top edge
 * with a small chip saying what is happening.
 */
export const BusyOverlay: React.FC<{ label: string }> = ({ label }) => (
  <div className="busy-overlay" role="status" aria-live="polite">
    <ProgressLine className="progress-line--window" />
    <span className="busy-overlay__label">{label}</span>
  </div>
);

export default Loader;
