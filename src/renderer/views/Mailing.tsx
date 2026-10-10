import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  DEFAULT_MAILING_ADRESACI,
  MAILING_TYP_ZGN,
  MailingAdresaci,
  MailingPole,
  MailingSendResult,
  MailingSzablon,
  MailingTyp,
  MailingTypDef,
  Spotkanie,
  ZgnJednostka,
  ZgnPelnomocnik,
} from '../../shared/types';
import {
  MailingRecipientLookup,
  MailingRecipientsResolved,
  resolveOdbiorcy,
} from '../../shared/mailing-recipients';
import MailingRecipientsEditor, {
  MailingOdbiorcyList,
  adresaciSummary,
} from '../components/MailingRecipientsEditor';
import { translations, Language } from '../translations';
import { plural } from '../plural';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import CheckList, { CheckListItem } from '../components/CheckList';
import { FormField, FormRow, FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import { ModalFooter } from '../components/Modal';
import Select from '../components/Select';
import MailingVisualEditor from '../components/MailingVisualEditor';
import MailingSaveTemplateModal from '../components/MailingSaveTemplateModal';
import SearchableSelect, { SearchableOption } from '../components/SearchableSelect';
import type { MailingKalendarzContext, SpotkanieLokalizacja } from '../../shared/types';
import {
  MailingRenderContext,
  buildKalendarzContext,
  extractFieldRefs,
  extractUsedFields,
  fieldPlaceholder,
  isBuiltinField,
  isFieldTableField,
  isKalendarzValueInjected,
  isZebranieField,
  kalendarzFieldOf,
  missingFieldValues,
  normalizeFieldName,
  readFieldValue,
} from '../../shared/mailing-template';

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
  /**
   * The meeting this send belongs to, when the user came here from a meeting's
   * "wyślij dokumenty". Travels through to every history row the send writes,
   * which is what lets the meeting list what actually went out for it.
   */
  spotkanieId?: number | null;
  /** The meeting's name, for the banner that says where this draft came from. */
  spotkanieNazwa?: string | null;
  /**
   * Recipient groups for this send. null ⇒ follow the kind's default (Mailing →
   * Typy mailingu), so editing the kind in the other tab still shows up here
   * until somebody changes the recipients for this one send.
   */
  adresaci: MailingAdresaci | null;
  /** Mailboxes (lower-cased) unticked for this send — across every community. */
  wykluczeni: string[];
}

export const emptyMailingDraft: MailingDraft = {
  typ: MAILING_TYP_ZGN,
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
  spotkanieId: null,
  spotkanieNazwa: null,
  adresaci: null,
  wykluczeni: [],
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
  const [pelnomocnicy, setPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  /** Mailing kinds, the built-in one first — the type picker and the default recipients. */
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  /**
   * The meeting this draft came from, when it did — its proxy and board members
   * replace the community's for that community's mail, exactly as the main
   * process resolves it.
   */
  const [spotkanie, setSpotkanie] = useState<Spotkanie | null>(null);
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
  /**
   * Community whose mail the preview shows. Every recipient gets its own text —
   * its name goes into the subject and the body, and it goes to its own city
   * unit's mailbox — so proofreading only the first one leaves the rest unseen.
   *
   * Kept out of the draft: it says nothing about what gets sent, only about what
   * is being looked at. `null` (and an id no longer on the list) falls back to
   * the first recipient, so removing the previewed one can't blank the preview.
   */
  const [previewAdresId, setPreviewAdresId] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  /** "Zapisz jako szablon" — the modal keeping this send's text as a template. */
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  /**
   * Meeting locations — read only for a draft made from a meeting, whose
   * location's street address goes into "Adres zebrania" next to its name.
   */
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return window.electronAPI.onMailingProgress((event) =>
      setProgress({ done: event.done, total: event.total }),
    );
  }, []);

  const load = async () => {
    try {
      const [adresyData, zgnData, szablonyData, polaData, smtp, pelnomocnicyData, typyData] =
        await Promise.all([
          window.electronAPI.getAdresy(),
          window.electronAPI.mailingGetZgn(),
          window.electronAPI.mailingGetSzablony(),
          window.electronAPI.mailingGetPola(),
          window.electronAPI.mailingGetSmtp(),
          window.electronAPI.getZgnPelnomocnicy(),
          window.electronAPI.mailingGetTypy(),
        ]);
      setAdresy(adresyData);
      setJednostki(zgnData);
      setPelnomocnicy(pelnomocnicyData);
      setTypy(typyData);
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

  /**
   * The meeting behind the draft, read only when there is one. A meeting that no
   * longer exists simply drops out: the community's own proxy and board apply,
   * which is also what the main process falls back to.
   */
  useEffect(() => {
    const id = draft.spotkanieId ?? null;
    if (id == null) {
      setSpotkanie(null);
      return;
    }
    let alive = true;
    window.electronAPI
      .getSpotkania()
      .then((all) => {
        if (alive) setSpotkanie(all.find((s) => s.id === id) ?? null);
      })
      .catch(() => {
        if (alive) setSpotkanie(null);
      });
    return () => {
      alive = false;
    };
  }, [draft.spotkanieId]);

  // The locations dictionary, once a meeting with a location is behind the draft.
  // A failure only costs the street address: the location's name is on the
  // meeting itself.
  const spotkanieLokalizacjaId = spotkanie?.lokalizacjaId ?? null;
  useEffect(() => {
    if (spotkanieLokalizacjaId == null) return;
    let alive = true;
    window.electronAPI
      .getSpotkaniaLokalizacje()
      .then((all) => {
        if (alive) setLokalizacje(all);
      })
      .catch(() => {
        if (alive) setLokalizacje([]);
      });
    return () => {
      alive = false;
    };
  }, [spotkanieLokalizacjaId]);

  /**
   * What the meeting fills the calendar fields with — its date, start time,
   * community and place. Null without a meeting: the calendar fields are then
   * typed by hand like any other field. Sent with the mail, so the main process
   * renders exactly what the preview shows.
   */
  const kalendarz = useMemo<MailingKalendarzContext | null>(() => {
    if (!spotkanie) return null;
    const lokalizacja = lokalizacje.find((l) => l.id === spotkanie.lokalizacjaId);
    return buildKalendarzContext({
      startsAt: spotkanie.startsAt,
      adresNazwa: spotkanie.adresNazwa,
      lokalizacjaNazwa: lokalizacja?.nazwa ?? spotkanie.lokalizacjaNazwa,
      lokalizacjaAdres: lokalizacja?.adres,
    });
  }, [spotkanie, lokalizacje]);

  /** The chosen kind; undefined while loading or for a kind deleted meanwhile. */
  const typDef = useMemo(() => typy.find((k) => k.klucz === draft.typ), [typy, draft.typ]);

  /**
   * Recipient groups this send uses: the draft's own once the user changed them,
   * the kind's default otherwise. Passed explicitly with the send, so what is
   * listed here is what the main process resolves.
   */
  const effectiveAdresaci = useMemo<MailingAdresaci>(
    () => draft.adresaci ?? typDef?.adresaci ?? DEFAULT_MAILING_ADRESACI,
    [draft.adresaci, typDef],
  );

  /** Kinds as picker options; a kind deleted meanwhile stays, marked, so the picker isn't blank. */
  const typOptions = useMemo(() => {
    const options = typy.map((k) => ({ value: k.klucz, label: k.nazwa }));
    if (!typy.some((k) => k.klucz === draft.typ)) {
      options.push({ value: draft.typ, label: t.mailingTypyUnknown.replace('{key}', draft.typ) });
    }
    return options;
  }, [typy, draft.typ, t.mailingTypyUnknown]);

  /** What one community's groups resolve against — the meeting only for the meeting's community. */
  const lookupFor = (adres: Adres): MailingRecipientLookup => ({
    adres,
    spotkanie: spotkanie && spotkanie.adresId === adres.id ? spotkanie : null,
    jednostki,
    pelnomocnicy,
  });

  /**
   * Every community's resolved recipients under the current groups and ticks —
   * the same `resolveOdbiorcy` the main process sends with, so the list, the
   * "no recipients" block and the actual To headers cannot disagree.
   */
  const resolvedByAdres = useMemo(() => {
    const map = new Map<number, MailingRecipientsResolved>();
    for (const adres of adresy) {
      map.set(adres.id, resolveOdbiorcy(lookupFor(adres), effectiveAdresaci, draft.wykluczeni));
    }
    return map;
    // lookupFor reads only the dependencies listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adresy, jednostki, pelnomocnicy, spotkanie, effectiveAdresaci, draft.wykluczeni]);

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

  /** Who one community's mail goes to under the current groups and ticks. */
  const odbiorcyFor = (adres: Adres) => resolvedByAdres.get(adres.id)?.odbiorcy ?? [];

  /** One line for a picker hint: the first recipient, and how many more. */
  const odbiorcyHint = (adres: Adres): string => {
    const odbiorcy = odbiorcyFor(adres);
    if (odbiorcy.length === 0) return t.mailingAdresaciNoneForAddress;
    const first = odbiorcy[0].nazwa ? `${odbiorcy[0].nazwa} — ${odbiorcy[0].email}` : odbiorcy[0].email;
    return odbiorcy.length > 1
      ? `${first} ${t.mailingAdresaciMoreCount.replace('{count}', String(odbiorcy.length - 1))}`
      : first;
  };

  /**
   * Communities that can actually be mailed — at least one address under the
   * current recipient groups. The rest are left out of the picker rather than
   * offered and then rejected at send time: the fix for them is in Adresy (or in
   * the groups below), not in the picker. Unticked addresses don't count here —
   * a community whose one address was unticked stays listed, and flagged.
   */
  const mailableAdresy = useMemo(
    () => adresy.filter((a) => (resolvedByAdres.get(a.id)?.kandydaci.length ?? 0) > 0),
    [adresy, resolvedByAdres],
  );

  const selectedAdresy = useMemo(
    () => draft.adresIds.map((id) => adresy.find((a) => a.id === id)).filter((a): a is Adres => !!a),
    [draft.adresIds, adresy],
  );

  /**
   * Selected communities whose mail would go to nobody — these block the send,
   * as a community without a city unit always has: the main process would only
   * record them as failures.
   */
  const noRecipients = useMemo(
    () => selectedAdresy.filter((a) => (resolvedByAdres.get(a.id)?.odbiorcy.length ?? 0) === 0),
    [selectedAdresy, resolvedByAdres],
  );

  /**
   * Fields the chosen template actually uses and still needs a value for, minus
   * the built-in ones.
   *
   * A field placed only as its description (`{{Woda|opis}}` — the label column of
   * a table the user drew by hand) renders its fixed sentence and nothing else, so
   * it gets no input here: an empty box that changes nothing in the letter reads
   * as something forgotten.
   *
   * Calendar fields are built-ins that may still need typing: listed when the
   * text uses them and the meeting does not fill them (no meeting, or a meeting
   * with no location) — with the date or time picker their kind names.
   */
  const fieldsToFill = useMemo(() => {
    if (!template) return [];
    const kalCtx: MailingRenderContext = { adresNazwa: '', dateText: '', pola, values: {}, kalendarz };
    // Read from the draft, so a field added while editing this send immediately
    // gets its own value input instead of silently going out unsubstituted.
    const needsValue = new Map<string, string>();
    for (const ref of extractFieldRefs(draft.temat, draft.tresc)) {
      const kal = kalendarzFieldOf(ref.nazwa);
      if (kal ? isKalendarzValueInjected(ref.nazwa, kalCtx) : isBuiltinField(ref.nazwa) || ref.part === 'label') {
        continue;
      }
      const key = normalizeFieldName(ref.nazwa);
      if (!needsValue.has(key)) needsValue.set(key, kal ? kal.nazwa : ref.nazwa);
    }
    return [...needsValue.values()].map((name) => ({
      name,
      pole: pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(name)),
      kal: kalendarzFieldOf(name),
    }));
  }, [template, draft.temat, draft.tresc, pola, kalendarz]);

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

  /**
   * The HTML input a field's value is typed into. A date or an hour picked from
   * the browser's own control cannot be spelled two ways, which is the whole
   * point of giving the field a kind.
   */
  const valueInputType = (pole?: Pick<MailingPole, 'typWartosci'>): 'text' | 'date' | 'time' => {
    if (pole?.typWartosci === 'data') return 'date';
    if (pole?.typWartosci === 'godzina') return 'time';
    return 'text';
  };

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

  const attachPdf = draft.attachPdf ?? template?.attachPdf ?? false;

  /**
   * Recipient the preview is showing. Resolved from the list rather than trusted
   * as stored, so an id left behind by a removed recipient quietly becomes the
   * first one instead of previewing a community that is no longer being mailed.
   */
  const previewAdres = useMemo(
    () => selectedAdresy.find((a) => a.id === previewAdresId) ?? selectedAdresy[0] ?? null,
    [selectedAdresy, previewAdresId],
  );

  const previewIndex = previewAdres ? selectedAdresy.findIndex((a) => a.id === previewAdres.id) : -1;
  /** Who the previewed community's mail goes to — shown above the preview. */
  const previewOdbiorcy = previewAdres ? odbiorcyFor(previewAdres) : [];

  /**
   * What the "Adresaci" editor resolves against: the previewed community, so the
   * address list and the preview are always about the same letter. Memoised so
   * the editor doesn't re-resolve on every keystroke elsewhere in the form.
   */
  const previewLookup = useMemo<MailingRecipientLookup | null>(
    () => (previewAdres ? lookupFor(previewAdres) : null),
    // lookupFor reads only the dependencies listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewAdres, spotkanie, jednostki, pelnomocnicy],
  );

  /** The recipients, as the preview picker's options — mailbox on the second line. */
  const previewOptions = useMemo<SearchableOption[]>(
    () =>
      selectedAdresy.map((a) => ({
        value: String(a.id),
        label: a.nazwa,
        hint: odbiorcyHint(a),
        keywords: (a.alternativeNames ?? []).join(' '),
      })),
    // odbiorcyHint reads resolvedByAdres and the translations only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAdresy, resolvedByAdres, t],
  );

  /**
   * Walk the recipient list. Wraps around: flipping through a dozen letters is
   * the point of the arrows, and a button that dead-ends at the last one reads as
   * broken.
   */
  const stepPreview = (delta: number) => {
    if (selectedAdresy.length === 0) return;
    const from = previewIndex < 0 ? 0 : previewIndex;
    const next = (from + delta + selectedAdresy.length) % selectedAdresy.length;
    setPreviewAdresId(selectedAdresy[next].id);
  };

  /** Preview a recipient picked from the list above, and bring the preview along. */
  const showPreviewFor = (id: number) => {
    setPreviewAdresId(id);
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Fields placed in the text that still have no value — user fields left empty,
   * calendar fields neither the meeting nor the user filled in. The send waits
   * for them: a gap would go out to every community as a blank. The community
   * is irrelevant here (it never leaves a gap), so one check covers every letter.
   */
  const missingValues = useMemo(
    () =>
      template
        ? missingFieldValues(
            { adresNazwa: '', dateText: '', pola, values: draft.values, tableFields: tableFieldNames, kalendarz },
            draft.temat,
            draft.tresc,
          )
        : [],
    [template, pola, draft.values, tableFieldNames, kalendarz, draft.temat, draft.tresc],
  );

  /**
   * Zebrania fields the text places. A send from here has no meeting version
   * behind it, so they can never be filled — said once, above the letter, rather
   * than left for the user to discover chip by chip.
   */
  const zebranieFieldsUsed = useMemo(
    () => extractUsedFields(draft.temat, draft.tresc).filter(isZebranieField),
    [draft.temat, draft.tresc],
  );

  /** "Zapisz jako szablon" done: the draft now matches the template it saved to. */
  const handleTemplateSaved = (saved: MailingSzablon, mode: 'overwrite' | 'new') => {
    setSzablony((prev) =>
      mode === 'overwrite' ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved],
    );
    setDraft((prev) => ({
      ...prev,
      templateId: saved.id,
      loadedFromTemplateId: saved.id,
      temat: saved.temat,
      tresc: saved.tresc,
      edited: false,
    }));
    // The server's own copy, in the background — the list above is already right
    // for everything this screen shows.
    window.electronAPI
      .mailingGetSzablony()
      .then(setSzablony)
      .catch(() => undefined);
  };

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
    if (noRecipients.length > 0) {
      notify.warning(
        t.mailingAdresaciMissingBlock.replace('{names}', noRecipients.map((a) => a.nazwa).join(', ')),
      );
      return;
    }
    if (missingValues.length > 0) {
      notify.warning(t.mveMissingBlocksSend.replace('{names}', missingValues.join(', ')));
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
        // Set when the draft came from a meeting's "wyślij dokumenty": every
        // history row this send writes points back at the meeting.
        spotkanieId: draft.spotkanieId ?? null,
        // The meeting's date, time and place for the calendar fields — the same
        // context the editable preview rendered.
        kalendarz,
        // Always explicit, even when it is the kind's default: the list on
        // screen was resolved from exactly these groups and ticks.
        adresaci: effectiveAdresaci,
        wykluczeni: draft.wykluczeni,
      });
      if (response.error) {
        notify.error(`${t.mailingSendError}: ${response.error}`);
        return;
      }
      const sent = response.results ?? [];
      setResults(sent);
      // Wysłane wspólnoty schodzą z listy adresatów: kolejny mailing startuje z
      // czystą listą, a nieudane zostają zaznaczone, żeby dało się je ponowić
      // bez szukania ich od nowa.
      const deliveredIds = new Set(
        sent.filter((r) => r.status === 'success').map((r) => r.adresId),
      );
      if (deliveredIds.size > 0) {
        setDraft((prev) => ({
          ...prev,
          adresIds: prev.adresIds.filter((id) => !deliveredIds.has(id)),
        }));
      }
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

  /** The communities as tickable rows: mailable ones, plus any ticked one that no longer is. */
  const communityItems: CheckListItem[] = adresy
    .filter((a) => draft.adresIds.includes(a.id) || mailableAdresy.some((m) => m.id === a.id))
    .map((a) => {
      const selected = draft.adresIds.includes(a.id);
      const none = odbiorcyFor(a).length === 0;
      return {
        id: a.id,
        label: a.nazwa,
        note: odbiorcyHint(a),
        noteTone: selected && none ? 'danger' : 'muted',
        highlighted: !!template && selected && previewAdres?.id === a.id,
        // Straight from the list to that community's own letter — the picker in
        // the preview does the same; this is the shortcut for the row in view.
        action:
          template && selected ? (
            <button
              type="button"
              className="button button-small button-ghost button-icon"
              onClick={() => showPreviewFor(a.id)}
              title={t.mailingPreviewThis}
              aria-label={`${t.mailingPreviewThis}: ${a.nazwa}`}
            >
              <Icon name="eye" size={14} />
            </button>
          ) : undefined,
      };
    });

  /** Why "Wyślij" is grey — said on hover, and in the bar's note. */
  const sendBlockedReason = !template
    ? t.mailingPickTemplate
    : draft.adresIds.length === 0
      ? t.mailingPickAddresses
      : missingValues.length > 0
        ? t.mveMissingBlocksSend.replace('{names}', missingValues.join(', '))
        : undefined;

  const sendNote = isSending && progress ? (
    <span className="action-note">
      <Icon name="loader" size={13} className="icon-spin" />
      {t.mailingProgress.replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}
    </span>
  ) : missingValues.length > 0 ? (
    <span className="action-note action-note--warning">
      <Icon name="alert-triangle" size={13} />
      {t.mveMissingBlocksSend.replace('{names}', missingValues.join(', '))}
    </span>
  ) : noRecipients.length > 0 ? (
    <span className="action-note action-note--danger">
      <Icon name="alert-triangle" size={13} />
      {t.mailingAdresaciMissingBlock.replace('{names}', noRecipients.map((a) => a.nazwa).join(', '))}
    </span>
  ) : smtpReady.ready ? (
    <span className="action-note">
      <Icon name="mail" size={13} />
      {t.mailingSendFrom.replace('{from}', smtpReady.user)}
    </span>
  ) : null;

  const customized = !!draft.adresaci || draft.wykluczeni.length > 0;

  /** What a folded "Wspólnoty" section says: the ticked names, the first few. */
  const pickedSummary =
    selectedAdresy.length === 0
      ? t.mailingNoCommunitiesPicked
      : t.formSectionPicked.replace(
          '{names}',
          selectedAdresy.slice(0, 4).map((a) => a.nazwa).join(', ') +
            (selectedAdresy.length > 4 ? ` +${selectedAdresy.length - 4}` : ''),
        );

  return (
    <div className="content-body">
      <div className="page-form">
        {!smtpReady.ready && (
          <div className="callout callout--danger" role="alert">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{t.mailingSmtpNotConfigured}</div>
          </div>
        )}

        {/* Where this draft came from, when it came from a meeting. Says it once,
            at the top, because the send itself will be recorded against that
            meeting and the user should know before pressing the button. */}
        {draft.spotkanieId != null && (
          <div className="callout callout--info" role="status">
            <Icon name="calendar" size={16} />
            <div className="callout__body">
              {t.mailingFromMeeting.replace('{name}', draft.spotkanieNazwa || '—')}
            </div>
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={() => setDraft((prev) => ({ ...prev, spotkanieId: null, spotkanieNazwa: null }))}
            >
              {t.mailingFromMeetingClear}
            </button>
          </div>
        )}

        <FormSection icon="mail" title={t.mailingSectionMessage} description={t.mailingSectionMessageDesc}>
          <FormRow>
            <FormField label={t.mailingType} hint={typDef?.opis || undefined}>
              <Select
                value={draft.typ}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev.typ === v
                      ? prev
                      : {
                          ...prev,
                          typ: v as MailingTyp,
                          templateId: null,
                          // Another kind has its own default recipients; changes made
                          // for the previous one don't carry over.
                          adresaci: null,
                          wykluczeni: [],
                        },
                  )
                }
                options={typOptions}
                ariaLabel={t.mailingType}
              />
            </FormField>
            <FormField label={t.mailingTemplate}>
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
                  ariaLabel={t.mailingTemplate}
                />
              ) : (
                <div className="callout callout--muted">
                  <Icon name="info" size={16} />
                  <div className="callout__body">{t.mailingNoTemplatesForType}</div>
                  <button type="button" className="button button-small button-subtle" onClick={onNavigateToTemplates}>
                    {t.mailingGoToTemplates}
                  </button>
                </div>
              )}
            </FormField>
          </FormRow>
        </FormSection>

        <FormSection
          icon="home"
          title={t.mailingRecipientsTitle}
          description={t.mailingAdresaciRecipientsHint}
          collapsible
          persistKey="mailing.communities"
          collapsedSummary={pickedSummary}
          aside={
            <div className="form-section__actions">
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={handleSelectAllMailable}
                disabled={mailableAdresy.length === 0 || draft.adresIds.length >= mailableAdresy.length}
              >
                {t.mailingSelectAll}
              </button>
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => setDraft((prev) => ({ ...prev, adresIds: [] }))}
                disabled={draft.adresIds.length === 0}
              >
                {t.mailingClearSelection}
              </button>
            </div>
          }
        >
          {communityItems.length > 0 ? (
            <CheckList
              items={communityItems}
              selected={draft.adresIds}
              onChange={(adresIds) => setDraft((prev) => ({ ...prev, adresIds }))}
              searchPlaceholder={t.mailingSearchAddresses}
              onlySelectedLabel={t.pickOnlySelected}
              emptyLabel={t.mailingNoMatchingAddress}
            />
          ) : (
            <div className="form-empty">
              <Icon name="home" size={16} />
              {adresy.length === 0 ? t.mailingNoAddresses : t.mailingAdresaciNoneSelectable}
            </div>
          )}
          {noRecipients.length > 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.mailingAdresaciMissingBlock.replace('{names}', noRecipients.map((a) => a.nazwa).join(', '))}
              </div>
            </div>
          )}
          {adresy.length > mailableAdresy.length && (
            <div className="callout callout--muted">
              <Icon name="info" size={16} />
              <div className="callout__body">
                {t.mailingAdresaciHiddenNone.replace('{count}', String(adresy.length - mailableAdresy.length))}
              </div>
            </div>
          )}
        </FormSection>

        {/* Who the mail goes to. Starts as the kind's default and can be changed
            for this one send; the list is the previewed community's, so the
            addresses and the preview below always describe the same letter. */}
        <FormSection
          icon="users"
          title={t.mailingAdresaciTitle}
          description={t.mailingAdresaciSendHint.replace('{typ}', typDef?.nazwa ?? draft.typ)}
          collapsible
          persistKey="mailing.adresaci"
          collapsedSummary={t.mailingAdresaciCollapsed.replace('{groups}', adresaciSummary(t, effectiveAdresaci))}
          badge={customized ? t.mailingAdresaciCustomized : undefined}
          aside={
            customized ? (
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => setDraft((prev) => ({ ...prev, adresaci: null, wykluczeni: [] }))}
                disabled={isSending}
              >
                <Icon name="refresh" size={13} /> {t.mailingAdresaciResetDefault}
              </button>
            ) : undefined
          }
        >
          {selectedAdresy.length > 1 && previewAdres && (
            <FormField label={t.mailingAdresaciShowFor}>
              <SearchableSelect
                value={String(previewAdres.id)}
                options={previewOptions}
                onChange={(v) => setPreviewAdresId(Number(v))}
                searchPlaceholder={t.mailingPreviewSearchAddress}
                emptyText={t.mailingNoMatchingAddress}
                ariaLabel={t.mailingAdresaciShowFor}
                style={{ maxWidth: '420px' }}
              />
            </FormField>
          )}
          {selectedAdresy.length === 0 && (
            <div className="callout callout--muted">
              <Icon name="info" size={16} />
              <div className="callout__body">{t.mailingAdresaciPickCommunity}</div>
            </div>
          )}
          <MailingRecipientsEditor
            language={language}
            adresaci={effectiveAdresaci}
            onAdresaciChange={(adresaci) => setDraft((prev) => ({ ...prev, adresaci }))}
            wykluczeni={draft.wykluczeni}
            onWykluczeniChange={(wykluczeni) => setDraft((prev) => ({ ...prev, wykluczeni }))}
            lookup={previewLookup}
            contextLabel={previewAdres?.nazwa}
            disabled={isSending}
          />
        </FormSection>

        {fieldsToFill.length > 0 && (
          <FormSection
            icon="edit"
            title={t.mailingValuesTitle}
            description={t.mailingValuesHint}
          >
            <div className="form-grid">
              {fieldsToFill.map(({ name, pole, kal }) => {
                const inputType = valueInputType(pole ?? kal);
                return (
                  <FormField
                    key={name}
                    label={pole?.nazwa ?? kal?.nazwa ?? name}
                    htmlFor={`mailing-value-${name}`}
                    hint={
                      pole?.tekst ? (
                        `„${pole.tekst}”`
                      ) : kal ? (
                        <><Icon name="calendar" size={12} /> {t.mveCalendarFieldInList}</>
                      ) : undefined
                    }
                    error={
                      !pole && !kal
                        ? t.mailingUnknownFieldInTemplate.replace('{field}', fieldPlaceholder(name))
                        : undefined
                    }
                  >
                    {/* The unit sits beside the box rather than in it: it is part of
                        what the letter will say, but not part of what you type. */}
                    <div className={`form-inline${inputType !== 'text' ? ' form-inline--narrow' : ''}`}>
                      <input
                        id={`mailing-value-${name}`}
                        type={inputType}
                        value={draft.values[name] ?? readFieldValue(draft.values, name)}
                        onChange={(e) => setFieldValue(name, e.target.value)}
                        placeholder={kal ? '' : t.mailingValuePlaceholder}
                      />
                      {pole?.jednostka && <span className="form-inline__unit">{pole.jednostka}</span>}
                    </div>
                  </FormField>
                );
              })}
            </div>
          </FormSection>
        )}

        {template && (
          <div ref={previewRef} className="page-form__anchor">
            <FormSection
              icon="eye"
              title={t.mailingPreviewTitle}
              description={`${t.mailingPreviewHint} ${t.mvePreviewEditHint}`}
              badge={draft.edited ? <span title={t.mailingEditedNotice}>{t.mailingEditedBadge}</span> : undefined}
              aside={
                draft.edited ? (
                  <button type="button" className="button button-small button-subtle" onClick={resetToTemplate}>
                    <Icon name="refresh" size={13} /> {t.mailingResetToTemplate}
                  </button>
                ) : undefined
              }
            >
              {kalendarz && (
                <div className="callout callout--info">
                  <Icon name="calendar" size={16} />
                  <div className="callout__body">
                    {t.mveFromMeetingValues.replace('{name}', draft.spotkanieNazwa || spotkanie?.nazwa || '—')}
                  </div>
                </div>
              )}

              {selectedAdresy.length > 0 ? (
                <div className="preview-bar">
                  <FormField label={t.mailingPreviewPickAddress}>
                    <div className="form-inline">
                      <SearchableSelect
                        value={previewAdres ? String(previewAdres.id) : ''}
                        options={previewOptions}
                        onChange={(v) => setPreviewAdresId(Number(v))}
                        searchPlaceholder={t.mailingPreviewSearchAddress}
                        emptyText={t.mailingNoMatchingAddress}
                        ariaLabel={t.mailingPreviewPickAddress}
                        style={{ flex: '1 1 300px', maxWidth: '420px' }}
                      />
                      {selectedAdresy.length > 1 && (
                        <div className="mailing-preview-nav">
                          <button
                            type="button"
                            className="button button-secondary button-icon"
                            onClick={() => stepPreview(-1)}
                            title={t.mailingPreviewPrev}
                            aria-label={t.mailingPreviewPrev}
                          >
                            <Icon name="chevron-left" size={14} />
                          </button>
                          <span className="mailing-preview-nav__count">
                            {t.mailingPreviewPosition
                              .replace('{index}', String(previewIndex + 1))
                              .replace('{total}', String(selectedAdresy.length))}
                          </span>
                          <button
                            type="button"
                            className="button button-secondary button-icon"
                            onClick={() => stepPreview(1)}
                            title={t.mailingPreviewNext}
                            aria-label={t.mailingPreviewNext}
                          >
                            <Icon name="chevron-right" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </FormField>
                  {/* The mailbox belongs in the preview: the letter names the
                      community, but it is delivered to that community's city unit —
                      a mismatch there is exactly what proofreading per recipient is for. */}
                  {previewAdres && (
                    previewOdbiorcy.length > 0 ? (
                      <div className="preview-bar__to">
                        <Icon name="mail" size={13} />
                        {t.mailingPreviewRecipient.replace('{email}', previewOdbiorcy.map((o) => o.email).join(', '))}
                      </div>
                    ) : (
                      <div className="preview-bar__to is-missing">
                        <Icon name="alert-triangle" size={13} /> {t.mailingAdresaciNoneForAddress}
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="callout callout--muted">
                  <Icon name="info" size={16} />
                  <div className="callout__body">
                    {t.mailingPreviewNoAddressNote.replace('{placeholder}', t.mailingPreviewNoAddress)}
                  </div>
                </div>
              )}

              {/* The preview IS the editor: the letter as the previewed community
                  receives it, editable in place. Text edits are for this send only
                  (the template changes only through "Zapisz jako szablon"); values
                  typed into its fields are the same `draft.values` the list above
                  edits. */}
              {zebranieFieldsUsed.length > 0 && (
                <div className="callout callout--warning">
                  <Icon name="alert-triangle" size={16} />
                  <div className="callout__body">
                    {t.mailingZebranieFieldsHere.replace('{names}', zebranieFieldsUsed.join(', '))}
                  </div>
                </div>
              )}
              <MailingVisualEditor
                language={language}
                temat={draft.temat}
                onTematChange={(temat) => setDraft((prev) => ({ ...prev, temat, edited: true }))}
                tresc={draft.tresc}
                onTrescChange={(tresc) => setDraft((prev) => ({ ...prev, tresc, edited: true }))}
                values={draft.values}
                onValuesChange={(values) => setDraft((prev) => ({ ...prev, values }))}
                pola={pola}
                adresNazwa={previewAdres?.nazwa ?? t.mailingPreviewNoAddress}
                kalendarz={kalendarz}
                typ={template?.typ ?? null}
                tableFields={tableFieldNames}
                tablePool={usesFieldTable ? tableFieldPool : undefined}
                onTableFieldsChange={
                  usesFieldTable
                    ? (names) => setDraft((prev) => ({ ...prev, tableFields: names }))
                    : undefined
                }
                onSaveAsTemplate={() => setSaveTplOpen(true)}
                readOnly={isSending}
              />
            </FormSection>
          </div>
        )}

        <MailingSaveTemplateModal
          language={language}
          open={saveTplOpen}
          onClose={() => setSaveTplOpen(false)}
          typ={draft.typ}
          temat={draft.temat}
          tresc={draft.tresc}
          attachPdf={attachPdf}
          // The template's shortlist for its table, not this send's ticks: which
          // rows go out is decided per send.
          tableFields={template?.tableFields ?? []}
          sourceTemplate={template}
          onSaved={handleTemplateSaved}
        />

        <FormSection
          icon="paperclip"
          title={t.mailingAttachmentsTitle}
          description={t.mailingAttachmentsDesc}
        >
          <label className="switch-row">
            <span className="switch-row__text">
              <span className="switch-row__label">{t.mailingAttachPdf}</span>
              <span className="switch-row__hint">{t.mailingAttachPdfHint}</span>
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setDraft((prev) => ({ ...prev, attachPdf: e.target.checked }))}
              />
              <span className="toggle-slider"></span>
            </span>
          </label>

          <FormField label={t.mailingOwnAttachments} hint={t.mailingOwnAttachmentsHint}>
            {/* The add button lives inside the list's frame: as its last row when
                there are files, beside "nothing yet" when there are none — never
                loose under the label. */}
            <div className={`file-list${draft.attachments.length === 0 ? ' is-empty' : ''}`}>
              {draft.attachments.map((a) => (
                <div key={a.filePath} className="file-list__row">
                  <Icon name="paperclip" size={14} />
                  <span className="file-list__name" title={a.filePath}>{a.fileName}</span>
                  <button
                    type="button"
                    className="button button-ghost button-icon icon-danger"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        attachments: prev.attachments.filter((x) => x.filePath !== a.filePath),
                      }))
                    }
                    title={t.remove}
                    aria-label={`${t.remove}: ${a.fileName}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
              <div className="file-list__footer">
                {draft.attachments.length === 0 && (
                  <span className="file-list__empty">
                    <Icon name="paperclip" size={14} />
                    {t.mailingNoOwnAttachments}
                  </span>
                )}
                <button type="button" className="button button-small button-subtle" onClick={handleAddAttachments}>
                  <Icon name="plus" size={13} /> {t.mailingAddAttachment}
                </button>
              </div>
            </div>
          </FormField>
        </FormSection>

        {results && (
          <FormSection
            icon="check-circle"
            title={t.mailingResultsTitle}
            aside={
              <button type="button" className="button button-small button-subtle" onClick={onNavigateToHistory}>
                <Icon name="history" size={13} /> {t.mailingGoToHistory}
              </button>
            }
          >
            <table className="form-table">
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
                    <td className="form-table__label">{r.adresNazwa}</td>
                    <td className="form-table__sub">
                      {r.odbiorcy && r.odbiorcy.length > 0 ? (
                        <MailingOdbiorcyList language={language} odbiorcy={r.odbiorcy} />
                      ) : r.jednostkaNazwa ? (
                        <>
                          <div>{r.jednostkaNazwa}</div>
                          <div>{r.jednostkaEmail}</div>
                        </>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'success' ? (
                        <span className="result-status is-ok">
                          <Icon name="check-circle" size={14} /> {t.mailingStatusSent}
                        </span>
                      ) : (
                        <span className="result-status is-error" title={r.errorMessage}>
                          <Icon name="x-circle" size={14} /> {r.errorMessage ?? t.mailingStatusError}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.attachments.length > 0 ? (
                        <div className="result-files">
                          {r.attachments.map((a) => (
                            <button
                              key={a.filePath}
                              type="button"
                              className="button button-small button-subtle"
                              onClick={async () => {
                                const ok = await window.electronAPI.openFile(a.filePath);
                                if (!ok) notify.error(t.mailingFileMissing);
                              }}
                            >
                              <Icon name="paperclip" size={13} /> {a.fileName}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FormSection>
        )}

        {/* The page's one action, closing the form — after the last section, where
            sending makes sense — with what stops it, or who it sends from, on the left. */}
        <ModalFooter
          className="page-action-bar"
          note={sendNote}
          onSubmit={handleSend}
          submitLabel={
            isSending
              ? t.mailingSending
              : draft.adresIds.length > 0
                ? t.mailingSendTo.replace(
                    '{count}',
                    plural(draft.adresIds.length, language, ['wspólnoty', 'wspólnot', 'wspólnot'], ['community', 'communities']),
                  )
                : t.mailingSend
          }
          submitIcon="mail"
          submitDisabled={!!sendBlockedReason}
          submitTitle={sendBlockedReason}
          busy={isSending}
        />
      </div>
    </div>
  );
};

export default Mailing;
