import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from '../translations';

interface LoaderText {
  loading: string;
  loaderQuips: readonly string[];
}

/**
 * The loader's words in the app's language. App provides its translations
 * around every screen, so the 40-odd loaders need not be passed a language one
 * by one. Polish outside a provider.
 */
export const LoaderTextContext = createContext<LoaderText>(translations.pl);

/** How long each quip stays under the caption. */
const QUIP_MS = 2800;

/** The line under the caption, moving on to the next quip every few seconds. */
const Quip: React.FC = () => {
  const { loaderQuips } = useContext(LoaderTextContext);
  // Start somewhere random, so loader after loader does not open on the same line.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * loaderQuips.length));
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => i + 1), QUIP_MS);
    return () => clearInterval(id);
  }, []);
  // Keyed by the counter, so every new line fades in afresh.
  return (
    <span key={index} className="loader-caption__quip" aria-hidden="true">
      {loaderQuips[index % loaderQuips.length]}
    </span>
  );
};

/** An accent arc turning over a faint track while it stretches and shrinks. */
const Spinner: React.FC = () => (
  <svg className="loader-spinner-ring" viewBox="0 0 44 44" aria-hidden="true">
    <circle className="loader-spinner-ring__track" cx="22" cy="22" r="20" />
    <circle className="loader-spinner-ring__arc" cx="22" cy="22" r="20" />
  </svg>
);

/**
 * The spinner with the caption under it. The caption is what screen readers
 * hear; the quips are only for the eye.
 */
const LoaderStage: React.FC<{ label?: string }> = ({ label }) => {
  const { loading } = useContext(LoaderTextContext);
  return (
    <div className="loader-stage">
      <Spinner />
      <div className="loader-caption">
        <span className={label ? 'loader-caption__label' : 'loader-caption__sr'}>{label ?? loading}</span>
        <Quip />
      </div>
    </div>
  );
};

interface LoaderProps {
  /** What is being loaded, shown under the spinner. */
  label?: string;
  /** Draw inside the surrounding box (a modal, a section) instead of over the view. */
  inline?: boolean;
}

/**
 * Loading indicator shown while a view fetches its data on entry: the spinner
 * in the middle of the content area, over a soft veil. Clicks pass through,
 * so the sidebar still works. With `inline` it draws a smaller spinner inside
 * its box instead — for a modal or a section.
 *
 * Only for that first fetch: a reload after a save must update the content in
 * place. Showing the loader again swaps out `.content-body`, the element that
 * scrolls, so the user would land back at the top of a long list.
 */
const Loader: React.FC<LoaderProps> = ({ label, inline }) => (
  <div className={inline ? 'inline-loader' : 'view-loader'} role="status" aria-live="polite">
    <LoaderStage label={label} />
  </div>
);

/**
 * Blocks the whole window while a long operation (an import) runs: the same
 * spinner over a veil across the window, saying what is happening.
 */
export const BusyOverlay: React.FC<{ label: string }> = ({ label }) => (
  <div className="busy-overlay" role="status" aria-live="polite">
    <LoaderStage label={label} />
  </div>
);

export default Loader;
