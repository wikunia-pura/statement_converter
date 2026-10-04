import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAILING_TYP_ZGN,
  MailingPole,
  MailingSzablon,
  MailingTyp,
  MailingTypDef,
} from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import MailingComposer from '../components/MailingComposer';
import { ModalFooter } from '../components/Modal';
import SearchableSelect, { SearchableOption } from '../components/SearchableSelect';
import Select from '../components/Select';
import {
  extractUsedFields,
  isFieldTableField,
  normalizeFieldName,
} from '../../shared/mailing-template';

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
    <>
      <FormField label={t.mailingTemplateTableFields}>
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
          ariaLabel={t.mailingTemplateTableFieldAdd}
          style={{ maxWidth: '420px' }}
        />
      </FormField>

      {selected.length > 0 && (
        <ol className="record-list">
          {selected.map((nazwa, index) => {
            const pole = pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(nazwa));
            return (
              <li key={nazwa} className="record-row">
                <span className="record-row__index">{index + 1}</span>
                <div className="record-row__main">
                  <div className="record-row__title">{pole?.tekst || nazwa}</div>
                  {pole ? (
                    <div className="record-row__meta">{nazwa}</div>
                  ) : (
                    <div className="record-row__meta is-error">
                      <Icon name="alert-triangle" size={12} /> {t.mailingTemplateTableFieldMissing}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button button-ghost button-icon"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title={t.mailingTemplateTableFieldUp}
                    aria-label={t.mailingTemplateTableFieldUp}
                  >
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-icon"
                    onClick={() => move(index, 1)}
                    disabled={index === selected.length - 1}
                    title={t.mailingTemplateTableFieldDown}
                    aria-label={t.mailingTemplateTableFieldDown}
                  >
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-icon icon-danger"
                    onClick={() =>
                      onChange(selected.filter((name) => normalizeFieldName(name) !== normalizeFieldName(nazwa)))
                    }
                    title={t.delete}
                    aria-label={`${t.delete}: ${nazwa}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* The two halves of the feature can be set up in either order, so neither
          missing half is an error — but silently producing no table would be. */}
      {selected.length > 0 && !inBody && (
        <div className="callout callout--warning" role="status">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.mailingTemplateTableNoPlaceholder}</div>
        </div>
      )}
      {selected.length === 0 && inBody && (
        <div className="callout callout--warning" role="status">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{t.mailingTemplateTableNoFieldsPicked}</div>
        </div>
      )}
    </>
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
  /** Mailing kinds (Mailing → Typy mailingu), the built-in one first. */
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  /**
   * Kind the list is narrowed to; '' = every kind. Also what a new template
   * starts as — someone looking at the meeting-notice templates and pressing
   * "add" is adding a meeting notice.
   */
  const [filterTyp, setFilterTyp] = useState<MailingTyp | ''>('');
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

  // The editor opens under the list — bring it into view, or with a long list
  // "Edytuj" would look like it did nothing.
  const editorRef = useRef<HTMLDivElement>(null);
  const editingKey = editing ? String(editing.id) : null;
  useEffect(() => {
    if (editingKey !== null) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editingKey]);

  const load = async () => {
    setIsLoading(true);
    try {
      const [szablonyData, polaData, typyData] = await Promise.all([
        window.electronAPI.mailingGetSzablony(),
        window.electronAPI.mailingGetPola(),
        window.electronAPI.mailingGetTypy(),
      ]);
      setSzablony(szablonyData);
      setPola(polaData);
      setTypy(typyData);
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  /** The kind's display name; null when the key no longer names a kind. */
  const typName = (typ: MailingTyp): string | null =>
    typy.find((k) => k.klucz === typ)?.nazwa ?? null;

  const visibleSzablony = useMemo(
    () => (filterTyp ? szablony.filter((s) => s.typ === filterTyp) : szablony),
    [szablony, filterTyp],
  );

  /**
   * Kinds offered in the editor's picker. A template whose kind was deleted
   * keeps it as an extra, marked option — otherwise opening it would silently
   * show (and save) some other kind.
   */
  const typOptions = useMemo(() => {
    const options = typy.map((k) => ({ value: k.klucz, label: k.nazwa }));
    if (editing && !typy.some((k) => k.klucz === editing.typ)) {
      options.push({
        value: editing.typ,
        label: t.mailingTypyUnknown.replace('{key}', editing.typ),
      });
    }
    return options;
  }, [typy, editing, t.mailingTypyUnknown]);

  const defaultNewTyp = (): MailingTyp =>
    filterTyp ||
    (typy.some((k) => k.klucz === MAILING_TYP_ZGN) ? MAILING_TYP_ZGN : typy[0]?.klucz ?? MAILING_TYP_ZGN);

  const startNew = () =>
    setEditing({
      id: null,
      nazwa: '',
      typ: defaultNewTyp(),
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
      <FormSection
        icon="file-text"
        title={t.mailingTemplatesTitle}
        description={t.mailingTemplatesListDesc}
        aside={
          <button className="button button-primary" onClick={startNew} disabled={editing !== null}>
            <Icon name="plus" size={14} /> {t.mailingTemplateAdd}
          </button>
        }
      >
        {pola.length === 0 && (
          <div className="callout callout--muted">
            <Icon name="info" size={16} />
            <div className="callout__body">{t.mailingNoFieldsHintForTemplates}</div>
          </div>
        )}

        {/* Narrowing by kind: the meeting notices and the rate-change letters are
            different jobs, and the list mixes them otherwise. */}
        {szablony.length > 0 && typy.length > 1 && (
          <div className="list-filter">
            <FormField label={t.mailingTypyFilterLabel}>
              <Select
                value={filterTyp}
                onChange={(v) => setFilterTyp(v)}
                ariaLabel={t.mailingTypyFilterLabel}
                style={{ maxWidth: '320px' }}
                options={[
                  { value: '', label: t.mailingTypyFilterAll },
                  ...typy.map((k) => ({ value: k.klucz, label: k.nazwa })),
                ]}
              />
            </FormField>
          </div>
        )}

        {szablony.length > 0 && visibleSzablony.length === 0 && (
          <div className="form-empty">
            <Icon name="file-text" size={16} />
            {t.mailingTypyNoTemplatesForFilter}
          </div>
        )}

        {visibleSzablony.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.mailingTemplateName}</th>
                <th>{t.mailingType}</th>
                <th>{t.mailingSubject}</th>
                <th>{t.mailingAttachPdf}</th>
                <th className="data-table__actions">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visibleSzablony.map((s) => (
                <tr key={s.id}>
                  <td className="data-table__name">
                    <span className="cell-title">{s.nazwa}</span>
                  </td>
                  <td>
                    {typName(s.typ) ?? (
                      <span className="cell-warning" title={t.mailingTypyUnknownHint}>
                        <Icon name="alert-triangle" size={13} /> {s.typ}
                      </span>
                    )}
                  </td>
                  <td>{s.temat || <span className="cell-empty">—</span>}</td>
                  <td>{s.attachPdf ? t.yes : <span className="cell-empty">{t.no}</span>}</td>
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => startEdit(s)}
                        disabled={editing !== null}
                      >
                        <Icon name="edit" size={13} /> {t.edit}
                      </button>
                      <button
                        type="button"
                        className="button button-small button-subtle"
                        onClick={() => handleDuplicate(s)}
                        title={t.mailingTemplateDuplicate}
                      >
                        <Icon name="copy" size={13} /> {t.mailingTemplateDuplicate}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-icon icon-danger"
                        onClick={() => handleDelete(s)}
                        title={t.delete}
                        aria-label={`${t.delete}: ${s.nazwa}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          szablony.length === 0 && (
            <div className="form-empty">
              <Icon name="file-text" size={16} />
              {t.mailingNoTemplates}
            </div>
          )
        )}
      </FormSection>

      {editing && (
        <div ref={editorRef} className="page-form page-form__anchor">
          <FormSection
            icon="file-text"
            title={editing.id !== null ? t.mailingTemplateEdit : t.mailingTemplateNew}
            description={t.mailingTemplateSectionDesc}
          >
            <FormRow>
              <FormField label={t.mailingTemplateName} htmlFor="szablon-name" required>
                <input
                  id="szablon-name"
                  type="text"
                  value={editing.nazwa}
                  onChange={(e) => { setEditing({ ...editing, nazwa: e.target.value }); if (error) setError(null); }}
                  placeholder={t.mailingTemplateNamePlaceholder}
                  autoFocus
                />
              </FormField>
              <FormField
                label={t.mailingType}
                error={!typName(editing.typ) ? t.mailingTypyUnknownHint : undefined}
              >
                <Select
                  value={editing.typ}
                  onChange={(v) => setEditing((prev) => (prev ? { ...prev, typ: v } : prev))}
                  options={typOptions}
                  ariaLabel={t.mailingType}
                />
              </FormField>
            </FormRow>
            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">{t.mailingAttachPdfDefault}</span>
                <span className="switch-row__hint">{t.mailingAttachPdfDefaultHint}</span>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={editing.attachPdf}
                  onChange={(e) => setEditing({ ...editing, attachPdf: e.target.checked })}
                />
                <span className="toggle-slider"></span>
              </span>
            </label>
          </FormSection>

          <FormSection
            icon="edit"
            title={t.mailingTemplateSectionContent}
            description={t.mailingTemplateSectionContentDesc}
          >
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
          </FormSection>

          <FormSection
            icon="table"
            title={t.mailingTemplateSectionTable}
            description={t.mailingTemplateTableFieldsHint}
            collapsible
            persistKey="mailing.templateTable"
            collapsedSummary={
              editing.tableFields.length > 0
                ? t.formSectionPicked.replace('{names}', editing.tableFields.join(', '))
                : undefined
            }
          >
            <FieldTablePicker
              language={language}
              pola={pola}
              selected={editing.tableFields}
              inBody={extractUsedFields(editing.tresc).some(isFieldTableField)}
              onChange={(tableFields) =>
                setEditing((prev) => (prev ? { ...prev, tableFields } : prev))
              }
            />
          </FormSection>

          {error && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{error}</div>
            </div>
          )}

          <ModalFooter
            className="page-action-bar"
            note={<RequiredNote label={t.formRequiredNote} />}
            onCancel={() => { setEditing(null); setError(null); }}
            cancelLabel={t.cancel}
            onSubmit={handleSave}
            submitLabel={t.save}
            submitIcon="save"
            busy={isSaving}
          />
        </div>
      )}
    </div>
  );
};

export default MailingSzablony;
