import React from 'react';
import Icon from './Icon';
import Tip from './Tip';

/**
 * A merged row's badge — how many printed rows it sums — with the rows listed
 * in the app's own tooltip (never a native `title`, never a help cursor).
 */
const MergedBadge: React.FC<{ label: string; wiersze: string[] }> = ({ label, wiersze }) => (
  <Tip
    className="zfin-merged"
    ariaLabel={`${label} ${wiersze.join(' + ')}`}
    content={
      <>
        <div className="tip__title">{label}</div>
        <ul className="tip__rows">
          {wiersze.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </>
    }
  >
    <Icon name="copy" size={11} /> {wiersze.length}
  </Tip>
);

export default MergedBadge;
