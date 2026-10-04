import Store from 'electron-store';
import log from 'electron-log';
import {
  SPOTKANIE_MATERIALY_STATUSES,
  KsiegowaniePriorytet,
  KsiegowanieUwaga,
  NotificationTarget,
  Spotkanie,
  SpotkanieMaterialyKrok,
  Zadanie,
  ZadanieKomentarz,
} from '../shared/types';
import { addToInbox, markInboxRead } from './notificationInbox';
import { dayKey, isOverdue } from '../shared/zadania';
import { personLabel } from '../shared/app-users';
import { showSystemNotification } from './systemNotification';
import { NotificationId, NotificationPrefs, isNotificationEnabled } from '../shared/notifications';

/**
 * Operating-system notifications.
 *
 * Everyone shares one cloud database and nothing pushes to the desktop, so this
 * polls: every minute the main process reads what the signed-in person cares
 * about and compares it with what it saw last time. That is also what makes the
 * notifications survive a closed app — the picture is persisted per mailbox, so
 * what changed while the app was off is announced on the next start.
 *
 * Zadania — three things are worth interrupting for, only for tasks assigned to me:
 *   - a task was assigned to me,
 *   - a task assigned to me was changed by SOMEONE ELSE,
 *   - a task assigned to me is past its deadline and not done (once per deadline).
 * Comments add two more, both about what SOMEONE ELSE wrote:
 *   - I was tagged (@) in a comment — on any task, assigned to me or not,
 *   - a comment was left on a task assigned to me, tag or no tag.
 * A comment that does both notifies once, as the tag.
 *
 * Księgowania — what the team does on the month's list, whoever it concerns:
 *   - a community was flagged as a priority,
 *   - a priority got a note (written or changed),
 *   - a community got a plain note.
 *
 * Kalendarz — the materials of any meeting, whoever takes part in it:
 *   - someone marked them ready to be prepared,
 *   - someone marked them prepared,
 *   - someone marked them sent.
 *
 * My own edits never notify me. Every notification has a switch in Ustawienia →
 * Powiadomienia, per person (the first five are locked on, the rest start off).
 * A switched-off one is still noticed — the picture moves on — so switching it
 * back on does not replay what happened while it was off.
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
  /**
   * Highest comment id already dealt with. Absent until the first comment poll,
   * which only takes the baseline — a person who has never had comment
   * notifications is not greeted with the whole history of the board.
   */
  lastCommentId?: number;
  /**
   * Priority id → fingerprint of its note, as last seen. Absent until the first
   * Księgowania poll, which only takes the baseline.
   */
  priorytety?: Record<string, string>;
  /** Highest community-note id already dealt with; absent until the baseline. */
  lastUwagaId?: number;
  /**
   * Meeting id → `status|changedAt` of its materials, as last seen. Absent until
   * the first Kalendarz poll, which only takes the baseline.
   */
  materialy?: Record<string, string>;
}

interface StoreSchema {
  people: Record<string, PersonState>;
}

/** Where a click on a notification goes. */
export type NotifierTarget = NotificationTarget;

interface Deps {
  getEmail: () => Promise<string | null>;
  getZadania: () => Promise<Zadanie[]>;
  /** Comments with an id above `afterId`, oldest first. */
  getKomentarzeAfter: (afterId: number) => Promise<ZadanieKomentarz[]>;
  /** Id of the newest comment (0 for none) — the baseline of a first poll. */
  getLatestKomentarzId: () => Promise<number>;
  getPriorytety: () => Promise<KsiegowaniePriorytet[]>;
  getUwagi: () => Promise<KsiegowanieUwaga[]>;
  getSpotkania: () => Promise<Spotkanie[]>;
  /** The person's own notification switches, from their account. */
  getNotificationPrefs: (email: string) => Promise<NotificationPrefs>;
  /** Display name of a mailbox (typed name, else the mailbox) — "Anna przypisała Ci…". */
  resolveName: (email: string) => Promise<string>;
  getLanguage: () => 'pl' | 'en';
  /** Bring the window forward and open what the notification was about. */
  onOpen: (target: NotifierTarget) => void;
  /** The bell's list changed — tell the window. */
  onInboxChanged: () => void;
}

const TEXT = {
  pl: {
    assignedTitle: 'Przypisano Ci zadanie',
    assignedBy: (who: string, title: string) => `${who}: ${title}`,
    changedTitle: 'Zadanie zostało zmienione',
    changedBy: (who: string, title: string) => `${who} zmienił(a): ${title}`,
    overdueTitle: 'Zadanie przeterminowane',
    overdueBody: (title: string, due: string) => `${title} (termin: ${due})`,
    mentionTitle: 'Oznaczono Cię w komentarzu',
    commentTitle: 'Nowy komentarz w Twoim zadaniu',
    commentBody: (who: string, title: string, text: string) => `${who} w „${title}”: ${text}`,
    priorytetTitle: 'Wspólnota oznaczona jako priorytet',
    priorytetBody: (who: string, name: string, month: string) =>
      `${who} oznaczył(a) „${name}” jako priorytet (${month})`,
    priorytetNotatkaTitle: 'Notatka w priorytecie',
    priorytetNotatkaBody: (who: string, name: string, text: string) =>
      `${who} – „${name}”: ${text}`,
    uwagaTitle: 'Nowa notatka do wspólnoty',
    uwagaBody: (who: string, name: string, text: string) => `${who} – „${name}”: ${text}`,
    materialyTitle: {
      do_przygotowania: 'Materiały gotowe do przygotowania',
      przygotowane: 'Materiały przygotowane',
      wyslane: 'Materiały wysłane',
    },
    materialyBody: (who: string, name: string, when: string) => `${who} – „${name}” (${when})`,
    materialyTestBody: (name: string, when: string) =>
      `Test – kliknij, aby otworzyć spotkanie „${name}” (${when})`,
    materialyTestBodyEmpty: 'Test – kliknij, aby otworzyć Kalendarz (brak spotkań do pokazania).',
    testTitle: 'Powiadomienie testowe',
    testBody: (title: string) => `Kliknij, aby otworzyć podgląd zadania: ${title}`,
    testBodyEmpty: 'Kliknij, aby otworzyć tablicę zadań (brak zadań do pokazania).',
    summaryTitle: 'Powiadomienia',
    summaryBody: (n: number) => `Masz ${n} nowych powiadomień.`,
  },
  en: {
    assignedTitle: 'A task was assigned to you',
    assignedBy: (who: string, title: string) => `${who}: ${title}`,
    changedTitle: 'A task was changed',
    changedBy: (who: string, title: string) => `${who} changed: ${title}`,
    overdueTitle: 'Task overdue',
    overdueBody: (title: string, due: string) => `${title} (due: ${due})`,
    mentionTitle: 'You were tagged in a comment',
    commentTitle: 'New comment on your task',
    commentBody: (who: string, title: string, text: string) => `${who} on "${title}": ${text}`,
    priorytetTitle: 'Community flagged as a priority',
    priorytetBody: (who: string, name: string, month: string) =>
      `${who} flagged "${name}" as a priority (${month})`,
    priorytetNotatkaTitle: 'Note on a priority',
    priorytetNotatkaBody: (who: string, name: string, text: string) =>
      `${who} – "${name}": ${text}`,
    uwagaTitle: 'New note on a community',
    uwagaBody: (who: string, name: string, text: string) => `${who} – "${name}": ${text}`,
    materialyTitle: {
      do_przygotowania: 'Materials ready to be prepared',
      przygotowane: 'Materials prepared',
      wyslane: 'Materials sent',
    },
    materialyBody: (who: string, name: string, when: string) => `${who} – "${name}" (${when})`,
    materialyTestBody: (name: string, when: string) =>
      `Test – click to open the meeting "${name}" (${when})`,
    materialyTestBodyEmpty: 'Test – click to open the Calendar (no meeting to show).',
    testTitle: 'Test notification',
    testBody: (title: string) => `Click to open the task preview: ${title}`,
    testBodyEmpty: 'Click to open the task board (there is no task to show).',
    summaryTitle: 'Notifications',
    summaryBody: (n: number) => `You have ${n} new notifications.`,
  },
} as const;

interface Event {
  id: NotificationId;
  title: string;
  body: string;
  target: NotifierTarget;
}

/** A comment or note as a one-line preview: whitespace collapsed, cut to fit a toast. */
function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Short stand-in for a note's text, so the store never keeps the notes themselves. */
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

const mailbox = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/** Each announced materials step, and the switch in Ustawienia that governs it. */
const MATERIALY_NOTIFICATION: Record<SpotkanieMaterialyKrok, NotificationId> = {
  do_przygotowania: 'spotkanieMaterialyDoPrzygotowania',
  przygotowane: 'spotkanieMaterialyPrzygotowane',
  wyslane: 'spotkanieMaterialyWyslane',
};

function isMaterialyKrok(value: string): value is SpotkanieMaterialyKrok {
  return value in MATERIALY_NOTIFICATION;
}

/** A meeting's start as the toast shows it. */
function meetingWhen(startsAt: string, lang: 'pl' | 'en'): string {
  return new Date(startsAt).toLocaleString(lang === 'en' ? 'en-GB' : 'pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export class Notifier {
  // The store keeps its original name: it already holds what people have seen,
  // and renaming it would announce every task on the board again.
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
      const email = mailbox(await this.deps.getEmail());
      if (!email) return;
      const all = await this.deps.getZadania();
      const mine = all.filter((z) => mailbox(z.przypisanyEmail) === email);
      const events = await this.diff(email, mine);
      // Each source apart from the others: comments and Księgowania live in tables
      // of their own, and one that is missing (its SQL not run yet) must not
      // silence everything else.
      try {
        events.push(...(await this.diffComments(email, all)));
      } catch (error) {
        log.warn('[NOTIFIER] comment check failed:', error instanceof Error ? error.message : error);
      }
      try {
        events.push(...(await this.diffKsiegowania(email)));
      } catch (error) {
        log.warn(
          '[NOTIFIER] Księgowania check failed:',
          error instanceof Error ? error.message : error,
        );
      }
      try {
        events.push(...(await this.diffMaterialy(email)));
      } catch (error) {
        log.warn(
          '[NOTIFIER] Kalendarz check failed:',
          error instanceof Error ? error.message : error,
        );
      }
      // Read after the diffs, and only when there is something to show. If the read
      // fails the defaults apply (the opt-in ones stay off) — a notification that
      // was meant to be off must never get through because the lookup broke.
      if (events.length > 0) {
        let prefs: NotificationPrefs = {};
        try {
          prefs = await this.deps.getNotificationPrefs(email);
        } catch (error) {
          log.warn(
            '[NOTIFIER] switches not read, using defaults:',
            error instanceof Error ? error.message : error,
          );
        }
        this.show(events.filter((e) => isNotificationEnabled(prefs, e.id)), email);
      }
    } catch (error) {
      // Quiet on purpose: an offline machine or a dead session is not worth a
      // notification of its own, and the next poll tries again.
      log.warn('[NOTIFIER] poll failed:', error instanceof Error ? error.message : error);
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
      // Put away on purpose: no news about it, but it stays in `seen` so that
      // bringing it back is not announced as a card that was just assigned.
      if (z.zarchiwizowane) continue;
      const byMe = mailbox(z.updatedBy) === email;
      const target: NotifierTarget = { view: 'zadania', zadanieId: z.id };

      // The very first run for a person only takes the picture: announcing every
      // card already on their board would greet them with a wall of old news.
      if (previous && !byMe) {
        const before = previous.seen[String(z.id)];
        if (before === undefined) {
          const who = await this.deps.resolveName(z.updatedBy || z.createdBy);
          events.push({
            id: 'zadanieAssigned',
            title: text.assignedTitle,
            body: text.assignedBy(who, z.tytul),
            target,
          });
        } else if (before !== z.updatedAt) {
          const who = await this.deps.resolveName(z.updatedBy);
          events.push({
            id: 'zadanieChanged',
            title: text.changedTitle,
            body: text.changedBy(who, z.tytul),
            target,
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
            id: 'zadanieOverdue',
            title: text.overdueTitle,
            body: text.overdueBody(z.tytul, due),
            target,
          });
        }
      }
    }

    // Pruned to what is overdue NOW: a task whose deadline moves, or that is done
    // and later reopened, is allowed to be announced again.
    people[email] = { ...previous, seen, overdue: [...overdueNow] };
    this.store.set('people', people);
    return events;
  }

  /**
   * New comments since the last poll that are worth a toast to this person.
   * Reads the state `diff` has just written, so it must run after it.
   */
  private async diffComments(email: string, all: Zadanie[]): Promise<Event[]> {
    const people = this.store.get('people');
    const state = people[email];
    if (!state) return [];

    if (state.lastCommentId === undefined) {
      people[email] = { ...state, lastCommentId: await this.deps.getLatestKomentarzId() };
      this.store.set('people', people);
      return [];
    }

    const fresh = await this.deps.getKomentarzeAfter(state.lastCommentId);
    if (fresh.length === 0) return [];

    const text = TEXT[this.deps.getLanguage()];
    const byId = new Map(all.map((z) => [z.id, z] as const));
    const events: Event[] = [];
    for (const c of fresh) {
      if (mailbox(c.autorEmail) === email) continue;
      const task = byId.get(c.zadanieId);
      if (!task) continue; // the card was deleted since

      const tagged = c.mentions.some((m) => mailbox(m) === email);
      const onMine = mailbox(task.przypisanyEmail) === email;
      if (!tagged && !onMine) continue;

      const who = await this.deps.resolveName(c.autorEmail);
      events.push({
        id: tagged ? 'zadanieMention' : 'zadanieComment',
        title: tagged ? text.mentionTitle : text.commentTitle,
        body: text.commentBody(who, task.tytul, snippet(c.tresc)),
        target: { view: 'zadania', zadanieId: task.id },
      });
    }

    // Advanced past the comments that did not concern me too, or every poll
    // would fetch them again.
    people[email] = { ...state, lastCommentId: fresh[fresh.length - 1].id };
    this.store.set('people', people);
    return events;
  }

  /**
   * What the team did on the month's list since the last poll: a community
   * flagged, a priority's note written or changed, a plain note added.
   * Both reads happen before anything is saved, so a failure on the second one
   * leaves the first one's baseline untouched and nothing is lost.
   */
  private async diffKsiegowania(email: string): Promise<Event[]> {
    const people = this.store.get('people');
    const state = people[email];
    if (!state) return [];

    const [priorytety, uwagi] = await Promise.all([
      this.deps.getPriorytety(),
      this.deps.getUwagi(),
    ]);
    const snapshot: Record<string, string> = {};
    for (const p of priorytety) snapshot[String(p.id)] = fingerprint(p.notatka ?? '');
    const newestUwaga = uwagi.reduce((max, u) => Math.max(max, u.id), 0);

    const events: Event[] = [];
    // The first run only takes the picture, like the board's: nobody wants a
    // notification for every priority already on the list.
    if (state.priorytety !== undefined && state.lastUwagaId !== undefined) {
      const text = TEXT[this.deps.getLanguage()];
      const target: NotifierTarget = { view: 'ksiegowania' };

      for (const p of priorytety) {
        const before = state.priorytety[String(p.id)];
        if (before === undefined) {
          if (mailbox(p.createdBy) === email) continue;
          const [y, m] = p.monthKey.split('-');
          events.push({
            id: 'ksiegowaniaPriorytet',
            title: text.priorytetTitle,
            body: text.priorytetBody(
              await this.deps.resolveName(p.createdBy),
              p.adresNazwa,
              `${m}.${y}`,
            ),
            target,
          });
        } else if (before !== snapshot[String(p.id)]) {
          // A note that was cleared is not news; one written or reworded by
          // somebody else is.
          if (!(p.notatka ?? '').trim() || mailbox(p.notatkaBy) === email) continue;
          events.push({
            id: 'ksiegowaniaPriorytetNotatka',
            title: text.priorytetNotatkaTitle,
            body: text.priorytetNotatkaBody(
              await this.deps.resolveName(p.notatkaBy || p.createdBy || ''),
              p.adresNazwa,
              snippet(p.notatka),
            ),
            target,
          });
        }
      }

      for (const u of uwagi) {
        if (u.id <= state.lastUwagaId || mailbox(u.createdBy) === email) continue;
        events.push({
          id: 'ksiegowaniaUwaga',
          title: text.uwagaTitle,
          body: text.uwagaBody(
            await this.deps.resolveName(u.createdBy),
            u.adresNazwa,
            snippet(u.tresc),
          ),
          target,
        });
      }
    }

    // Pruned to the priorities that exist now, so a removed one does not pile up.
    people[email] = {
      ...state,
      priorytety: snapshot,
      lastUwagaId: Math.max(state.lastUwagaId ?? 0, newestUwaga),
    };
    this.store.set('people', people);
    return events;
  }

  /**
   * Materials of any meeting that somebody else marked as ready to be prepared,
   * prepared or sent since the last poll — the whole office prepares them, not
   * only the people in the room. "Not needed" and "needed" are not news.
   */
  private async diffMaterialy(email: string): Promise<Event[]> {
    const people = this.store.get('people');
    const state = people[email];
    if (!state) return [];

    const mine = await this.deps.getSpotkania();
    const snapshot: Record<string, string> = {};
    for (const s of mine) {
      snapshot[String(s.id)] = `${s.materialyStatus}|${s.materialyZmienioneAt ?? ''}`;
    }

    const events: Event[] = [];
    // The first run only takes the picture, like the other sources.
    if (state.materialy !== undefined) {
      const text = TEXT[this.deps.getLanguage()];
      const lang = this.deps.getLanguage();
      for (const s of mine) {
        const before = state.materialy[String(s.id)];
        // A meeting created since the last poll arrives with whatever it already
        // had: only a status changed on a meeting already seen is announced.
        // Checked first — `before` is what the step comparison below reads.
        if (before === undefined) continue;
        if (before === snapshot[String(s.id)]) continue;
        const krok = s.materialyStatus;
        if (!isMaterialyKrok(krok)) continue;
        // Only a step forward is news. Going back ("Cofnij" on the card) lands on
        // a step that was already announced once, and says nothing new.
        const rank = (status: string) =>
          SPOTKANIE_MATERIALY_STATUSES.indexOf(status as (typeof SPOTKANIE_MATERIALY_STATUSES)[number]);
        if (rank(krok) <= rank(before.split('|')[0])) continue;
        if (mailbox(s.materialyZmienioneBy) === email) continue;
        events.push({
          id: MATERIALY_NOTIFICATION[krok],
          title: text.materialyTitle[krok],
          body: text.materialyBody(
            await this.deps.resolveName(s.materialyZmienioneBy ?? ''),
            s.nazwa,
            meetingWhen(s.startsAt, lang),
          ),
          target: { view: 'kalendarz', spotkanieId: s.id },
        });
      }
    }

    // Pruned to the meetings that exist now, so deleted ones do not pile up.
    people[email] = { ...state, materialy: snapshot };
    this.store.set('people', people);
    return events;
  }

  private show(events: Event[], email: string): void {
    if (events.length === 0) return;
    const text = TEXT[this.deps.getLanguage()];
    // The bell keeps every event on its own, even when the desktop gets one summary.
    const stored = addToInbox(
      email,
      events.map((e) => ({ kind: e.id, title: e.title, body: e.body, target: e.target })),
    );
    this.deps.onInboxChanged();
    if (events.length > MAX_INDIVIDUAL) {
      showSystemNotification(
        { title: text.summaryTitle, body: text.summaryBody(events.length) },
        () => this.deps.onOpen(this.summaryTarget(events)),
      );
      return;
    }
    events.forEach((e, i) => {
      // `addToInbox` returns newest first, so the entry of event i is mirrored.
      const entry = stored[stored.length - 1 - i];
      showSystemNotification({ title: e.title, body: e.body }, () => {
        if (entry) {
          markInboxRead(email, [entry.id]);
          this.deps.onInboxChanged();
        }
        this.deps.onOpen(e.target);
      });
    });
  }

  /**
   * A notification on demand, to check that one arrives and that clicking it
   * opens the card. It points at the newest card assigned to this person, else
   * the newest on the board; with an empty board it opens the board itself.
   */
  async sendTest(): Promise<{ shown: boolean; withTask: boolean }> {
    const email = mailbox(await this.deps.getEmail());
    const all = await this.deps.getZadania();
    const newest = (list: Zadanie[]) =>
      [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const task =
      newest(all.filter((z) => !z.zarchiwizowane && mailbox(z.przypisanyEmail) === email)) ??
      newest(all.filter((z) => !z.zarchiwizowane));
    const text = TEXT[this.deps.getLanguage()];
    const target: NotifierTarget = task ? { view: 'zadania', zadanieId: task.id } : { view: 'zadania' };
    const title = text.testTitle;
    const body = task ? text.testBody(task.tytul) : text.testBodyEmpty;
    const [entry] = email ? addToInbox(email, [{ kind: 'test', title, body, target }]) : [];
    if (entry) this.deps.onInboxChanged();
    showSystemNotification({ title, body }, () => {
      if (entry) {
        markInboxRead(email, [entry.id]);
        this.deps.onInboxChanged();
      }
      this.deps.onOpen(target);
    });
    return { shown: true, withTask: !!task };
  }

  /**
   * One materials notification on demand, with its real title, about the
   * nearest upcoming meeting (else the latest one) — so a click can be checked
   * to open it. Shown whatever the switch says: it is a test of the toast.
   */
  async sendTestMaterialy(
    krok: SpotkanieMaterialyKrok,
  ): Promise<{ shown: boolean; withMeeting: boolean }> {
    if (!isMaterialyKrok(krok)) return { shown: false, withMeeting: false };
    const email = mailbox(await this.deps.getEmail());
    const lang = this.deps.getLanguage();
    const text = TEXT[lang];
    let meeting: Spotkanie | undefined;
    try {
      const all = await this.deps.getSpotkania();
      const now = Date.now();
      const byStart = [...all].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      meeting =
        byStart.find((s) => new Date(s.startsAt).getTime() >= now) ?? byStart[byStart.length - 1];
    } catch (error) {
      log.warn('[NOTIFIER] test: meetings not read:', error instanceof Error ? error.message : error);
    }
    const title = text.materialyTitle[krok];
    const body = meeting
      ? text.materialyTestBody(meeting.nazwa, meetingWhen(meeting.startsAt, lang))
      : text.materialyTestBodyEmpty;
    // With no meeting there is nothing to land on; the calendar opens on today.
    const target: NotifierTarget = { view: 'kalendarz', spotkanieId: meeting?.id ?? 0 };
    const [entry] = email
      ? addToInbox(email, [{ kind: 'test', title, body, target }])
      : [];
    if (entry) this.deps.onInboxChanged();
    showSystemNotification({ title, body }, () => {
      if (entry) {
        markInboxRead(email, [entry.id]);
        this.deps.onInboxChanged();
      }
      this.deps.onOpen(target);
    });
    return { shown: true, withMeeting: !!meeting };
  }

  /** A summary opens the place all its events share, else the task board. */
  private summaryTarget(events: Event[]): NotifierTarget {
    if (events.every((e) => e.target.view === 'ksiegowania')) return { view: 'ksiegowania' };
    const first = events[0]?.target;
    if (first?.view === 'kalendarz' && events.every((e) => e.target.view === 'kalendarz')) {
      return first;
    }
    return { view: 'zadania' };
  }
}

/** Resolve a mailbox to the name the app shows for it. */
export function nameForMailbox(
  users: { email: string; displayName?: string | null; firstName?: string | null; lastName?: string | null }[],
  email: string,
): string {
  const wanted = mailbox(email);
  const user = users.find((u) => mailbox(u.email) === wanted);
  return user ? personLabel(user) : email;
}
