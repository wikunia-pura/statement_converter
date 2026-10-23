import React from 'react';
import Icon, { IconName } from './Icon';
import { FormSection } from './FormSection';

export interface PozostalyWpis {
  key: string;
  nazwa: string;
}

/**
 * The communities a tax module's list leaves out (no PIT this year, no ZUS payer, nothing to send this
 * month), under the list: a folded section with their count, opened to a grid of cards that each carry
 * the one action that brings the community in.
 */
const PodatkiPozostale: React.FC<{
  icon: IconName;
  title: string;
  description: string;
  persistKey: string;
  wpisy: PozostalyWpis[];
  actionLabel: string;
  actionIcon: IconName;
  onAction: (key: string) => void;
}> = ({ icon, title, description, persistKey, wpisy, actionLabel, actionIcon, onAction }) => (
  <div className="pod-rest-wrap">
    <FormSection
      icon={icon}
      title={title}
      description={description}
      aside={<span className="pod-rest__count">{wpisy.length}</span>}
      collapsible
      defaultCollapsed
      persistKey={persistKey}
    >
      <ul className="pod-rest">
        {wpisy.map((w) => (
          <li key={w.key} className="pod-rest__item">
            <span className="pod-rest__icon" aria-hidden="true">
              <Icon name="building" size={14} />
            </span>
            <span className="pod-rest__name" data-tip={w.nazwa}>
              {w.nazwa}
            </span>
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => onAction(w.key)}
            >
              <Icon name={actionIcon} size={13} /> {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </FormSection>
  </div>
);

/**
 * The leftover sections together, under a "Poza listą" divider: a zone of its own below the
 * module's list, so the folded sections never read as more rows of it.
 */
export const PodatkiPozostaleGrupa: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="pod-rest-group">
    <div className="ksieg-queue-divider">
      <span>{label}</span>
    </div>
    {children}
  </div>
);

export default PodatkiPozostale;
