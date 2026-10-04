import React, { useState } from 'react';
import {
  KALENDARZ_PDF_MAX_MIESIECY,
  kalendarzOkresProblem,
  lastDayOfMonth,
} from '../../shared/calendar';
import { translations, Language } from '../translations';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormRow, FormSection } from './FormSection';

type Zakres = 'miesiac' | 'okres';

/**
 * "PDF" in Kalendarz: which stretch of the calendar goes into the file — one
 * month (the one on screen to start with) or any period from one day to
 * another. The filters on screen apply either way; the note says so when one
 * is on, so a thin PDF is not a surprise.
 */
const KalendarzPdfModal: React.FC<{
  language: Language;
  /** The month on screen (`YYYY-MM`) — where both choices start. */
  monthKey: string;
  filtersActive: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (okresOd: string, okresDo: string) => void;
}> = ({ language, monthKey, filtersActive, busy, onClose, onSubmit }) => {
  const t = translations[language];
  const [zakres, setZakres] = useState<Zakres>('miesiac');
  const [miesiac, setMiesiac] = useState(monthKey);
  const [od, setOd] = useState(`${monthKey}-01`);
  const [doDnia, setDoDnia] = useState(lastDayOfMonth(monthKey));

  const okres: [string, string] =
    zakres === 'miesiac' ? [`${miesiac}-01`, /^\d{4}-\d{2}$/.test(miesiac) ? lastDayOfMonth(miesiac) : ''] : [od, doDnia];
  const problem = kalendarzOkresProblem(okres[0], okres[1]);
  const error =
    problem === 'kolejnosc'
      ? t.kalPdfErrOrder
      : problem === 'za-dlugi'
        ? t.kalPdfErrLong.replace('{n}', String(KALENDARZ_PDF_MAX_MIESIECY))
        : null;

  const submit = () => {
    if (!problem && !busy) onSubmit(okres[0], okres[1]);
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={busy ? () => undefined : onClose} ariaLabel={t.close} />
        <ModalHeader icon="download" title={t.kalPdfTitle} subtitle={t.kalPdfSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="calendar" title={t.kalPdfRange} description={t.kalPdfRangeDesc}>
            <FormField label={t.kalPdfRange}>
              <div className="zad-seg" role="radiogroup" aria-label={t.kalPdfRange}>
                {(['miesiac', 'okres'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={zakres === option}
                    className={`zad-seg__btn${zakres === option ? ' is-active' : ''}`}
                    onClick={() => setZakres(option)}
                  >
                    {option === 'miesiac' ? t.kalPdfMonth : t.kalPdfPeriod}
                  </button>
                ))}
              </div>
            </FormField>

            {zakres === 'miesiac' ? (
              <FormField label={t.kalPdfMonth} htmlFor="kal-pdf-month">
                <input
                  id="kal-pdf-month"
                  type="month"
                  value={miesiac}
                  onChange={(e) => setMiesiac(e.target.value)}
                />
              </FormField>
            ) : (
              <FormRow>
                <FormField label={t.kalPdfFrom} htmlFor="kal-pdf-from" error={error ?? undefined}>
                  <input id="kal-pdf-from" type="date" value={od} onChange={(e) => setOd(e.target.value)} />
                </FormField>
                <FormField label={t.kalPdfTo} htmlFor="kal-pdf-to">
                  <input
                    id="kal-pdf-to"
                    type="date"
                    value={doDnia}
                    min={od || undefined}
                    onChange={(e) => setDoDnia(e.target.value)}
                  />
                </FormField>
              </FormRow>
            )}
          </FormSection>
        </div>
        <ModalFooter
          note={filtersActive ? t.kalPdfFiltersNote : undefined}
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={submit}
          submitLabel={t.kalPdfGenerate}
          submitIcon="download"
          submitDisabled={problem !== null}
          busy={busy}
          autoFocus="submit"
        />
      </div>
    </div>
  );
};

export default KalendarzPdfModal;
