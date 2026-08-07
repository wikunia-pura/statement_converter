import React from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <ModalDismiss onClose={onClose} />
        <div className="modal-header">
          {t.odczytySkippedTitle} ({total})
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>{t.odczytySkippedIntro}</p>
          {groups.map((group) => (
            <div key={group.fileName} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontWeight: 600,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon name="file-text" size={14} /> {group.fileName}
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>{t.odczytySkippedRow}</th>
                    <th style={{ width: 100 }}>{t.odczytySkippedSheet}</th>
                    <th style={{ width: 130 }}>{t.odczytySkippedDevice}</th>
                    <th>{t.odczytySkippedWhere}</th>
                    <th>{t.odczytySkippedReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((s, i) => (
                    <tr key={`${group.fileName}-${s.sheet}-${s.row}-${i}`}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {s.row}
                      </td>
                      <td>{s.sheet}</td>
                      <td style={{ wordBreak: 'break-all' }}>{s.deviceNumber || '—'}</td>
                      <td>
                        <div>{s.wm || '—'}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          {s.context
                            .filter((c) => c.value)
                            .map((c) => `${c.label}: ${c.value}`)
                            .join(' · ') || '—'}
                        </div>
                      </td>
                      <td>
                        <div>{reasonText(s)}</div>
                        {s.reason === 'no-value' && (
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
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
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>
            <Icon name="x" size={14} />{' '}{t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OdczytySkippedModal;
