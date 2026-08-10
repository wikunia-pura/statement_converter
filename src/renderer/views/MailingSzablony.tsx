import React, { useEffect, useMemo, useState } from 'react';
import { MailingPole, MailingSzablon, MailingTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import MailingComposer from '../components/MailingComposer';
import SearchableSelect, { SearchableOption } from '../components/SearchableSelect';
import {
  extractUsedFields,
  isFieldTableField,
  normalizeFieldName,
} from '../../shared/mailing-template';
import { MAILING_TYPE_OPTIONS } from './Mailing';

interface Props {
  language: Language;
}

interface FieldTablePickerProps {
  language: Language;
  /** The whole dictionary — the pool is a shortlist out of this. */
  pola: MailingPole[];
  /** Field names currently on the shortlist, in row order. */
  selected: string[];
  /** True when the body actually contains the `{{Tabela pól}}` placeholder. */
  inBody: boolean;
  onChange: (selected: string[]) => void;
}

/**
 * The shortlist of dynamic fields this template's table offers. A searchable
 * "add" dropdown plus an ordered list, rather than a checkbox per dictionary
 * entry: the dictionary grows with every rate a community can change, and one
 * letter concerns a handful of them — picking 5 out of 50 must not mean scrolling
 * past 45. The order here is the order of the rows in the sent mail.
 */
const FieldTablePicker: React.FC<FieldTablePickerProps> = ({
  language,
  pola,
  selected,
  inBody,
  onChange,
}) => {
  const t = translations[language];

  /** Dictionary fields not on the shortlist yet. */
  const options = useMemo<SearchableOption[]>(
    () =>
      pola
        .filter((p) => !selected.some((name) => normalizeFieldName(name) === normalizeFieldName(p.nazwa)))
        .map((p) => ({ value: p.nazwa, label: p.nazwa, hint: p.tekst || undefined })),
    [pola, selected],
  );

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="form-group">
      <label>{t.mailingTemplateTableFields}</label>
      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px', maxWidth: '80ch' }}>
        {t.mailingTemplateTableFieldsHint}
      </div>

      <SearchableSelect
        // Empty on purpose: picking adds to the list below, so the trigger stays
        // an "add another field" action.
        value=""
        options={options}
        onChange={(nazwa) => onChange([...selected, nazwa])}
        placeholder={t.mailingTemplateTableFieldAdd}
        searchPlaceholder={t.mailingInsertFieldSearch}
        emptyText={
          pola.length === 0
            ? t.mailingFieldTableNoFields
            : options.length === 0
              ? t.mailingTemplateTableFieldsAllPicked
              : t.mailingInsertFieldNoMatch
        }
        size="sm"
        style={{ maxWidth: '420px', marginBottom: selected.length > 0 ? '10px' : 0 }}
      />

      {selected.map((nazwa, index) => {
        const pole = pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(nazwa));
        return (
          <div
            key={nazwa}
            className={`mailing-recipient${!pole ? ' mailing-recipient--missing' : ''}`}
          >
            <span className="mailing-recipient__name">
              {index + 1}. {pole?.tekst || nazwa}
            </span>
            <div className="mailing-recipient__unit">
              {pole ? (
                nazwa
              ) : (
                <span style={{ color: 'var(--danger)' }}>{t.mailingTemplateTableFieldMissing}</span>
              )}
            </div>
            <button
              type="button"
              className="button button-ghost button-icon"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              title={t.mailingTemplateTableFieldUp}
              aria-label={t.mailingTemplateTableFieldUp}
            >
              ↑
            </button>
            <button
              type="button"
              className="button button-ghost button-icon"
              onClick={() => move(index, 1)}
              disabled={index === selected.length - 1}
              title={t.mailingTemplateTableFieldDown}
              aria-label={t.mailingTemplateTableFieldDown}
            >
              ↓
            </button>
            <button
              type="button"
              className="alternative-name-remove"
              onClick={() =>
                onChange(
                  selected.filter((name) => normalizeFieldName(name) !== normalizeFieldName(nazwa)),
                )
              }
              title={t.delete}
              aria-label={t.delete}
            >
              ×
            </button>
          </div>
        );
      })}

      {/* The two halves of the feature can be set up in either order, so neither
          missing half is an error — but silently producing no table would be. */}
      {selected.length > 0 && !inBody && (
        <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '8px' }}>
          <Icon name="alert-triangle" size={13} /> {t.mailingTemplateTableNoPlaceholder}
        </div>
      )}
      {selected.length === 0 && inBody && (
        <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '8px' }}>
          <Icon name="alert-triangle" size={13} /> {t.mailingTemplateTableNoFieldsPicked}
        </div>
      )}
    </div>
  );
};

/**
 * Template library. A template is a subject and a formatted body, both written
 * with `{{field}}` placeholders; the send screen resolves them per community.
 */
const MailingSzablony: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [szablony, setSzablony] = useState<MailingSzablon[]>([]);
  const [pola, setPola] = useState<MailingPole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null = list only; otherwise the template being edited (id null = new one).
  const [editing, setEditing] = useState<{
    id: number | null;
    nazwa: string;
    typ: MailingTyp;
    temat: string;
    tresc: string;
    attachPdf: boolean;
    tableFields: string[];
  } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      const [szablonyData, polaData] = await Promise.all([
        window.electronAPI.mailingGetSzablony(),
        window.electronAPI.mailingGetPola(),
      ]);
      setSzablony(szablonyData);
      setPola(polaData);
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const startNew = () =>
    setEditing({
      id: null,
      nazwa: '',
      typ: 'zgn-zaliczki',
      temat: '',
      tresc: '',
      attachPdf: false,
      tableFields: [],
    });

  const startEdit = (szablon: MailingSzablon) =>
    setEditing({
      id: szablon.id,
      nazwa: szablon.nazwa,
      typ: szablon.typ,
      temat: szablon.temat,
      tresc: szablon.tresc,
      attachPdf: szablon.attachPdf,
      // Absent on templates saved before the field table existed.
      tableFields: szablon.tableFields ?? [],
    });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.nazwa.trim()) {
      setError(t.mailingTemplateNameRequired);
      return;
    }
    if (!editing.temat.trim()) {
      setError(t.mailingTemplateSubjectRequired);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        nazwa: editing.nazwa.trim(),
        typ: editing.typ,
        temat: editing.temat,
        tresc: editing.tresc,
        attachPdf: editing.attachPdf,
        tableFields: editing.tableFields,
      };
      if (editing.id !== null) {
        await window.electronAPI.mailingUpdateSzablon(editing.id, payload);
      } else {
        await window.electronAPI.mailingAddSzablon(payload);
      }
      setEditing(null);
      await load();
      notify.success(t.mailingTemplateSaved);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (szablon: MailingSzablon) => {
    if (!(await notify.confirm(t.mailingTemplateConfirmDelete, { danger: true }))) return;
    try {
      await window.electronAPI.mailingDeleteSzablon(szablon.id);
      if (editing?.id === szablon.id) setEditing(null);
      await load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDuplicate = async (szablon: MailingSzablon) => {
    try {
      await window.electronAPI.mailingAddSzablon({
        nazwa: `${szablon.nazwa} (${t.mailingTemplateCopySuffix})`,
        typ: szablon.typ,
        temat: szablon.temat,
        tresc: szablon.tresc,
        attachPdf: szablon.attachPdf,
        tableFields: szablon.tableFields ?? [],
      });
      await load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /** Insert a placeholder into the subject, at the caret if there is one. */
  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
          }}
        >
          <h2 style={{ margin: 0 }}>{t.mailingTemplatesTitle}</h2>
          <button className="button button-primary" onClick={startNew} disabled={editing !== null}>
            + {t.mailingTemplateAdd}
          </button>
        </div>

        {szablony.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t.mailingTemplateName}</th>
                <th>{t.mailingType}</th>
                <th>{t.mailingSubject}</th>
                <th>{t.mailingAttachPdf}</th>
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {szablony.map((s) => (
                <tr key={s.id}>
                  <td>{s.nazwa}</td>
                  <td>
                    {MAILING_TYPE_OPTIONS.find((o) => o.value === s.typ)?.label ?? s.typ}
                  </td>
                  <td style={{ fontSize: '12px', opacity: 0.85 }}>{s.temat || '—'}</td>
                  <td>{s.attachPdf ? t.yes : t.no}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button button-small button-primary"
                        onClick={() => startEdit(s)}
                        disabled={editing !== null}
                      >
                        {t.edit}
                      </button>
                      <button
                        className="button button-small button-secondary"
                        onClick={() => handleDuplicate(s)}
                        title={t.mailingTemplateDuplicate}
                      >
                        {t.mailingTemplateDuplicate}
                      </button>
                      <button
                        className="button button-small button-danger"
                        onClick={() => handleDelete(s)}
                      >
                        {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">{t.mailingNoTemplates}</div>
        )}
      </div>

      {editing && (
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>
            {editing.id !== null ? t.mailingTemplateEdit : t.mailingTemplateNew}
          </h2>

          <div className="form-group">
            <label>{t.mailingTemplateName} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={editing.nazwa}
              onChange={(e) => { setEditing({ ...editing, nazwa: e.target.value }); if (error) setError(null); }}
              placeholder={t.mailingTemplateNamePlaceholder}
            />
          </div>

          <MailingComposer
            language={language}
            temat={editing.temat}
            tresc={editing.tresc}
            pola={pola}
            onChange={(patch) =>
              setEditing((prev) => (prev ? { ...prev, ...patch } : prev))
            }
            onDirty={() => { if (error) setError(null); }}
          />

          <FieldTablePicker
            language={language}
            pola={pola}
            selected={editing.tableFields}
            inBody={extractUsedFields(editing.tresc).some(isFieldTableField)}
            onChange={(tableFields) =>
              setEditing((prev) => (prev ? { ...prev, tableFields } : prev))
            }
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '6px',
            }}
          >
            <div>
              <div style={{ fontSize: '13px' }}>{t.mailingAttachPdfDefault}</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>{t.mailingAttachPdfDefaultHint}</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={editing.attachPdf}
                onChange={(e) => setEditing({ ...editing, attachPdf: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {error && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '10px' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button className="button button-success" onClick={handleSave} disabled={isSaving}>
              {t.save}
            </button>
            <button
              className="button button-secondary"
              onClick={() => { setEditing(null); setError(null); }}
              disabled={isSaving}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {pola.length === 0 && (
        <div className="card">
          <div style={{ fontSize: '13px', opacity: 0.8 }}>
            <Icon name="info" size={14} /> {t.mailingNoFieldsHintForTemplates}
          </div>
        </div>
      )}
    </div>
  );
};

export default MailingSzablony;
