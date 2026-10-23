import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Adres,
  AdresIdentyfikacja,
  AdresPowierzchnie,
  Bank,
  ApartmentMapping,
  KontoTyp,
  ZgnJednostka,
  ZarzadOsoba,
} from '../../shared/types';
import { normalizeIdentyfikacja, pustaIdentyfikacja } from '../../shared/adres-identyfikacja';
import { brakujacePowierzchnie, normalizePowierzchnie, pustePowierzchnie } from '../../shared/adres-powierzchnie';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import { formatAccount, normalizeAccount } from '../../shared/account-extractor';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import { useStableCallback } from '../hooks/useStableCallback';
import Loader, { BusyOverlay } from '../components/Loader';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import ModuleTabs from '../components/ModuleTabs';
import Select from '../components/Select';
import TagInput from '../components/TagInput';
import AdresyZasilDn1 from './AdresyZasilDn1';
import { foldSummary } from '../components/adresy/adresyShared';
import { AccountTypesPanel } from '../components/adresy/AccountTypes';
import { ApartmentMappingsEditor, ApartmentMappingsModal } from '../components/adresy/ApartmentMappings';
import { ZarzadEditor, ZarzadModal } from '../components/adresy/Zarzad';
import { ZgnUnitsPanel, ZgnUnitsModal } from '../components/adresy/ZgnUnits';
import { IdentyfikacjaSection } from '../components/adresy/IdentyfikacjaSection';
import { PowierzchnieSection } from '../components/adresy/PowierzchnieSection';
import { AdresRow } from '../components/adresy/AdresRow';
import { ipcErrorMessage } from '../ipcError';

interface AdresyProps {
  language: Language;
  /** When set, opens the "add address" modal with this account number pre-filled. The parent should clear it once consumed. */
  prefillAccountNumber?: string | null;
  onPrefillConsumed?: () => void;
  /** When set, opens this address's edit modal (e.g. from a budget plan, whose areas come from here). The parent should clear it once consumed. */
  openAdresId?: number | null;
  onOpenAdresConsumed?: () => void;
}

/** Whether anything is filled in — an untouched form is not worth a write. */
const identyfikacjaPusta = (i: AdresIdentyfikacja) =>
  JSON.stringify(normalizeIdentyfikacja(i)) === JSON.stringify(pustaIdentyfikacja());

type AdresyTab = 'lista' | 'typy' | 'zgn';

/** What an address can lack, in the order the row's tooltip and the filter list them. */
const BRAKI = [
  'nip',
  'nazwaPelna',
  'siedziba',
  'account',
  'zgn',
  'zarzad',
  'powierzchnia',
  'miasto',
  'pozytki',
] as const;
type AdresBrak = (typeof BRAKI)[number];

/** The list's filter: every address, any with something missing, or those missing one thing. */
type BrakFilter = 'all' | 'any' | AdresBrak;

const Adresy: React.FC<AdresyProps> = ({
  language,
  prefillAccountNumber,
  onPrefillConsumed,
  openAdresId,
  onOpenAdresConsumed,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [tab, setTab] = useState<AdresyTab>('lista');
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [kontoTypy, setKontoTypy] = useState<KontoTyp[]>([]);
  const [zgnJednostki, setZgnJednostki] = useState<ZgnJednostka[]>([]);
  const [showZgnUnitsModal, setShowZgnUnitsModal] = useState(false);
  const [newZgnJednostkaId, setNewZgnJednostkaId] = useState<number | null>(null);
  const [newBezZgn, setNewBezZgn] = useState(false);
  const [showAddAdres, setShowAddAdres] = useState(false);
  const [editingAdres, setEditingAdres] = useState<Adres | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newAlternativeNames, setNewAlternativeNames] = useState<string[]>([]);
  const [newSwrkIdentifiers, setNewSwrkIdentifiers] = useState<string[]>([]);
  const [newAccountNumbers, setNewAccountNumbers] = useState<string[]>([]);
  const [newAccountTypes, setNewAccountTypes] = useState<Record<string, number>>({});
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [accountNumberError, setAccountNumberError] = useState<string | null>(null);
  const [newBankId, setNewBankId] = useState<number | null>(null);
  const [newIdentyfikacja, setNewIdentyfikacja] = useState<AdresIdentyfikacja>(pustaIdentyfikacja());
  const [newPowierzchnie, setNewPowierzchnie] = useState<AdresPowierzchnie>(pustePowierzchnie());
  // The board and the apartment rules are also on the list (their own modals);
  // here they are part of the form and saved with it.
  const [newZarzad, setNewZarzad] = useState<ZarzadOsoba[]>([]);
  const [newMappings, setNewMappings] = useState<ApartmentMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [brakFilter, setBrakFilter] = useState<BrakFilter>('all');
  // By id, not the row itself: saving reloads the list (and shows the loader,
  // which remounts the modal), so the modal must pick up the fresh row — a kept
  // copy would reopen showing the list as it was before the save.
  const [mappingsAdresId, setMappingsAdresId] = useState<number | null>(null);
  const [zarzadAdresId, setZarzadAdresId] = useState<number | null>(null);
  const mappingsAdres = adresy.find((a) => a.id === mappingsAdresId) ?? null;
  const zarzadAdres = adresy.find((a) => a.id === zarzadAdresId) ?? null;

  // Honor incoming prefill from the Converter: open the "add" modal with the
  // detected account pre-loaded so the user only needs to type the nazwa.
  useEffect(() => {
    if (!prefillAccountNumber) return;
    const canonical = normalizeAccount(prefillAccountNumber);
    if (!canonical) return;
    setTab('lista');
    setShowAddAdres(true);
    setEditingAdres(null);
    setNewAccountNumbers([canonical]);
    onPrefillConsumed?.();
  }, [prefillAccountNumber, onPrefillConsumed]);

  useEffect(() => {
    loadData();
  }, []);

  // Asked to open one address (a budget plan's "Edytuj w Adresach"): its edit modal, once the list is in.
  useEffect(() => {
    if (openAdresId == null || isLoading) return;
    const adres = adresy.find((a) => a.id === openAdresId);
    if (adres) {
      setTab('lista');
      setShowAddAdres(false);
      handleEditAdres(adres);
    }
    onOpenAdresConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAdresId, isLoading]);

  // The units modal opens over this form, and its unit form can re-assign this
  // very address. Follow such a change, so saving the address does not quietly
  // put the old unit back.
  useEffect(() => {
    if (!editingAdres) return;
    const fresh = adresy.find((a) => a.id === editingAdres.id);
    if (
      fresh &&
      ((fresh.zgnJednostkaId ?? null) !== (editingAdres.zgnJednostkaId ?? null) ||
        !!fresh.bezZgn !== !!editingAdres.bezZgn)
    ) {
      setNewZgnJednostkaId(fresh.zgnJednostkaId ?? null);
      setNewBezZgn(!!fresh.bezZgn);
      setEditingAdres(fresh);
    }
  }, [adresy]);

  const loadData = async () => {
    try {
      const [adresyData, banksData, kontoTypyData, zgnData] = await Promise.all([
        window.electronAPI.getAdresy(),
        window.electronAPI.getBanks(),
        window.electronAPI.getKontoTypy(),
        window.electronAPI.mailingGetZgn(),
      ]);
      setAdresy(adresyData);
      setBanks(banksData);
      setKontoTypy(kontoTypyData);
      setZgnJednostki(zgnData);
    } catch (error) {
      console.error('Error loading adresy:', error);
      // Said out loud: an empty table with no word why reads as "no addresses".
      notify.error(t.adresyLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  /** The address itself is already saved by now, so a failure here is reported without keeping the form open. */
  const saveIdentyfikacja = async (id: number, value: AdresIdentyfikacja) => {
    try {
      await window.electronAPI.setAdresIdentyfikacja(id, normalizeIdentyfikacja(value));
    } catch (error: unknown) {
      notify.error(ipcErrorMessage(error, t.errorUnexpected), t.adresIdentSaveError);
    }
  };

  /** Like the identification: the address is saved by now, so a failure is reported without keeping the form open. */
  const savePowierzchnie = async (id: number, value: AdresPowierzchnie) => {
    try {
      await window.electronAPI.setAdresPowierzchnie(id, normalizePowierzchnie(value));
    } catch (error: unknown) {
      notify.error(ipcErrorMessage(error, t.errorUnexpected), t.adresPowSaveError);
    }
  };

  /** Like the identification: the address is saved by now, so a failure is reported without keeping the form open. */
  const saveZarzad = async (id: number, value: ZarzadOsoba[]) => {
    try {
      await window.electronAPI.setAdresZarzad(id, value);
    } catch (error: unknown) {
      notify.error(ipcErrorMessage(error, t.errorUnexpected), t.adresZarzadSaveError);
    }
  };

  const handleAddAdres = async () => {
    if (!newNazwa) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive)
    const duplicateExists = adresy.some(
      a => a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateAdresName);
      return;
    }

    try {
      const created = await window.electronAPI.addAdres(
        newNazwa,
        newAlternativeNames,
        newSwrkIdentifiers,
        newBankId,
        newAccountNumbers,
        newMappings,
        newAccountTypes,
        newZgnJednostkaId,
        newBezZgn,
      );
      // A new address has no id until now, so its identification and board are saved right after it exists.
      if (!identyfikacjaPusta(newIdentyfikacja)) await saveIdentyfikacja(created.id, newIdentyfikacja);
      if (brakujacePowierzchnie({ powierzchnie: newPowierzchnie }).length < 3) {
        await savePowierzchnie(created.id, newPowierzchnie);
      }
      if (newZarzad.length > 0) await saveZarzad(created.id, newZarzad);
      resetForm();
      setShowAddAdres(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = ipcErrorMessage(error, t.errorUnexpected);
      notify.error(`${t.errorAddingAdres}: ${errorMessage}`);
    }
  };

  const handleUpdateAdres = async () => {
    if (!editingAdres || !newNazwa) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive), excluding current adres
    const duplicateExists = adresy.some(
      a => a.id !== editingAdres.id && a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateAdresName);
      return;
    }

    try {
      await window.electronAPI.updateAdres(
        editingAdres.id,
        newNazwa,
        newAlternativeNames,
        newSwrkIdentifiers,
        newBankId,
        newAccountNumbers,
        // Only when touched: an untouched list is not re-sent.
        JSON.stringify(newMappings) !== JSON.stringify(editingAdres.apartmentMappings || []) ? newMappings : undefined,
        newAccountTypes,
        newZgnJednostkaId,
        newBezZgn,
      );
      const ident = normalizeIdentyfikacja(newIdentyfikacja);
      if (JSON.stringify(ident) !== JSON.stringify(normalizeIdentyfikacja(editingAdres.identyfikacja))) {
        await saveIdentyfikacja(editingAdres.id, ident);
      }
      const pow = normalizePowierzchnie(newPowierzchnie);
      if (JSON.stringify(pow) !== JSON.stringify(normalizePowierzchnie(editingAdres.powierzchnie))) {
        await savePowierzchnie(editingAdres.id, pow);
      }
      if (JSON.stringify(newZarzad) !== JSON.stringify(editingAdres.zarzad || [])) {
        await saveZarzad(editingAdres.id, newZarzad);
      }
      resetForm();
      setEditingAdres(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = ipcErrorMessage(error, t.errorUnexpected);
      notify.error(`${t.errorUpdatingAdres}: ${errorMessage}`);
    }
  };

  const handleDeleteAdres = async (id: number) => {
    if (await notify.confirm(t.confirmDeleteAdres, { danger: true })) {
      try {
        await window.electronAPI.deleteAdres(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = ipcErrorMessage(error, t.errorUnexpected);
        notify.error(`${t.errorDeletingAdres}: ${errorMessage}`);
      }
    }
  };

  const resetForm = () => {
    setNewNazwa('');
    setNewAlternativeNames([]);
    setNewSwrkIdentifiers([]);
    setNewAccountNumbers([]);
    setNewAccountTypes({});
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(null);
    setNewZgnJednostkaId(null);
    setNewBezZgn(false);
    setNewIdentyfikacja(pustaIdentyfikacja());
    setNewPowierzchnie(pustePowierzchnie());
    setNewZarzad([]);
    setNewMappings([]);
  };

  const handleEditAdres = (adres: Adres) => {
    setEditingAdres(adres);
    setNewNazwa(adres.nazwa);
    setNewAlternativeNames(adres.alternativeNames || []);
    setNewSwrkIdentifiers(adres.swrkIdentifiers || []);
    setNewAccountNumbers(adres.accountNumbers || []);
    setNewAccountTypes(adres.accountTypes || {});
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(adres.bankId ?? null);
    setNewZgnJednostkaId(adres.zgnJednostkaId ?? null);
    setNewBezZgn(!!adres.bezZgn);
    setNewIdentyfikacja(normalizeIdentyfikacja(adres.identyfikacja));
    setNewPowierzchnie(normalizePowierzchnie(adres.powierzchnie));
    setNewZarzad(adres.zarzad || []);
    setNewMappings(adres.apartmentMappings || []);
  };

  const handleCancelEdit = () => {
    setEditingAdres(null);
    setShowAddAdres(false);
    resetForm();
  };

  const handleAddAccountNumber = () => {
    const canonical = normalizeAccount(newAccountNumber);
    if (!canonical) {
      setAccountNumberError(t.accountNumberInvalid);
      return;
    }
    if (newAccountNumbers.includes(canonical)) {
      setAccountNumberError(t.accountNumberDuplicateLocal);
      return;
    }
    setNewAccountNumbers([...newAccountNumbers, canonical]);
    // Default the new account to the default type (if one is configured).
    const defaultType = kontoTypy.find((k) => k.isDefault) ?? kontoTypy[0];
    if (defaultType) {
      setNewAccountTypes((prev) => ({ ...prev, [canonical]: defaultType.id }));
    }
    setNewAccountNumber('');
    setAccountNumberError(null);
  };

  const handleRemoveAccountNumber = (index: number) => {
    const removed = newAccountNumbers[index];
    setNewAccountNumbers(newAccountNumbers.filter((_, i) => i !== index));
    if (removed) {
      setNewAccountTypes((prev) => {
        const next = { ...prev };
        delete next[removed];
        return next;
      });
    }
  };

  const handleAccountTypeChange = (account: string, typeId: number) => {
    setNewAccountTypes((prev) => ({ ...prev, [account]: typeId }));
  };

  const handleImportFromFile = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importAdresyFromFile();
      if (result.success) {
        notify.success(t.importAdresySuccess.replace('{count}', String(result.count ?? 0)));
        if (result.errors && result.errors.length > 0) {
          notify.error(
            t.importAdresyPartialErrors.replace('{count}', String(result.errors.length)) +
              '\n' + result.errors.join('\n'),
          );
        }
        loadData();
      } else if (result.error) {
        notify.error(`${t.importAdresyError}: ${ipcErrorMessage(result.error, t.errorUnexpected)}`);
      }
    } catch (error) {
      notify.error(t.importAdresyError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportToFile = async () => {
    try {
      const result = await window.electronAPI.exportAdresyToFile();
      if (result.success) {
        notify.success(t.exportAdresySuccess.replace('{count}', String(result.count ?? 0)), {
          file: result.filePath,
        });
      } else if (result.error) {
        notify.error(`${t.exportAdresyError}: ${ipcErrorMessage(result.error, t.errorUnexpected)}`);
      }
    } catch (error) {
      notify.error(t.exportAdresyError);
    }
  };

  const handleDeleteAll = async () => {
    if (await notify.confirm(t.confirmDeleteAllAdresy, { danger: true })) {
      try {
        await window.electronAPI.deleteAllAdresy();
        loadData();
      } catch (error: unknown) {
        const errorMessage = ipcErrorMessage(error, t.errorUnexpected);
        notify.error(`${t.errorDeletingAdres}: ${errorMessage}`);
      }
    }
  };

  // What each address is still missing, worked out once per list.
  const brakiById = useMemo(() => {
    const out = new Map<number, AdresBrak[]>();
    for (const a of adresy) {
      const id = a.identyfikacja;
      const braki: AdresBrak[] = [];
      if (!id?.nip) braki.push('nip');
      if (!id?.nazwaPelna?.trim()) braki.push('nazwaPelna');
      if (!id?.siedziba?.miejscowosc?.trim() || !id.siedziba.ulica?.trim()) braki.push('siedziba');
      if (!(a.accountNumbers?.length)) braki.push('account');
      if (!a.bezZgn && !zgnJednostki.some((j) => j.id === a.zgnJednostkaId)) braki.push('zgn');
      if (!(a.zarzad?.length)) braki.push('zarzad');
      const pow = brakujacePowierzchnie(a);
      if (pow.includes('calkowita')) braki.push('powierzchnia');
      if (pow.includes('miasto')) braki.push('miasto');
      if (pow.includes('pozytki')) braki.push('pozytki');
      out.set(a.id, braki);
    }
    return out;
  }, [adresy, zgnJednostki]);

  const brakLabels: Record<AdresBrak, string> = useMemo(() => ({
    nip: t.adresMissingNip,
    nazwaPelna: t.adresMissingNazwaPelna,
    siedziba: t.adresMissingSiedziba,
    account: t.adresMissingAccount,
    zgn: t.adresMissingZgn,
    zarzad: t.adresMissingZarzad,
    powierzchnia: t.adresMissingPowierzchnia,
    miasto: t.adresMissingMiasto,
    pozytki: t.adresMissingPozytki,
  }), [t]);

  // What an address is still missing, as the labels the row's tooltip lists.
  const missingOf = useCallback(
    (a: Adres): string[] => (brakiById.get(a.id) ?? []).map((b) => brakLabels[b]),
    [brakiById, brakLabels],
  );

  const searchedAdresy = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return adresy;
    return adresy.filter((a) =>
      a.nazwa.toLowerCase().includes(q) ||
      a.alternativeNames?.some((n) => n.toLowerCase().includes(q)) ||
      a.swrkIdentifiers?.some((s) => s.toLowerCase().includes(q)) ||
      a.accountNumbers?.some((acc) => acc.includes(q.replace(/\s/g, ''))),
    );
  }, [adresy, searchTerm]);

  // The number on each option: how many addresses it would show under the
  // current search — so an option says what clicking it yields.
  const brakCounts = useMemo(() => {
    const per = Object.fromEntries(BRAKI.map((b) => [b, 0])) as Record<AdresBrak, number>;
    let any = 0;
    for (const a of searchedAdresy) {
      const braki = brakiById.get(a.id) ?? [];
      if (braki.length > 0) any += 1;
      for (const b of braki) per[b] += 1;
    }
    return { any, per };
  }, [searchedAdresy, brakiById]);

  const filteredAdresy = useMemo(() => {
    if (brakFilter === 'all') return searchedAdresy;
    return searchedAdresy.filter((a) => {
      const braki = brakiById.get(a.id) ?? [];
      return brakFilter === 'any' ? braki.length > 0 : braki.includes(brakFilter);
    });
  }, [searchedAdresy, brakFilter, brakiById]);

  // Clicking the chosen option again goes back to every address.
  const brakOption = (key: BrakFilter, label: string, count?: number) => (
    <button
      key={key}
      type="button"
      className={`zad-seg__btn${brakFilter === key ? ' is-active' : ''}${count === 0 ? ' is-empty' : ''}`}
      aria-pressed={brakFilter === key}
      onClick={() => setBrakFilter(brakFilter === key ? 'all' : key)}
    >
      {label}
      {count !== undefined && <span className="zad-seg__count">{count}</span>}
    </button>
  );

  // Lookups the rows make, built once per list instead of a `find` per row per render.
  const banksById = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);
  const zgnById = useMemo(() => new Map(zgnJednostki.map((j) => [j.id, j])), [zgnJednostki]);
  const kontoTypyById = useMemo(() => new Map(kontoTypy.map((k) => [k.id, k])), [kontoTypy]);
  // One identity for the view's life, so the memoized rows stay put.
  const onEditRow = useStableCallback(handleEditAdres);
  const onDeleteRow = useStableCallback((id: number) => void handleDeleteAdres(id));

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  // Editing a saved address opens with every section folded, each header saying
  // what it holds — unfold only the part being changed. A new address opens
  // unfolded: all of it is to be filled in.
  const foldEdit = editingAdres !== null;
  const zgnWybrana = zgnJednostki.find((j) => j.id === newZgnJednostkaId);

  return (
    <>
      <ModuleTabs
        tabs={[
          { id: 'lista', label: t.adresyTabList, icon: 'map-pin' },
          { id: 'typy', label: t.accountTypesTitle, icon: 'settings' },
          { id: 'zgn', label: t.zgnUnitsTitle, icon: 'building' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as AdresyTab)}
      />
      <div className="content-body">
        {isImporting && <BusyOverlay label={t.importing} />}
        {tab === 'lista' && (
          <FormSection
            icon="map-pin"
            title={t.adresy}
            description={t.adresyListDesc}
            aside={
              <div className="form-section__actions">
                {/* Mass delete is demoted: never the loudest button next to everyday actions. */}
                {adresy.length > 0 && (
                  <>
                    <button
                      className="button button-ghost icon-danger"
                      onClick={handleDeleteAll}
                    >
                      <Icon name="trash" size={14} />{' '}{t.deleteAllAdresy}
                    </button>
                    <span className="toolbar-divider" aria-hidden="true" />
                  </>
                )}
                <AdresyZasilDn1 language={language} onDone={loadData} disabled={isImporting} />
                <button
                  className="button button-import"
                  onClick={handleImportFromFile}
                  disabled={isImporting}
                >
                  <Icon name="upload" size={14} />{' '}{t.importFromFile}
                </button>
                <button
                  className="button button-export"
                  onClick={handleExportToFile}
                  disabled={adresy.length === 0}
                >
                  <Icon name="download" size={14} />{' '}{t.exportToFile}
                </button>
                <button
                  className="button button-primary"
                  onClick={() => setShowAddAdres(true)}
                  disabled={showAddAdres || editingAdres !== null}
                >
                  <Icon name="plus" size={14} />{' '}{t.addAdres}
                </button>
              </div>
            }
          >

            {/* In the body, not in the list's card: the overlay must cover the window, and a card around it can pin it to the list. */}
            {(showAddAdres || editingAdres) &&
              createPortal(
              <div className="modal-overlay" onClick={handleCancelEdit}>
                <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
                  <ModalDismiss onClose={handleCancelEdit} />
                  <ModalHeader
                    icon="map-pin"
                    title={editingAdres ? t.editAdres : t.addNewAdres}
                    subtitle={editingAdres ? editingAdres.nazwa : t.adresFormSubtitleAdd}
                  />
                  <div className="modal-body modal-body--sectioned">
                    <FormSection
                      icon="home"
                      title={t.adresSectionBasic}
                      description={t.adresSectionBasicDesc}
                      collapsible={foldEdit}
                      defaultCollapsed
                      collapsedSummary={[newNazwa.trim(), banks.find((b) => b.id === newBankId)?.name ?? t.adresNoBank]
                        .filter(Boolean)
                        .join(' · ')}
                    >
                      <FormRow>
                        <FormField label={t.nazwa} htmlFor="adres-nazwa" required>
                          <input
                            id="adres-nazwa"
                            type="text"
                            value={newNazwa}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                            placeholder={t.adresNamePlaceholder}
                            autoFocus={!editingAdres}
                            required
                          />
                        </FormField>
                        <FormField label={t.adresBank} hint={t.adresBankHintShort}>
                          <Select
                            overlay
                            value={newBankId ?? ''}
                            onChange={(v) => setNewBankId(v ? Number(v) : null)}
                            options={[
                              { value: '', label: t.adresNoBank },
                              ...banks.map((bank) => ({ value: String(bank.id), label: bank.name })),
                            ]}
                          />
                        </FormField>
                      </FormRow>
                    </FormSection>

                    <FormSection
                      icon="wallet"
                      title={t.adresSectionAccounts}
                      description={t.adresSectionAccountsDesc}
                      collapsible={foldEdit}
                      defaultCollapsed
                      collapsedSummary={foldSummary(newAccountNumbers.map(formatAccount), t.adresNoAccount, 1)}
                    >
                      {newAccountNumbers.length > 0 ? (
                        <div className={`account-list${kontoTypy.length === 0 ? ' account-list--untyped' : ''}`}>
                          <div className="account-list__head">
                            <span>{t.adresAccountNumberColumn}</span>
                            {kontoTypy.length > 0 && <span>{t.accountTypeColumn}</span>}
                            <span aria-hidden="true" />
                          </div>
                          {newAccountNumbers.map((acc, index) => (
                            <div key={acc} className="account-list__row">
                              <span className="account-list__number">{formatAccount(acc)}</span>
                              {kontoTypy.length > 0 && (
                                <Select
                                  overlay
                                  size="sm"
                                  value={newAccountTypes[acc] ?? ''}
                                  onChange={(v) => handleAccountTypeChange(acc, Number(v))}
                                  options={kontoTypy.map((typ) => ({
                                    value: String(typ.id),
                                    label: `${typ.name} (${typ.bankAccountSymbol})`,
                                  }))}
                                  ariaLabel={t.accountTypeColumn}
                                />
                              )}
                              <button
                                type="button"
                                className="button button-ghost button-icon icon-danger"
                                onClick={() => handleRemoveAccountNumber(index)}
                                aria-label={`${t.remove}: ${formatAccount(acc)}`}
                                data-tip={t.remove}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="form-empty">
                          <Icon name="wallet" size={16} />
                          {t.adresAccountsEmpty}
                        </div>
                      )}
                      <FormField
                        label={t.adresAccountAddLabel}
                        htmlFor="adres-account-new"
                        hint={t.adresAccountHintShort}
                        error={accountNumberError}
                      >
                        <div className="form-inline">
                          <input
                            id="adres-account-new"
                            type="text"
                            className="input-mono"
                            value={newAccountNumber}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              setNewAccountNumber(e.target.value);
                              if (accountNumberError) setAccountNumberError(null);
                            }}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddAccountNumber();
                              }
                            }}
                            placeholder={t.accountNumberPlaceholder}
                            aria-invalid={accountNumberError ? true : undefined}
                          />
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={handleAddAccountNumber}
                            disabled={!newAccountNumber.trim()}
                          >
                            <Icon name="plus" size={14} />{' '}{t.add}
                          </button>
                        </div>
                      </FormField>
                    </FormSection>

                    <FormSection
                      icon="search"
                      title={t.adresSectionMatching}
                      description={t.adresSectionMatchingDesc}
                      collapsible={foldEdit}
                      defaultCollapsed
                      collapsedSummary={
                        [
                          newAlternativeNames.length > 0 && `${t.alternativeNames}: ${foldSummary(newAlternativeNames, '')}`,
                          newSwrkIdentifiers.length > 0 && `${t.swrkIdentifiers}: ${foldSummary(newSwrkIdentifiers, '')}`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || t.adresMatchingCollapsedEmpty
                      }
                    >
                      <FormField
                        label={t.alternativeNames}
                        htmlFor="adres-alt-names"
                        hint={t.adresAltNamesHintShort}
                      >
                        <TagInput
                          id="adres-alt-names"
                          values={newAlternativeNames}
                          onChange={setNewAlternativeNames}
                          placeholder={t.adresAltNamesPlaceholder}
                          addLabel={t.add}
                          removeLabel={t.remove}
                        />
                      </FormField>
                      <FormField
                        label={t.swrkIdentifiers}
                        htmlFor="adres-swrk"
                        hint={t.adresSwrkHintShort}
                      >
                        <TagInput
                          id="adres-swrk"
                          values={newSwrkIdentifiers}
                          onChange={setNewSwrkIdentifiers}
                          placeholder={t.swrkPlaceholder}
                          addLabel={t.add}
                          removeLabel={t.remove}
                          monospace
                        />
                      </FormField>
                    </FormSection>

                    <FormSection
                      icon="clipboard"
                      title={t.apartmentMappingsTitle}
                      description={t.adresSectionApartmentsDesc}
                      collapsible
                      defaultCollapsed={foldEdit}
                      persistKey={foldEdit ? undefined : 'adres-reguly-lokali'}
                      collapsedSummary={foldSummary(newMappings.map((m) => m.matchText), t.noApartmentMappings)}
                    >
                      <ApartmentMappingsEditor
                        language={language}
                        mappings={newMappings}
                        onChange={(next) => { setNewMappings(next); return true; }}
                        inForm
                      />
                    </FormSection>

                    <FormSection
                      icon="building"
                      title={t.zgnUnit}
                      description={t.adresSectionZgnDesc}
                      collapsible={foldEdit}
                      defaultCollapsed
                      collapsedSummary={
                        newBezZgn
                          ? t.zgnUnitAbsent
                          : zgnWybrana
                            ? `${zgnWybrana.nazwa} — ${zgnWybrana.email}`
                            : t.zgnUnitNone
                      }
                    >
                      <label className="switch-row">
                        <span className="switch-row__text">
                          <span className="switch-row__label">{t.adresBezZgn}</span>
                          <span className="switch-row__hint">{t.adresBezZgnHint}</span>
                        </span>
                        <span className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={newBezZgn}
                            onChange={(e) => {
                              setNewBezZgn(e.target.checked);
                              if (e.target.checked) setNewZgnJednostkaId(null);
                            }}
                          />
                          <span className="toggle-slider"></span>
                        </span>
                      </label>
                      {!newBezZgn && (
                        <FormField label={t.zgnUnit}>
                          <div className="form-inline">
                            <Select
                              overlay
                              value={newZgnJednostkaId ?? ''}
                              onChange={(v) => setNewZgnJednostkaId(v ? Number(v) : null)}
                              options={[
                                { value: '', label: t.zgnUnitNone },
                                ...zgnJednostki.map((j) => ({
                                  value: String(j.id),
                                  label: `${j.nazwa} — ${j.email}`,
                                })),
                              ]}
                              ariaLabel={t.zgnUnit}
                              style={{ flex: 1, minWidth: 0 }}
                            />
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => setShowZgnUnitsModal(true)}
                              data-tip={t.zgnUnitsTitle}
                            >
                              <Icon name="settings" size={14} />{' '}{t.zgnManageUnits}
                            </button>
                          </div>
                        </FormField>
                      )}
                    </FormSection>

                    <FormSection
                      icon="users"
                      title={t.zarzadTitle}
                      description={t.adresSectionZarzadDesc}
                      collapsible={foldEdit}
                      defaultCollapsed
                      collapsedSummary={foldSummary(newZarzad.map((m) => m.imieNazwisko), t.zarzadEmpty, 3)}
                    >
                      <ZarzadEditor
                        language={language}
                        adresNazwa={newNazwa.trim() || t.addNewAdres}
                        members={newZarzad}
                        onChange={(next) => { setNewZarzad(next); return true; }}
                        inForm
                      />
                    </FormSection>

                    <PowierzchnieSection
                      key={editingAdres?.id ?? 'new'}
                      t={t}
                      value={newPowierzchnie}
                      onChange={setNewPowierzchnie}
                      editing={foldEdit}
                    />

                    <IdentyfikacjaSection
                      t={t}
                      nazwa={newNazwa}
                      value={newIdentyfikacja}
                      onChange={setNewIdentyfikacja}
                      editing={foldEdit}
                    />
                  </div>
                  <ModalFooter
                    note={<RequiredNote label={t.formRequiredNote} />}
                    onCancel={handleCancelEdit}
                    cancelLabel={t.cancel}
                    onSubmit={editingAdres ? handleUpdateAdres : handleAddAdres}
                    submitLabel={editingAdres ? t.save : t.addAdres}
                    submitIcon={editingAdres ? 'save' : 'plus'}
                  />
                </div>
              </div>,
              document.body,
            )}

            {adresy.length > 0 ? (
              <>
                <div className="list-filter">
                  <div className="input-icon">
                    <Icon name="search" size={15} />
                    <input
                      type="text"
                      placeholder={t.searchAdresy}
                      value={searchTerm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                      aria-label={t.searchAdresy}
                    />
                  </div>
                  <span className="list-filter__count">
                    {t.totalAdresy}: <strong>{filteredAdresy.length}</strong> / {adresy.length}
                  </span>
                </div>
                <div className="zad-filterbar">
                  <div className="zad-fgroup">
                    <span className="zad-fgroup__label">
                      <Icon name="alert-triangle" size={13} /> {t.adresMissingFilter}
                    </span>
                    <div className="zad-seg" role="group" aria-label={t.adresMissingFilter}>
                      {brakOption('all', t.adresMissingFilterAll)}
                      {brakOption('any', t.adresMissingFilterAny, brakCounts.any)}
                      {BRAKI.map((b) => brakOption(b, brakLabels[b], brakCounts.per[b]))}
                    </div>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.nazwa}</th>
                      <th>{t.adresBank}</th>
                      <th>{t.adresAccountsColumn}</th>
                      <th>{t.adresSwrkColumn}</th>
                      <th>{t.zgnUnit}</th>
                      <th>{t.zarzadTitle}</th>
                      <th>{t.apartmentMappings}</th>
                      <th className="data-table__actions">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdresy.map((adres) => (
                      <AdresRow
                        key={adres.id}
                        adres={adres}
                        bank={adres.bankId ? banksById.get(adres.bankId) : undefined}
                        jednostka={adres.zgnJednostkaId != null ? zgnById.get(adres.zgnJednostkaId) : undefined}
                        kontoTypyById={kontoTypyById}
                        missingOf={missingOf}
                        language={language}
                        onEdit={onEditRow}
                        onDelete={onDeleteRow}
                        onZarzad={setZarzadAdresId}
                        onMappings={setMappingsAdresId}
                      />
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="form-empty">
                <Icon name="map-pin" size={16} />
                {t.noAdresyConfigured}
              </div>
            )}
          </FormSection>
        )}

        {tab === 'typy' && (
          <AccountTypesPanel language={language} kontoTypy={kontoTypy} onSaved={loadData} />
        )}

        {tab === 'zgn' && (
          <FormSection icon="building" title={t.zgnUnitsTitle}>
            <ZgnUnitsPanel
              language={language}
              jednostki={zgnJednostki}
              adresy={adresy}
              onSaved={loadData}
            />
          </FormSection>
        )}

        {zarzadAdres && (
          <ZarzadModal
            adres={zarzadAdres}
            language={language}
            onClose={() => setZarzadAdresId(null)}
            onSaved={loadData}
          />
        )}

        {mappingsAdres && (
          <ApartmentMappingsModal
            adres={mappingsAdres}
            language={language}
            onClose={() => setMappingsAdresId(null)}
            onSaved={loadData}
          />
        )}

        {showZgnUnitsModal && (
          <ZgnUnitsModal
            language={language}
            jednostki={zgnJednostki}
            adresy={adresy}
            onClose={() => setShowZgnUnitsModal(false)}
            onSaved={loadData}
          />
        )}

      </div>
    </>
  );
};

export default Adresy;
