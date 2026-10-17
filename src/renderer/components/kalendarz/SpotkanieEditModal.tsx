import React, { useEffect, useState } from 'react';
import {
  Adres,
  AppUser,
  Spotkanie,
  SpotkanieInput,
  SpotkanieLokalizacja,
  SpotkanieTyp,
  Zadanie,
  ZadanieInput,
  ZgnJednostka,
  ZgnPelnomocnik,
} from '../../../shared/types';
import { ipcErrorMessage, isIpcError } from '../../ipcError';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import { toDayKey } from '../../../shared/calendar';
import { type KalendarzPreloaded } from './kalendarzShared';
import { SpotkanieFormModal } from './SpotkanieFormModal';

/**
 * The meeting's edit form on its own, for a screen that is not the calendar
 * (Zebrania): the same form and the same save, without leaving that screen.
 * Loads what the form needs; `onSaved` lets the host reload its own data.
 */
export const SpotkanieEditModal: React.FC<{
  language: Language;
  userEmail?: string;
  spotkanie: Spotkanie;
  onSaved: () => void;
  onCancel: () => void;
  /** What the host already holds — the form then only loads the rest. */
  preloaded?: Omit<KalendarzPreloaded, 'zebrania'>;
}> = ({ language, userEmail, spotkanie, onSaved, onCancel, preloaded }) => {
  const t = translations[language];
  const notify = useNotify();
  const [typy, setTypy] = useState<SpotkanieTyp[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [zgnJednostki, setZgnJednostki] = useState<ZgnJednostka[]>([]);
  const [zgnPelnomocnicy, setZgnPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  const [zadania, setZadania] = useState<Zadanie[]>([]);
  const [wszystkie, setWszystkie] = useState<Spotkanie[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The meeting the form edits: after a save conflict, the one now stored.
  const [current, setCurrent] = useState(spotkanie);

  const loadZadania = async () => {
    try {
      const all = await window.electronAPI.getZadania();
      setZadania(all.filter((z) => z.spotkanieId === spotkanie.id && !z.zarchiwizowane));
    } catch {
      setZadania([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [typyData, lokalizacjeData, adresyData, usersData, spotkaniaData] = await Promise.all([
          window.electronAPI.getSpotkaniaTypy(),
          preloaded?.lokalizacje ?? window.electronAPI.getSpotkaniaLokalizacje(),
          preloaded?.adresy ?? window.electronAPI.getAdresy(),
          window.electronAPI.getAppUsers(),
          preloaded?.spotkania ?? window.electronAPI.getSpotkania(),
        ]);
        if (cancelled) return;
        setWszystkie(spotkaniaData);
        setTypy(typyData);
        setLokalizacje(lokalizacjeData);
        setAdresy(adresyData);
        setUsers(usersData);
      } catch {
        if (!cancelled) notify.error(t.kalLoadError);
      }
      try {
        const [jednostki, pelnomocnicy] = await Promise.all([
          preloaded?.zgnJednostki ?? window.electronAPI.mailingGetZgn(),
          window.electronAPI.getZgnPelnomocnicy(),
        ]);
        if (cancelled) return;
        setZgnJednostki(jednostki);
        setZgnPelnomocnicy(pelnomocnicy);
      } catch {
        // Without the units the picker is only empty.
      }
      await loadZadania();
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotkanie.id]);

  const handleSubmit = async (
    input: SpotkanieInput,
    _pendingZadania: ZadanieInput[],
    materialyPotrzebne: boolean,
  ) => {
    setIsSaving(true);
    setError(null);
    try {
      // Only over the meeting as the form loaded it: one saved since by somebody else is refused.
      await window.electronAPI.updateSpotkanie(spotkanie.id, input, current.updatedAt);
      const was = current.materialyStatus;
      if (!materialyPotrzebne && was !== 'brak') {
        await window.electronAPI.setSpotkanieMaterialy(spotkanie.id, 'brak');
      } else if (materialyPotrzebne && was === 'brak') {
        await window.electronAPI.setSpotkanieMaterialy(spotkanie.id, 'potrzebne');
      }
      if (materialyPotrzebne) {
        try {
          await window.electronAPI.ensureZebranieForSpotkanie(spotkanie.id);
        } catch (err: unknown) {
          notify.error(`${t.zebraniaAutoCreateError}: ${ipcErrorMessage(err, t.errorUnexpected)}`);
        }
      }
      notify.success(t.kalUpdated);
      onSaved();
    } catch (err: unknown) {
      if (isIpcError(err, 'concurrentEdit')) {
        // As in the calendar's own form: the fields stay, the meeting is the one now stored.
        const fresh = await window.electronAPI.getSpotkanie(spotkanie.id).catch(() => null);
        if (fresh) setCurrent(fresh);
        setError(t.kalConflict);
      } else {
        setError(ipcErrorMessage(err, t.errorUnexpected));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteZadanie = async (z: Zadanie) => {
    if (!(await notify.confirm(t.zadConfirmDelete.replace('{title}', z.tytul), { danger: true }))) {
      return;
    }
    try {
      await window.electronAPI.deleteZadanie(z.id);
      notify.success(t.kalTaskDeleted);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
    }
    await loadZadania();
  };

  if (!loaded) return null;
  return (
    <SpotkanieFormModal
      language={language}
      editing={current}
      defaultDay={toDayKey(spotkanie.startsAt)}
      typy={typy}
      lokalizacje={lokalizacje}
      adresy={adresy}
      users={users}
      userEmail={userEmail}
      isSaving={isSaving}
      error={error}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      zgnJednostki={zgnJednostki}
      zgnPelnomocnicy={zgnPelnomocnicy}
      linkedZadania={zadania}
      spotkania={wszystkie}
      onZadaniaChanged={() => void loadZadania()}
      onDeleteZadanie={(z) => void handleDeleteZadanie(z)}
    />
  );
};
