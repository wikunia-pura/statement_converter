import React, { useEffect, useMemo, useState } from 'react';
import {
  Adres,
  MailingPole,
  MailingSendResult,
  MailingSzablon,
  MailingTyp,
  ZgnJednostka,
} from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import Select from '../components/Select';
import MailingComposer from '../components/MailingComposer';
import SearchableSelect, { SearchableOption } from '../components/SearchableSelect';
import { MAILING_LOGO_SVG_DATA_URI } from '../../shared/mailing-logo';
import {
  buildMailShell,
  extractUsedFields,
  fieldPlaceholder,
  formatPolishDate,
  isBuiltinField,
  isFieldTableField,
  normalizeFieldName,
  readFieldValue,
  renderHtml,
  renderPlain,
} from '../../shared/mailing-template';

/** Mailing kinds offered in the type dropdown. Only one exists so far. */
export const MAILING_TYPE_OPTIONS: { value: MailingTyp; label: string }[] = [
  { value: 'zgn-zaliczki', label: 'Zmiany zaliczek ZGN' },
];

/**
 * The send form's state. Lifted to App so stepping out to Adresy to attach a
 * missing city unit — the most likely detour mid-flow — doesn't discard the
 * selection, the typed values and the attachments.
 */
export interface MailingDraft {
  typ: MailingTyp;
  templateId: number | null;
  adresIds: number[];
  /** Field values keyed by field name — one set for the whole send. */
  values: Record<string, string>;
  /**
   * Dynamic fields ticked for the `{{Tabela pól}}` table in the body. Per send,
   * not per template: which positions a letter lists changes from month to month,
   * and the values for them are typed here anyway.
   */
  tableFields: string[];
  attachments: { fileName: string; filePath: string }[];
  /** null ⇒ follow the template's default. */
  attachPdf: boolean | null;
  /**
   * Subject and body for *this send*. Loaded from the chosen template and freely
   * editable afterwards: a rate-change letter usually needs a sentence about the
   * specific resolution, and saving that into the template would carry it into
   * every future mailing.
   */
  temat: string;
  tresc: string;
  /**
   * Template the text above was loaded from. Kept so picking another template
   * (or having the template edited in the other tab) reloads the text, while
   * every other re-render leaves the user's edits alone.
   */
  loadedFromTemplateId: number | null;
  /** True once the text differs from the template — drives the "edited" hint. */
  edited: boolean;
}

export const emptyMailingDraft: MailingDraft = {
  typ: 'zgn-zaliczki',
  templateId: null,
  adresIds: [],
  values: {},
  tableFields: [],
  attachments: [],
  attachPdf: null,
  temat: '',
  tresc: '',
  loadedFromTemplateId: null,
  edited: false,
};

interface Props {
  language: Language;
  draft: MailingDraft;
  setDraft: React.Dispatch<React.SetStateAction<MailingDraft>>;
  onNavigateToHistory: () => void;
  /** Jump to the templates tab — offered when there is no template yet. */
  onNavigateToTemplates: () => void;
}

const Mailing: React.FC<Props> = ({
  language,
  draft,
  setDraft,
  onNavigateToHistory,
  onNavigateToTemplates,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [jednostki, setJednostki] = useState<ZgnJednostka[]>([]);
  const [szablony, setSzablony] = useState<MailingSzablon[]>([]);
  const [pola, setPola] = useState<MailingPole[]>([]);
  const [smtpReady, setSmtpReady] = useState<{ ready: boolean; user: string }>({
    ready: false,
    user: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<MailingSendResult[] | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return window.electronAPI.onMailingProgress((event) =>
      setProgress({ done: event.done, total: event.total }),
    );
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      const [adresyData, zgnData, szablonyData, polaData, smtp] = await Promise.all([
        window.electronAPI.getAdresy(),
        window.electronAPI.mailingGetZgn(),
        window.electronAPI.mailingGetSzablony(),
        window.electronAPI.mailingGetPola(),
        window.electronAPI.mailingGetSmtp(),
      ]);
      setAdresy(adresyData);
      setJednostki(zgnData);
      setSzablony(szablonyData);
      setPola(polaData);
      setSmtpReady({
        ready: Boolean(smtp.user && smtp.passwordSet && smtp.host),
        user: smtp.user,
      });
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const templatesForType = useMemo(
    () => szablony.filter((s) => s.typ === draft.typ),
    [szablony, draft.typ],
  );

  const template = useMemo(
    () => templatesForType.find((s) => s.id === draft.templateId) ?? null,
    [templatesForType, draft.templateId],
  );

  // Default the selected template to the only sensible choice when there is one.
  useEffect(() => {
    if (draft.templateId === null && templatesForType.length === 1) {
      setDraft((prev) => ({ ...prev, templateId: templatesForType[0].id }));
    }
  }, [draft.templateId, templatesForType, setDraft]);

  /**
   * Load the chosen template's subject and body into the draft. Guarded on
   * `loadedFromTemplateId` so it fires when the selection changes and never on a
   * later re-render — otherwise every keystroke would be overwritten by the
   * template it came from.
   */
  useEffect(() => {
    if (!template) return;
    const sameTemplate = draft.loadedFromTemplateId === template.id;
    const matchesTemplate = draft.temat === template.temat && draft.tresc === template.tresc;
    // Reload on a different template, and also when this send hasn't been edited
    // but the template has — switching to the Templates tab, fixing a typo and
    // coming back should bring the fix with it. Edits to this send always win.
    if (sameTemplate && (draft.edited || matchesTemplate)) return;
    setDraft((prev) => ({
      ...prev,
      temat: template.temat,
      tresc: template.tresc,
      loadedFromTemplateId: template.id,
      edited: false,
      // Another template offers another shortlist for its table, so the ticks
      // from the previous one mean nothing here. Re-loading the *same* template's
      // text (a typo fixed in the other tab) keeps them.
      tableFields: sameTemplate ? prev.tableFields : [],
    }));
  }, [template, draft.loadedFromTemplateId, draft.edited, draft.temat, draft.tresc, setDraft]);

  /** Put the template's own text back, discarding this send's edits. */
  const resetToTemplate = () => {
    if (!template) return;
    setDraft((prev) => ({
      ...prev,
      temat: template.temat,
      tresc: template.tresc,
      loadedFromTemplateId: template.id,
      edited: false,
    }));
  };

  const jednostkaFor = (adres: Adres): ZgnJednostka | undefined =>
    adres.zgnJednostkaId != null ? jednostki.find((j) => j.id === adres.zgnJednostkaId) : undefined;

  /**
   * Communities that can actually be mailed — a unit with a mailbox. The rest are
   * left out of the picker rather than offered and then rejected at send time:
   * the fix for them is in Adresy, not here.
   */
  const mailableAdresy = useMemo(
    () => adresy.filter((a) => Boolean(jednostkaFor(a)?.email)),
    [adresy, jednostki],
  );

  const selectedAdresy = useMemo(
    () => draft.adresIds.map((id) => adresy.find((a) => a.id === id)).filter((a): a is Adres => !!a),
    [draft.adresIds, adresy],
  );

  /** Pickable communities: mailable and not already on the list. */
  const recipientOptions = useMemo<SearchableOption[]>(
    () =>
      mailableAdresy
        .filter((a) => !draft.adresIds.includes(a.id))
        .map((a) => {
          const jednostka = jednostkaFor(a);
          return {
            value: String(a.id),
            label: a.nazwa,
            hint: jednostka ? `${jednostka.nazwa} — ${jednostka.email}` : undefined,
            keywords: (a.alternativeNames ?? []).join(' '),
          };
        }),
    [mailableAdresy, draft.adresIds, jednostki],
  );

  /** Selected communities with no city unit — these cannot be mailed. */
  const missingUnit = useMemo(
    () => selectedAdresy.filter((a) => !jednostkaFor(a)),
    [selectedAdresy, jednostki],
  );

  /** Fields the chosen template actually uses, minus the built-in ones. */
  const fieldsToFill = useMemo(() => {
    if (!template) return [];
    // Read from the draft, so a field added while editing this send immediately
    // gets its own value input instead of silently going out unsubstituted.
    return extractUsedFields(draft.temat, draft.tresc)
      .filter((name) => !isBuiltinField(name))
      .map((name) => ({
        name,
        pole: pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(name)),
      }));
  }, [template, draft.temat, draft.tresc, pola]);

  /** True once the body asks for the field table, i.e. the picker below matters. */
  const usesFieldTable = useMemo(
    () => extractUsedFields(draft.tresc).some(isFieldTableField),
    [draft.tresc],
  );

  /**
   * The template's shortlist, resolved against the dictionary and kept in the
   * template's own order — that order is the order of the rows in the mail.
   * A field deleted from the dictionary since the template was written is dropped
   * rather than sent as a row with no sentence.
   */
  const tableFieldPool = useMemo(
    () =>
      (template?.tableFields ?? [])
        .map((name) => pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(name)))
        .filter((p): p is MailingPole => !!p),
    [template, pola],
  );

  /**
   * Ticked fields, in the pool's order — exactly the rows that will be sent, so
   * the preview, the mail and the history entry all read from this one list.
   * Empty when the body no longer holds the placeholder (it can be deleted while
   * editing this send): the ticks then describe a table nobody will receive.
   */
  const tableFieldNames = useMemo(
    () =>
      usesFieldTable
        ? tableFieldPool
            .filter((p) =>
              draft.tableFields.some(
                (name) => normalizeFieldName(name) === normalizeFieldName(p.nazwa),
              ),
            )
            .map((p) => p.nazwa)
        : [],
    [usesFieldTable, tableFieldPool, draft.tableFields],
  );

  /** Ticked fields still waiting for a value — a row with an empty cell. */
  const tableFieldsWithoutValue = useMemo(
    () => tableFieldNames.filter((name) => !readFieldValue(draft.values, name)),
    [tableFieldNames, draft.values],
  );

  /**
   * Store a field's value under exactly one spelling. The same field can be named
   * differently by a placeholder and by a table row (`{{zaliczka}}` against the
   * dictionary's `Zaliczka`), and two entries differing only in case would make
   * the resolved value depend on key order.
   */
  const setFieldValue = (nazwa: string, wartosc: string) =>
    setDraft((prev) => {
      const key = normalizeFieldName(nazwa);
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.values)) {
        if (normalizeFieldName(k) !== key) values[k] = v;
      }
      values[nazwa] = wartosc;
      return { ...prev, values };
    });

  const toggleTableField = (nazwa: string, checked: boolean) =>
    setDraft((prev) => {
      const key = normalizeFieldName(nazwa);
      const without = prev.tableFields.filter((name) => normalizeFieldName(name) !== key);
      return { ...prev, tableFields: checked ? [...without, nazwa] : without };
    });

  /**
   * Typing a value into a row of the table is the clearest possible statement
   * that the row belongs in this mail, so it ticks the box too. The box stays
   * ticked if the value is cleared again — unticking is the user's call.
   */
  const setTableFieldValue = (nazwa: string, wartosc: string) => {
    setFieldValue(nazwa, wartosc);
    if (wartosc.trim()) toggleTableField(nazwa, true);
  };

  const attachPdf = draft.attachPdf ?? template?.attachPdf ?? false;

  /** Preview rendered against the first selected community, as it will be sent. */
  const preview = useMemo(() => {
    if (!template) return null;
    const ctx = {
      adresNazwa: selectedAdresy[0]?.nazwa ?? t.mailingPreviewNoAddress,
      dateText: formatPolishDate(new Date()),
      pola,
      values: draft.values,
      tableFields: tableFieldNames,
    };
    return {
      // The draft's text, not the template's — this is what will be sent.
      subject: renderPlain(draft.temat, ctx),
      // The whole mail frame, not just the body: the shell is inline-styled, so
      // the preview renders the very markup that is sent.
      html: buildMailShell(renderHtml(draft.tresc, ctx), MAILING_LOGO_SVG_DATA_URI),
    };
  }, [
    template,
    draft.temat,
    draft.tresc,
    selectedAdresy,
    pola,
    draft.values,
    tableFieldNames,
    t.mailingPreviewNoAddress,
  ]);

  const addAdres = (id: number) =>
    setDraft((prev) => ({
      ...prev,
      adresIds: prev.adresIds.includes(id) ? prev.adresIds : [...prev.adresIds, id],
    }));

  const removeAdres = (id: number) =>
    setDraft((prev) => ({ ...prev, adresIds: prev.adresIds.filter((x) => x !== id) }));

  const handleSelectAllMailable = () =>
    setDraft((prev) => ({
      ...prev,
      adresIds: [...new Set([...prev.adresIds, ...mailableAdresy.map((a) => a.id)])],
    }));

  const handleAddAttachments = async () => {
    const files = await window.electronAPI.mailingSelectAttachments();
    if (files.length === 0) return;
    setDraft((prev) => ({
      ...prev,
      attachments: [
        ...prev.attachments,
        ...files.filter((f) => !prev.attachments.some((a) => a.filePath === f.filePath)),
      ],
    }));
  };

  const handleSend = async () => {
    if (!template) {
      notify.warning(t.mailingPickTemplate);
      return;
    }
    if (draft.adresIds.length === 0) {
      notify.warning(t.mailingPickAddresses);
      return;
    }
    if (missingUnit.length > 0) {
      notify.warning(
        t.mailingMissingUnits.replace('{names}', missingUnit.map((a) => a.nazwa).join(', ')),
      );
      return;
    }
    if (!smtpReady.ready) {
      notify.warning(t.mailingSmtpNotConfigured);
      return;
    }
    const confirmMessage = t.mailingConfirmSend
      .replace('{count}', String(draft.adresIds.length))
      .replace('{from}', smtpReady.user);
    if (!(await notify.confirm(confirmMessage))) return;

    setIsSending(true);
    setResults(null);
    setProgress({ done: 0, total: draft.adresIds.length });
    try {
      const response = await window.electronAPI.mailingSend({
        typ: draft.typ,
        templateId: template.id,
        // The edited text goes over the wire: the main process must send what the
        // user proofread, not what the template still says.
        temat: draft.temat,
        tresc: draft.tresc,
        adresIds: draft.adresIds,
        values: draft.values,
        // Only the fields that survive as rows — the same list the preview used.
        tableFields: tableFieldNames,
        attachPdf,
        attachments: draft.attachments,
      });
      if (response.error) {
        notify.error(`${t.mailingSendError}: ${response.error}`);
        return;
      }
      const sent = response.results ?? [];
      setResults(sent);
      const failed = sent.filter((r) => r.status === 'error').length;
      if (failed === 0) {
        notify.success(t.mailingSendSuccess.replace('{count}', String(sent.length)));
      } else {
        notify.error(
          t.mailingSendPartial
            .replace('{sent}', String(sent.length - failed))
            .replace('{failed}', String(failed)),
        );
      }
    } catch (err: unknown) {
      notify.error(
        `${t.mailingSendError}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setIsSending(false);
      setProgress(null);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
      {!smtpReady.ready && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <Icon name="alert-triangle" size={16} />
            {t.mailingSmtpNotConfigured}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: '15px' }}>{t.mailingTitle}</h2>

        <div className="form-group">
          <label>{t.mailingType}</label>
          <Select
            value={draft.typ}
            onChange={(v) =>
              setDraft((prev) => ({ ...prev, typ: v as MailingTyp, templateId: null }))
            }
            options={MAILING_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>

        <div className="form-group">
          <label>{t.mailingTemplate}</label>
          {templatesForType.length > 0 ? (
            <Select
              value={draft.templateId ?? ''}
              onChange={(v) =>
                setDraft((prev) => ({
                  ...prev,
                  templateId: v ? Number(v) : null,
                  // A new template brings its own PDF default; drop the override.
                  attachPdf: null,
                }))
              }
              placeholder={t.mailingPickTemplate}
              options={[
                { value: '', label: t.mailingPickTemplate },
                ...templatesForType.map((s) => ({ value: String(s.id), label: s.nazwa })),
              ]}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', opacity: 0.8 }}>{t.mailingNoTemplatesForType}</span>
              <button className="button button-primary button-small" onClick={onNavigateToTemplates}>
                {t.mailingGoToTemplates}
              </button>
            </div>
          )}
        </div>
      </div>

      {fieldsToFill.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '8px' }}>{t.mailingValuesTitle}</h2>
          <div style={{ fontSize: '13px', opacity: 0.75, marginBottom: '16px', maxWidth: '80ch' }}>
            {t.mailingValuesHint}
          </div>
          {fieldsToFill.map(({ name, pole }) => (
            <div className="form-group" key={name}>
              <label>{pole?.nazwa ?? name}</label>
              {pole?.tekst && (
                <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '6px' }}>
                  „{pole.tekst}”
                </div>
              )}
              {!pole && (
                <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '6px' }}>
                  {t.mailingUnknownFieldInTemplate.replace('{field}', fieldPlaceholder(name))}
                </div>
              )}
              <input
                type="text"
                value={draft.values[name] ?? readFieldValue(draft.values, name)}
                onChange={(e) => setFieldValue(name, e.target.value)}
                placeholder={t.mailingValuePlaceholder}
              />
            </div>
          ))}
        </div>
      )}

      {usesFieldTable && (
        <div className="card">
          <h2 style={{ marginBottom: '8px' }}>{t.mailingFieldTableTitle}</h2>
          <div style={{ fontSize: '13px', opacity: 0.75, marginBottom: '16px', maxWidth: '80ch' }}>
            {t.mailingFieldTableHint}
          </div>

          {tableFieldPool.length > 0 ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '52px' }}>{t.mailingFieldTableInTable}</th>
                    <th>{t.mailingFieldTableRowLabel}</th>
                    <th style={{ width: '32%' }}>{t.mailingFieldValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableFieldPool.map((p) => {
                    const checked = tableFieldNames.some(
                      (name) => normalizeFieldName(name) === normalizeFieldName(p.nazwa),
                    );
                    return (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleTableField(p.nazwa, e.target.checked)}
                            aria-label={p.nazwa}
                          />
                        </td>
                        <td>
                          <div>{p.tekst || p.nazwa}</div>
                          {p.tekst && (
                            <div style={{ fontSize: '12px', opacity: 0.6 }}>{p.nazwa}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            // Always editable — typing here ticks the box, which is
                            // one gesture instead of two for the common case.
                            value={draft.values[p.nazwa] ?? readFieldValue(draft.values, p.nazwa)}
                            onChange={(e) => setTableFieldValue(p.nazwa, e.target.value)}
                            placeholder={t.mailingValuePlaceholder}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '12px' }}>
                {t.mailingFieldTableRowCount
                  .replace('{count}', String(tableFieldNames.length))
                  .replace('{total}', String(tableFieldPool.length))}
              </div>
              {tableFieldNames.length === 0 && (
                <div style={{ fontSize: '12px', opacity: 0.75, marginTop: '6px' }}>
                  <Icon name="info" size={13} /> {t.mailingFieldTableEmptyNote}
                </div>
              )}
              {tableFieldsWithoutValue.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '6px' }}>
                  <Icon name="alert-triangle" size={13} />{' '}
                  {t.mailingFieldTableMissingValues.replace(
                    '{names}',
                    tableFieldsWithoutValue.join(', '),
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div>{t.mailingFieldTableNoPool}</div>
              <button
                className="button button-primary button-small"
                style={{ marginTop: '10px' }}
                onClick={onNavigateToTemplates}
              >
                {t.mailingFieldTableGoToTemplate}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <h2 style={{ margin: 0 }}>{t.mailingRecipientsTitle}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="button button-small button-secondary"
              onClick={handleSelectAllMailable}
              disabled={mailableAdresy.length === 0}
            >
              {t.mailingSelectAll}
            </button>
            <button
              className="button button-small button-secondary"
              onClick={() => setDraft((prev) => ({ ...prev, adresIds: [] }))}
              disabled={draft.adresIds.length === 0}
            >
              {t.mailingClearSelection}
            </button>
          </div>
        </div>
        <div style={{ fontSize: '13px', opacity: 0.75, marginBottom: '12px', maxWidth: '80ch' }}>
          {t.mailingRecipientsHint}
        </div>

        {mailableAdresy.length > 0 ? (
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <SearchableSelect
              // Empty on purpose: picking adds to the list below, so the trigger
              // stays an "add another recipient" action.
              value=""
              options={recipientOptions}
              onChange={(v) => addAdres(Number(v))}
              placeholder={t.mailingAddRecipient}
              searchPlaceholder={t.mailingSearchAddresses}
              emptyText={
                recipientOptions.length === 0 ? t.mailingAllRecipientsPicked : t.mailingNoMatchingAddress
              }
              style={{ maxWidth: '520px' }}
            />
          </div>
        ) : (
          <div className="empty-state">
            {adresy.length === 0 ? t.mailingNoAddresses : t.mailingNoMailableAddresses}
          </div>
        )}

        <div style={{ fontSize: '13px', marginBottom: '10px', opacity: 0.8 }}>
          {t.mailingSelectedCount
            .replace('{selected}', String(draft.adresIds.length))
            .replace('{total}', String(mailableAdresy.length))}
        </div>

        {adresy.length > mailableAdresy.length && (
          <div style={{ fontSize: '12px', opacity: 0.75, marginBottom: '10px' }}>
            <Icon name="info" size={13} />{' '}
            {t.mailingHiddenNoUnit.replace(
              '{count}',
              String(adresy.length - mailableAdresy.length),
            )}
          </div>
        )}

        {missingUnit.length > 0 && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--danger)',
              marginBottom: '10px',
            }}
          >
            {t.mailingMissingUnits.replace('{names}', missingUnit.map((a) => a.nazwa).join(', '))}
          </div>
        )}

        {selectedAdresy.length > 0 && (
          <div>
            {selectedAdresy.map((adres) => {
              const jednostka = jednostkaFor(adres);
              return (
                <div
                  key={adres.id}
                  className={`mailing-recipient${!jednostka ? ' mailing-recipient--missing' : ''}`}
                >
                  <span className="mailing-recipient__name">{adres.nazwa}</span>
                  <div className="mailing-recipient__unit">
                    {jednostka ? (
                      <>
                        <div>{jednostka.nazwa}</div>
                        <div style={{ opacity: 0.8 }}>{jednostka.email}</div>
                      </>
                    ) : (
                      <span style={{ color: 'var(--danger)' }}>{t.mailingNoUnitForAddress}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="alternative-name-remove"
                    onClick={() => removeAdres(adres.id)}
                    title={t.mailingRemoveRecipient}
                    aria-label={t.mailingRemoveRecipient}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '15px' }}>{t.mailingAttachmentsTitle}</h2>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '13px' }}>{t.mailingAttachPdf}</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>{t.mailingAttachPdfHint}</div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={attachPdf}
              onChange={(e) => setDraft((prev) => ({ ...prev, attachPdf: e.target.checked }))}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="form-group">
          <label>{t.mailingOwnAttachments}</label>
          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
            {t.mailingOwnAttachmentsHint}
          </div>
          {draft.attachments.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              {draft.attachments.map((a) => (
                <div key={a.filePath} className="alternative-name-tag">
                  <span title={a.filePath}>{a.fileName}</span>
                  <button
                    type="button"
                    className="alternative-name-remove"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        attachments: prev.attachments.filter((x) => x.filePath !== a.filePath),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="button button-secondary" onClick={handleAddAttachments}>
            + {t.mailingAddAttachment}
          </button>
        </div>
      </div>

      {template && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '12px',
              marginBottom: '15px',
            }}
          >
            <div>
              <h2 style={{ margin: '0 0 8px' }}>{t.mailingMessageTitle}</h2>
              <div style={{ fontSize: '13px', opacity: 0.75, maxWidth: '80ch' }}>
                {t.mailingMessageHint}
              </div>
            </div>
            {draft.edited && (
              <button className="button button-secondary" onClick={resetToTemplate}>
                <Icon name="refresh" size={14} /> {t.mailingResetToTemplate}
              </button>
            )}
          </div>

          {draft.edited && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--accent)',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Icon name="edit" size={14} /> {t.mailingEditedNotice}
            </div>
          )}

          <MailingComposer
            language={language}
            temat={draft.temat}
            tresc={draft.tresc}
            pola={pola}
            bodyNote={t.mailingMessageBodyNote}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch, edited: true }))}
          />
        </div>
      )}

      {preview && (
        <div className="card">
          <h2 style={{ marginBottom: '8px' }}>{t.mailingPreviewTitle}</h2>
          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '12px' }}>
            {selectedAdresy.length > 1
              ? t.mailingPreviewForFirst.replace('{name}', selectedAdresy[0].nazwa)
              : t.mailingPreviewHint}
          </div>
          <div className="form-group">
            <label>{t.mailingSubject}</label>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>{preview.subject || '—'}</div>
          </div>
          <div
            className="mailing-preview"
            // Content is the user's own template, rendered with escaped field
            // values — the same string that becomes the mail body and the PDF.
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="button button-success"
            onClick={handleSend}
            disabled={isSending || !template || draft.adresIds.length === 0}
          >
            {isSending ? t.mailingSending : t.mailingSend}
          </button>
          {isSending && progress && (
            <span style={{ fontSize: '13px', opacity: 0.8 }}>
              {t.mailingProgress
                .replace('{done}', String(progress.done))
                .replace('{total}', String(progress.total))}
            </span>
          )}
          {smtpReady.ready && !isSending && (
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {t.mailingSendFrom.replace('{from}', smtpReady.user)}
            </span>
          )}
        </div>
      </div>

      {results && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <h2 style={{ margin: 0 }}>{t.mailingResultsTitle}</h2>
            <button className="button button-small button-secondary" onClick={onNavigateToHistory}>
              {t.mailingGoToHistory}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t.mailingResultAddress}</th>
                <th>{t.mailingResultRecipient}</th>
                <th>{t.mailingResultStatus}</th>
                <th>{t.mailingResultAttachments}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.adresId}-${r.subject}`}>
                  <td>{r.adresNazwa}</td>
                  <td style={{ fontSize: '12px' }}>
                    {r.jednostkaNazwa ? (
                      <>
                        <div>{r.jednostkaNazwa}</div>
                        <div style={{ opacity: 0.7 }}>{r.jednostkaEmail}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {r.status === 'success' ? (
                      <span style={{ color: 'var(--success)' }}>
                        <Icon name="check-circle" size={14} /> {t.mailingStatusSent}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--danger)' }} title={r.errorMessage}>
                        <Icon name="x-circle" size={14} /> {r.errorMessage ?? t.mailingStatusError}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    {r.attachments.length > 0
                      ? r.attachments.map((a) => (
                          <div key={a.filePath}>
                            <button
                              className="button button-small button-secondary"
                              onClick={async () => {
                                const ok = await window.electronAPI.openFile(a.filePath);
                                if (!ok) notify.error(t.mailingFileMissing);
                              }}
                            >
                              {a.fileName}
                            </button>
                          </div>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Mailing;
