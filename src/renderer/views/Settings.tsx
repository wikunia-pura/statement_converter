import React, { useState, useEffect } from 'react';
import { Converter, ContractorSortOrder, BackupCounts, MailingSmtpStatus, SpotkanieMaterialyKrok } from '../../shared/types';
import {
  NOTIFICATION_DEFS,
  NOTIFICATION_GROUPS,
  NotificationId,
  NotificationPrefs,
  isNotificationEnabled,
} from '../../shared/notifications';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Icon from '../components/Icon';
import Select from '../components/Select';
import Loader from '../components/Loader';
import UsersCard from '../components/UsersCard';
import { FormField, FormRow, FormSection } from '../components/FormSection';
import { PodpisKartaUstawienia } from '../components/PodpisKarta';

interface SettingsProps {
  darkMode: boolean;
  language: Language;
  onDarkModeChange: (enabled: boolean) => void;
  onLanguageChange: (language: Language) => void;
  /** Mailbox of the signed-in user, so the user list can mark their own row. */
  userEmail?: string;
  /** Fired when someone's name changes, so the greeting updates immediately. */
  onUserNamesChanged?: () => void;
  /** Opens the dialog that arranges the sidebar menu (it lives in App, which owns the menu). */
  onOpenSidebarOrder?: () => void;
  /** The Pulpit's filter tiles, in the same order dialog. */
  onOpenTileOrder?: () => void;
  /** Fired after settings came back from a file or a backup, so App re-reads what it keeps (menu order). */
  onSettingsRestored?: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  darkMode,
  language,
  onDarkModeChange,
  onLanguageChange,
  userEmail,
  onUserNamesChanged,
  onOpenSidebarOrder,
  onOpenTileOrder,
  onSettingsRestored,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [converters, setConverters] = useState<Converter[]>([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [impexFolder, setImpexFolder] = useState('');
  const [podatkiFolder, setPodatkiFolder] = useState('');
  const [swrkFolder, setSwrkFolder] = useState('');
  const [statementsFolder, setStatementsFolder] = useState('');
  const [skipUserApproval, setSkipUserApproval] = useState(false);
  const [alwaysUseAI, setAlwaysUseAI] = useState(true);
  const [calendarHoverCard, setCalendarHoverCard] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>({});
  const [contractorSortOrder, setContractorSortOrder] = useState<ContractorSortOrder>('name-asc');
  const [isLoading, setIsLoading] = useState(true);
  const [backupStatus, setBackupStatus] = useState<{
    folder: string;
    lastAutoBackup: string | null;
    autoBackupCount: number;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  /** Percent of the installer download under way; null when none is running. */
  const [installerProgress, setInstallerProgress] = useState<number | null>(null);
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
      const [convertersData, settings, backupInfo, smtpStatus, notificationData] = await Promise.all([
        window.electronAPI.getConverters(),
        window.electronAPI.getSettings(),
        window.electronAPI.backupGetStatus(),
        window.electronAPI.mailingGetSmtp(),
        // A failed read must not blank the whole page: the defaults show instead.
        window.electronAPI.getNotificationPrefs().catch((): NotificationPrefs => ({})),
      ]);
      setConverters(convertersData);
      setBackupStatus(backupInfo);
      setSmtp(smtpStatus);
      setSmtpPassword('');
      setOutputFolder(settings.outputFolder);
      setImpexFolder(settings.impexFolder || '');
      setPodatkiFolder(settings.podatkiFolder || '');
      setSwrkFolder(settings.swrkFolder || '');
      setStatementsFolder(settings.statementsFolder || '');
      setSkipUserApproval(settings.skipUserApproval ?? false);
      setAlwaysUseAI(settings.alwaysUseAI !== false);
      setCalendarHoverCard(settings.calendarHoverCard ?? false);
      setNotificationPrefs(notificationData);
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

  const handleSelectPodatkiFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setPodatkiFolder(folder);
      setPodatkiFolder(folder);
    }
  };

  const handleSelectStatementsFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setStatementsFolder(folder);
      setStatementsFolder(folder);
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

  // Typed over every id, so a notification added to the list without its wording
  // here is a compile error rather than a blank row.
  const notificationText: Record<NotificationId, [string, string]> = {
    zadanieAssigned: [t.notifZadanieAssigned, t.notifZadanieAssignedDesc],
    zadanieChanged: [t.notifZadanieChanged, t.notifZadanieChangedDesc],
    zadanieOverdue: [t.notifZadanieOverdue, t.notifZadanieOverdueDesc],
    zadanieMention: [t.notifZadanieMention, t.notifZadanieMentionDesc],
    zadanieComment: [t.notifZadanieComment, t.notifZadanieCommentDesc],
    ksiegowaniaPriorytet: [t.notifKsiegowaniaPriorytet, t.notifKsiegowaniaPriorytetDesc],
    ksiegowaniaPriorytetNotatka: [
      t.notifKsiegowaniaPriorytetNotatka,
      t.notifKsiegowaniaPriorytetNotatkaDesc,
    ],
    ksiegowaniaUwaga: [t.notifKsiegowaniaUwaga, t.notifKsiegowaniaUwagaDesc],
    spotkanieMaterialyDoPrzygotowania: [
      t.notifSpotkanieMaterialyDo,
      t.notifSpotkanieMaterialyDoDesc,
    ],
    spotkanieMaterialyPrzygotowane: [
      t.notifSpotkanieMaterialyPrzygotowane,
      t.notifSpotkanieMaterialyPrzygotowaneDesc,
    ],
    spotkanieMaterialyWyslane: [
      t.notifSpotkanieMaterialyWyslane,
      t.notifSpotkanieMaterialyWyslaneDesc,
    ],
  };

  /** Which materials step each Kalendarz switch is about — for its test button. */
  const materialyTestKrok: Partial<Record<NotificationId, SpotkanieMaterialyKrok>> = {
    spotkanieMaterialyDoPrzygotowania: 'do_przygotowania',
    spotkanieMaterialyPrzygotowane: 'przygotowane',
    spotkanieMaterialyWyslane: 'wyslane',
  };

  const handleSendTestMaterialy = async (krok: SpotkanieMaterialyKrok) => {
    try {
      const result = await window.electronAPI.sendTestMaterialyNotification(krok);
      if (!result.shown) notify.error(t.notifTestFailed);
    } catch {
      notify.error(t.notifTestFailed);
    }
  };

  const handleNotificationToggle = async (id: NotificationId) => {
    const next = !isNotificationEnabled(notificationPrefs, id);
    // Optimistic: the switch moves at once, and goes back if the write is refused.
    setNotificationPrefs((prev) => ({ ...prev, [id]: next }));
    let saved = false;
    try {
      saved = await window.electronAPI.setNotificationPref(id, next);
    } catch {
      saved = false;
    }
    if (!saved) {
      setNotificationPrefs((prev) => ({ ...prev, [id]: !next }));
      notify.error(t.notifSaveError);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      const result = await window.electronAPI.sendTestNotification();
      if (!result.shown) notify.error(t.notifTestFailed);
    } catch {
      notify.error(t.notifTestFailed);
    }
  };

  const handleCalendarHoverCardToggle = async () => {
    const newValue = !calendarHoverCard;
    await window.electronAPI.setCalendarHoverCard(newValue);
    setCalendarHoverCard(newValue);
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
        notify.success(t.exportSuccess, { file: result.filePath });
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
          setPodatkiFolder(settings.podatkiFolder || '');
          setSwrkFolder(settings.swrkFolder || '');
          setStatementsFolder(settings.statementsFolder || '');
          setSkipUserApproval(settings.skipUserApproval ?? false);
          setAlwaysUseAI(settings.alwaysUseAI !== false);
          setCalendarHoverCard(settings.calendarHoverCard ?? false);
          setContractorSortOrder(settings.contractorSortOrder ?? 'name-asc');
          onSettingsRestored?.();
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
      .replace('{zgnPelnomocnicy}', String(counts.zgnPelnomocnicy))
      .replace('{mailingPola}', String(counts.mailingPola))
      .replace('{mailingSzablony}', String(counts.mailingSzablony))
      .replace('{mailingHistory}', String(counts.mailingHistory))
      .replace('{spotkaniaTypy}', String(counts.spotkaniaTypy))
      .replace('{spotkania}', String(counts.spotkania))
      .replace('{spotkaniaLokalizacje}', String(counts.spotkaniaLokalizacje))
      .replace('{zadania}', String(counts.zadania))
      .replace('{zadaniaKomentarze}', String(counts.zadaniaKomentarze))
      .replace('{zadaniaNotatki}', String(counts.zadaniaNotatki))
      .replace('{notificationPrefs}', String(counts.notificationPrefs))
      .replace('{appUserNames}', String(counts.appUserNames))
      .replace('{ksiegowaniaPriorytety}', String(counts.ksiegowaniaPriorytety))
      .replace('{ksiegowaniaUwagi}', String(counts.ksiegowaniaUwagi))
      .replace('{ksiegowaniaPrzypisania}', String(counts.ksiegowaniaPrzypisania))
      .replace('{ksiegowaniaPliki}', String(counts.ksiegowaniaPliki))
      .replace('{ksiegowaniaKonwersje}', String(counts.ksiegowaniaKonwersje))
      .replace('{mailingTypy}', String(counts.mailingTypy))
      .replace('{zebrania}', String(counts.zebrania))
      .replace('{zebraniaWersje}', String(counts.zebraniaWersje))
      .replace('{zebraniaSprawozdania}', String(counts.zebraniaSprawozdania))
      .replace('{zebraniaWspolnoty}', String(counts.zebraniaWspolnoty))
      .replace('{zebraniaUstawienia}', String(counts.zebraniaUstawienia))
      .replace('{planyGospodarcze}', String(counts.planyGospodarcze))
      .replace('{podatkiNieruchomosci}', String(counts.podatkiNieruchomosci))
      .replace('{podatkiStawki}', String(counts.podatkiStawki));
  };

  const handleDownloadInstaller = async () => {
    setInstallerProgress(0);
    // Subscribed inside the try: anything thrown here must still reach the
    // finally, or the button stays stuck on "0%".
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.electronAPI.onInstallerDownloadProgress(setInstallerProgress);
      const result = await window.electronAPI.downloadInstaller();
      if (result.success) {
        const message = result.alreadyDownloaded ? t.setInstallerAlready : t.setInstallerSaved;
        notify.success(message.replace('{version}', result.version), { file: result.filePath });
      } else if (result.unsupported) {
        notify.warning(t.setInstallerUnsupported);
      } else {
        notify.error(`${t.setInstallerError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(`${t.setInstallerError}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      unsubscribe?.();
      setInstallerProgress(null);
    }
  };

  const handleCreateBackup = async () => {
    setBackupBusy(true);
    try {
      const result = await window.electronAPI.backupExport();
      if (result.success) {
        notify.success(`${t.backupCreated} (${formatBackupCounts(result.counts)})`, {
          file: result.filePath,
        });
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
        onSettingsRestored?.();
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

  /** A folder setting: read-only path, "Zmień", and — when optional — clear. */
  const folderField = (
    label: string,
    hint: string | undefined,
    value: string,
    placeholder: string | undefined,
    onChange: () => void,
    onClear?: () => void,
    clearTitle?: string,
  ) => (
    <FormField label={label} hint={hint}>
      <div className="form-inline">
        <div className="input-icon">
          <Icon name="folder" size={15} />
          <input type="text" value={value} readOnly placeholder={placeholder} aria-label={label} />
        </div>
        <button type="button" className="button button-secondary" onClick={onChange}>
          {t.change}
        </button>
        {onClear && value && (
          <button
            type="button"
            className="button button-ghost button-icon icon-danger"
            onClick={onClear}
            title={clearTitle}
            aria-label={clearTitle}
          >
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
    </FormField>
  );

  return (
    <div className="content-body">
      <div className="page-form">
        <FormSection icon="settings" title={t.setSectionLook} description={t.setSectionLookDesc}>
          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main">{t.darkMode}</span>
                <span className="settings-label-sub">{darkMode ? t.setDarkOn : t.setDarkOff}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={darkMode} onChange={handleDarkModeToggle} aria-label={t.darkMode} />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main">{t.language}</span>
                <span className="settings-label-sub">{t.setLanguageDesc}</span>
              </div>
              <Select
                value={language}
                onChange={handleLanguageChange}
                options={[
                  { value: 'pl', label: t.polish },
                  { value: 'en', label: t.english },
                ]}
                ariaLabel={t.language}
                className="settings-control"
              />
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main settings-label-main--icon">
                  <Icon name="menu" size={14} /> {t.sidebarOrderLabel}
                </span>
                <span className="settings-label-sub">{t.sidebarOrderHint}</span>
              </div>
              <button type="button" className="button button-secondary" onClick={() => onOpenSidebarOrder?.()}>
                {t.sidebarOrderOpen}
              </button>
            </div>

            {onOpenTileOrder && (
              <div className="settings-row">
                <div className="settings-label">
                  <span className="settings-label-main settings-label-main--icon">
                    <Icon name="grip" size={14} /> {t.ksTileOrderTitle}
                  </span>
                  <span className="settings-label-sub">{t.ksTileOrderSettingsHint}</span>
                </div>
                <button type="button" className="button button-secondary" onClick={onOpenTileOrder}>
                  {t.ksTileOrderButton}
                </button>
              </div>
            )}

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
                ariaLabel={t.contractorSortOrder}
                className="settings-control settings-control--wide"
              />
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main settings-label-main--icon">
                  <Icon name="bot" size={14} /> {t.alwaysUseAI}
                </span>
                <span className="settings-label-sub">{t.alwaysUseAIDesc}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={alwaysUseAI} onChange={handleAlwaysUseAIToggle} aria-label={t.alwaysUseAI} />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main settings-label-main--icon">
                  <Icon name="calendar" size={14} /> {t.calendarHoverCard}
                </span>
                <span className="settings-label-sub">{t.calendarHoverCardDesc}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={calendarHoverCard}
                  onChange={handleCalendarHoverCardToggle}
                  aria-label={t.calendarHoverCard}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </FormSection>

        {/* Notifications: what may interrupt, and which of it can be switched off */}
        <FormSection
          icon="bell"
          title={t.notifTitle}
          description={t.notifIntro}
          aside={
            <button type="button" className="button button-small button-subtle" onClick={() => void handleSendTestNotification()} title={t.notifTestDesc}>
              <Icon name="bell" size={13} /> {t.notifTestButton}
            </button>
          }
        >
          <div className="settings-list">
            {NOTIFICATION_GROUPS.map((group) => (
              <React.Fragment key={group}>
                <div className="notif-group">
                  {group === 'zadania'
                    ? t.notifGroupZadania
                    : group === 'kalendarz'
                      ? t.notifGroupKalendarz
                      : t.notifGroupKsiegowania}
                </div>
                {NOTIFICATION_DEFS.filter((d) => d.group === group).map((def) => {
                  const [label, desc] = notificationText[def.id];
                  return (
                    <div className="settings-row" key={def.id}>
                      <div className="settings-label">
                        <span className="settings-label-main">{label}</span>
                        <span className="settings-label-sub">{desc}</span>
                      </div>
                      <div className="notif-control">
                        {materialyTestKrok[def.id] && (
                          <button
                            type="button"
                            className="button button-small button-subtle"
                            title={t.notifTestMaterialyHint}
                            onClick={() => void handleSendTestMaterialy(materialyTestKrok[def.id]!)}
                          >
                            <Icon name="bell" size={13} /> {t.notifTestButton}
                          </button>
                        )}
                        {def.locked && <span className="form-section__badge is-neutral">{t.notifAlwaysOn}</span>}
                        <label className="toggle-switch" title={def.locked ? t.notifAlwaysOn : undefined}>
                          <input
                            type="checkbox"
                            checked={isNotificationEnabled(notificationPrefs, def.id)}
                            disabled={def.locked}
                            onChange={() => void handleNotificationToggle(def.id)}
                            aria-label={label}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </FormSection>

        <FormSection icon="folder" title={t.setSectionFolders} description={t.setSectionFoldersDesc}>
          {folderField(t.outputFolder, t.convertedFilesSaved, outputFolder, undefined, handleSelectOutputFolder)}
          {folderField(
            t.statementsFolderLabel,
            t.statementsFolderHint,
            statementsFolder,
            t.statementsFolderPlaceholder,
            handleSelectStatementsFolder,
            async () => {
              await window.electronAPI.setStatementsFolder('');
              setStatementsFolder('');
            },
            t.statementsFolderClear,
          )}
          {folderField(
            t.swrkFolderLabel,
            t.swrkFolderHint,
            swrkFolder,
            t.swrkFolderPlaceholder,
            handleSelectSwrkFolder,
            async () => {
              await window.electronAPI.setSwrkFolder('');
              setSwrkFolder('');
            },
            t.swrkFolderClearTooltip,
          )}
          {folderField(
            t.setImpexLabel,
            t.setImpexHint,
            impexFolder,
            t.setNotSet,
            handleSelectImpexFolder,
            async () => {
              await window.electronAPI.setImpexFolder('');
              setImpexFolder('');
            },
            t.setImpexClear,
          )}
          {folderField(
            t.setPodatkiFolderLabel,
            t.setPodatkiFolderHint,
            podatkiFolder,
            t.setPodatkiFolderPlaceholder,
            handleSelectPodatkiFolder,
            async () => {
              await window.electronAPI.setPodatkiFolder('');
              setPodatkiFolder('');
            },
            t.setPodatkiFolderClear,
          )}
        </FormSection>

        {/* Mailing — SMTP of the mailbox we send from (machine-local) */}
        <FormSection icon="mail" title={t.smtpTitle} description={t.smtpHint}>
          <FormRow>
            <FormField label={t.smtpHost} htmlFor="smtp-host">
              <input
                id="smtp-host"
                type="text"
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                placeholder="poczta.home.pl"
              />
            </FormField>
            <FormField label={t.smtpPort} htmlFor="smtp-port">
              <div className="form-inline form-inline--narrow">
                <input
                  id="smtp-port"
                  type="number"
                  value={smtp.port}
                  onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
                />
              </div>
            </FormField>
          </FormRow>
          <label className="switch-row">
            <span className="switch-row__text">
              <span className="switch-row__label">{t.smtpSecure}</span>
              <span className="switch-row__hint">{t.smtpSecureHint}</span>
            </span>
            <span className="toggle-switch">
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
            </span>
          </label>
          <FormRow>
            <FormField label={t.smtpUser} htmlFor="smtp-user">
              <div className="input-icon">
                <Icon name="mail" size={15} />
                <input
                  id="smtp-user"
                  type="email"
                  value={smtp.user}
                  onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                  placeholder="np. biuro@twojafirma.pl"
                />
              </div>
            </FormField>
            <FormField
              label={t.smtpPassword}
              htmlFor="smtp-password"
              hint={smtp.passwordSet ? t.smtpPasswordStored : t.smtpPasswordHint}
            >
              <input
                id="smtp-password"
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder={smtp.passwordSet ? t.smtpPasswordPlaceholderStored : t.smtpPasswordPlaceholder}
                autoComplete="new-password"
              />
            </FormField>
          </FormRow>
          <FormField label={t.smtpFromName} htmlFor="smtp-from">
            <input
              id="smtp-from"
              type="text"
              value={smtp.fromName}
              onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
              placeholder={t.smtpFromNamePlaceholder}
            />
          </FormField>
          <label className="switch-row">
            <span className="switch-row__text">
              <span className="switch-row__label">{t.smtpBccSelf}</span>
              <span className="switch-row__hint">{t.smtpBccSelfHint}</span>
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={smtp.bccSelf}
                onChange={(e) => setSmtp({ ...smtp, bccSelf: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </span>
          </label>
          <div className="section-actions">
            <button type="button" className="button button-secondary" onClick={handleTestSmtp} disabled={smtpBusy}>
              <Icon name="mail" size={14} /> {t.smtpTest}
            </button>
            <button type="button" className="button button-success" onClick={handleSaveSmtp} disabled={smtpBusy}>
              <Icon name={smtpBusy ? 'loader' : 'save'} size={14} className={smtpBusy ? 'icon-spin' : undefined} /> {t.save}
            </button>
          </div>
        </FormSection>

        {/* Podpis kwalifikowany — the card's library on this machine */}
        <PodpisKartaUstawienia language={language} />

        <FormSection
          icon="shield"
          title={t.backupTitle}
          description={t.backupDesc}
          aside={
            <div className="form-section__actions">
              <button type="button" className="button button-small button-subtle" onClick={() => window.electronAPI.backupOpenFolder()} disabled={backupBusy}>
                <Icon name="folder" size={13} /> {t.backupOpenFolder}
              </button>
            </div>
          }
        >
          <div className="callout callout--muted">
            <Icon name="clock" size={16} />
            <div className="callout__body">
              {t.backupAutoInfo} {t.backupLastAuto}: <strong>{backupStatus?.lastAutoBackup ?? t.backupNever}</strong>
            </div>
          </div>
          <div className="section-actions section-actions--start">
            <button type="button" className="button button-export" onClick={handleCreateBackup} disabled={backupBusy}>
              <Icon name="download" size={14} /> {t.backupCreate}
            </button>
            <button type="button" className="button button-import" onClick={handleRestoreBackup} disabled={backupBusy}>
              <Icon name="upload" size={14} /> {t.backupRestore}
            </button>
          </div>
        </FormSection>

        <FormSection icon="settings" title={t.setSectionSettingsIo} description={t.setSectionSettingsIoDesc}>
          <div className="section-actions section-actions--start">
            <button type="button" className="button button-export" onClick={handleExportSettings}>
              <Icon name="download" size={14} /> {t.setExport}
            </button>
            <button type="button" className="button button-import" onClick={handleImportSettings}>
              <Icon name="upload" size={14} /> {t.setImport}
            </button>
          </div>
        </FormSection>

        <FormSection icon="refresh" title={t.setSectionUpdates} description={t.setSectionUpdatesDesc}>
          <div className="section-actions section-actions--start">
            <button
              type="button"
              className="button button-primary"
              onClick={async () => {
                const result = await window.electronAPI.checkForUpdates();
                if (result.message) {
                  notify.info(result.message);
                } else if (result.error) {
                  notify.error(`${t.setUpdateError}: ${result.error}`);
                } else if (result.available) {
                  notify.info(t.setUpdateAvailable);
                } else {
                  notify.info(t.setUpdateNone);
                }
              }}
            >
              <Icon name="refresh" size={14} /> {t.checkForUpdates}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleDownloadInstaller}
              disabled={installerProgress !== null}
              title={t.setDownloadInstallerHint}
            >
              <Icon name="download" size={14} />{' '}
              {installerProgress !== null
                ? t.setInstallerDownloading.replace('{percent}', String(installerProgress))
                : t.setDownloadInstaller}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                const result = await window.electronAPI.openLogsFolder();
                if (result.success && result.logPath) {
                  console.log('Log file:', result.logPath);
                }
              }}
              title={t.setShowLogsHint}
            >
              <Icon name="clipboard" size={14} /> {t.setShowLogs}
            </button>
          </div>
          <div className="form-field__hint">{t.setUpdatesHint}</div>
        </FormSection>

        <FormSection icon="zap" title={t.availableConverters} description={t.setSectionConvertersDesc} collapsible defaultCollapsed persistKey="settings.converters">
          <table className="form-table">
            <thead>
              <tr>
                <th>{t.converterName}</th>
                <th>{t.description}</th>
              </tr>
            </thead>
            <tbody>
              {converters.filter((c) => c && c.id).map((converter) => (
                <tr key={converter.id}>
                  <td className="form-table__label">{converter.name || converter.id}</td>
                  <td className="form-table__sub">{converter.description || t.setNoDescription}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </FormSection>

        {/* ------------------------------ ADMIN -----------------------------
            Last on the page and shut by default. The user list is edited once
            per person, and the switch below it is one nobody should be looking
            for — putting either among the everyday settings invites a stray
            click on the second one. */}
        <FormSection icon="shield" title={t.setSectionAdmin} description={t.adminSectionHint} collapsible defaultCollapsed>
          <UsersCard language={language} currentEmail={userEmail} onNamesChanged={onUserNamesChanged} />

          <div className="danger-zone">
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                <div className="callout__title">{t.doNotUseSkipApproval}</div>
                <div>{t.skipApprovalWarningMessage}</div>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <span className="settings-label-main settings-label-main--icon is-danger">
                  <Icon name="alert-circle" size={14} /> {t.skipUserApproval}
                </span>
                <span className="settings-label-sub">{t.skipUserApprovalDesc}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={skipUserApproval} onChange={handleSkipUserApprovalToggle} aria-label={t.skipUserApproval} />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </FormSection>
      </div>
    </div>
  );
};

export default Settings;
