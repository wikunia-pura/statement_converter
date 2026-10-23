import React, { useEffect, useState } from 'react';
import { PodatekCit, PodatkiCitUpoResult } from '../../../shared/types';
import { formatStamp } from '../../../shared/calendar';
import {
  BlokadaWysylki,
  EDeklaracjeSrodowisko,
  EDeklaracjeWysylka,
  blokadaDoPotwierdzenia,
  blokadyWysylkiProd,
  czekaNaUpo,
  moznaPorzucic,
  niepewnaOtwarta,
  normalizeSrodowisko,
  swiezaWysylka,
  wTrakcieWysylania,
} from '../../../shared/e-deklaracje';
import { useNotify } from '../Notifications';
import { PodpiszTezPdf, bezPrefiksu } from '../PodpisKarta';
import Icon from '../Icon';
import { baseName, etapWysylkiText, klasaEtapu } from '../../views/PodatkiNieruchomosci';
import { type T } from './citShared';

/**
 * "Wyślij do e-Deklaracji" in a signing window, with the gateway of Settings → Administracja in plain sight —
 * read when the window opens, so TEST or PRODUKCJA is on screen before the PIN.
 */
export const WyslijOpcja: React.FC<{
  t: T;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** The hint under the option — another form's words (PIT); the CIT-8's by default. */
  hint?: string;
}> = ({ t, checked, onChange, hint }) => {
  const [srodowisko, setSrodowisko] = useState<EDeklaracjeSrodowisko | null>(null);
  useEffect(() => {
    void window.electronAPI.getSettings().then((s) => setSrodowisko(normalizeSrodowisko(s.eDeklaracjeSrodowisko)));
  }, []);
  const prod = srodowisko === 'prod';
  return (
    <>
      <PodpiszTezPdf checked={checked} onChange={onChange} label={t.citSendOption} hint={hint ?? t.citSendOptionHint} />
      {checked && srodowisko && (
        <div className={`callout ${prod ? 'callout--warning' : ''}`}>
          <Icon name={prod ? 'alert-triangle' : 'info'} size={16} />
          <div className="callout__body">
            <span className={`status-badge ${prod ? 'status-error' : 'status-info'}`}>{prod ? t.citEnvProd : t.citEnvTest}</span>{' '}
            {prod ? t.citEnvProdNote : t.citEnvTestNote}
          </div>
        </div>
      )}
    </>
  );
};

/** A send's state badge: the gateway's stage, or what the app could not settle and a person did. */
export function etapWysylki(t: T, w: EDeklaracjeWysylka): { text: string; klasa: string } {
  if (w.rozstrzygnieta?.jak === 'nie_dotarla') return { text: t.citEtap_nieDotarla, klasa: 'status-neutral' };
  if (w.rozstrzygnieta?.jak === 'dotarla') return { text: t.citEtap_dotarla, klasa: 'status-success' };
  if (w.rozstrzygnieta?.jak === 'porzucona') return { text: t.citEtap_porzucona, klasa: 'status-neutral' };
  if (wTrakcieWysylania(w)) return { text: t.citEtap_wysylanie, klasa: 'status-pending' };
  const niepewna = niepewnaOtwarta(w);
  return { text: etapWysylkiText(t, w.status, w.refId, niepewna), klasa: klasaEtapu(w.status, w.refId, niepewna) };
}

/** What a send list does about a send — the CIT-8's calls by default, another form's (PIT) when given. */
export interface WysylkiAkcje {
  pobierzUpo: (refId: string) => Promise<{ filePath: string }>;
  rozstrzygnij: (at: string, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => Promise<unknown>;
}

/** The settling texts that name the document — the CIT-8's speak of a return; a PIT-11 is not one. */
export interface WysylkiTeksty {
  resolveHint: string;
  resolveNotArrivedConfirm: string;
  resolveArrivedConfirm: string;
  /** With `{ref}`. */
  resolveAbandonConfirm: string;
}

/**
 * The document's sends to the gateway, newest first — a send with its UPO offers it for download. A send the
 * app could not settle offers the person's decision: an uncertain one (no answer — it may have been filed)
 * did not or did reach the gateway; one stuck "in progress" is no longer waited for. `id`: the CIT-8 return
 * whose calls are the default `akcje`.
 */
export const WysylkiLista: React.FC<{
  t: T;
  locale: string;
  id?: number;
  wysylki: EDeklaracjeWysylka[];
  onZmiana: () => void;
  akcje?: WysylkiAkcje;
  teksty?: WysylkiTeksty;
}> = ({ t, locale, id, wysylki, onZmiana, akcje, teksty }) => {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const zrob: WysylkiAkcje = akcje ?? {
    pobierzUpo: (refId) => window.electronAPI.pobierzUpoCit(id!, refId),
    rozstrzygnij: (at, jak) => window.electronAPI.rozstrzygnijWysylkeCit(id!, at, jak),
  };
  const tx: WysylkiTeksty = teksty ?? {
    resolveHint: t.citResolveHint,
    resolveNotArrivedConfirm: t.citResolveNotArrivedConfirm,
    resolveArrivedConfirm: t.citResolveArrivedConfirm,
    resolveAbandonConfirm: t.citResolveAbandonConfirm,
  };
  const pobierz = async (refId: string) => {
    try {
      const { filePath } = await zrob.pobierzUpo(refId);
      notify.success(t.citUpoSaved.replace('{file}', baseName(filePath)), { file: filePath });
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citUpoError);
    }
  };
  const rozstrzygnij = async (w: EDeklaracjeWysylka, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => {
    const pytanie =
      jak === 'nie_dotarla'
        ? tx.resolveNotArrivedConfirm
        : jak === 'dotarla'
          ? tx.resolveArrivedConfirm
          : tx.resolveAbandonConfirm.replace('{ref}', w.refId ?? '—');
    if (!(await notify.confirm(pytanie, { danger: jak !== 'dotarla' }))) return;
    setBusy(w.at);
    try {
      await zrob.rozstrzygnij(w.at, jak);
      notify.success(t.citResolveDone);
      onZmiana();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.citResolveError);
    } finally {
      setBusy(null);
    }
  };
  return (
  <ul className="cit-wysylki">
    {/* The six newest — and every unsettled uncertain one: it may block the return, its buttons must show. */}
    {[...wysylki].reverse().filter((w, i) => i < 6 || niepewnaOtwarta(w)).map((w, i) => {
      const etap = etapWysylki(t, w);
      const doRozstrzygniecia = niepewnaOtwarta(w) && !wTrakcieWysylania(w);
      return (
      <li key={`${w.at}${i}`}>
        <span className={`status-badge ${w.srodowisko === 'prod' ? 'status-accent' : 'status-info'}`}>
          {w.srodowisko === 'prod' ? t.citEnvProd : t.citEnvTest}
        </span>
        <span className={`status-badge ${etap.klasa}`}>{etap.text}</span>
        <span>{formatStamp(w.at, locale)} · {w.by || '—'}</span>
        <span className="cit-wysylki__ref">{w.refId ? t.citSendRef.replace('{ref}', w.refId) : t.citSendNoRef}</span>
        {w.upo && w.refId && (
          <button type="button" className="button button-small button-secondary" onClick={() => void pobierz(w.refId!)}>
            <Icon name="download" size={13} /> {t.citUpoDownload}
          </button>
        )}
        {doRozstrzygniecia && (
          <>
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={busy !== null}
              onClick={() => void rozstrzygnij(w, 'nie_dotarla')}
            >
              <Icon name="refresh" size={13} /> {t.citResolveNotArrived}
            </button>
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={busy !== null}
              onClick={() => void rozstrzygnij(w, 'dotarla')}
            >
              <Icon name="check" size={13} /> {t.citResolveArrived}
            </button>
          </>
        )}
        {moznaPorzucic(w) && (
          <button
            type="button"
            className="button button-small button-ghost"
            disabled={busy !== null}
            onClick={() => void rozstrzygnij(w, 'porzucona')}
          >
            <Icon name="x" size={13} /> {t.citResolveAbandon}
          </button>
        )}
        {doRozstrzygniecia && <span className="cit-wysylki__opis">{tx.resolveHint}</span>}
        {czekaNaUpo(w) && swiezaWysylka(w) && <span className="cit-wysylki__opis">{t.citUpoAuto}</span>}
        {w.opis && <span className="cit-wysylki__opis">{w.opis}</span>}
        {w.sprawdzono && <span className="cit-wysylki__opis">{t.citSendChecked.replace('{when}', formatStamp(w.sprawdzono, locale))}</span>}
        {w.rozstrzygnieta && (
          <span className="cit-wysylki__opis">
            {t.citSettledBy.replace('{who}', w.rozstrzygnieta.by || '—').replace('{when}', formatStamp(w.rozstrzygnieta.at, locale))}
          </span>
        )}
      </li>
      );
    })}
  </ul>
  );
};

/** "Sprawdź UPO" for the given returns (or the year); the result as one toast, the list reloaded by the caller. */
export async function sprawdzUpo(
  t: T,
  notify: ReturnType<typeof useNotify>,
  rok: number,
  ids?: number[],
): Promise<PodatkiCitUpoResult | null> {
  try {
    const r = await window.electronAPI.sprawdzUpoCit(rok, ids);
    if (r.wyniki.length === 0 && r.bledy.length === 0) {
      notify.info(t.citUpoNothing);
      return r;
    }
    const upo = r.wyniki.filter((w) => w.status === 200).length;
    const toku = r.wyniki.filter((w) => w.status !== null && w.status >= 300 && w.status < 400).length;
    const odrz = r.wyniki.length - upo - toku;
    const msg = t.citUpoDone
      .replace('{n}', String(r.wyniki.length))
      .replace('{upo}', String(upo))
      .replace('{toku}', String(toku))
      .replace('{odrz}', String(odrz));
    const bledy = r.bledy.length > 0 ? ` ${t.citUpoErrors.replace('{list}', r.bledy.map((b) => `${b.nazwa} — ${b.powod}`).join('; '))}` : '';
    if (odrz > 0 || r.bledy.length > 0) notify.warning(msg + bledy, r.folder ? { file: r.folder } : undefined);
    else notify.success(msg, r.folder ? { file: r.folder } : undefined);
    return r;
  } catch (err: unknown) {
    notify.error(bezPrefiksu(err), t.citUpoError);
    return null;
  }
}

/** A correction's hold-up in the window's words. */
const blokadaText = (t: T, b: BlokadaWysylki): string =>
  b.kod === 'korektaCzeka'
    ? t.citBlokada_korektaCzeka.replace('{ref}', 'refId' in b ? b.refId : '—')
    : t.citBlokada_korektaPrzyjeta.replace('{ref}', 'refId' in b ? b.refId : '—');

/**
 * Before a signing run that sends: the corrections an earlier production send holds back — one still waiting
 * for its UPO, or an earlier correction that reached the gateway — are named and the person decides, before
 * anything is signed. Only for the production gateway (the test one files nothing). The keys confirmed go to
 * the run; a correction left unconfirmed is signed but not sent, and the summary says why. Any document with a
 * purpose, its sends and its filed mark — a CIT-8 return, a PIT-11, a PIT-4R.
 */
export async function potwierdzKorektyDokumentow<K>(
  t: T,
  notify: ReturnType<typeof useNotify>,
  dokumenty: { klucz: K; nazwa: string; cel: 1 | 2; wysylki: EDeklaracjeWysylka[]; zlozone: unknown }[],
  wyslij: boolean,
): Promise<K[]> {
  if (!wyslij) return [];
  const doPotwierdzenia = dokumenty
    .filter((d) => d.cel === 2)
    .map((d) => ({ d, blokady: blokadyWysylkiProd(d).filter(blokadaDoPotwierdzenia) }))
    .filter((x) => x.blokady.length > 0);
  if (doPotwierdzenia.length === 0) return [];
  const settings = await window.electronAPI.getSettings();
  if (normalizeSrodowisko(settings.eDeklaracjeSrodowisko) !== 'prod') return [];
  const lista = doPotwierdzenia
    .map(({ d, blokady }) => `${d.nazwa}: ${blokady.map((b) => blokadaText(t, b)).join('; ')}`)
    .join('\n');
  const ok = await notify.confirm(t.citCorrectionConfirm.replace('{list}', lista), {
    title: t.citCorrectionConfirmTitle,
    confirmLabel: t.citCorrectionConfirmYes,
  });
  return ok ? doPotwierdzenia.map(({ d }) => d.klucz) : [];
}

/** `potwierdzKorektyDokumentow` for CIT-8 returns. */
export const potwierdzKorekty = (
  t: T,
  notify: ReturnType<typeof useNotify>,
  rekordy: PodatekCit[],
  wyslij: boolean,
): Promise<number[]> =>
  potwierdzKorektyDokumentow(
    t,
    notify,
    rekordy.map((r) => ({ klucz: r.id, nazwa: r.adresNazwa, cel: r.dane.cel, wysylki: r.dane.wysylki, zlozone: r.dane.zlozone })),
    wyslij,
  );
