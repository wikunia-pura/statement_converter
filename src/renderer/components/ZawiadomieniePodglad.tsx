import React, { useEffect, useMemo, useState } from 'react';
import { MailingPole, ZebranieMaterial, ZebranieWersja } from '../../shared/types';
import { ZebranieDane, buildZebranieContext } from '../../shared/zebrania';
import {
  buildKalendarzContext,
  formatPolishDate,
  missingFieldValues,
  renderPlain,
} from '../../shared/mailing-template';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { FormSection } from './FormSection';
import Icon from './Icon';
import MailingVisualEditor from './MailingVisualEditor';

/**
 * The meeting notice of one version: the letter as it will go out, read-only —
 * the subject and the text with the meeting's date, time and place from the
 * calendar and the values typed in the editor. The same rendering as the editor
 * and the PDF, so what is read here is what is downloaded. The box's header
 * carries the way into the editor (or into preparing the notice) and the
 * version's status.
 */
const ZawiadomieniePodglad: React.FC<{
  language: Language;
  locale: string;
  notice: ZebranieMaterial | undefined;
  /** The version the notice belongs to — its statement, plan and resolutions fill the Zebrania fields. */
  wersja: ZebranieWersja;
  dane: ZebranieDane;
  busy: boolean;
  onOpenNotice: () => void;
}> = ({ language, locale, notice, wersja, dane, busy, onOpenNotice }) => {
  const t = translations[language];
  const [pola, setPola] = useState<MailingPole[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .mailingGetPola()
      .then((p) => {
        if (!cancelled) setPola(p);
      })
      .catch(() => {
        if (!cancelled) setPola([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kalendarz = useMemo(() => buildKalendarzContext(dane), [dane]);
  const zebranieCtx = useMemo(() => buildZebranieContext(wersja, dane, pola ?? []), [wersja, dane, pola]);
  const ctx = useMemo(
    () => ({
      adresNazwa: dane.adresNazwa,
      dateText: formatPolishDate(new Date()),
      pola: pola ?? [],
      values: notice?.values ?? {},
      tableFields: notice?.tableFields ?? [],
      kalendarz,
      zebranie: zebranieCtx,
    }),
    [dane.adresNazwa, pola, notice?.values, notice?.tableFields, kalendarz, zebranieCtx]
  );
  const missing = useMemo(
    () => (pola && notice ? missingFieldValues(ctx, notice.temat, notice.tresc) : []),
    [ctx, pola, notice]
  );
  const noop = () => undefined;

  return (
    <FormSection
      icon="mail"
      title={t.zawPreviewTitle}
      description={
        notice?.updatedAt
          ? t.uchChanged
              .replace('{when}', formatStamp(notice.updatedAt, locale))
              .replace('{who}', notice.updatedBy || '—')
          : undefined
      }
      aside={
        <div className="form-section__actions">
          {notice && (
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={onOpenNotice}
              disabled={busy}
            >
              <Icon name="edit" size={13} /> {t.zebraniaNoticeOpen}
            </button>
          )}
        </div>
      }
    >
      {!notice ? (
        <div className="uch-empty">
          <span className="zeb-tab-empty__icon">
            <Icon name="mail" size={22} />
          </span>
          <strong>{t.zebraniaNoticeEmptyTitle}</strong>
          <p>{t.zebraniaNoticeNone}</p>
          <button
            type="button"
            className="button button-primary"
            onClick={onOpenNotice}
            disabled={busy}
          >
            <Icon name="plus" size={14} /> {t.zebraniaNoticePrepare}
          </button>
        </div>
      ) : (
        pola && (
          <>
            {missing.length > 0 && (
              <div className="callout callout--warning">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.uchMissingFields.replace('{fields}', missing.join(', '))}
                </div>
              </div>
            )}
            <dl className="facts">
              <dt>{t.zawPreviewSubject}</dt>
              <dd>{renderPlain(notice.temat, ctx) || '—'}</dd>
            </dl>
            <MailingVisualEditor
              language={language}
              temat={notice.temat}
              tresc={notice.tresc}
              onTrescChange={noop}
              values={notice.values}
              onValuesChange={noop}
              pola={pola}
              adresNazwa={dane.adresNazwa}
              kalendarz={kalendarz}
              zebranie={zebranieCtx}
              typ={notice.typ}
              tableFields={notice.tableFields}
              readOnly
              hideHint
            />
          </>
        )
      )}
    </FormSection>
  );
};

export default ZawiadomieniePodglad;
