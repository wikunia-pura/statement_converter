import { Notification } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { Zadanie } from '../shared/types';
import { dayKey, isOverdue } from '../shared/zadania';
import { personLabel } from '../shared/app-users';

/**
 * Operating-system notifications for the "Zadania" board.
 *
 * Everyone shares one cloud database and nothing pushes to the desktop, so this
 * polls: every minute the main process reads the tasks assigned to the signed-in
 * person and compares them with what it saw last time. That is also what makes
 * the notifications survive a closed app — the picture is persisted per mailbox,
 * so what changed while the app was off is announced on the next start.
 *
 * Three things are worth interrupting for, and only for tasks assigned to me:
 *   - a task was assigned to me,
 *   - a task assigned to me was changed by SOMEONE ELSE,
 *   - a task assigned to me is past its deadline and not done (once per deadline).
 * My own edits never notify me.
 */

const POLL_MS = 60_000;
/** The session is restored shortly after launch; polling earlier only logs a failure. */
const FIRST_POLL_MS = 8_000;
/** More than this at once becomes one summary, so a restored backup is not a barrage. */
const MAX_INDIVIDUAL = 3;

interface PersonState {
  /** Task id → `updatedAt` as last seen, for the tasks assigned to this person. */
  seen: Record<string, string>;
  /** `id|deadline` of overdue notifications already shown. */
  overdue: string[];
}

interface StoreSchema {
  people: Record<string, PersonState>;
}

interface Deps {
  getEmail: () => Promise<string | null>;
  getZadania: () => Promise<Zadanie[]>;
  /** Display name of a mailbox (typed name, else the mailbox) — "Anna przypisała Ci…". */
  resolveName: (email: string) => Promise<string>;
  getLanguage: () => 'pl' | 'en';
  /** Bring the window forward and open the board. */
  onOpen: () => void;
}

const TEXT = {
  pl: {
    assignedTitle: 'Przypisano Ci zadanie',
    assignedBy: (who: string, title: string) => `${who}: ${title}`,
    changedTitle: 'Zadanie zostało zmienione',
    changedBy: (who: string, title: string) => `${who} zmienił(a): ${title}`,
    overdueTitle: 'Zadanie przeterminowane',
    overdueBody: (title: string, due: string) => `${title} (termin: ${due})`,
    summaryTitle: 'Zadania',
    summaryBody: (n: number) => `Masz ${n} nowych powiadomień o zadaniach.`,
  },
  en: {
    assignedTitle: 'A task was assigned to you',
    assignedBy: (who: string, title: string) => `${who}: ${title}`,
    changedTitle: 'A task was changed',
    changedBy: (who: string, title: string) => `${who} changed: ${title}`,
    overdueTitle: 'Task overdue',
    overdueBody: (title: string, due: string) => `${title} (due: ${due})`,
    summaryTitle: 'Tasks',
    summaryBody: (n: number) => `You have ${n} new task notifications.`,
  },
} as const;

interface Event {
  kind: 'assigned' | 'changed' | 'overdue';
  title: string;
  body: string;
}

export class ZadaniaNotifier {
  private readonly store = new Store<StoreSchema>({
    name: 'zadania-notifier',
    defaults: { people: {} },
  });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.timer) return;
    setTimeout(() => void this.poll(), FIRST_POLL_MS);
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    // A slow read must not stack a second one on top of it.
    if (this.running) return;
    this.running = true;
    try {
      const email = (await this.deps.getEmail())?.trim().toLowerCase();
      if (!email) return;
      const mine = (await this.deps.getZadania()).filter(
        (z) => (z.przypisanyEmail ?? '').trim().toLowerCase() === email,
      );
      const events = await this.diff(email, mine);
      this.show(events);
    } catch (error) {
      // Quiet on purpose: an offline machine or a dead session is not worth a
      // notification of its own, and the next poll tries again.
      log.warn('[ZADANIA] notifier poll failed:', error instanceof Error ? error.message : error);
    } finally {
      this.running = false;
    }
  }

  private async diff(email: string, mine: Zadanie[]): Promise<Event[]> {
    const text = TEXT[this.deps.getLanguage()];
    const people = this.store.get('people');
    const previous = people[email];
    const events: Event[] = [];
    const today = dayKey();

    const seen: Record<string, string> = {};
    const overdueNotified = new Set(previous?.overdue ?? []);
    const overdueNow = new Set<string>();

    for (const z of mine) {
      seen[String(z.id)] = z.updatedAt;
      const byMe = (z.updatedBy ?? '').trim().toLowerCase() === email;

      // The very first run for a person only takes the picture: announcing every
      // card already on their board would greet them with a wall of old news.
      if (previous && !byMe) {
        const before = previous.seen[String(z.id)];
        if (before === undefined) {
          const who = await this.deps.resolveName(z.updatedBy || z.createdBy);
          events.push({
            kind: 'assigned',
            title: text.assignedTitle,
            body: text.assignedBy(who, z.tytul),
          });
        } else if (before !== z.updatedAt) {
          const who = await this.deps.resolveName(z.updatedBy);
          events.push({
            kind: 'changed',
            title: text.changedTitle,
            body: text.changedBy(who, z.tytul),
          });
        }
      }

      if (z.termin && isOverdue(z, today)) {
        const key = `${z.id}|${z.termin}`;
        overdueNow.add(key);
        if (!overdueNotified.has(key)) {
          const [y, m, d] = z.termin.split('-');
          const due = this.deps.getLanguage() === 'en' ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
          events.push({
            kind: 'overdue',
            title: text.overdueTitle,
            body: text.overdueBody(z.tytul, due),
          });
        }
      }
    }

    // Pruned to what is overdue NOW: a task whose deadline moves, or that is done
    // and later reopened, is allowed to be announced again.
    people[email] = { seen, overdue: [...overdueNow] };
    this.store.set('people', people);
    return events;
  }

  private show(events: Event[]): void {
    if (events.length === 0 || !Notification.isSupported()) return;
    const text = TEXT[this.deps.getLanguage()];
    const toShow: { title: string; body: string }[] =
      events.length > MAX_INDIVIDUAL
        ? [{ title: text.summaryTitle, body: text.summaryBody(events.length) }]
        : events;
    for (const e of toShow) {
      const notification = new Notification({ title: e.title, body: e.body });
      notification.on('click', () => this.deps.onOpen());
      notification.show();
    }
  }
}

/** Resolve a mailbox to the name the app shows for it. */
export function nameForMailbox(
  users: { email: string; displayName?: string | null; firstName?: string | null; lastName?: string | null }[],
  email: string,
): string {
  const wanted = (email ?? '').trim().toLowerCase();
  const user = users.find((u) => u.email.trim().toLowerCase() === wanted);
  return user ? personLabel(user) : email;
}
