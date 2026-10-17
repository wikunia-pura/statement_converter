import { useSyncExternalStore } from 'react';
import {
  Adres,
  Spotkanie,
  SpotkanieLokalizacja,
  SpotkanieMaterialyStatus,
  ZgnJednostka,
  Zebranie,
} from '../../../shared/types';
import { translations, Language } from '../../translations';

/** Data a host screen hands the one-card mode instead of it being fetched again. */
export interface KalendarzPreloaded {
  spotkania: Spotkanie[];
  lokalizacje: SpotkanieLokalizacja[];
  adresy: Adres[];
  zgnJednostki: ZgnJednostka[];
  zebrania: Zebranie[];
}

/**
 * A hover card's state, kept outside React state on purpose: a card shown on
 * every chip the pointer crosses must not re-render the whole calendar each
 * time — only the card itself, which subscribes here.
 */
export interface HoverStore<T> {
  get: () => T | null;
  set: (value: T | null) => void;
  subscribe: (listener: () => void) => () => void;
}
export function createHoverStore<T>(): HoverStore<T> {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export const useHover = <T,>(store: HoverStore<T>): T | null => useSyncExternalStore(store.subscribe, store.get);

/**
 * An open month/year count card: what it counts (a type, or every meeting), the
 * two numbers, and where it hangs — under the chip or figure it explains.
 */
export interface CountTipState {
  label: string;
  color: string | null;
  month: number;
  year: number;
  left: number;
  top: number;
}

/** "3 spotkania" / "5 spotkań" — the count with the word that fits it. */
export function meetingsCount(n: number, language: Language): string {
  if (language === 'en') return `${n} ${n === 1 ? 'meeting' : 'meetings'}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return `${n} spotkanie`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${n} spotkania`;
  return `${n} spotkań`;
}

/** An open hover card: which meeting, and the viewport edges it hangs off. */
export interface TipState {
  spotkanie: Spotkanie;
  left: number;
  top?: number;
  bottom?: number;
}

/** Where a meeting's materials stand, in words — card, chip card and preview. */
export function materialyStatusLabel(
  t: (typeof translations)['pl'],
  status: SpotkanieMaterialyStatus,
): string {
  return {
    brak: t.kalMatStateBrak,
    potrzebne: t.kalMatStatePotrzebne,
    do_przygotowania: t.kalMatStateDo,
    przygotowane: t.kalMatStatePrzygotowane,
    wyslane: t.kalMatStateWyslane,
  }[status];
}
