import React, { useMemo, useState } from 'react';
import {
  MAILING_TYP_UCHWALA,
  MailingPole,
  MailingSzablon,
  MailingTypDef,
  MailingZebranieContext,
} from '../../shared/types';
import {
  buildKalendarzContext,
  formatPolishDate,
  MailingRenderContext,
  renderPlain,
} from '../../shared/mailing-template';
import { ZebranieDane } from '../../shared/zebrania';
import { translations, Language } from '../translations';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';

/** A subject as a person reads it: `{{Adres Wspólnoty}}` becomes `[Adres Wspólnoty]`. */
/**
 * A template's subject as this meeting will read it: fields the meeting fills
 * (community, date, place …) filled in, the rest left as `[Field]`.
 */
const readable = (text: string, ctx: MailingRenderContext | null) =>
  text.replace(/\{\{\s*([^{}|]+?)\s*(?:\|[^{}]*)?\}\}/g, (all, nazwa: string) => {
    const value = ctx ? renderPlain(all, ctx).trim() : '';
    return value || `[${nazwa}]`;
  });

/**
 * "Dodaj uchwały" — pick several Mailing templates at once; each becomes a
 * resolution of the version. The order they are ticked in is the order they are
 * kept in, shown as a number on the row, so the order the documents will have
 * is never a surprise.
 *
 * Templates of the built-in "Uchwała" kind are shown first (that is where they
 * belong), but any template can be picked — a statute extract or an annex written
 * as a mailing template is a resolution's material just as well.
 */
const UchwalyPickerModal: React.FC<{
  language: Language;
  szablony: MailingSzablon[];
  typy: MailingTypDef[];
  /** How many resolutions of the version already came from each template. */
  uzyte: Map<number, number>;
  busy: boolean;
  onSubmit: (szablonIds: number[]) => void;
  onClose: () => void;
  /** "Mailing → Szablony", for when no template exists yet. */
  onOpenSzablony?: () => void;
  /** The meeting — fills the subjects' fields in the list. */
  dane?: ZebranieDane;
  pola?: MailingPole[];
  /** The version's statement, plan and resolutions — fills the Zebrania fields of the subjects. */
  zebranieCtx?: MailingZebranieContext | null;
}> = ({ language, szablony: wszystkie, uzyte, busy, onSubmit, onClose, onOpenSzablony, dane, pola, zebranieCtx }) => {
  const t = translations[language];
  const ctx = useMemo<MailingRenderContext | null>(
    () =>
      dane
        ? {
            adresNazwa: dane.adresNazwa,
            dateText: formatPolishDate(new Date()),
            pola: pola ?? [],
            values: {},
            tableFields: [],
            kalendarz: buildKalendarzContext(dane),
            zebranie: zebranieCtx ?? null,
          }
        : null,
    [dane, pola, zebranieCtx],
  );

  /** Only resolution templates, by name — that is the order they are first ticked in. */
  const szablony = useMemo(
    () =>
      wszystkie
        .filter((s) => s.typ === MAILING_TYP_UCHWALA)
        .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl')),
    [wszystkie],
  );
  const [search, setSearch] = useState('');
  /** In the order ticked; every resolution template to start with. */
  const [picked, setPicked] = useState<number[]>(() => szablony.map((s) => s.id));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return szablony.filter((s) => !q || `${s.nazwa} ${s.temat}`.toLowerCase().includes(q));
  }, [szablony, search]);

  const toggle = (id: number) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal modal--lg uch-picker" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="file-text" title={t.uchPickTitle} subtitle={t.uchPickHint} />
        <div className="modal-body uch-picker__body">
          {szablony.length === 0 ? (
            <div className="zaw-empty">
              <Icon name="file-text" size={28} />
              <strong>{t.uchPickNoTemplatesTitle}</strong>
              <p>{t.uchPickNoTemplatesText}</p>
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
              <div className="uch-picker__tools">
                <div className="ksieg-search">
                  <Icon name="search" size={15} />
                  <input
                    type="text"
                    placeholder={t.uchPickSearch}
                    value={search}
                    autoFocus
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search.trim() && (
                    <button type="button" onClick={() => setSearch('')} title={t.close} aria-label={t.close}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="zeb-nomatch">
                  <Icon name="search" size={18} /> {t.uchPickNoMatch}
                </div>
              ) : (
                <ul className="uch-picker__list">
                  {visible.map((s) => {
                    const order = picked.indexOf(s.id);
                    const used = uzyte.get(s.id) ?? 0;
                    return (
                      <li key={s.id}>
                        <label className={`uch-pick${order >= 0 ? ' is-picked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={order >= 0}
                            disabled={busy}
                            onChange={() => toggle(s.id)}
                          />
                          <span className="uch-pick__mark" aria-hidden="true">
                            {order >= 0 ? order + 1 : ''}
                          </span>
                          <span className="uch-pick__text">
                            <strong>{s.nazwa}</strong>
                            <span>
                              {s.temat ? readable(s.temat, ctx) : ''}
                            </span>
                          </span>
                          <span className="uch-pick__used">
                            {used > 0 && (
                              <span className="status-badge status-neutral">
                                {t.uchPickUsed.replace('{n}', String(used))}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <ModalFooter
          note={<span className="uch-picker__count">{t.uchPickSelected.replace('{n}', String(picked.length))}</span>}
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => onSubmit(picked)}
          submitLabel={t.uchPickSubmit.replace('{n}', String(picked.length))}
          submitIcon="plus"
          submitDisabled={picked.length === 0}
          submitTitle={t.uchPickEmptySelection}
          busy={busy}
        />
      </div>
    </div>
  );
};

export default UchwalyPickerModal;
