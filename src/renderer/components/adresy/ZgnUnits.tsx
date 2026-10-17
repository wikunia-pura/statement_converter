import React, { useState, useEffect, useMemo } from 'react';
import { Adres, ZgnJednostka, ZgnPelnomocnik } from '../../../shared/types';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import CheckList, { CheckListItem } from '../CheckList';
import { FormField, FormRow, FormSection, RequiredNote } from '../FormSection';
import Icon from '../Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { plural } from '../../plural';
import { foldSummary } from './adresyShared';

/** An e-mail that wraps after its "@" first, rather than at an arbitrary letter, in a narrow column. */
const breakableEmail = (email: string): React.ReactNode => {
  const at = email.indexOf('@');
  if (at < 0) return email;
  return <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>;
};

interface ZgnUnitFormModalProps {
  language: Language;
  /** Unit being edited, or null when adding a new one. */
  editing: ZgnJednostka | null;
  /** All communities — the ones this unit serves are ticked in the form. */
  adresy: Adres[];
  /** All units, to name the one a community would be taken over from. */
  jednostki: ZgnJednostka[];
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (e.g. API failure). */
  error: string | null;
  /** Stack above the units modal when the dictionary itself is a modal. */
  zIndex?: number;
  /** The unit's proxies, kept live by the panel — managed here as on the units list. */
  pelnomocnicy: ZgnPelnomocnik[];
  /** Proxies are their own records: these save at once, not with the unit's "Zapisz". */
  onAddProxy: () => void;
  onEditProxy: (p: ZgnPelnomocnik) => void;
  onDeleteProxy: (p: ZgnPelnomocnik) => void;
  onSubmit: (data: { nazwa: string; email: string; adresIds: number[]; assignmentChanged: boolean }) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for a single city unit: its name and mailbox, and the
 * communities it serves — ticked right here, so a new unit does not send the
 * user through every address afterwards.
 */
const ZgnUnitFormModal: React.FC<ZgnUnitFormModalProps> = ({
  language,
  editing,
  adresy,
  jednostki,
  isSaving,
  error,
  zIndex = 1100,
  pelnomocnicy,
  onAddProxy,
  onEditProxy,
  onDeleteProxy,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [email, setEmail] = useState(editing?.email || '');
  const [localError, setLocalError] = useState<string | null>(null);
  // What the unit serves when the form opens — the baseline for the change summary.
  const [initialIds] = useState<number[]>(() =>
    editing ? adresy.filter((a) => a.zgnJednostkaId === editing.id).map((a) => a.id) : [],
  );
  const [adresIds, setAdresIds] = useState<number[]>(initialIds);

  const added = adresIds.filter((id) => !initialIds.includes(id)).length;
  const removed = initialIds.filter((id) => !adresIds.includes(id)).length;
  const assignmentChanged = added > 0 || removed > 0;
  const emailChanged = !!editing && email.trim() !== editing.email;
  const unchanged = !!editing && nazwa.trim() === editing.nazwa && !emailChanged && !assignmentChanged;

  const items: CheckListItem[] = useMemo(() => {
    const unitName = (id: number) => jednostki.find((j) => j.id === id)?.nazwa ?? '';
    return adresy.map((a) => {
      const on = adresIds.includes(a.id);
      const other = a.zgnJednostkaId && a.zgnJednostkaId !== editing?.id ? unitName(a.zgnJednostkaId) : '';
      if (on && other) {
        return { id: a.id, label: a.nazwa, note: t.zgnPickTakesOver.replace('{name}', other), noteTone: 'warning' };
      }
      if (!on && initialIds.includes(a.id)) {
        return { id: a.id, label: a.nazwa, note: t.zgnPickDetaches, noteTone: 'danger' };
      }
      return { id: a.id, label: a.nazwa, note: other || undefined, noteTone: 'muted' };
    });
  }, [adresy, jednostki, adresIds, initialIds, editing, t]);

  const handleSubmit = () => {
    const n = nazwa.trim();
    const e = email.trim();
    if (!n || !e) {
      setLocalError(t.fillAllFields);
      return;
    }
    // Deliberately loose: a corporate mailbox can look unusual, and refusing to
    // save is worse than sending to an address the user can see and correct.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setLocalError(t.zgnEmailInvalid);
      return;
    }
    onSubmit({ nazwa: n, email: e, adresIds, assignmentChanged });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex }}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon="building"
          title={editing ? t.zgnUnitEdit : t.zgnUnitAdd}
          subtitle={editing ? editing.nazwa : t.zgnUnitFormSubtitle}
        />
        <div className="modal-body modal-body--sectioned">
          {/* Editing a saved unit opens folded, like the address form; a new one opens unfolded. */}
          <FormSection
            icon="building"
            title={t.zgnSectionUnit}
            description={t.zgnSectionUnitDesc}
            collapsible={!!editing}
            defaultCollapsed
            collapsedSummary={[nazwa.trim(), email.trim()].filter(Boolean).join(' — ')}
          >
            <FormRow>
              <FormField label={t.zgnUnitName} htmlFor="zgn-unit-name" required>
                <input
                  id="zgn-unit-name"
                  type="text"
                  value={nazwa}
                  onChange={(e) => { setNazwa(e.target.value); if (localError) setLocalError(null); }}
                  placeholder={t.zgnUnitNamePlaceholder}
                  onKeyDown={submitOnEnter}
                  autoFocus
                />
              </FormField>
              <FormField
                label={t.zgnUnitEmail}
                htmlFor="zgn-unit-email"
                required
                hint={t.zgnUnitEmailHint}
                error={localError}
              >
                <div className="input-icon">
                  <Icon name="mail" size={15} />
                  <input
                    id="zgn-unit-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
                    placeholder="np. zgn@um.example.pl"
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </FormField>
            </FormRow>
            {emailChanged && adresIds.length > 0 && (
              <div className="callout callout--warning" role="status">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.zgnUnitEmailChangeImpact.replace(
                    '{count}',
                    plural(adresIds.length, language, ['wspólnoty', 'wspólnot', 'wspólnot'], ['community', 'communities']),
                  )}
                </div>
              </div>
            )}
          </FormSection>

          <FormSection
            icon="users"
            title={t.zgnProxies}
            description={t.zgnSectionProxiesDesc}
            collapsible={!!editing}
            defaultCollapsed
            collapsedSummary={foldSummary(pelnomocnicy.map((p) => p.imieNazwisko), t.zgnProxiesCollapsedEmpty, 3)}
          >
            {editing ? (
              <>
                {pelnomocnicy.length > 0 && (
                  <ul className="zgn-proxy-list">
                    {pelnomocnicy.map((p) => (
                      <li key={p.id} className="zgn-proxy-row">
                        <span className="zgn-proxy-row__name">{p.imieNazwisko}</span>
                        <span className={`zgn-proxy-row__email${p.email ? '' : ' is-missing'}`}>
                          {p.email ? breakableEmail(p.email) : t.zgnProxyNoEmail}
                        </span>
                        <span className="zgn-proxy-row__actions">
                          <button
                            type="button"
                            className="button button-ghost button-icon"
                            onClick={() => onEditProxy(p)}
                            disabled={isSaving}
                            aria-label={`${t.edit}: ${p.imieNazwisko}`}
                          >
                            <Icon name="edit" size={13} />
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-icon icon-danger"
                            onClick={() => onDeleteProxy(p)}
                            disabled={isSaving}
                            aria-label={`${t.delete}: ${p.imieNazwisko}`}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <button
                    type="button"
                    className="button button-small button-subtle"
                    onClick={onAddProxy}
                    disabled={isSaving}
                  >
                    <Icon name="plus" size={13} />{' '}{t.zgnProxyAdd}
                  </button>
                </div>
              </>
            ) : (
              <div className="form-empty">
                <Icon name="info" size={16} />
                {t.zgnProxiesAfterSave}
              </div>
            )}
          </FormSection>

          <FormSection
            icon="home"
            title={t.zgnSectionCommunities}
            description={t.zgnSectionCommunitiesDesc}
            collapsible={!!editing}
            defaultCollapsed
            collapsedSummary={
              adresIds.length > 0
                ? t.formSectionPicked.replace(
                    '{names}',
                    foldSummary(adresy.filter((a) => adresIds.includes(a.id)).map((a) => a.nazwa), '', 3),
                  )
                : t.zgnCommunitiesCollapsedEmpty
            }
          >
            <CheckList
              items={items}
              selected={adresIds}
              onChange={setAdresIds}
              searchPlaceholder={t.zgnPickSearch}
              onlySelectedLabel={t.pickOnlySelected}
              emptyLabel={t.zgnPickEmpty}
            />
          </FormSection>

          {/* Under the sections, not in a field: the section it concerns may be folded. */}
          {error && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{error}</div>
            </div>
          )}
        </div>
        <ModalFooter
          note={
            assignmentChanged ? (
              <span className="change-summary">
                {t.zgnAssignChanges}:
                {added > 0 && <span className="change-summary__add">+{added}</span>}
                {removed > 0 && <span className="change-summary__remove">−{removed}</span>}
              </span>
            ) : (
              <RequiredNote label={t.formRequiredNote} />
            )
          }
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zgnUnitAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !nazwa.trim() || !email.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.fillAllFields}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ZgnProxyFormModalProps {
  language: Language;
  /** The unit the proxy acts for — named in the header. */
  jednostka: ZgnJednostka;
  /** Proxy being edited, or null when adding one. */
  editing: ZgnPelnomocnik | null;
  isSaving: boolean;
  error: string | null;
  zIndex?: number;
  onSubmit: (data: { imieNazwisko: string; email: string }) => void;
  onCancel: () => void;
}

/** Add/edit one proxy of a unit: a name, and a mailbox if there is one. */
const ZgnProxyFormModal: React.FC<ZgnProxyFormModalProps> = ({
  language,
  jednostka,
  editing,
  isSaving,
  error,
  zIndex = 1100,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [imieNazwisko, setImieNazwisko] = useState(editing?.imieNazwisko || '');
  const [email, setEmail] = useState(editing?.email || '');
  const unchanged =
    !!editing && imieNazwisko.trim() === editing.imieNazwisko && email.trim() === (editing.email || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = imieNazwisko.trim();
    const e = email.trim();
    if (!n) {
      setLocalError(t.zgnProxyNameRequired);
      return;
    }
    // Optional, and as loose as the unit's own check when it is given.
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setLocalError(t.zgnEmailInvalid);
      return;
    }
    onSubmit({ imieNazwisko: n, email: e });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex }}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon={editing ? 'users' : 'user-plus'}
          title={editing ? t.zgnProxyEdit : t.zgnProxyAdd}
          subtitle={jednostka.nazwa}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="users" title={t.zgnSectionProxy} description={t.zgnSectionProxyDesc}>
            <FormRow>
              <FormField label={t.zgnProxyName} htmlFor="zgn-proxy-name" required>
                <input
                  id="zgn-proxy-name"
                  type="text"
                  value={imieNazwisko}
                  onChange={(e) => { setImieNazwisko(e.target.value); if (localError) setLocalError(null); }}
                  placeholder={t.zgnProxyNamePlaceholder}
                  onKeyDown={submitOnEnter}
                  autoFocus
                />
              </FormField>
              <FormField
                label={t.zgnUnitEmail}
                htmlFor="zgn-proxy-email"
                hint={t.zgnProxyEmailHint}
                error={localError || error}
              >
                <div className="input-icon">
                  <Icon name="mail" size={15} />
                  <input
                    id="zgn-proxy-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
                    placeholder="np. jan.kowalski@um.example.pl"
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </FormField>
            </FormRow>
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zgnProxyAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !imieNazwisko.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.zgnProxyNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ZgnUnitsPanelProps {
  language: Language;
  jednostki: ZgnJednostka[];
  adresy: Adres[];
  onSaved: () => void;
  /** Raised when the panel itself sits in a modal, so its form lands on top. */
  formZIndex?: number;
}

/**
 * Dictionary of city units ("jednostki ZGN") the Mailing module writes to. One
 * unit usually serves many communities, so it lives here once and each address
 * points at it — changing the unit's mailbox fixes every community at once.
 *
 * Rendered as its own tab, and reused inside a modal (`ZgnUnitsModal`) for the
 * one place that needs it without leaving what it is doing: the address form,
 * where a missing unit blocks the field being filled in.
 */
export const ZgnUnitsPanel: React.FC<ZgnUnitsPanelProps> = ({
  language,
  jednostki,
  adresy,
  onSaved,
  formZIndex,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <jednostka> } = edit.
  const [formState, setFormState] = useState<{ editing: ZgnJednostka | null } | null>(null);
  // Proxies of every unit, loaded here: they are only ever managed in this panel.
  const [pelnomocnicy, setPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  const [proxyForm, setProxyForm] = useState<{
    jednostka: ZgnJednostka;
    editing: ZgnPelnomocnik | null;
  } | null>(null);

  const loadPelnomocnicy = async () => {
    try {
      setPelnomocnicy(await window.electronAPI.getZgnPelnomocnicy());
    } catch {
      setPelnomocnicy([]);
    }
  };

  // Again whenever the units change: deleting one takes its proxies with it.
  useEffect(() => {
    void loadPelnomocnicy();
  }, [jednostki]);

  const proxiesOf = (jednostkaId: number) =>
    pelnomocnicy.filter((p) => p.jednostkaId === jednostkaId);

  const handleProxySubmit = async (data: { imieNazwisko: string; email: string }) => {
    if (!proxyForm) return;
    setIsSaving(true);
    setError(null);
    try {
      if (proxyForm.editing) {
        await window.electronAPI.updateZgnPelnomocnik(
          proxyForm.editing.id,
          data.imieNazwisko,
          data.email,
        );
      } else {
        await window.electronAPI.addZgnPelnomocnik(
          proxyForm.jednostka.id,
          data.imieNazwisko,
          data.email,
        );
      }
      setProxyForm(null);
      await loadPelnomocnicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProxyDelete = async (p: ZgnPelnomocnik) => {
    if (!(await notify.confirm(t.zgnProxyConfirmDelete.replace('{name}', p.imieNazwisko), { danger: true }))) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.deleteZgnPelnomocnik(p.id);
      await loadPelnomocnicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = async (data: {
    nazwa: string;
    email: string;
    adresIds: number[];
    assignmentChanged: boolean;
  }) => {
    setIsSaving(true);
    setError(null);
    try {
      const editing = formState?.editing;
      let jednostkaId: number;
      if (editing) {
        await window.electronAPI.mailingUpdateZgn(editing.id, data.nazwa, data.email);
        jednostkaId = editing.id;
      } else {
        jednostkaId = (await window.electronAPI.mailingAddZgn(data.nazwa, data.email)).id;
      }
      if (data.assignmentChanged) {
        await window.electronAPI.setZgnAdresy(jednostkaId, data.adresIds);
      }
      setFormState(null);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (jednostka: ZgnJednostka) => {
    const used = adresy.filter((a) => a.zgnJednostkaId === jednostka.id).length;
    const proxies = proxiesOf(jednostka.id).length;
    const message =
      (used > 0
        ? t.zgnConfirmDeleteUsed.replace('{count}', String(used))
        : t.zgnConfirmDelete) +
      (proxies > 0 ? ` ${t.zgnConfirmDeleteProxies.replace('{count}', String(proxies))}` : '');
    if (!(await notify.confirm(message, { danger: true }))) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.mailingDeleteZgn(jednostka.id);
      if (formState?.editing?.id === jednostka.id) setFormState(null);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="panel-intro">
        <p className="panel-intro__text">{t.zgnUnitsHint}</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => { setError(null); setFormState({ editing: null }); }}
          disabled={isSaving}
        >
          <Icon name="plus" size={14} />{' '}{t.zgnUnitAdd}
        </button>
      </div>

      {error && !formState && !proxyForm && (
        <div className="form-field__error" role="alert">
          <Icon name="alert-circle" size={13} />
          {error}
        </div>
      )}

      {jednostki.length > 0 ? (
        <table className="data-table zgn-table">
          <thead>
            <tr>
              <th>{t.zgnUnitName}</th>
              <th>{t.zgnUnitEmail}</th>
              <th className="data-table__center">{t.zgnUnitUsedByLabel}</th>
              <th>{t.zgnProxies}</th>
              <th className="data-table__actions">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {jednostki.map((j) => {
              const used = adresy.filter((a) => a.zgnJednostkaId === j.id).length;
              const proxies = proxiesOf(j.id);
              return (
                <tr key={j.id}>
                  <td className="data-table__name">
                    <span className="cell-title">{j.nazwa}</span>
                  </td>
                  <td className="zgn-table__email">{breakableEmail(j.email)}</td>
                  <td className="data-table__center">{used}</td>
                  <td className="zgn-table__proxies">
                    {proxies.length > 0 ? (
                      <ul className="zgn-proxy-list">
                        {proxies.map((p) => (
                          <li key={p.id} className="zgn-proxy-row">
                            <span className="zgn-proxy-row__name">{p.imieNazwisko}</span>
                            <span className={`zgn-proxy-row__email${p.email ? '' : ' is-missing'}`}>
                              {p.email ? breakableEmail(p.email) : t.zgnProxyNoEmail}
                            </span>
                            <span className="zgn-proxy-row__actions">
                              <button
                                type="button"
                                className="button button-ghost button-icon"
                                onClick={() => { setError(null); setProxyForm({ jednostka: j, editing: p }); }}
                                disabled={isSaving}
                                data-tip={t.edit}
                                aria-label={`${t.edit}: ${p.imieNazwisko}`}
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button
                                type="button"
                                className="button button-ghost button-icon icon-danger"
                                onClick={() => void handleProxyDelete(p)}
                                disabled={isSaving}
                                data-tip={t.delete}
                                aria-label={`${t.delete}: ${p.imieNazwisko}`}
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="cell-empty">—</span>
                    )}
                  </td>
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => { setError(null); setFormState({ editing: j }); }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} />{' '}{t.edit}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-icon icon-danger"
                        onClick={() => handleDelete(j)}
                        disabled={isSaving}
                        data-tip={t.delete}
                        aria-label={`${t.delete}: ${j.nazwa}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="form-empty">
          <Icon name="building" size={16} />
          {t.zgnNoUnits}
        </div>
      )}

      {formState && (
        <ZgnUnitFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          zIndex={formZIndex}
          adresy={adresy}
          jednostki={jednostki}
          pelnomocnicy={formState.editing ? proxiesOf(formState.editing.id) : []}
          onAddProxy={() => {
            if (!formState.editing) return;
            setError(null);
            setProxyForm({ jednostka: formState.editing, editing: null });
          }}
          onEditProxy={(p) => {
            if (!formState.editing) return;
            setError(null);
            setProxyForm({ jednostka: formState.editing, editing: p });
          }}
          onDeleteProxy={(p) => void handleProxyDelete(p)}
          onSubmit={(data) => void handleFormSubmit(data)}
          onCancel={() => { setFormState(null); setError(null); }}
        />
      )}

      {proxyForm && (
        <ZgnProxyFormModal
          key={proxyForm.editing ? `edit-${proxyForm.editing.id}` : `new-${proxyForm.jednostka.id}`}
          language={language}
          jednostka={proxyForm.jednostka}
          editing={proxyForm.editing}
          isSaving={isSaving}
          error={error}
          zIndex={formZIndex}
          onSubmit={(data) => void handleProxySubmit(data)}
          onCancel={() => { setProxyForm(null); setError(null); }}
        />
      )}
    </>
  );
};

interface ZgnUnitsModalProps extends ZgnUnitsPanelProps {
  onClose: () => void;
}

/**
 * The units dictionary in a modal, for the address form: a unit added there must
 * be pickable without closing the half-filled address first, so it opens above it
 * instead of switching tabs and discarding the form.
 */
export const ZgnUnitsModal: React.FC<ZgnUnitsModalProps> = ({ onClose, ...panelProps }) => {
  const t = translations[panelProps.language];
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="building" title={t.zgnUnitsTitle} subtitle={t.zgnUnitsModalSubtitle} />
        <div className="modal-body modal-body--sectioned">
          {/* One layer above this modal, which already sits above the address form. */}
          <ZgnUnitsPanel {...panelProps} formZIndex={1200} />
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};
