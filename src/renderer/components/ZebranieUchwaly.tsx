import React, { useEffect, useMemo, useState } from 'react';
import {
  MailingPole,
  MailingSzablon,
  MailingTypDef,
  Zebranie,
  ZebranieMaterial,
  ZebranieWersja,
} from '../../shared/types';
import {
  ZebranieDane,
  copyMaterialyForRevision,
  moveUchwala,
  moveUchwalaNextTo,
  newUchwalaMaterial,
  uchwalaMissing,
  uchwalaTytul,
  uchwalyOf,
  withUchwaly,
} from '../../shared/zebrania';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import { FormSection } from './FormSection';
import Icon from './Icon';
import Loader from './Loader';
import OverflowMenu from './OverflowMenu';
import UchwalyPickerModal from './UchwalyPickerModal';
import UchwalaEditorModal from './UchwalaEditorModal';
import UchwalaPreviewModal from './UchwalaPreviewModal';
import { downloadUchwalaPdf, fileBaseName } from './uchwalaPdf';

/**
 * "Uchwały" of one version: resolutions made from Mailing templates.
 *
 * The user ticks several templates at once and each becomes a document of this
 * version — text copied from the template (later edits to the template never
 * reach it), the meeting's date, time and place filled in from the calendar and
 * kept in step with it: those are read when the document is shown or printed,
 * not stored in it. From the list a resolution can be previewed, edited,
 * downloaded as a PDF, duplicated, reordered or deleted; the order here is the
 * order of the package.
 *
 * Resolutions are materials of the version (`materialy`, `rodzaj: 'uchwala'`),
 * so a new revision starts with a copy of them and a backup carries them. Every
 * write re-reads the version first and changes only the resolution list
 * (`withUchwaly`), so it can never overwrite the notice saved meanwhile.
 */
const ZebranieUchwaly: React.FC<{
  language: Language;
  locale: string;
  userEmail: string;
  zebranie: Zebranie;
  wersja: ZebranieWersja;
  dane: ZebranieDane;
  /** Reload the entry after a write. */
  onChanged: () => Promise<void>;
  /** The version's status box, shown below the resolutions, also while there are none. */
  statusBox?: React.ReactNode;
  /** "Mailing → Szablony", for when no template exists yet. */
  onOpenSzablony?: () => void;
}> = ({ language, locale, userEmail, zebranie, wersja, dane, onChanged, onOpenSzablony, statusBox }) => {
  const t = translations[language];
  const notify = useNotify();

  const [pola, setPola] = useState<MailingPole[]>([]);
  const [szablony, setSzablony] = useState<MailingSzablon[]>([]);
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** What is being written or rendered: 'add', 'all', or a resolution's id. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Drag and drop: the card being dragged, and the card + side it would land on. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.mailingGetPola(),
      window.electronAPI.mailingGetSzablony(),
      window.electronAPI.mailingGetTypy().catch(() => [] as MailingTypDef[]),
    ])
      .then(([p, s, k]) => {
        if (cancelled) return;
        setPola(p);
        setSzablony(s);
        setTypy(k);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const uchwaly = useMemo(() => uchwalyOf(wersja), [wersja]);
  const rows = useMemo(
    () =>
      uchwaly.map((u, i) => ({
        u,
        lp: i + 1,
        tytul: uchwalaTytul(u, dane, pola),
        missing: uchwalaMissing(u, dane, pola),
      })),
    [uchwaly, dane, pola]
  );
  const todo = rows.filter((r) => r.missing.length > 0).length;
  const uzyte = useMemo(() => {
    const counts = new Map<number, number>();
    for (const u of uchwaly)
      if (u.szablonId != null) counts.set(u.szablonId, (counts.get(u.szablonId) ?? 0) + 1);
    return counts;
  }, [uchwaly]);

  const editing = editingId ? (rows.find((r) => r.u.id === editingId) ?? null) : null;
  const previewing = previewId ? (rows.find((r) => r.u.id === previewId) ?? null) : null;

  /**
   * Change the resolution list. The version is re-read first and only the
   * resolutions are written back, so the notice, the revision's note and any
   * download recorded meanwhile are kept as they are stored.
   */
  const writeList = async (
    change: (current: ZebranieMaterial[]) => ZebranieMaterial[]
  ): Promise<void> => {
    const fresh = (await window.electronAPI.getZebrania()).find((z) => z.id === zebranie.id);
    const freshWersja = fresh?.wersje.find((w) => w.id === wersja.id);
    if (!freshWersja) throw new Error(t.zawVersionGone);
    const next = change(uchwalyOf(freshWersja));
    await window.electronAPI.updateZebranieWersja(wersja.id, {
      opis: freshWersja.opis,
      materialy: withUchwaly(freshWersja.materialy, next),
    });
    await onChanged();
  };

  /** Run a write for `key`, report a failure as a message and never throw. */
  const run = async (key: string, action: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await action();
      if (done) notify.success(done);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.uchWriteError);
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = (szablonIds: number[]) =>
    run('add', async () => {
      const created = szablonIds
        .map((id) => szablony.find((s) => s.id === id))
        .filter((s): s is MailingSzablon => !!s)
        .map((s) => newUchwalaMaterial(s, userEmail));
      await writeList((current) => [...current, ...created]);
      setPickerOpen(false);
      notify.success(t.uchAdded.replace('{n}', String(created.length)));
    });

  /** Save from the editor; resolves with what is stored, the download record kept from the store. */
  const handleSaveOne = async (draft: ZebranieMaterial): Promise<ZebranieMaterial> => {
    let stored: ZebranieMaterial | null = null;
    await writeList((current) => {
      const stale = current.find((u) => u.id === draft.id);
      if (!stale) throw new Error(t.uchGone);
      stored = {
        ...draft,
        pobrania: stale.pobrania,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail,
      };
      return current.map((u) => (u.id === draft.id ? (stored as ZebranieMaterial) : u));
    });
    return stored as unknown as ZebranieMaterial;
  };

  const handleMove = (id: string, delta: -1 | 1) =>
    run(id, () => writeList((current) => moveUchwala(current, id, delta)));

  const handleDrop = (targetId: string, before: boolean) => {
    const id = dragId;
    setDragId(null);
    setDrop(null);
    if (id && id !== targetId)
      void run(id, () => writeList((current) => moveUchwalaNextTo(current, id, targetId, before)));
  };

  const handleDuplicate = (id: string) =>
    run(
      id,
      () =>
        writeList((current) => {
          const at = current.findIndex((u) => u.id === id);
          if (at < 0) throw new Error(t.uchGone);
          const [copy] = copyMaterialyForRevision([current[at]]);
          return [
            ...current.slice(0, at + 1),
            { ...copy, updatedAt: new Date().toISOString(), updatedBy: userEmail },
            ...current.slice(at + 1),
          ];
        }),
      t.uchDuplicated
    );

  const handleDelete = async (id: string, tytul: string) => {
    const ok = await notify.confirm(t.uchDeleteConfirm.replace('{name}', tytul), {
      danger: true,
      confirmLabel: t.delete,
    });
    if (!ok) return;
    await run(id, () => writeList((current) => current.filter((u) => u.id !== id)), t.uchDeleted);
  };

  const handlePdf = async (row: (typeof rows)[number]) => {
    if (row.missing.length > 0) {
      notify.error(
        t.uchMissingBlock.replace('{fields}', row.missing.join(', ')),
        t.uchMissingTitle
      );
      return;
    }
    setBusy(`pdf-${row.u.id}`);
    try {
      const result = await downloadUchwalaPdf(zebranie, wersja, dane, row.u, userEmail);
      if (!result.ok) {
        notify.error(result.error, t.zfinDownloadError);
        return;
      }
      notify.success(
        t.zfinDownloaded.replace('{file}', fileBaseName(result.files[0]?.filePath ?? '')),
        {
          file: result.files[0]?.filePath,
        }
      );
      await onChanged();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinDownloadError);
    } finally {
      setBusy(null);
    }
  };

  /** Every resolution in one file, behind the meeting's cover — the package, with this part only. */
  const handleDownloadAll = async () => {
    if (rows.length === 0) {
      notify.warning(t.uchDownloadAllNothing);
      return;
    }
    const incomplete = rows.filter((r) => r.missing.length > 0);
    if (incomplete.length > 0) {
      notify.error(
        incomplete.map((r) => `${r.tytul} (${r.missing.join(', ')})`).join('; '),
        t.uchMissingTitle
      );
      return;
    }
    setBusy('all');
    try {
      const { filePath } = await window.electronAPI.exportZebraniePakiet({
        wersjaId: wersja.id,
        zawiadomienie: false,
        sprawozdanie: false,
        wstep: false,
        plan: false,
        uchwaly: true,
      });
      notify.success(t.zfinDownloaded.replace('{file}', fileBaseName(filePath)), {
        file: filePath,
      });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinDownloadError);
    } finally {
      setBusy(null);
    }
  };

  const noDate = !dane.startsAt;

  if (loading) return <Loader label={t.loading} />;

  return (
    <div className="page-form zeb-page">
      <FormSection
        icon="file-text"
        title={t.uchTitle}
        description={t.uchDesc}
        aside={
          rows.length === 0 ? undefined : (
            <div className="form-section__actions">
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => void handleDownloadAll()}
                disabled={busy !== null}
                title={t.uchDownloadAllHint}
              >
                <Icon name={busy === 'all' ? 'loader' : 'download'} size={13} /> {t.uchDownloadAll}
              </button>
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => setPickerOpen(true)}
                disabled={busy !== null || loadFailed}
                title={t.uchAddHint}
              >
                <Icon name="plus" size={13} /> {t.uchAdd}
              </button>
            </div>
          )
        }
      >
        {loadFailed && (
          <div className="callout callout--warning">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{t.uchLoadError}</div>
          </div>
        )}
        {noDate && (
          <div className="callout callout--warning">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{t.uchNoDateWarning}</div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="uch-empty">
            <span className="zeb-tab-empty__icon">
              <Icon name="file-text" size={22} />
            </span>
            <strong>{t.uchEmptyTitle}</strong>
            <p>{t.uchEmptyText}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setPickerOpen(true)}
              disabled={busy !== null || loadFailed}
            >
              <Icon name="plus" size={14} /> {t.uchAdd}
            </button>
          </div>
        ) : (
          <>
            <p className="uch-summary">
              {t.uchSummary
                .replace('{n}', String(rows.length))
                .replace('{ready}', String(rows.length - todo))
                .replace('{todo}', String(todo))}
            </p>
            <ol className="uch-list">
              {rows.map((r, i) => {
                const rowBusy = busy === r.u.id || busy === `pdf-${r.u.id}`;
                return (
                  <li
                    key={r.u.id}
                    className={`uch-card ${r.missing.length > 0 ? 'uch-card--todo' : 'uch-card--ready'}${
                      dragId === r.u.id ? ' is-dragging' : ''
                    }${drop?.id === r.u.id && dragId !== r.u.id ? (drop.before ? ' is-drop-before' : ' is-drop-after') : ''}`}
                    draggable={busy === null && rows.length > 1}
                    onDragStart={(e) => {
                      setDragId(r.u.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', r.u.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      const box = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < box.top + box.height / 2;
                      if (drop?.id !== r.u.id || drop.before !== before)
                        setDrop({ id: r.u.id, before });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const box = e.currentTarget.getBoundingClientRect();
                      handleDrop(r.u.id, e.clientY < box.top + box.height / 2);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDrop(null);
                    }}
                  >
                    <span className="uch-card__grip" aria-hidden="true" title={t.uchDragHint}>
                      <Icon name="grip" size={16} />
                    </span>
                    <span className="uch-card__lp" aria-hidden="true">
                      {r.lp}
                    </span>
                    <button
                      type="button"
                      className="uch-card__main"
                      onClick={() => setEditingId(r.u.id)}
                      title={t.uchEdit}
                    >
                      <strong className="uch-card__title">{r.tytul}</strong>
                      {r.missing.length > 0 && (
                        <span className="uch-card__missing">
                          <Icon name="alert-triangle" size={13} />{' '}
                          {t.uchMissingFields.replace('{fields}', r.missing.join(', '))}
                        </span>
                      )}
                    </button>
                    <div className="uch-card__actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => setPreviewId(r.u.id)}
                        disabled={rowBusy}
                      >
                        <Icon name="eye" size={13} /> {t.uchPreview}
                      </button>
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => setEditingId(r.u.id)}
                        disabled={rowBusy}
                      >
                        <Icon name="edit" size={13} /> {t.uchEdit}
                      </button>
                      <button
                        type="button"
                        className="button button-small button-primary"
                        onClick={() => void handlePdf(r)}
                        disabled={rowBusy || busy !== null}
                        title={
                          r.missing.length > 0
                            ? t.uchMissingFields.replace('{fields}', r.missing.join(', '))
                            : undefined
                        }
                      >
                        <Icon name={busy === `pdf-${r.u.id}` ? 'loader' : 'download'} size={13} />{' '}
                        PDF
                      </button>
                      <OverflowMenu
                        label={t.uchMore}
                        disabled={busy !== null}
                        items={[
                          {
                            icon: 'arrow-up',
                            label: t.uchMoveUp,
                            onClick: () => void handleMove(r.u.id, -1),
                            disabled: i === 0,
                          },
                          {
                            icon: 'arrow-down',
                            label: t.uchMoveDown,
                            onClick: () => void handleMove(r.u.id, 1),
                            disabled: i === rows.length - 1,
                          },
                          {
                            icon: 'copy',
                            label: t.uchDuplicate,
                            onClick: () => void handleDuplicate(r.u.id),
                          },
                          {
                            icon: 'trash',
                            label: t.uchDelete,
                            onClick: () => void handleDelete(r.u.id, r.tytul),
                            danger: true,
                          },
                        ]}
                      />
                      <span
                        className={`status-badge uch-card__status ${r.missing.length > 0 ? 'status-pending' : 'status-success'}`}
                      >
                        {r.missing.length > 0 ? t.uchStatusMissing : t.uchStatusReady}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </FormSection>

      {statusBox}

      {pickerOpen && (
        <UchwalyPickerModal
          language={language}
          szablony={szablony}
          typy={typy}
          uzyte={uzyte}
          busy={busy === 'add'}
          onSubmit={(ids) => void handleAdd(ids)}
          onClose={() => setPickerOpen(false)}
          onOpenSzablony={onOpenSzablony}
        />
      )}

      {previewing && (
        <UchwalaPreviewModal
          language={language}
          locale={locale}
          uchwala={previewing.u}
          lp={previewing.lp}
          dane={dane}
          pola={pola}
          onEdit={() => {
            setPreviewId(null);
            setEditingId(previewing.u.id);
          }}
          onClose={() => setPreviewId(null)}
        />
      )}

      {editing && (
        <UchwalaEditorModal
          key={editing.u.id}
          language={language}
          locale={locale}
          zebranie={zebranie}
          wersja={wersja}
          dane={dane}
          uchwala={editing.u}
          lp={editing.lp}
          pola={pola}
          szablony={szablony}
          userEmail={userEmail}
          onSave={handleSaveOne}
          onDownloaded={() => void onChanged()}
          onTemplateSaved={(stored) =>
            setSzablony((prev) => [...prev.filter((s) => s.id !== stored.id), stored])
          }
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
};

export default ZebranieUchwaly;
