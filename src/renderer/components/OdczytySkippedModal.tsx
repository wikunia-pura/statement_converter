import React from 'react';
import { translations, Language } from '../translations';
import { FormSection } from './FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { OdczytySkippedRow } from '../../shared/types';

/** Skipped rows of one source file. */
export interface OdczytySkippedGroup {
  fileName: string;
  rows: OdczytySkippedRow[];
}

interface Props {
  language: Language;
  groups: OdczytySkippedGroup[];
  onClose: () => void;
}

/**
 * Lists every source row that produced no reading, with the sheet name and the
 * Excel row number so it can be opened and checked in the source workbook.
 * Shared by the conversion view and the operation history.
 */
const OdczytySkippedModal: React.FC<Props> = ({ language, groups, onClose }) => {
  const t = translations[language];

  const reasonText = (s: OdczytySkippedRow): string => {
    switch (s.reason) {
      case 'no-value':
        return `${t.odczytyReasonNoValue} „${s.column}"`;
      case 'no-device':
        return t.odczytyReasonNoDevice;
      case 'no-wm':
        return `${t.odczytyReasonNoWm} „${s.column}"`;
      case 'no-date':
        return `${t.odczytyReasonNoDate} „${s.column}"`;
    }
  };

  const total = groups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="alert-triangle" title={`${t.odczytySkippedTitle} (${total})`} subtitle={t.odczytySkippedIntro} />
        <div className="modal-body modal-body--sectioned">
          {groups.map((group) => (
            <FormSection key={group.fileName} icon="file-text" title={group.fileName}>
              <table className="form-table">
                <thead>
                  <tr>
                    <th>{t.odczytySkippedRow}</th>
                    <th>{t.odczytySkippedSheet}</th>
                    <th>{t.odczytySkippedDevice}</th>
                    <th>{t.odczytySkippedWhere}</th>
                    <th>{t.odczytySkippedReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((s, i) => (
                    <tr key={`${group.fileName}-${s.sheet}-${s.row}-${i}`}>
                      <td className="form-table__label cell-num">{s.row}</td>
                      <td>{s.sheet}</td>
                      <td className="cell-wrap">{s.deviceNumber || <span className="cell-empty">—</span>}</td>
                      <td>
                        <div>{s.wm || '—'}</div>
                        <div className="form-table__sub">
                          {s.context
                            .filter((c) => c.value)
                            .map((c) => `${c.label}: ${c.value}`)
                            .join(' · ') || '—'}
                        </div>
                      </td>
                      <td>
                        <div>{reasonText(s)}</div>
                        {s.reason === 'no-value' && (
                          <div className="form-table__sub">
                            {s.fallback
                              ? `${t.odczytyFallbackNote} ${s.fallback.column} = ${s.fallback.value}`
                              : t.odczytyFallbackNone}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FormSection>
          ))}
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};

export default OdczytySkippedModal;
