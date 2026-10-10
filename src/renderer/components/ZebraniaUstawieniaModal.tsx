import React, { useState } from 'react';
import { ZebraniaUstawienia } from '../../shared/types';
import { uchwalaNr } from '../../shared/plan-gospodarczy';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormRow, FormSection } from './FormSection';
import Select from './Select';

/**
 * "Ustawienia planu" — shared by everyone: the default number of the
 * resolution adopting the plan, and the rounding of planned costs.
 */
const ZebraniaUstawieniaModal: React.FC<{
  language: Language;
  value: ZebraniaUstawienia;
  onSaved: (value: ZebraniaUstawienia) => void;
  onClose: () => void;
}> = ({ language, value, onSaved, onClose }) => {
  const t = translations[language];
  const notify = useNotify();
  const [uchwala, setUchwala] = useState(value.uchwalaPlanNr);
  const [zaokr, setZaokr] = useState(String(value.zaokraglenie));
  const [saving, setSaving] = useState(false);

  const roundingOptions = [1, 10, 100, 1000].map((n) => ({ value: String(n), label: `${n} zł` }));

  const save = async () => {
    const next: ZebraniaUstawienia = {
      // The template meeting is chosen on the list, not here — it stays as it is.
      ...value,
      uchwalaPlanNr: uchwala.trim(),
      zaokraglenie: Number(zaokr) || 100,
    };
    setSaving(true);
    try {
      await window.electronAPI.setZebraniaUstawienia(next);
      notify.success(t.zsetSaved);
      onSaved(next);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="settings" title={t.zsetTitle} subtitle={t.zsetSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="file-text" title={t.zsetDefaults} description={t.zsetDefaultsDesc}>
            <FormRow>
              <FormField
                label={t.zsetResolution}
                htmlFor="zset-uchwala"
                hint={t.zsetResolutionHint.replace('{example}', uchwalaNr(uchwala || '—', new Date().getFullYear() + 1))}
              >
                <input id="zset-uchwala" type="text" value={uchwala} onChange={(e) => setUchwala(e.target.value)} />
              </FormField>
              <FormField label={t.zsetRounding}>
                <Select overlay value={zaokr} options={roundingOptions} onChange={setZaokr} ariaLabel={t.zsetRounding} />
              </FormField>
            </FormRow>
          </FormSection>
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.cancel}
          onSubmit={() => void save()}
          submitLabel={t.save}
          submitIcon="save"
          busy={saving}
        />
      </div>
    </div>
  );
};

export default ZebraniaUstawieniaModal;
