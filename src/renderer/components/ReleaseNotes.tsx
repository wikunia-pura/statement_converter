import React from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import {
  HighlightKind,
  LocalizedText,
  Release,
  ReleaseHighlight,
  loc,
} from '../../shared/release-notes';

type IconName = React.ComponentProps<typeof Icon>['name'];

/** Release data stores icons as plain strings so shared/ stays UI-agnostic. */
const iconName = (name: string): IconName => name as IconName;

const KIND_ICON: Record<HighlightKind, IconName> = {
  new: 'sparkles',
  improved: 'zap',
  fixed: 'check-circle',
};

function kindLabel(kind: HighlightKind, language: Language): string {
  const t = translations[language];
  if (kind === 'new') return t.whatsNewKindNew;
  if (kind === 'improved') return t.whatsNewKindImproved;
  return t.whatsNewKindFixed;
}

function formatDate(iso: string, language: Language): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === 'pl' ? 'pl-PL' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Gradient banner with the version, headline, tagline and the stat pills. */
export const ReleaseHero: React.FC<{
  release: Release;
  language: Language;
  /** Modal variant: tighter padding, no stats row duplication of the view. */
  compact?: boolean;
}> = ({ release, language, compact }) => {
  const t = translations[language];
  return (
    <div className={`wn-hero${compact ? ' wn-hero--compact' : ''}`}>
      <div className="wn-hero__glow" aria-hidden="true" />
      <div className="wn-hero__content">
        <div className="wn-hero__meta">
          <span className="wn-hero__version">v{release.version}</span>
          <span className="wn-hero__date">
            {t.whatsNewReleased} {formatDate(release.date, language)}
          </span>
        </div>
        <h1 className="wn-hero__title">{loc(release.title, language)}</h1>
        <p className="wn-hero__tagline">{loc(release.tagline, language)}</p>
        {release.stats && release.stats.length > 0 && (
          <div className="wn-hero__stats">
            {release.stats.map((s, i) => (
              <div className="wn-stat" key={i}>
                <div className="wn-stat__value">{loc(s.value, language)}</div>
                <div className="wn-stat__label">{loc(s.label, language)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const WhereTrail: React.FC<{ where: LocalizedText[]; language: Language }> = ({
  where,
  language,
}) => {
  const t = translations[language];
  return (
    <div className="wn-block wn-block--where">
      <div className="wn-block__label">
        <Icon name="map-pin" size={13} /> {t.whatsNewWhere}
      </div>
      <div className="wn-trail">
        {where.map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span className="wn-trail__sep" aria-hidden="true">
                <Icon name="chevron-right" size={12} />
              </span>
            )}
            <span className="wn-trail__chip">{loc(step, language)}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export const ReleaseHighlightCard: React.FC<{
  highlight: ReleaseHighlight;
  language: Language;
}> = ({ highlight, language }) => {
  const t = translations[language];
  return (
    <article className={`wn-card wn-card--${highlight.kind}`}>
      <header className="wn-card__head">
        <span className="wn-card__icon" aria-hidden="true">
          <Icon name={iconName(highlight.icon)} size={20} />
        </span>
        <div className="wn-card__headings">
          <span className={`wn-kind wn-kind--${highlight.kind}`}>
            <Icon name={KIND_ICON[highlight.kind]} size={11} />
            {kindLabel(highlight.kind, language)}
          </span>
          <h3 className="wn-card__title">{loc(highlight.title, language)}</h3>
          <p className="wn-card__summary">{loc(highlight.summary, language)}</p>
        </div>
      </header>

      {highlight.details && highlight.details.length > 0 && (
        <div className="wn-card__details">
          {highlight.details.map((d, i) => (
            <p key={i}>{loc(d, language)}</p>
          ))}
        </div>
      )}

      {highlight.where && highlight.where.length > 0 && (
        <WhereTrail where={highlight.where} language={language} />
      )}

      {highlight.steps && highlight.steps.length > 0 && (
        <div className="wn-block">
          <div className="wn-block__label">
            <Icon name="arrow-right" size={13} /> {t.whatsNewSteps}
          </div>
          <ol className="wn-steps">
            {highlight.steps.map((step, i) => (
              <li className="wn-step" key={i}>
                <span className="wn-step__num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="wn-step__body">
                  <div className="wn-step__do">{loc(step.do, language)}</div>
                  {step.then && (
                    <div className="wn-step__then">
                      <Icon name="arrow-right" size={12} />
                      <span>{loc(step.then, language)}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {highlight.expect && highlight.expect.length > 0 && (
        <div className="wn-block">
          <div className="wn-block__label">
            <Icon name="check-circle" size={13} /> {t.whatsNewExpect}
          </div>
          <ul className="wn-expect">
            {highlight.expect.map((e, i) => (
              <li key={i}>
                <Icon name="check" size={13} />
                <span>{loc(e, language)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {highlight.note && (
        <div className={`wn-note wn-note--${highlight.note.type}`}>
          <Icon
            name={highlight.note.type === 'tip' ? 'info' : 'alert-triangle'}
            size={15}
          />
          <div>
            <strong>
              {highlight.note.type === 'tip' ? t.whatsNewTip : t.whatsNewWarning}
            </strong>{' '}
            {loc(highlight.note.text, language)}
          </div>
        </div>
      )}
    </article>
  );
};

/** Hero + every highlight card — shared by the view and the update modal. */
const ReleaseNotesBody: React.FC<{
  release: Release;
  language: Language;
  compactHero?: boolean;
}> = ({ release, language, compactHero }) => (
  <>
    <ReleaseHero release={release} language={language} compact={compactHero} />
    <div className="wn-cards">
      {release.highlights.map((h) => (
        <ReleaseHighlightCard key={h.id} highlight={h} language={language} />
      ))}
    </div>
  </>
);

export default ReleaseNotesBody;
