import React from 'react';
import Icon from './Icon';

/**
 * The title block of a record's own screen (a declaration, a meeting, a
 * statement): the way back to the list as a square button beside the title —
 * the same one the month bars page with — and, above the title, the list's
 * name as a link to it. One target twice, so whichever the eye lands on works;
 * the tooltip says where it goes.
 *
 * Sits in `.zeb-screen-head__row`, left of the screen's actions.
 */
const ScreenTitle: React.FC<{
  /** Where Back goes — "Wszystkie zebrania". */
  backLabel: string;
  /** The list's name above the title — "Zebrania", "Podatek od nieruchomości · 2027". */
  crumb: string;
  onBack: () => void;
  title: React.ReactNode;
  /** The record's facts under the title. */
  meta?: React.ReactNode;
}> = ({ backLabel, crumb, onBack, title, meta }) => (
  <div className="screen-title">
    <button
      type="button"
      className="ksieg-nav-arrow screen-title__back"
      onClick={onBack}
      title={backLabel}
      aria-label={backLabel}
    >
      <Icon name="chevron-left" size={18} />
    </button>
    <div className="zeb-screen-head__id screen-title__id">
      <button type="button" className="screen-title__crumb" onClick={onBack} title={backLabel}>
        {crumb}
      </button>
      <h1 className="zeb-screen-head__title">{title}</h1>
      {meta && <div className="zeb-screen-head__meta">{meta}</div>}
    </div>
  </div>
);

export default ScreenTitle;
