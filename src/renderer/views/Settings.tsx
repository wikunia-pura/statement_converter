import React, { useState, useEffect } from 'react';
import { Converter, ContractorSortOrder, BackupCounts, MailingSmtpStatus } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Icon from '../components/Icon';
import Select from '../components/Select';
import Loader from '../components/Loader';

interface SettingsProps {
  darkMode: boolean;
  language: Language;
  onDarkModeChange: (enabled: boolean) => void;
  onLanguageChange: (language: Language) => void;
}

const Settings: React.FC<SettingsProps> = ({ darkMode, language, onDarkModeChange, onLanguageChange }) => {
  const t = translations[language];
  const notify = useNotify();
  const [converters, setConverters] = useState<Converter[]>([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [impexFolder, setImpexFolder] = useState('');
  const [swrkFolder, setSwrkFolder] = useState('');
  const [skipUserApproval, setSkipUserApproval] = useState(false);
  const [alwaysUseAI, setAlwaysUseAI] = useState(true);
  const [contractorSortOrder, setContractorSortOrder] = useState<ContractorSortOrder>('name-asc');
  const [isLoading, setIsLoading] = useState(true);
  const [backupStatus, setBackupStatus] = useState<{
    folder: string;
    lastAutoBackup: string | null;
    autoBackupCount: number;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  // SMTP of the mailbox the Mailing module sends from. The stored password never
  // reaches the renderer, so `passwordSet` stands in for it and the input below
  // stays empty unless the user is deliberately changing it.
  const [smtp, setSmtp] = useState<MailingSmtpStatus>({
    host: 'poczta.home.pl',
    port: 465,
    secure: true,
    user: '',
    fromName: '',
    bccSelf: false,
    passwordSet: false,
  });
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpBusy, setSmtpBusy] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [convertersData, settings, backupInfo, smtpStatus] = await Promise.all([
        window.electronAPI.getConverters(),
        window.electronAPI.getSettings(),
        window.electronAPI.backupGetStatus(),
        window.electronAPI.mailingGetSmtp(),
      ]);
      setConverters(convertersData);
      setBackupStatus(backupInfo);
      setSmtp(smtpStatus);
      setSmtpPassword('');
      setOutputFolder(settings.outputFolder);
      setImpexFolder(settings.impexFolder || '');
      setSwrkFolder(settings.swrkFolder || '');
      setSkipUserApproval(settings.skipUserApproval ?? false);
      setAlwaysUseAI(settings.alwaysUseAI !== false);
      setContractorSortOrder(settings.contractorSortOrder ?? 'name-asc');
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectOutputFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setOutputFolder(folder);
      setOutputFolder(folder);
    }
  };

  const handleSelectImpexFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setImpexFolder(folder);
      setImpexFolder(folder);
    }
  };

  const handleSelectSwrkFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setSwrkFolder(folder);
      setSwrkFolder(folder);
    }
  };

  const handleDarkModeToggle = async () => {
    const newValue = !darkMode;
    await window.electronAPI.setDarkMode(newValue);
    onDarkModeChange(newValue);
  };

  const handleSkipUserApprovalToggle = async () => {
    const newValue = !skipUserApproval;
    
    // If enabling, show warning dialogs
    if (newValue) {
      // First warning
      const firstConfirm = await notify.confirm(
        `${t.skipApprovalWarningTitle}\n\n${t.skipApprovalWarningMessage}\n\nKliknij OK aby kontynuować lub Anuluj aby wrócić.`
      );
      
      if (!firstConfirm) {
        return; // User cancelled
      }
      
      // Second confirmation
      const secondConfirm = await notify.confirm(
        `${t.skipApprovalConfirmTitle}\n\n${t.skipApprovalConfirmMessage}`
      );
      
      if (!secondConfirm) {
        return; // User cancelled again
      }
    }
    
    await window.electronAPI.setSkipUserApproval(newValue);
    setSkipUserApproval(newValue);
  };

  const handleAlwaysUseAIToggle = async () => {
    const newValue = !alwaysUseAI;
    await window.electronAPI.setAlwaysUseAI(newValue);
    setAlwaysUseAI(newValue);
  };

  const handleLanguageChange = async (value: string) => {
    const newLanguage = value as Language;
    await window.electronAPI.setLanguage(newLanguage);
    onLanguageChange(newLanguage);
  };

  const handleContractorSortOrderChange = async (value: string) => {
    const newOrder = value as ContractorSortOrder;
    await window.electronAPI.setContractorSortOrder(newOrder);
    setContractorSortOrder(newOrder);
  };

  const handleExportSettings = async () => {
    try {
      const result = await window.electronAPI.exportSettings();
      if (result.success) {
        notify.success(t.exportSuccess);
      }
    } catch (error) {
      notify.error(t.exportError);
    }
  };

  const handleImportSettings = async () => {
    if (await notify.confirm(t.importConfirm)) {
      try {
        const result = await window.electronAPI.importSettings();
        if (result.success) {
          notify.success(t.importSuccess);
          
          // Reload all data and settings
          await loadData();
          
          // Explicitly sync settings with parent component
          const settings = await window.electronAPI.getSettings();
          
          // Sync darkMode
          if (settings.darkMode !== darkMode) {
            onDarkModeChange(settings.darkMode);
          }
          
          // Sync language
          if (settings.language !== language) {
            onLanguageChange(settings.language);
          }
          
          // Explicitly update outputFolder in local state
          setOutputFolder(settings.outputFolder || '');
          setImpexFolder(settings.impexFolder || '');
          setSwrkFolder(settings.swrkFolder || '');
          setSkipUserApproval(settings.skipUserApproval ?? false);
          setAlwaysUseAI(settings.alwaysUseAI !== false);
          setContractorSortOrder(settings.contractorSortOrder ?? 'name-asc');
        } else if (result.error) {
          notify.error(`${t.importError}: ${result.error}`);
        }
      } catch (error) {
        notify.error(t.importError);
      }
    }
  };

  const persistSmtp = async () => {
    await window.electronAPI.mailingSetSmtp({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      fromName: smtp.fromName,
      bccSelf: smtp.bccSelf,
      // `pass` is omitted when the field is untouched, so saving other changes
      // cannot wipe a password the renderer was never shown.
      ...(smtpPassword ? { pass: smtpPassword } : {}),
    });
    setSmtp((prev) => ({ ...prev, passwordSet: prev.passwordSet || smtpPassword.length > 0 }));
    setSmtpPassword('');
  };

  const handleSaveSmtp = async () => {
    setSmtpBusy(true);
    try {
      await persistSmtp();
      notify.success(t.smtpSaved);
    } catch (error: unknown) {
      notify.error(error instanceof Error ? error.message : t.smtpSaveError);
    } finally {
      setSmtpBusy(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpBusy(true);
    try {
      // Save first: the test runs against the stored config, so what gets
      // verified is exactly what a real send will use.
      await persistSmtp();
      const result = await window.electronAPI.mailingTestSmtp();
      if (result.ok) notify.success(t.smtpTestOk);
      else notify.error(`${t.smtpTestFailed}: ${result.error}`);
    } catch (error: unknown) {
      notify.error(error instanceof Error ? error.message : t.smtpTestFailed);
    } finally {
      setSmtpBusy(false);
    }
  };

  const formatBackupCounts = (counts?: BackupCounts): string => {
    if (!counts) return '';
    return t.backupCounts
      .replace('{banks}', String(counts.banks))
      .replace('{kontrahenci}', String(counts.kontrahenci))
      .replace('{adresy}', String(counts.adresy))
      .replace('{kontoTypy}', String(counts.kontoTypy))
      .replace('{history}', String(counts.history))
      .replace('{odczytyHistory}', String(counts.odczytyHistory))
      .replace('{zgnJednostki}', String(counts.zgnJednostki))
      .replace('{mailingPola}', String(counts.mailingPola))
      .replace('{mailingSzablony}', String(counts.mailingSzablony))
      .replace('{mailingHistory}', String(counts.mailingHistory));
  };

  const handleCreateBackup = async () => {
    setBackupBusy(true);
    try {
      const result = await window.electronAPI.backupExport();
      if (result.success) {
        notify.success(`${t.backupCreated} (${formatBackupCounts(result.counts)})`);
      } else if (result.error) {
        notify.error(`${t.backupError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.backupError);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!(await notify.confirm(t.backupRestoreConfirm1))) return;
    if (!(await notify.confirm(t.backupRestoreConfirm2))) return;
    setBackupBusy(true);
    try {
      const result = await window.electronAPI.backupRestore();
      if (result.success) {
        notify.success(`${t.backupRestored} (${formatBackupCounts(result.counts)})`);
        // Restored settings may change theme/language/folders — re-sync like settings import.
        await loadData();
        const settings = await window.electronAPI.getSettings();
        if (settings.darkMode !== darkMode) onDarkModeChange(settings.darkMode);
        if (settings.language !== language) onLanguageChange(settings.language);
      } else if (result.error) {
        notify.error(`${t.backupError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.backupError);
    } finally {
      setBackupBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
        {/* Updates */}
        <div className="card">
          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="refresh" size={20} /> {t.checkForUpdates}
          </h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '20px' }}>
            Sprawdź czy dostępna jest nowa wersja aplikacji.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button 
              className="button button-primary" 
              onClick={async () => {
                const result = await window.electronAPI.checkForUpdates();
                if (result.message) {
                  notify.info(result.message);
                } else if (result.error) {
                  notify.error(`Błąd: ${result.error}`);
                } else if (result.available) {
                  notify.info('Dostępna nowa wersja! Pojawi się powiadomienie.');
                } else {
                  notify.info('Nie znaleziono aktualizacji');
                }
              }}
            ><Icon name="refresh" size={14} />{' '}
              Sprawdź aktualizacje
            </button>
            <button 
              className="button button-secondary" 
              onClick={async () => {
                const result = await window.electronAPI.openLogsFolder();
                if (result.success && result.logPath) {
                  console.log('Log file:', result.logPath);
                }
              }}
              title="Otwórz folder z logami aplikacji - pomaga w diagnozowaniu problemów z aktualizacjami"
            >
              <Icon name="clipboard" size={14} /> Pokaż logi
            </button>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="info" size={12} /> Jeśli aktualizacja nie działa, sprawdź logi aby zobaczyć szczegóły błędu.
          </p>
        </div>

        {/* Appearance Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>{t.appearance}</h2>
          
          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">{t.darkMode}</span>
              <span className="settings-label-sub">
                {darkMode ? 'Ciemny motyw jest włączony' : 'Jasny motyw jest włączony'}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={darkMode}
                onChange={handleDarkModeToggle}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">{t.language}</span>
              <span className="settings-label-sub">Wybierz preferowany język</span>
            </div>
            <Select
              value={language}
              onChange={handleLanguageChange}
              options={[
                { value: 'pl', label: t.polish },
                { value: 'en', label: t.english },
              ]}
              style={{ width: 'auto', minWidth: '150px' }}
            />
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">{t.contractorSortOrder}</span>
              <span className="settings-label-sub">{t.contractorSortOrderDesc}</span>
            </div>
            <Select
              value={contractorSortOrder}
              onChange={handleContractorSortOrderChange}
              options={[
                { value: 'name-asc', label: t.sortNameAsc },
                { value: 'name-desc', label: t.sortNameDesc },
                { value: 'account-asc', label: t.sortAccountAsc },
                { value: 'account-desc', label: t.sortAccountDesc },
              ]}
              style={{ width: 'auto', minWidth: '180px' }}
            />
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="bot" size={14} /> {t.alwaysUseAI}
              </span>
              <span className="settings-label-sub">{t.alwaysUseAIDesc}</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={alwaysUseAI}
                onChange={handleAlwaysUseAIToggle}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        {/* Output Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>{t.outputFolder}</h2>
          <div className="form-group">
            <label>{t.convertedFilesSaved}</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input type="text" value={outputFolder} readOnly />
              <button className="button button-primary" onClick={handleSelectOutputFolder}>
                <Icon name="folder" size={14} />{' '}{t.change}
              </button>
            </div>
          </div>
        </div>

        {/* IMPEX Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="folder" size={20} /> Folder IMPEX
          </h2>
          <div className="form-group">
            <label>
              Opcjonalna ścieżka dla dodatkowej kopii plików accounting
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                Jeśli ustawiona, każdy plik accounting będzie dodatkowo zapisany w tym folderze
              </span>
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input 
                type="text" 
                value={impexFolder} 
                readOnly 
                placeholder="Nie ustawiono (opcjonalnie)"
              />
              <button className="button button-primary" onClick={handleSelectImpexFolder}>
                <Icon name="folder" size={14} />{' '}{t.change}
              </button>
              {impexFolder && (
                <button
                  className="button button-secondary"
                  onClick={async () => {
                    await window.electronAPI.setImpexFolder('');
                    setImpexFolder('');
                  }}
                  title="Wyczyść ścieżkę IMPEX"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SWRK Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="folder" size={20} /> {t.swrkFolderTitle}
          </h2>
          <div className="form-group">
            <label>
              {t.swrkFolderLabel}
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                {t.swrkFolderHint}
              </span>
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                value={swrkFolder}
                readOnly
                placeholder={t.swrkFolderPlaceholder}
              />
              <button className="button button-primary" onClick={handleSelectSwrkFolder}>
                <Icon name="folder" size={14} />{' '}{t.change}
              </button>
              {swrkFolder && (
                <button
                  className="button button-secondary"
                  onClick={async () => {
                    await window.electronAPI.setSwrkFolder('');
                    setSwrkFolder('');
                  }}
                  title={t.swrkFolderClearTooltip}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mailing — SMTP of the mailbox we send from (machine-local) */}
        <div className="card">
          <h2 style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="mail" size={20} /> {t.smtpTitle}
          </h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '18px', maxWidth: '80ch' }}>
            {t.smtpHint}
          </p>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 260px' }}>
              <label>{t.smtpHost}</label>
              <input
                type="text"
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                placeholder="poczta.home.pl"
              />
            </div>
            <div className="form-group" style={{ flex: '0 1 120px' }}>
              <label>{t.smtpPort}</label>
              <input
                type="number"
                value={smtp.port}
                onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div>
              <div style={{ fontSize: '13px' }}>{t.smtpSecure}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t.smtpSecureHint}</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={smtp.secure}
                onChange={(e) =>
                  // Port and TLS mode go together on home.pl; move the port with
                  // the switch so the pair can't end up mismatched by accident.
                  setSmtp({
                    ...smtp,
                    secure: e.target.checked,
                    port: e.target.checked ? 465 : 587,
                  })
                }
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="form-group">
            <label>{t.smtpUser}</label>
            <input
              type="email"
              value={smtp.user}
              onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
              placeholder="np. biuro@twojafirma.pl"
            />
          </div>

          <div className="form-group">
            <label>{t.smtpPassword}</label>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
              {smtp.passwordSet ? t.smtpPasswordStored : t.smtpPasswordHint}
            </div>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={smtp.passwordSet ? t.smtpPasswordPlaceholderStored : t.smtpPasswordPlaceholder}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label>{t.smtpFromName}</label>
            <input
              type="text"
              value={smtp.fromName}
              onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
              placeholder={t.smtpFromNamePlaceholder}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '18px',
            }}
          >
            <div>
              <div style={{ fontSize: '13px' }}>{t.smtpBccSelf}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t.smtpBccSelfHint}</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={smtp.bccSelf}
                onChange={(e) => setSmtp({ ...smtp, bccSelf: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="button-group" style={{ marginTop: 0 }}>
            <button className="button button-success" onClick={handleSaveSmtp} disabled={smtpBusy}>
              <Icon name="save" size={14} /> {t.save}
            </button>
            <button className="button button-secondary" onClick={handleTestSmtp} disabled={smtpBusy}>
              <Icon name="refresh" size={14} /> {t.smtpTest}
            </button>
          </div>
        </div>

        {/* Available Converters Info */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>{t.availableConverters}</h2>
          <table>
            <thead>
              <tr>
                <th>{t.converterName}</th>
                <th>{t.description}</th>
              </tr>
            </thead>
            <tbody>
              {converters.filter(c => c && c.id).map((converter) => (
                <tr key={converter.id}>
                  <td>{converter.name || converter.id}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{converter.description || 'No description'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Export/Import Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>📦 Zarządzanie ustawieniami</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '20px' }}>
            Eksportuj lub importuj swoje ustawienia, w tym listę banków i preferencje aplikacji.
          </p>
          <div className="button-group" style={{ marginTop: 0 }}>
            <button className="button button-export" onClick={handleExportSettings}>
              <Icon name="download" size={14} /> Eksportuj ustawienia
            </button>
            <button className="button button-import" onClick={handleImportSettings}>
              <Icon name="upload" size={14} /> Importuj ustawienia
            </button>
          </div>
        </div>

        {/* Backup */}
        <div className="card">
          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="shield" size={20} /> {t.backupTitle}
          </h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '10px' }}>
            {t.backupDesc}
          </p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="info" size={12} /> {t.backupAutoInfo}{' '}
            {t.backupLastAuto}: <strong>{backupStatus?.lastAutoBackup ?? t.backupNever}</strong>
          </p>
          <div className="button-group" style={{ marginTop: 0 }}>
            <button className="button button-export" onClick={handleCreateBackup} disabled={backupBusy}>
              <Icon name="download" size={14} /> {t.backupCreate}
            </button>
            <button className="button button-import" onClick={handleRestoreBackup} disabled={backupBusy}>
              <Icon name="upload" size={14} /> {t.backupRestore}
            </button>
            <button
              className="button button-secondary"
              onClick={() => window.electronAPI.backupOpenFolder()}
              disabled={backupBusy}
            >
              <Icon name="folder" size={14} /> {t.backupOpenFolder}
            </button>
          </div>
        </div>

        {/* Developer-only section - Skip Approval */}
        <div className="card" style={{ borderColor: 'var(--danger)', backgroundColor: 'rgba(220, 53, 69, 0.05)' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="alert-triangle" size={20} /> {t.doNotUseSkipApproval}
          </h2>
          <p style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '15px', fontWeight: 'bold' }}>
            {t.skipApprovalWarningMessage}
          </p>
          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main" style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="alert-circle" size={14} /> {t.skipUserApproval}
              </span>
              <span className="settings-label-sub" style={{ color: 'var(--text-tertiary)' }}>
                {t.skipUserApprovalDesc}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={skipUserApproval}
                onChange={handleSkipUserApprovalToggle}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
    </div>
  );
};

export default Settings;
