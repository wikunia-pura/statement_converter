import React from 'react';
import Icon from './Icon';

export interface ModuleTab {
  id: string;
  label: string;
  icon?: React.ComponentProps<typeof Icon>['name'];
}

interface Props {
  tabs: ModuleTab[];
  active: string;
  onChange: (id: string) => void;
}

/**
 * Segmented tab bar shown at the top of a module view. Each tool keeps its own
 * history next to the work it belongs to, rather than in one global History
 * view that would have to disambiguate between modules.
 */
const ModuleTabs: React.FC<Props> = ({ tabs, active, onChange }) => (
  <div className="module-tabs" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={`module-tab ${active === tab.id ? 'is-active' : ''}`}
        onClick={() => onChange(tab.id)}
      >
        {tab.icon && <Icon name={tab.icon} size={15} />}
        {tab.label}
      </button>
    ))}
  </div>
);

export default ModuleTabs;
