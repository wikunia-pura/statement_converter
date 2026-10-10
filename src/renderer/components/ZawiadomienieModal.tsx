import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  MAILING_TYP_ZAWIADOMIENIE,
  MailingExportResult,
  MailingPole,
  MailingSzablon,
  MailingTypDef,
  Spotkanie,
  SpotkanieLokalizacja,
  Zebranie,
  ZebranieMaterial,
  ZebranieWersja,
  ZgnJednostka,
  ZgnPelnomocnik,
} from '../../shared/types';
import {
  buildZebranieContext,
  latestWersja,
  newZawiadomienieMaterial,
  wersjaLabel,
  zawiadomienieOf,
  zebranieDane,
} from '../../shared/zebrania';
import {
  buildKalendarzContext,
  formatPolishDate,
  missingFieldValues,
  normalizeFieldName,
} from '../../shared/mailing-template';
import { MailingRecipientLookup, resolveOdbiorcy } from '../../shared/mailing-recipients';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';
import Loader from './Loader';
import MailingVisualEditor from './MailingVisualEditor';
import MailingRecipientsEditor from './MailingRecipientsEditor';
import MailingSaveTemplateModal from './MailingSaveTemplateModal';

/**
 * "Zawiadomienie o zebraniu" — the meeting notice, from template to file.
 *
 * One flow for both ways in (a meeting card in the Kalendarz, an entry in the
 * Zebrania module), because it is one document: the notice stored as a material
 * of ONE version of ONE Zebranie. Opening it from a meeting that has no entry
 * yet creates the entry (`zebranieFromSpotkanie`) — the notice needs somewhere
 * to live, and that place is the meeting's Zebranie, so the user can come back
 * to it, correct it and download it again.
 *
 * Built for a person who should never have to think about templates or
 * placeholders: when there is exactly one notice template it is taken without
 * asking; after that the screen is the letter itself, who it goes to, and two
 * download buttons. Everything that would make a download wrong (a blank field)
 * is said in words next to the buttons before it can happen.
 */
export interface ZawiadomienieModalProps {
  language: Language;
  /** Signed-in user — recorded as the author of the notice. */
  userEmail: string;
  /**
   * The entry the notice belongs to. Re-read when the modal opens, so a stale
   * copy from the caller never overwrites newer work.
   */
  zebranie?: Zebranie | null;
  /**
   * Or the meeting it is for: its entry is fetched — and created on first use —
   * through `zebranieFromSpotkanie`. Takes precedence over `zebranie`.
   */
  spotkanieId?: number | null;
  /** The version whose notice is edited. Absent / unknown ⇒ the newest one. */
  wersjaId?: number | null;
  onClose: () => void;
  /**
   * Something was written (the entry created, the notice saved, a download
   * recorded, the version's status moved) — the caller reloads what it shows.
   */
  onChanged?: () => void;
  /** "Mailing → Szablony", for when no notice template exists yet. */
  onOpenSzablony?: () => void;
  /**
   * Sending the notice (Kalendarz → "Wyślij zawiadomienie"): the side panel with
   * the blank fields, who it goes to and the PDF / e-mail downloads, and "Wyślij"
   * — the notice mailed through the Mailing's SMTP box — as the window's action.
   * Without it (Zebrania) the window is the letter alone.
   */
  sending?: boolean;
}

type Phase = 'loading' | 'error' | 'pick' | 'edit';

/** What the user edits — everything a save writes, without the bookkeeping. */
function materialContent(m: ZebranieMaterial): string {
  return JSON.stringify({
    szablonId: m.szablonId,
    szablonNazwa: m.szablonNazwa,
    temat: m.temat,
    tresc: m.tresc,
    values: m.values,
    tableFields: m.tableFields,
    adresaci: m.adresaci,
    wykluczeni: [...m.wykluczeni].sort(),
  });
}

/** A file name from a path, whichever separator the OS used. */
function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

const ZawiadomienieModal: React.FC<ZawiadomienieModalProps> = ({
  language,
  userEmail,
  zebranie: zebranieProp = null,
  spotkanieId = null,
  wersjaId = null,
  onClose,
  onChanged,
  onOpenSzablony,
  sending = false,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [zebranie, setZebranie] = useState<Zebranie | null>(null);
  /** The version being worked on — fixed when the modal opens. */
  const [targetWersjaId, setTargetWersjaId] = useState<number | null>(null);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [jednostki, setJednostki] = useState<ZgnJednostka[]>([]);
  const [pelnomocnicy, setPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  const [pola, setPola] = useState<MailingPole[]>([]);
  const [szablony, setSzablony] = useState<MailingSzablon[]>([]);
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  /** The notice as stored, and as being edited. Dirty = they differ. */
  const [saved, setSaved] = useState<ZebranieMaterial | null>(null);
  const [draft, setDraft] = useState<ZebranieMaterial | null>(null);
  /** The picker was opened from the editor ("start again") — it can go back. */
  const [restarting, setRestarting] = useState(false);
  const [busy, setBusy] = useState<
    null | 'save' | 'pdf' | 'eml' | 'send' | 'status' | 'start'
  >(null);
  /** The Mailing's SMTP box — "Wyślij" needs one; `user` is who the mail comes from. */
  const [smtp, setSmtp] = useState<{ ready: boolean; user: string }>({ ready: false, user: '' });
  const [lastFiles, setLastFiles] = useState<MailingExportResult['files'] | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  /**
   * A close is being confirmed. Escape reaches both the confirm dialog and this
   * modal's own dismiss handler, so without this the Escape that answers the
   * question would ask it again.
   */
  const closingRef = useRef(false);

  const zawSzablony = useMemo(
    () =>
      szablony
        .filter((s) => s.typ === MAILING_TYP_ZAWIADOMIENIE)
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl')),
    [szablony]
  );

  const wersja: ZebranieWersja | null = useMemo(() => {
    if (!zebranie) return null;
    return zebranie.wersje.find((w) => w.id === targetWersjaId) ?? latestWersja(zebranie);
  }, [zebranie, targetWersjaId]);
  const newest = zebranie ? latestWersja(zebranie) : null;

  const dane = useMemo(
    () => (zebranie ? zebranieDane(zebranie, spotkania, lokalizacje) : null),
    [zebranie, spotkania, lokalizacje]
  );
  const kalendarz = useMemo(() => (dane ? buildKalendarzContext(dane) : null), [dane]);
  /** The version's statement, plan and resolutions — what the Zebrania fields read. */
  const zebranieCtx = useMemo(
    () => (dane ? buildZebranieContext(wersja, dane, pola) : null),
    [wersja, dane, pola]
  );
  const spotkanie = useMemo(
    () =>
      zebranie?.spotkanieId != null
        ? (spotkania.find((s) => s.id === zebranie.spotkanieId) ?? null)
        : null,
    [zebranie, spotkania]
  );

  /** What the recipient groups resolve against: the community, the meeting, the units. */
  const lookup: MailingRecipientLookup | null = useMemo(() => {
    if (!dane) return null;
    return {
      adres: dane.adresId != null ? (adresy.find((a) => a.id === dane.adresId) ?? null) : null,
      spotkanie,
      jednostki,
      pelnomocnicy,
    };
  }, [dane, adresy, spotkanie, jednostki, pelnomocnicy]);

  const resolved = useMemo(
    () => (lookup && draft ? resolveOdbiorcy(lookup, draft.adresaci, draft.wykluczeni) : null),
    [lookup, draft]
  );

  const missing = useMemo(() => {
    if (!draft || !dane) return [];
    return missingFieldValues(
      {
        adresNazwa: dane.adresNazwa,
        dateText: formatPolishDate(new Date()),
        pola,
        values: draft.values,
        tableFields: draft.tableFields,
        kalendarz,
        zebranie: zebranieCtx,
      },
      draft.temat,
      draft.tresc
    );
  }, [draft, dane, pola, kalendarz, zebranieCtx]);

  /** The table's rows: the template's shortlist, resolved against the dictionary. */
  const tablePool = useMemo(() => {
    const names = szablony.find((x) => x.id === draft?.szablonId)?.tableFields ?? [];
    return names
      .map((name) => pola.find((p) => normalizeFieldName(p.nazwa) === normalizeFieldName(name)))
      .filter((p): p is MailingPole => !!p);
  }, [szablony, draft?.szablonId, pola]);

  const dirty = !!draft && !!saved && materialContent(draft) !== materialContent(saved);

  /* --------------------------------- Loading -------------------------------- */

  useEffect(() => {
    void init();
    // Opened once per mount; the caller remounts it for another meeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const init = async () => {
    try {
      const resolveZebranie = async (): Promise<Zebranie> => {
        if (spotkanieId != null) return window.electronAPI.zebranieFromSpotkanie(spotkanieId);
        if (!zebranieProp) throw new Error(t.zawVersionGone);
        const fresh = (await window.electronAPI.getZebrania()).find(
          (z) => z.id === zebranieProp.id
        );
        if (!fresh) throw new Error(t.zawVersionGone);
        return fresh;
      };
      const [z, spotkaniaD, lokD, adresyD, jednD, pelD, polaD, szablonyD, typyD, smtpD] =
        await Promise.all([
          resolveZebranie(),
          window.electronAPI.getSpotkania(),
          window.electronAPI.getSpotkaniaLokalizacje(),
          window.electronAPI.getAdresy(),
          window.electronAPI.mailingGetZgn().catch(() => [] as ZgnJednostka[]),
          window.electronAPI.getZgnPelnomocnicy().catch(() => [] as ZgnPelnomocnik[]),
          window.electronAPI.mailingGetPola(),
          window.electronAPI.mailingGetSzablony(),
          window.electronAPI.mailingGetTypy().catch(() => [] as MailingTypDef[]),
          window.electronAPI.mailingGetSmtp().catch(() => null),
        ]);
      // Coming from a meeting the entry may have just been created, and the
      // meeting's materials status moved with it.
      if (spotkanieId != null) onChanged?.();
      setZebranie(z);
      setSpotkania(spotkaniaD);
      setLokalizacje(lokD);
      setAdresy(adresyD);
      setJednostki(jednD);
      setPelnomocnicy(pelD);
      setPola(polaD);
      setSzablony(szablonyD);
      setTypy(typyD);
      setSmtp({
        ready: Boolean(smtpD?.host && smtpD.user && smtpD.passwordSet),
        user: smtpD?.user ?? '',
      });

      const target = z.wersje.find((w) => w.id === wersjaId) ?? latestWersja(z);
      if (!target) throw new Error(t.zawVersionGone);
      setTargetWersjaId(target.id);

      const existing = zawiadomienieOf(target);
      if (existing) {
        setSaved(existing);
        setDraft(existing);
        setPhase('edit');
        return;
      }
      const templates = szablonyD.filter((s) => s.typ === MAILING_TYP_ZAWIADOMIENIE);
      // One template is no choice at all — asking would only be a click to get past.
      if (templates.length === 1) {
        await startFrom(templates[0], z, target, typyD);
        return;
      }
      setPhase('pick');
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  /* --------------------------------- Writing -------------------------------- */

  /**
   * Store the notice in its version. Re-reads the version first and keeps what
   * this screen does not own — the revision note, any other material, and the
   * download record (someone may have downloaded in the meantime) — so a save
   * here can only ever change the notice's own text and recipients.
   */
  const writeMaterial = async (
    material: ZebranieMaterial,
    base: Zebranie,
    target: ZebranieWersja
  ): Promise<ZebranieMaterial> => {
    const fresh = (await window.electronAPI.getZebrania()).find((z) => z.id === base.id);
    const freshWersja = fresh?.wersje.find((w) => w.id === target.id);
    if (!fresh || !freshWersja) throw new Error(t.zawVersionGone);
    const stored = freshWersja.materialy.find((m) => m.id === material.id);
    const next: ZebranieMaterial = {
      ...material,
      pobrania: stored?.pobrania ?? material.pobrania,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail,
    };
    // One notice per version: a notice started again from a template replaces the old one.
    const others = freshWersja.materialy.filter(
      (m) => m.id !== material.id && m.rodzaj !== material.rodzaj
    );
    const materialy = [...others, next];
    await window.electronAPI.updateZebranieWersja(target.id, { opis: freshWersja.opis, materialy });
    setZebranie({
      ...fresh,
      wersje: fresh.wersje.map((w) => (w.id === target.id ? { ...w, materialy } : w)),
    });
    onChanged?.();
    return next;
  };

  /** A new notice from a template, stored at once — it exists from the first moment. */
  const startFrom = async (
    szablon: MailingSzablon,
    base: Zebranie | null = zebranie,
    target: ZebranieWersja | null = wersja,
    kinds: MailingTypDef[] = typy
  ) => {
    if (!base || !target) return;
    const kindAdresaci = kinds.find((k) => k.klucz === MAILING_TYP_ZAWIADOMIENIE)?.adresaci;
    const material = newZawiadomienieMaterial(szablon, kindAdresaci, userEmail);
    setBusy('start');
    try {
      const stored = await writeMaterial(material, base, target);
      setSaved(stored);
      setDraft(stored);
      setLastFiles(null);
      setRestarting(false);
      setPhase('edit');
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zawSaveError);
      if (!saved) {
        setLoadError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    } finally {
      setBusy(null);
    }
  };

  /** Save when there is something to save; returns the stored notice. */
  const saveIfDirty = async (): Promise<ZebranieMaterial | null> => {
    if (!draft || !zebranie || !wersja) return null;
    if (!dirty) return draft;
    const stored = await writeMaterial(draft, zebranie, wersja);
    setSaved(stored);
    setDraft(stored);
    return stored;
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      await saveIfDirty();
      notify.success(t.zawSaved);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zawSaveError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Pobierz PDF / e-mail". Saved first, so what was downloaded is what is
   * stored; refused while a field is blank (the blank would go out as-is); a
   * mail with nobody in "To" is only a warning — the address can be typed in the
   * mail program.
   */
  const handleDownload = async (format: 'pdf' | 'eml') => {
    if (!draft || !zebranie || !wersja || !dane) return;
    if (missing.length > 0) {
      notify.error(t.zawMissingBlock.replace('{fields}', missing.join(', ')), t.zawMissingTitle);
      return;
    }
    if (format === 'eml' && resolved && resolved.odbiorcy.length === 0) {
      const go = await notify.confirm(t.zawNoRecipientsConfirm, {
        confirmLabel: t.zawDownloadAnyway,
      });
      if (!go) return;
    }
    setBusy(format);
    try {
      const material = (await saveIfDirty()) ?? draft;
      const source = szablony.find((s) => s.id === material.szablonId);
      const result = await window.electronAPI.mailingExport({
        typ: material.typ,
        templateName: material.szablonNazwa,
        temat: material.temat,
        tresc: material.tresc,
        values: material.values,
        tableFields: material.tableFields,
        kalendarz,
        zebranie: zebranieCtx,
        adresId: dane.adresId,
        adresNazwa: dane.adresNazwa,
        spotkanieId: zebranie.spotkanieId,
        adresaci: material.adresaci,
        wykluczeni: material.wykluczeni,
        formats: [format],
        attachPdf: source?.attachPdf ?? true,
      });
      if (!result.success) {
        notify.error(result.error, t.zawDownloadError);
        return;
      }
      setLastFiles(result.files);
      const pliki = result.files.map((f) => baseName(f.filePath));
      // The record is the main process's to write; mirror it here so a later
      // save from this screen does not look like it dropped the download.
      const entry = { at: new Date().toISOString(), by: userEmail, pliki };
      setSaved((prev) => (prev ? { ...prev, pobrania: [...prev.pobrania, entry] } : prev));
      setDraft((prev) => (prev ? { ...prev, pobrania: [...prev.pobrania, entry] } : prev));
      try {
        await window.electronAPI.recordZebraniePobranie(wersja.id, material.id, pliki);
        onChanged?.();
      } catch {
        // The files are in Downloads either way; only the record of it is missing.
      }
      notify.success(t.zawDownloaded, { file: result.files[0]?.filePath });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zawDownloadError);
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Wyślij" — the notice mailed to the recipients ticked in "Do kogo", through
   * the same SMTP send as the Mailing module (so it lands in the Mailing history,
   * against the meeting). Saved first, so what went out is what is stored.
   */
  const handleSend = async () => {
    if (!draft || !zebranie || !dane || !resolved) return;
    const blocked = sendBlockedReason();
    if (blocked) {
      notify.warning(blocked);
      return;
    }
    const source = szablony.find((s) => s.id === draft.szablonId);
    if (!source) {
      notify.error(t.zawSendNoTemplate, t.mailingSendError);
      return;
    }
    const ok = await notify.confirm(
      t.zawSendConfirm
        .replace('{count}', String(resolved.odbiorcy.length))
        .replace('{from}', smtp.user),
      { confirmLabel: t.zawSend }
    );
    if (!ok) return;
    setBusy('send');
    try {
      const material = (await saveIfDirty()) ?? draft;
      const response = await window.electronAPI.mailingSend({
        typ: material.typ || MAILING_TYP_ZAWIADOMIENIE,
        templateId: source.id,
        temat: material.temat,
        tresc: material.tresc,
        adresIds: [dane.adresId as number],
        values: material.values,
        tableFields: material.tableFields,
        attachPdf: source.attachPdf ?? true,
        attachments: [],
        spotkanieId: zebranie.spotkanieId ?? null,
        kalendarz,
        zebranie: zebranieCtx,
        adresaci: material.adresaci,
        wykluczeni: material.wykluczeni,
      });
      if (response.error) {
        notify.error(response.error, t.mailingSendError);
        return;
      }
      const result = response.results?.[0];
      if (!result || result.status !== 'success') {
        notify.error(result?.errorMessage || t.mailingSendError, t.mailingSendError);
        return;
      }
      notify.success(
        t.zawSent.replace('{count}', String(result.odbiorcy?.length ?? resolved.odbiorcy.length))
      );
      onChanged?.();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.mailingSendError);
    } finally {
      setBusy(null);
    }
  };

  /** Why "Wyślij" is grey — said on hover, and as the warning when clicked anyway. */
  const sendBlockedReason = (): string | undefined => {
    if (!dane || dane.adresId == null) return t.zawSendNoCommunity;
    if (missing.length > 0) return t.zawMissingBlock.replace('{fields}', missing.join(', '));
    if (!resolved || resolved.odbiorcy.length === 0) return t.zawSendNoRecipients;
    if (!smtp.ready) return t.mailingSmtpNotConfigured;
    return undefined;
  };

  const showFile = async (filePath: string) => {
    const ok = await window.electronAPI.mailingShowInFolder(filePath);
    if (!ok) notify.warning(t.zawFileMissing);
  };

  const openFile = async (filePath: string) => {
    const ok = await window.electronAPI.openFile(filePath);
    if (!ok) notify.warning(t.zawFileMissing);
  };

  /** Drop the notice from this version — the next visit starts from a template again. */
  const handleDelete = async () => {
    if (!draft || !zebranie || !wersja) return;
    const ok = await notify.confirm(t.zawDeleteConfirm, {
      confirmLabel: t.zawDeleteConfirmLabel,
      danger: true,
    });
    if (!ok) return;
    setBusy('save');
    try {
      const fresh = (await window.electronAPI.getZebrania()).find((z) => z.id === zebranie.id);
      const freshWersja = fresh?.wersje.find((w) => w.id === wersja.id);
      if (!fresh || !freshWersja) throw new Error(t.zawVersionGone);
      const materialy = freshWersja.materialy.filter(
        (m) => m.id !== draft.id && m.rodzaj !== draft.rodzaj
      );
      await window.electronAPI.updateZebranieWersja(wersja.id, {
        opis: freshWersja.opis,
        materialy,
      });
      onChanged?.();
      notify.success(t.zawDeleted);
      onClose();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zawSaveError);
    } finally {
      setBusy(null);
    }
  };

  const handleClose = async () => {
    if (busy || closingRef.current) return;
    if (dirty) {
      closingRef.current = true;
      const discard = await notify.confirm(t.zawUnsavedConfirm, {
        confirmLabel: t.zawUnsavedDiscard,
        cancelLabel: t.zawUnsavedKeep,
        danger: true,
      });
      // Released after the Escape that answered has finished reaching every listener.
      setTimeout(() => {
        closingRef.current = false;
      }, 0);
      if (!discard) return;
    }
    onClose();
  };

  const patchDraft = (patch: Partial<ZebranieMaterial>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  /* -------------------------------- Rendering ------------------------------- */

  /** Name · when · community · version — the line that says which letter this is. */
  const contextLine = dane && (
    <div className="zaw-context">
      {dane.nazwa && <strong>{dane.nazwa}</strong>}
      {dane.startsAt && (
        <span>
          <Icon name="calendar" size={13} /> {formatStamp(dane.startsAt, locale)}
        </span>
      )}
      {dane.adresNazwa && (
        <span>
          <Icon name="building" size={13} /> {dane.adresNazwa}
        </span>
      )}
      {wersja && (
        <span className="zaw-context__version">
          {t.zawVersion.replace('{v}', wersjaLabel(wersja))}
        </span>
      )}
      {wersja && (
        <span className={`status-badge zeb-status zeb-status--${wersja.status}`}>
          {wersja.status === 'przygotowane' ? t.zebraniaStatusPrzygotowane : t.zebraniaStatusW}
        </span>
      )}
    </div>
  );

  if (phase === 'loading' || phase === 'error' || phase === 'pick') {
    return (
      <div className="modal-overlay" onClick={() => void handleClose()}>
        <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
          <ModalDismiss onClose={() => void handleClose()} ariaLabel={t.close} />
          <ModalHeader
            icon="mail"
            title={phase === 'pick' ? t.zawPickTitle : t.zawTitle}
            subtitle={contextLine}
          />
          <div className="modal-body">
            {phase === 'loading' && <Loader label={t.zawLoading} />}

            {phase === 'error' && (
              <div className="zaw-empty">
                <Icon name="alert-circle" size={28} />
                <strong>{t.zawLoadError}</strong>
                <p>{loadError}</p>
              </div>
            )}

            {phase === 'pick' && (
              <>
                {zawSzablony.length === 0 ? (
                  <div className="zaw-empty">
                    <Icon name="file-text" size={28} />
                    <strong>{t.zawNoTemplatesTitle}</strong>
                    <p>{t.zawNoTemplatesText}</p>
                    {onOpenSzablony && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => {
                          onClose();
                          onOpenSzablony();
                        }}
                      >
                        <Icon name="arrow-right" size={14} /> {t.zawGoToTemplates}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="zaw-hint">{restarting ? t.zawPickRestartHint : t.zawPickHint}</p>
                    <ul className="zaw-templates">
                      {zawSzablony.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            className="zaw-template"
                            onClick={() => void startFrom(s)}
                            disabled={busy !== null}
                          >
                            <Icon name="file-text" size={18} />
                            <span className="zaw-template__text">
                              <strong>{s.nazwa}</strong>
                              {s.temat && <span>{s.temat}</span>}
                            </span>
                            <Icon name="chevron-right" size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
          <ModalFooter
            note={
              phase === 'pick' && restarting ? (
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() => {
                    setRestarting(false);
                    setPhase('edit');
                  }}
                  disabled={busy !== null}
                >
                  <Icon name="chevron-left" size={13} /> {t.zawBackToEditor}
                </button>
              ) : undefined
            }
            onCancel={() => void handleClose()}
            cancelLabel={t.close}
          />
        </div>
      </div>
    );
  }

  if (!draft || !wersja || !dane) return null;

  const sourceTemplate = szablony.find((s) => s.id === draft.szablonId) ?? null;
  const recentDownloads = [...draft.pobrania].reverse().slice(0, 3);
  const isOlder = !!newest && newest.id !== wersja.id;
  const sendBlocked = sending ? sendBlockedReason() : undefined;

  return (
    <div className="modal-overlay zaw-overlay">
      <div className="modal zaw-modal" role="dialog" aria-label={t.zawTitle}>
        <ModalDismiss onClose={() => void handleClose()} ariaLabel={t.close} />
        <ModalHeader icon="mail" title={t.zawTitle} subtitle={contextLine} />

        <div className={`zaw-body${sending ? ' zaw-body--side' : ''}`}>
          <div className="zaw-main">
            {isOlder && newest && (
              <div className="callout callout--info" role="status">
                <Icon name="info" size={16} />
                <div className="callout__body">
                  {t.zawOlderVersion.replace('{v}', wersjaLabel(newest))}
                </div>
              </div>
            )}
            <MailingVisualEditor
              language={language}
              temat={draft.temat}
              onTematChange={(temat) => patchDraft({ temat })}
              tresc={draft.tresc}
              onTrescChange={(tresc) => patchDraft({ tresc })}
              values={draft.values}
              onValuesChange={(values) => patchDraft({ values })}
              pola={pola}
              adresNazwa={dane.adresNazwa}
              kalendarz={kalendarz}
              zebranie={zebranieCtx}
              typ={draft.typ}
              tableFields={draft.tableFields}
              tablePool={tablePool}
              onTableFieldsChange={(tableFields) => patchDraft({ tableFields })}
              onSaveAsTemplate={() => setSaveTemplateOpen(true)}
              hideHint
            />
          </div>

          {sending && (
            <aside className="zaw-side">
              <section className={`zaw-panel${missing.length > 0 ? ' is-warning' : ' is-ok'}`}>
                <h4 className="zaw-panel__title">
                  <Icon name={missing.length > 0 ? 'alert-triangle' : 'check-circle'} size={15} />
                  {t.zawStepText}
                </h4>
                {missing.length === 0 ? (
                  <p>{t.zawMissingNone}</p>
                ) : (
                  <>
                    <p>{t.zawMissingList}</p>
                    <ul className="zaw-missing">
                      {missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section className="zaw-panel">
                <h4 className="zaw-panel__title">
                  <Icon name="users" size={15} /> {t.zawRecipients}
                </h4>
                <p className="zaw-panel__hint">{t.zawRecipientsHint}</p>
                <MailingRecipientsEditor
                  language={language}
                  adresaci={draft.adresaci}
                  onAdresaciChange={(adresaci) => patchDraft({ adresaci })}
                  wykluczeni={draft.wykluczeni}
                  onWykluczeniChange={(wykluczeni) => patchDraft({ wykluczeni })}
                  lookup={lookup}
                  contextLabel={dane.adresNazwa || undefined}
                  disabled={busy !== null}
                />
              </section>

              <section className="zaw-panel">
                <h4 className="zaw-panel__title">
                  <Icon name="download" size={15} /> {t.zawDownload}
                </h4>
                <p className="zaw-panel__hint">{t.zawDownloadHint}</p>
                <div className="zaw-downloads">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => void handleDownload('pdf')}
                    disabled={busy !== null}
                  >
                    <Icon name={busy === 'pdf' ? 'loader' : 'file-text'} size={14} />{' '}
                    {busy === 'pdf' ? t.zawDownloading : t.zawDownloadPdf}
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => void handleDownload('eml')}
                    disabled={busy !== null}
                  >
                    <Icon name={busy === 'eml' ? 'loader' : 'mail'} size={14} />{' '}
                    {busy === 'eml' ? t.zawDownloading : t.zawDownloadEml}
                  </button>
                </div>

                {lastFiles && lastFiles.length > 0 && (
                  <ul className="zaw-files">
                    {lastFiles.map((f) => (
                      <li key={f.filePath} className="zaw-file">
                        <Icon name={f.format === 'pdf' ? 'file-check' : 'mail'} size={14} />
                        <span className="zaw-file__name" title={f.filePath}>
                          {baseName(f.filePath)}
                        </span>
                        <span className="zaw-file__actions">
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => void showFile(f.filePath)}
                          >
                            <Icon name="folder" size={12} /> {t.zawShowInFolder}
                          </button>
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => void openFile(f.filePath)}
                          >
                            <Icon name="eye" size={12} /> {t.zawOpenFile}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {recentDownloads.length > 0 && (
                  <div className="zaw-history">
                    <span className="zaw-history__label">{t.zawLastDownloads}</span>
                    <ul>
                      {recentDownloads.map((p, i) => (
                        <li key={`${p.at}-${i}`}>
                          <span>{p.pliki.join(', ')}</span>
                          <span className="zaw-history__when">
                            {t.zawDownloadedBy
                              .replace('{when}', formatStamp(p.at, locale))
                              .replace('{who}', p.by || '—')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </aside>
          )}
        </div>

        <ModalFooter
          note={
            <span className="zaw-foot">
              <span className={`zaw-foot__state${dirty ? ' is-dirty' : ''}`}>
                <Icon name={dirty ? 'alert-circle' : 'check'} size={13} />
                {dirty ? t.zawUnsaved : t.zawAllSaved}
              </span>
              {draft.szablonNazwa && (
                <span className="zaw-foot__source">
                  {t.zawFromTemplate.replace('{name}', draft.szablonNazwa)}
                </span>
              )}
              <button
                type="button"
                className="button button-small button-ghost icon-danger"
                onClick={() => void handleDelete()}
                disabled={busy !== null}
              >
                <Icon name="trash" size={13} /> {t.zawDelete}
              </button>
            </span>
          }
          onCancel={() => void handleClose()}
          cancelLabel={t.close}
          {...(sending
            ? {
                // Sending is what this window is for; saving stays beside it.
                secondaryAction: (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void handleSave()}
                    disabled={busy !== null || !dirty}
                    title={!dirty ? t.noChangesToSave : undefined}
                  >
                    <Icon name="save" size={14} /> {t.zawSave}
                  </button>
                ),
                onSubmit: () => void handleSend(),
                submitLabel: busy === 'send' ? t.mailingSending : t.zawSend,
                submitIcon: 'mail' as const,
                submitDisabled: busy !== null || !!sendBlocked,
                busy: busy === 'send',
                submitTitle: busy === null ? sendBlocked : undefined,
              }
            : {
                onSubmit: () => void handleSave(),
                submitLabel: t.zawSave,
                submitIcon: 'save' as const,
                submitDisabled: busy !== null || !dirty,
                submitTitle: !dirty ? t.noChangesToSave : undefined,
              })}
        />
      </div>

      <MailingSaveTemplateModal
        language={language}
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        typ={draft.typ || MAILING_TYP_ZAWIADOMIENIE}
        temat={draft.temat}
        tresc={draft.tresc}
        attachPdf={sourceTemplate?.attachPdf ?? true}
        // The template's own shortlist for its table, as the send screen passes it:
        // the notice's ticks are per letter, and overwriting with them would wipe
        // the shortlist every other letter picks from.
        tableFields={sourceTemplate?.tableFields ?? draft.tableFields}
        sourceTemplate={sourceTemplate}
        onSaved={(stored) => {
          setSaveTemplateOpen(false);
          setSzablony((prev) => [...prev.filter((s) => s.id !== stored.id), stored]);
          // The letter now comes from the template it was saved as.
          patchDraft({ szablonId: stored.id, szablonNazwa: stored.nazwa });
          notify.success(t.zawTemplateSaved);
        }}
      />
    </div>
  );
};

export default ZawiadomienieModal;
