import React from 'react';

interface LoaderProps {
  /** Optional caption shown under the spinner. */
  label?: string;
}

/**
 * Full-view loading indicator shown while a view fetches its data on entry.
 * Reuses the app's `.loader-spinner` and centers itself in the content area.
 */
const Loader: React.FC<LoaderProps> = ({ label }) => (
  <div className="view-loader" role="status" aria-live="polite">
    <div className="loader-spinner" />
    {label && <span className="view-loader__text">{label}</span>}
  </div>
);

export default Loader;
