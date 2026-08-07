import React, { useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
import ReleaseNotesBody from '../components/ReleaseNotes';
import { RELEASES, loc, releaseForVersion } from '../../shared/release-notes';

interface CoNowegoProps {
  language: Language;
  /** Running build, so the list can mark which entry the user is actually on. */
  appVersion: string;
}

/**
 * "What's new" — the release notes for the installed version, with every
 * earlier release still browsable from the rail on the left.
 */
const CoNowego: React.FC<CoNowegoProps> = ({ language, appVersion }) => {
  const t = translations[language];
  const current = releaseForVersion(appVersion) ?? RELEASES[0];
  const [selectedVersion, setSelectedVersion] = useState<string>(
    current?.version ?? '',
  );

  const release = RELEASES.find((r) => r.version === selectedVersion) ?? current;

  if (!release) {
    return (
      <div className="content-body">
        <div className="card">{t.whatsNewEmpty}</div>
      </div>
    );
  }

  return (
    <div className="content-body whatsnew">
      <div className="whatsnew-layout">
        <aside className="wn-rail">
          <div className="wn-rail__label">{t.whatsNewVersions}</div>
          {RELEASES.map((r) => {
            const isInstalled = r.version === current?.version;
            return (
              <button
                key={r.version}
                type="button"
                className={`wn-rail__item${
                  r.version === release.version ? ' is-active' : ''
                }`}
                onClick={() => setSelectedVersion(r.version)}
              >
                <span className="wn-rail__version">v{r.version}</span>
                <span className="wn-rail__title">{loc(r.title, language)}</span>
                {isInstalled && (
                  <span className="wn-rail__installed">
                    <Icon name="check" size={11} /> {t.whatsNewInstalled}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <div className="wn-main">
          <ReleaseNotesBody release={release} language={language} />
        </div>
      </div>
    </div>
  );
};

export default CoNowego;
