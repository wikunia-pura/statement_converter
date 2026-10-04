import React, { useState, useEffect, useMemo } from 'react';
import { Kontrahent, KontrahentTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import ChoiceCards from '../components/ChoiceCards';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import TagInput from '../components/TagInput';

/** Badge modifier per contractor kind — the colours live in styles.css. */
const TYP_BADGE: Record<KontrahentTyp, string> = {
  'Kontrahent': 'typ-badge--kontrahent',
  'Pozostałe przychody': 'typ-badge--przychody',
  'Pozostałe koszty': 'typ-badge--koszty',
};

interface KontrahenciProps {
  language: Language;
}

const Kontrahenci: React.FC<KontrahenciProps> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [kontrahenci, setKontrahenci] = useState<Kontrahent[]>([]);
  const [showAddKontrahent, setShowAddKontrahent] = useState(false);
  const [editingKontrahent, setEditingKontrahent] = useState<Kontrahent | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newKontoKontrahenta, setNewKontoKontrahenta] = useState('');
  const [newNip, setNewNip] = useState('');
  const [newTypy, setNewTypy] = useState<KontrahentTyp[]>(['Kontrahent']);
  const [newAlternativeNames, setNewAlternativeNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const kontrahenciData = await window.electronAPI.getKontrahenci();
      setKontrahenci(kontrahenciData);
    } catch (error) {
      console.error('Error loading kontrahenci:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddKontrahent = async () => {
    if (!newNazwa || !newKontoKontrahenta) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive)
    const duplicateExists = kontrahenci.some(
      k => k.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateKontrahentName);
      return;
    }

    try {
      await window.electronAPI.addKontrahent(newNazwa, newKontoKontrahenta, newNip || undefined, newAlternativeNames, newTypy);
      setNewNazwa('');
      setNewKontoKontrahenta('');
      setNewNip('');
      setNewTypy(['Kontrahent']);
      setNewAlternativeNames([]);
      setShowAddKontrahent(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorAddingKontrahent}: ${errorMessage}`);
    }
  };

  const handleUpdateKontrahent = async () => {
    if (!editingKontrahent || !newNazwa || !newKontoKontrahenta) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive), excluding current kontrahent
    const duplicateExists = kontrahenci.some(
      k => k.id !== editingKontrahent.id && k.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateKontrahentName);
      return;
    }

    try {
      await window.electronAPI.updateKontrahent(editingKontrahent.id, newNazwa, newKontoKontrahenta, newNip || undefined, newAlternativeNames, newTypy);
      setNewNazwa('');
      setNewKontoKontrahenta('');
      setNewNip('');
      setNewTypy(['Kontrahent']);
      setNewAlternativeNames([]);
      setEditingKontrahent(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorUpdatingKontrahent}: ${errorMessage}`);
    }
  };

  const handleDeleteKontrahent = async (id: number) => {
    if (await notify.confirm(t.confirmDeleteKontrahent, { danger: true })) {
      try {
        await window.electronAPI.deleteKontrahent(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        notify.error(`${t.errorDeletingKontrahent}: ${errorMessage}`);
      }
    }
  };

  const handleEditKontrahent = (kontrahent: Kontrahent) => {
    setEditingKontrahent(kontrahent);
    setNewNazwa(kontrahent.nazwa);
    setNewKontoKontrahenta(kontrahent.kontoKontrahenta);
    setNewNip(kontrahent.nip || '');
    setNewTypy(kontrahent.typy && kontrahent.typy.length > 0 ? kontrahent.typy : ['Kontrahent']);
    setNewAlternativeNames(kontrahent.alternativeNames || []);
  };

  const handleCancelEdit = () => {
    setEditingKontrahent(null);
    setShowAddKontrahent(false);
    setNewNazwa('');
    setNewKontoKontrahenta('');
    setNewNip('');
    setNewTypy(['Kontrahent']);
    setNewAlternativeNames([]);
  };

  const handleToggleTyp = (typ: KontrahentTyp) => {
    setNewTypy(prev => {
      const next = prev.includes(typ) ? prev.filter(t => t !== typ) : [...prev, typ];
      // Never allow an empty selection — a contractor must have at least one role.
      return next.length > 0 ? next : prev;
    });
  };

  const handleImportFromFileFunky = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importKontrahenciFromFile();
      console.log('[UI] Import result:', result);
      if (result.success) {
        const message = t.importKontrahenciFromFileFunkySuccess
          .replace('{added}', result.added?.toString() || '0')
          .replace('{updated}', result.updated?.toString() || '0');
        notify.success(message);
        loadData();
      } else if (result.error) {
        notify.error(`${t.importKontrahenciError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.importKontrahenciError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromDOM = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importKontrahenciFromDOM();
      if (result.success) {
        const message = t.importKontrahenciFromDOMSuccess
          .replace('{added}', result.added?.toString() || '0')
          .replace('{updated}', result.updated?.toString() || '0');
        notify.success(message);
        loadData();
      } else if (result.error) {
        notify.error(`${t.importKontrahenciError}: ${result.error}`);
      }
      // If success is false but no error, user canceled - do nothing
    } catch (error) {
      console.error('Error importing from DOM:', error);
      notify.error(`${t.importKontrahenciError}: ${error}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportToFile = async () => {
    try {
      const result = await window.electronAPI.exportKontrahenciToFile();
      if (result.success) {
        notify.success(t.exportKontrahenciSuccess.replace('{count}', String(result.count ?? 0)));
      } else if (result.error) {
        notify.error(`${t.exportKontrahenciError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.exportKontrahenciError);
    }
  };

  const handleDeleteAll = async () => {
    if (await notify.confirm(t.confirmDeleteAllKontrahenci, { danger: true })) {
      try {
        await window.electronAPI.deleteAllKontrahenci();
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        notify.error(`${t.errorDeletingKontrahent}: ${errorMessage}`);
      }
    }
  };

  const filteredKontrahenci = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return kontrahenci.filter(k =>
      k.nazwa.toLowerCase().includes(q) ||
      k.kontoKontrahenta.toLowerCase().includes(q) ||
      (k.nip && k.nip.toLowerCase().includes(q))
    );
  }, [kontrahenci, searchTerm]);

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  const typOptions = [
    { value: 'Kontrahent' as KontrahentTyp, label: t.typKontrahent, hint: t.kontrahentTypKontrahentHint },
    { value: 'Pozostałe koszty' as KontrahentTyp, label: t.typPozostaleKoszty, hint: t.kontrahentTypKosztyHint },
    { value: 'Pozostałe przychody' as KontrahentTyp, label: t.typPozostalePrzychody, hint: t.kontrahentTypPrzychodyHint },
  ];

  return (
    <div className="content-body">
      {isImporting && <BusyOverlay label={t.importing} />}
      <FormSection
        icon="briefcase"
        title={t.kontrahenci}
        description={t.kontrahenciListDesc}
        aside={
          <div className="form-section__actions">
            {/* Mass delete is demoted: never the loudest button next to everyday actions. */}
            {kontrahenci.length > 0 && (
              <>
                <button className="button button-ghost icon-danger" onClick={handleDeleteAll}>
                  <Icon name="trash" size={14} />{' '}{t.deleteAllKontrahenci}
                </button>
                <span className="toolbar-divider" aria-hidden="true" />
              </>
            )}
            <button className="button button-import" onClick={handleImportFromFileFunky} disabled={isImporting}>
              <Icon name="upload" size={14} />{' '}{t.importFromFileFunky}
            </button>
            <button className="button button-import" onClick={handleImportFromDOM} disabled={isImporting}>
              <Icon name="upload" size={14} />{' '}{t.importFromDOM}
            </button>
            <button
              className="button button-export"
              onClick={handleExportToFile}
              disabled={kontrahenci.length === 0}
            >
              <Icon name="download" size={14} />{' '}{t.exportToFile}
            </button>
            <button
              className="button button-primary"
              onClick={() => setShowAddKontrahent(true)}
              disabled={showAddKontrahent || editingKontrahent !== null}
            >
              <Icon name="plus" size={14} />{' '}{t.addKontrahent}
            </button>
          </div>
        }
      >
        {(showAddKontrahent || editingKontrahent) && (
          <div className="modal-overlay" onClick={handleCancelEdit}>
            <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
              <ModalDismiss onClose={handleCancelEdit} />
              <ModalHeader
                icon="briefcase"
                title={editingKontrahent ? t.editKontrahent : t.addNewKontrahent}
                subtitle={editingKontrahent ? editingKontrahent.nazwa : t.kontrahentFormSubtitleAdd}
              />
              <div className="modal-body modal-body--sectioned">
                <FormSection icon="briefcase" title={t.kontrahentSectionData} description={t.kontrahentSectionDataDesc}>
                  <FormField label={t.nazwa} htmlFor="kontrahent-nazwa" required>
                    <input
                      id="kontrahent-nazwa"
                      type="text"
                      value={newNazwa}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                      placeholder="np. Miasto Stołeczne Warszawa"
                      autoFocus={!editingKontrahent}
                    />
                  </FormField>
                  <FormRow>
                    <FormField label={t.kontoKontrahenta} htmlFor="kontrahent-konto" required>
                      <input
                        id="kontrahent-konto"
                        type="text"
                        className="input-mono"
                        value={newKontoKontrahenta}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKontoKontrahenta(e.target.value)}
                        placeholder="np. 201-00001"
                      />
                    </FormField>
                    <FormField label={t.nip} htmlFor="kontrahent-nip">
                      <input
                        id="kontrahent-nip"
                        type="text"
                        className="input-mono"
                        value={newNip}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNip(e.target.value)}
                        placeholder="np. 1234567890"
                      />
                    </FormField>
                  </FormRow>
                </FormSection>

                <FormSection icon="clipboard" title={t.kontrahentSectionTyp} description={t.kontrahentSectionTypDesc}>
                  <ChoiceCards options={typOptions} selected={newTypy} onToggle={handleToggleTyp} />
                </FormSection>

                <FormSection
                  icon="search"
                  title={t.kontrahentSectionMatching}
                  description={t.kontrahentSectionMatchingDesc}
                >
                  <FormField label={t.alternativeNames} htmlFor="kontrahent-alt" hint={t.kontrahentAltNamesHint}>
                    <TagInput
                      id="kontrahent-alt"
                      values={newAlternativeNames}
                      onChange={setNewAlternativeNames}
                      placeholder="np. Tech-Home, TECH HOME"
                      addLabel={t.add}
                      removeLabel={t.remove}
                    />
                  </FormField>
                </FormSection>
              </div>
              <ModalFooter
                note={<RequiredNote label={t.formRequiredNote} />}
                onCancel={handleCancelEdit}
                cancelLabel={t.cancel}
                onSubmit={editingKontrahent ? handleUpdateKontrahent : handleAddKontrahent}
                submitLabel={editingKontrahent ? t.save : t.addNewKontrahent}
                submitIcon={editingKontrahent ? 'save' : 'plus'}
                submitDisabled={!newNazwa.trim() || !newKontoKontrahenta.trim()}
                submitTitle={t.fillAllFields}
              />
            </div>
          </div>
        )}

        {kontrahenci.length > 0 ? (
          <>
            <div className="list-filter">
              <div className="input-icon">
                <Icon name="search" size={15} />
                <input
                  type="text"
                  placeholder={t.searchKontrahenci}
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                  aria-label={t.searchKontrahenci}
                />
              </div>
              <span className="list-filter__count">
                {t.totalKontrahenci}: <strong>{filteredKontrahenci.length}</strong> / {kontrahenci.length}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.nazwa}</th>
                  <th>{t.kontoKontrahenta}</th>
                  <th>{t.nip}</th>
                  <th>{t.typ}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredKontrahenci.map((kontrahent) => {
                  const altNames = kontrahent.alternativeNames ?? [];
                  const typy: KontrahentTyp[] =
                    kontrahent.typy && kontrahent.typy.length > 0 ? kontrahent.typy : ['Kontrahent'];
                  return (
                    <tr key={kontrahent.id}>
                      <td className="data-table__name">
                        {/* Spelling variants are for matching, not for reading the list —
                            on hover only (search still finds them by name). */}
                        <span
                          className="cell-title"
                          title={altNames.length > 0 ? `${t.alternativeNames}:\n${altNames.join('\n')}` : undefined}
                        >
                          {kontrahent.nazwa}
                        </span>
                      </td>
                      <td className="cell-mono">{kontrahent.kontoKontrahenta}</td>
                      <td className="cell-mono">
                        {kontrahent.nip || <span className="cell-empty">—</span>}
                      </td>
                      <td>
                        <div className="badge-row">
                          {typy.map((typ) => (
                            <span key={typ} className={`typ-badge ${TYP_BADGE[typ]}`}>{typ}</span>
                          ))}
                        </div>
                      </td>
                      <td className="data-table__actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => handleEditKontrahent(kontrahent)}
                          >
                            <Icon name="edit" size={13} />{' '}{t.edit}
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-icon icon-danger"
                            onClick={() => handleDeleteKontrahent(kontrahent.id)}
                            title={t.delete}
                            aria-label={`${t.delete}: ${kontrahent.nazwa}`}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <div className="form-empty">
            <Icon name="briefcase" size={16} />
            {t.noKontrahenciConfigured}
          </div>
        )}
      </FormSection>
    </div>
  );
};

export default Kontrahenci;
