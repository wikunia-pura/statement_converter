import React, { useMemo, useState } from 'react';
import { PlanKategoria, PlanSlownikRegula, ZebraniaUstawienia } from '../../shared/types';
import {
  PLAN_KATEGORIA_NAZWA,
  PLAN_KOSZTY,
  PLAN_PRZYCHODY,
  defaultSlownik,
  foldText,
  uchwalaNr,
} from '../../shared/plan-gospodarczy';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormField, FormRow, FormSection } from './FormSection';
import Icon from './Icon';
import Select from './Select';

function newRule(): PlanSlownikRegula {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return { id: c?.randomUUID?.() ?? `r-${Date.now()}`, wzorzec: '', kategoria: 'pozostale' };
}

/**
 * "Ustawienia zebrań" — shared by everyone: the dictionary that sorts statement
 * rows into plan lines, the default number of the resolution adopting the
 * plan, and the rounding of planned costs.
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
  const [rules, setRules] = useState<PlanSlownikRegula[]>(value.slownik);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const categoryOptions = useMemo(
    () => [
      ...PLAN_KOSZTY.map((k) => ({ value: k, label: `${t.zsetGroupCosts}: ${PLAN_KATEGORIA_NAZWA[k]}`, triggerLabel: PLAN_KATEGORIA_NAZWA[k] })),
      ...PLAN_PRZYCHODY.map((k) => ({ value: k, label: `${t.zsetGroupIncome}: ${PLAN_KATEGORIA_NAZWA[k]}`, triggerLabel: PLAN_KATEGORIA_NAZWA[k] })),
      { value: 'zaliczkaA', label: `${t.zsetGroupIncome}: ${PLAN_KATEGORIA_NAZWA.zaliczkaA}`, triggerLabel: PLAN_KATEGORIA_NAZWA.zaliczkaA },
      { value: 'pomin', label: PLAN_KATEGORIA_NAZWA.pomin },
    ],
    [t],
  );
  const roundingOptions = [1, 10, 100, 1000].map((n) => ({ value: String(n), label: `${n} zł` }));

  const q = foldText(filter);
  const visible = rules
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !q || foldText(r.wzorzec).includes(q) || foldText(PLAN_KATEGORIA_NAZWA[r.kategoria]).includes(q));

  const setRule = (id: string, patch: Partial<PlanSlownikRegula>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (index: number, by: number) =>
    setRules((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const save = async () => {
    const value: ZebraniaUstawienia = {
      uchwalaPlanNr: uchwala.trim(),
      zaokraglenie: Number(zaokr) || 100,
      slownik: rules.filter((r) => r.wzorzec.trim()).map((r) => ({ ...r, wzorzec: r.wzorzec.trim() })),
    };
    setSaving(true);
    try {
      await window.electronAPI.setZebraniaUstawienia(value);
      notify.success(t.zsetSaved);
      onSaved(value);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
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

          <FormSection
            icon="book"
            title={t.zsetDictionary}
            description={t.zsetDictionaryDesc}
            aside={
              <div className="form-section__actions">
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={async () => {
                    if (await notify.confirm(t.zsetRestoreConfirm, { confirmLabel: t.zsetRestore })) {
                      setRules(defaultSlownik());
                    }
                  }}
                >
                  <Icon name="undo" size={13} /> {t.zsetRestore}
                </button>
                <button type="button" className="button button-small button-primary" onClick={() => setRules((prev) => [newRule(), ...prev])}>
                  <Icon name="plus" size={13} /> {t.zsetAddRule}
                </button>
              </div>
            }
          >
            <div className="ksieg-search zset-search">
              <Icon name="search" size={15} />
              <input type="text" placeholder={t.zsetSearch} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="zset-rules">
              <div className="zset-rule zset-rule--head">
                <span>#</span>
                <span>{t.zsetPhrase}</span>
                <span>{t.zsetCategory}</span>
                <span />
              </div>
              {visible.map(({ r, index }) => (
                <div key={r.id} className="zset-rule">
                  <span className="zeb-muted">{index + 1}</span>
                  <input
                    type="text"
                    value={r.wzorzec}
                    placeholder={t.zsetPhrasePlaceholder}
                    onChange={(e) => setRule(r.id, { wzorzec: e.target.value })}
                    aria-label={t.zsetPhrase}
                  />
                  <Select
                    overlay
                    size="sm"
                    value={r.kategoria}
                    options={categoryOptions}
                    onChange={(k) => setRule(r.id, { kategoria: k as PlanKategoria })}
                    ariaLabel={t.zsetCategory}
                  />
                  <span className="row-actions">
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title={t.zsetMoveUp}
                      aria-label={t.zsetMoveUp}
                    >
                      <Icon name="arrow-up" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost"
                      onClick={() => move(index, 1)}
                      disabled={index === rules.length - 1}
                      title={t.zsetMoveDown}
                      aria-label={t.zsetMoveDown}
                    >
                      <Icon name="arrow-down" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-icon button-ghost icon-danger"
                      onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                      title={t.zsetRemoveRule}
                      aria-label={t.zsetRemoveRule}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {visible.length === 0 && <p className="zeb-muted">{t.zsetNoRules}</p>}
            </div>
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
