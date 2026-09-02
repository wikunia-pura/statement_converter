import React from 'react';
import { translations, Language } from '../translations';
import { monthAccent, monthInk } from './MonthIllustration';

interface Props {
  language: Language;
  /** First name of the signed-in person, or their mailbox handle. */
  name: string;
  /** Shown in the tooltip — which account this greeting belongs to. */
  email: string;
}

/**
 * The greeting under the logo.
 *
 * Three elements and a lot of air: a small letterspaced label, the name at
 * display size, and one hairline rule. Nothing else — no card, no border, no
 * avatar, no drawn ornament. A container would read as another button in a
 * column of nav items, and an ornament competes with the only thing here worth
 * looking at, which is the name.
 *
 * The label and the rule carry the month's own colour, the same twelve the
 * dashboard's month bar is tinted with — so the sidebar warms up through autumn
 * and goes cold and pale in winter, and the app quietly says what time of year
 * it is before a single number is read.
 */
const SidebarWelcome: React.FC<Props> = ({ language, name, email }) => {
  const t = translations[language];
  // Today's month, read on every render: an app left open across midnight on
  // the 31st should turn over with the calendar.
  const month = new Date().getMonth() + 1;

  return (
    <div
      className="welcome"
      title={`${t.greetingWord}, ${name} · ${email}`}
      style={{
        // Two variants of one hue: `ink` is dark enough to set 11px type in on
        // the light surface, `accent` is the bright one that only works on the
        // dark theme's near-black. The stylesheet picks per theme.
        ['--month-ink' as string]: monthInk(month),
        ['--month-accent' as string]: monthAccent(month),
      }}
    >
      <span className="welcome__word">{t.greetingWord}</span>
      <span className="welcome__name">{name}</span>
      <span className="welcome__rule" aria-hidden="true" />
    </div>
  );
};

export default SidebarWelcome;
