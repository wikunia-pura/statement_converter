import React, { useEffect, useMemo, useState } from 'react';
import { AppUser } from '../../shared/types';
import { comparePeople, personInitials, personLabel } from '../../shared/app-users';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import Loader from './Loader';

interface Props {
  language: Language;
  /** Mailbox of the person looking at the list, marked as "Ty". */
  currentEmail?: string;
  /** Fired after a name is saved, so the greeting can pick it up at once. */
  onNamesChanged?: () => void;
}

/** One row's editable state. */
interface Draft {
  firstName: string;
  lastName: string;
}

function draftOf(user: AppUser): Draft {
  return { firstName: user.firstName ?? '', lastName: user.lastName ?? '' };
}

function isDirty(user: AppUser, draft: Draft): boolean {
  return (
    draft.firstName.trim() !== (user.firstName ?? '').trim() ||
    draft.lastName.trim() !== (user.lastName ?? '').trim()
  );
}

/**
 * The accounts with access to the app, and a name for each.
 *
 * The list itself is not editable: accounts are created and removed in Supabase
 * and mirrored here by a trigger, so this screen adds the one thing the mirror
 * cannot know — what the person is actually called. That name is what the
 * calendar offers instead of a mailbox, and what the app greets them by.
 */
const UsersCard: React.FC<Props> = ({ language, currentEmail, onNamesChanged }) => {
  const t = translations[language];
  const notify = useNotify();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    try {
      // By name, not by mailbox: the name is the column people read down.
      const list = [...(await window.electronAPI.getAppUsers())].sort(comparePeople);
      setUsers(list);
      setDrafts(Object.fromEntries(list.map((u) => [u.id, draftOf(u)])));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t.usersLoadFailed);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const namedCount = useMemo(
    () => users.filter((u) => (u.firstName ?? '') !== '' || (u.lastName ?? '') !== '').length,
    [users]
  );

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const save = async (user: AppUser) => {
    const draft = drafts[user.id];
    if (!draft || !isDirty(user, draft)) return;
    setSavingId(user.id);
    try {
      await window.electronAPI.setAppUserName(user.id, draft.firstName, draft.lastName);
      // Re-read rather than patch in place: the name is shared, and another
      // person may have renamed someone else while this list was open.
      await load();
      notify.success(t.usersSaved.replace('{name}', personLabel({ ...user, ...draft })));
      onNamesChanged?.();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t.usersSaveFailed);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon name="users" size={20} /> {t.usersTitle}
      </h2>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '16px' }}>
        {t.usersHint}
      </p>

      {isLoading ? (
        <Loader label={t.loading} />
      ) : users.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>{t.usersEmpty}</div>
      ) : (
        <>
          <div className="users-table">
            <table>
              <thead>
                <tr>
                  <th>{t.usersColumnPerson}</th>
                  <th style={{ width: '22%' }}>{t.usersColumnFirstName}</th>
                  <th style={{ width: '22%' }}>{t.usersColumnLastName}</th>
                  <th style={{ width: '1%' }} aria-label={t.save} />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const draft = drafts[user.id] ?? draftOf(user);
                  const dirty = isDirty(user, draft);
                  const isMe = !!currentEmail && user.email === currentEmail;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="users-person">
                          <span className="user-avatar user-avatar--sm" aria-hidden="true">
                            {personInitials(user)}
                          </span>
                          <span className="users-person__text">
                            <span className="users-person__name">
                              {personLabel(user)}
                              {isMe && <em className="users-person__you"> ({t.usersYou})</em>}
                            </span>
                            <span className="users-person__email">{user.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={draft.firstName}
                          placeholder={t.usersColumnFirstName}
                          aria-label={`${t.usersColumnFirstName} — ${user.email}`}
                          disabled={savingId === user.id}
                          onChange={(e) => setDraft(user.id, { firstName: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void save(user);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={draft.lastName}
                          placeholder={t.usersColumnLastName}
                          aria-label={`${t.usersColumnLastName} — ${user.email}`}
                          disabled={savingId === user.id}
                          onChange={(e) => setDraft(user.id, { lastName: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void save(user);
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => void save(user)}
                          disabled={!dirty || savingId === user.id}
                          title={dirty ? t.save : t.usersNothingToSave}
                        >
                          <Icon name={savingId === user.id ? 'loader' : 'save'} size={14} />{' '}
                          {t.save}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: '12px' }}>
            {t.usersNamedCount
              .replace('{named}', String(namedCount))
              .replace('{total}', String(users.length))}
          </p>
        </>
      )}
    </div>
  );
};

export default UsersCard;
