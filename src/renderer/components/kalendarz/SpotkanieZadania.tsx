import React from 'react';
import { AppUser, Zadanie, ZadanieInput } from '../../../shared/types';
import { personLabel } from '../../../shared/app-users';
import { translations, Language } from '../../translations';
import Icon from '../Icon';
import { formatDayKey } from '../../../shared/zadania';

/* ========================= A meeting's linked tasks ======================== */

/**
 * The tasks that belong to one meeting — in its form and on its card. Saved
 * tasks can be edited, deleted and followed to the board; a new meeting's
 * tasks are `pending`: kept in the form and added once the meeting exists,
 * because until then there is no meeting for them to point at.
 */
export const SpotkanieZadania: React.FC<{
  zadania: Zadanie[];
  pending?: ZadanieInput[];
  users: AppUser[];
  language: Language;
  disabled?: boolean;
  onAdd: () => void;
  onPreview: (zadanie: Zadanie) => void;
  onEdit: (zadanie: Zadanie) => void;
  onDelete: (zadanie: Zadanie) => void;
  onOpenBoard?: (zadanie: Zadanie) => void;
  onRemovePending?: (index: number) => void;
}> = ({
  zadania,
  pending = [],
  users,
  language,
  disabled = false,
  onAdd,
  onPreview,
  onEdit,
  onDelete,
  onOpenBoard,
  onRemovePending,
}) => {
  const t = translations[language];
  const dayLocale = language === 'en' ? 'en' : 'pl';
  const statusLabel: Record<Zadanie['status'], string> = {
    todo: t.zadColTodo,
    in_progress: t.zadColInProgress,
    done: t.zadColDone,
  };
  const who = (email: string | null): string | null => {
    if (!email) return null;
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return user ? personLabel(user) : email;
  };
  const meta = (z: Pick<ZadanieInput, 'przypisanyEmail' | 'termin'>): string =>
    [who(z.przypisanyEmail), z.termin ? formatDayKey(z.termin, dayLocale) : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="kal-tasks">
      <div className="kal-tasks__head">
        <span className="kal-tasks__title">
          <Icon name="clipboard" size={13} /> {t.kalTasksTitle}
        </span>
        <button
          type="button"
          className="button button-small button-subtle"
          onClick={onAdd}
          disabled={disabled}
          data-tip={t.kalAddTaskHint}
        >
          <Icon name="plus" size={13} /> {t.kalAddTask}
        </button>
      </div>
      {zadania.length === 0 && pending.length === 0 ? (
        <div className="kal-tasks__empty">{t.kalTasksEmpty}</div>
      ) : (
        <ul className="kal-tasks__list">
          {zadania.map((z) => (
            <li key={z.id} className={`kal-task kal-task--${z.status}`}>
              <span className="kal-task__dot" data-tip={statusLabel[z.status]} aria-label={statusLabel[z.status]} />
              <button
                type="button"
                className="kal-task__body kal-task__body--open"
                onClick={() => onPreview(z)}
                data-tip={t.kalTaskPreview}
              >
                <span className="kal-task__name">{z.tytul}</span>
                <span className="kal-task__meta">
                  {statusLabel[z.status]}
                  {meta(z) && ` · ${meta(z)}`}
                </span>
              </button>
              <span className="kal-task__actions">
                {onOpenBoard && (
                  <button
                    type="button"
                    onClick={() => onOpenBoard(z)}
                    data-tip={t.kalTaskOpenBoard}
                    aria-label={t.kalTaskOpenBoard}
                  >
                    <Icon name="arrow-right" size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(z)}
                  disabled={disabled}
                  data-tip={t.edit}
                  aria-label={t.edit}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => onDelete(z)}
                  disabled={disabled}
                  data-tip={t.delete}
                  aria-label={t.delete}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </li>
          ))}
          {pending.map((p, i) => (
            <li key={`pending-${i}`} className="kal-task kal-task--pending">
              <span className="kal-task__dot" />
              <span className="kal-task__body">
                <span className="kal-task__name">{p.tytul}</span>
                <span className="kal-task__meta">
                  {t.kalTaskPending}
                  {meta(p) && ` · ${meta(p)}`}
                </span>
              </span>
              {onRemovePending && (
                <span className="kal-task__actions">
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => onRemovePending(i)}
                    disabled={disabled}
                    data-tip={t.kalTaskRemovePending}
                    aria-label={t.kalTaskRemovePending}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
