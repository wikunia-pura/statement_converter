import React, { createContext, useContext, useEffect, useState } from 'react';
import type { PodatkiPodpisPostep, PodatkiZusWyslijResult, PodpisWybor } from '../../../shared/types';
import {
  ZusSrodowisko,
  ZusWysylka,
  czekaNaPotwierdzenie,
  etapZusWysylki,
  kluczWysylki,
  moznaPorzucic,
  niepewnaOtwarta,
  normalizeZusSrodowisko,
  ostatniaWysylka,
  wTrakcieWysylania,
} from '../../../shared/zus-ewd';
import { formatStamp } from '../../../shared/calendar';
import { translations } from '../../translations';
import type { Language } from '../../translations';
import { FormSection } from '../FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { PodpisKartaModal, bezPrefiksu } from '../PodpisKarta';
import { useNotify } from '../Notifications';
import Icon, { type IconName } from '../Icon';
import { baseName } from '../../views/PodatkiNieruchomosci';

/*
 * Sending ZUS documents straight to ZUS (EWD) — the pieces the ZUS tab and the payer's screen share: the sends
 * in a context (so a document line deep in the editor finds its own), the badge of a document's newest send
 * with what a person can do about it, the signing window and the summary of a run.
 */

type T = (typeof translations)['pl'];

const sub = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

export interface ZusWysylkiKontekst {
  wysylki: ZusWysylka[];
  /** Opens "Podpisz i wyślij do ZUS" for these documents of the month on screen. */
  wyslij: (ids: string[]) => void;
  /** A send changed here (settled) — swap it in. */
  zmiana: (w: ZusWysylka) => void;
}

export const ZusWysylkiContext = createContext<ZusWysylkiKontekst>({ wysylki: [], wyslij: () => undefined, zmiana: () => undefined });

/** The newest send of a document (a set by its identifier). */
export function useWysylkaDokumentu(dokument: string | null, identyfikator: number | null = null): ZusWysylka | null {
  const { wysylki } = useContext(ZusWysylkiContext);
  return dokument ? ostatniaWysylka(wysylki, kluczWysylki(dokument, identyfikator)) : null;
}

const KLASA: Record<ReturnType<typeof etapZusWysylki>, string> = {
  wysylanie: 'status-pending',
  niepewna: 'status-pending',
  nie_wyslano: 'status-neutral',
  czeka: 'status-info',
  przyjeta: 'status-success',
  odrzucona: 'status-error',
  nie_dotarla: 'status-neutral',
  dotarla: 'status-success',
  porzucona: 'status-neutral',
};

/** The hover text of a send: when and who, ZUS's word, its errors and what it said about the signer. */
function opisWysylki(t: T, locale: string, w: ZusWysylka): string {
  const p = w.potwierdzenie;
  return [
    sub(t.zusSendTipHead, { kiedy: formatStamp(w.at, locale), kto: w.by || '—', podpisal: w.podpisal || '—' }),
    w.idPrzesylki ? sub(t.zusSendTipId, { id: w.idPrzesylki }) : '',
    w.opis,
    ...(p?.bledy ?? []).map((b) => `• ${[b.rodzaj, b.opis].filter(Boolean).join(': ')}`),
    p?.upowaznienie === 'false' ? t.zusAuthFalse : '',
    w.sprawdzono && !p ? sub(t.zusSendTipChecked, { kiedy: formatStamp(w.sprawdzono, locale) }) : '',
    w.rozstrzygnieta ? sub(t.zusSettledBy, { kto: w.rozstrzygnieta.by || '—', kiedy: formatStamp(w.rozstrzygnieta.at, locale) }) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The newest send of a document: its stage, TEST when it went to the test service, and what can be done — the
 * confirmation to save, an uncertain send to settle, a send waiting too long to stop waiting for.
 */
export const WysylkaZus: React.FC<{ t: T; locale: string; wysylka: ZusWysylka | null; kompakt?: boolean }> = ({
  t,
  locale,
  wysylka: w,
  kompakt,
}) => {
  const notify = useNotify();
  const { zmiana } = useContext(ZusWysylkiContext);
  const [busy, setBusy] = useState(false);
  if (!w) return null;
  const etap = etapZusWysylki(w);
  const pobierz = async () => {
    try {
      const { filePath } = await window.electronAPI.pobierzPotwierdzenieZus(w.id);
      notify.success(sub(t.zusConfirmSaved, { file: baseName(filePath) }), { file: filePath });
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.zusConfirmError);
    }
  };
  const rozstrzygnij = async (jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => {
    const pytanie =
      jak === 'nie_dotarla'
        ? t.zusResolveNotArrivedConfirm
        : jak === 'dotarla'
          ? t.zusResolveArrivedConfirm
          : sub(t.zusResolveAbandonConfirm, { id: w.idPrzesylki ?? '—' });
    if (!(await notify.confirm(pytanie, { danger: jak !== 'dotarla' }))) return;
    setBusy(true);
    try {
      zmiana(await window.electronAPI.rozstrzygnijWysylkeZus(w.id, jak));
      notify.success(t.zusResolveDone);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.zusResolveError);
    } finally {
      setBusy(false);
    }
  };
  const doRozstrzygniecia = niepewnaOtwarta(w) && !wTrakcieWysylania(w);
  return (
    <span className={`zus-wysylka${kompakt ? ' zus-wysylka--kompakt' : ''}`}>
      <span className={`status-badge ${KLASA[etap]}`} data-tip={opisWysylki(t, locale, w)}>
        {w.srodowisko === 'test' && <span className="zus-wysylka__env">{t.citEnvTest}</span>}
        {t[`zusEtap_${etap}`]}
      </span>
      {w.potwierdzenie?.kontener && (
        <button type="button" className="button button-small button-ghost" onClick={() => void pobierz()} data-tip={t.zusConfirmDownloadHint}>
          <Icon name="download" size={13} /> {t.zusConfirmDownload}
        </button>
      )}
      {doRozstrzygniecia && (
        <>
          <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => void rozstrzygnij('nie_dotarla')}>
            <Icon name="refresh" size={13} /> {t.zusResolveNotArrived}
          </button>
          <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => void rozstrzygnij('dotarla')}>
            <Icon name="check" size={13} /> {t.zusResolveArrived}
          </button>
        </>
      )}
      {moznaPorzucic(w) && (
        <button type="button" className="button button-small button-ghost" disabled={busy} onClick={() => void rozstrzygnij('porzucona')}>
          <Icon name="x" size={13} /> {t.zusResolveAbandon}
        </button>
      )}
    </span>
  );
};

/**
 * A production send of the document is still in the air or waiting for its confirmation — no new send is
 * offered (the database would refuse it too). A test send never holds a document back.
 */
export const wysylkaTrwa = (w: ZusWysylka | null): boolean =>
  !!w && w.srodowisko === 'prod' && (niepewnaOtwarta(w) || czekaNaPotwierdzenie(w));

/** The service of Settings → Administracja, read when a window opens — TEST or PRODUKCJA on screen before the PIN. */
export function useZusSrodowisko(): ZusSrodowisko | null {
  const [srodowisko, setSrodowisko] = useState<ZusSrodowisko | null>(null);
  useEffect(() => {
    void window.electronAPI.getSettings().then((s) => setSrodowisko(normalizeZusSrodowisko(s.zusSrodowisko)));
  }, []);
  return srodowisko;
}

/**
 * "Podpisz i wyślij do ZUS": the documents, the service in plain sight, the card and one PIN. A rejection (wrong PIN, no
 * card — nothing signed) stays in the window; anything else closes it and hands the result over.
 */
export const WyslijZusModal: React.FC<{
  language: Language;
  okres: string;
  okresEtykieta: string;
  dokumenty: { id: string; nazwa: string }[];
  onWynik: (wynik: PodatkiZusWyslijResult) => void;
  onClose: () => void;
}> = ({ language, okres, okresEtykieta, dokumenty, onWynik, onClose }) => {
  const t = translations[language];
  const srodowisko = useZusSrodowisko();
  const [postep, setPostep] = useState<PodatkiPodpisPostep | null>(null);
  useEffect(() => window.electronAPI.onZusPostep(setPostep), []);
  const prod = srodowisko === 'prod';
  const podpisz = async (wybor: PodpisWybor) => {
    setPostep(null);
    const wynik = await window.electronAPI.wyslijZus(
      okres,
      dokumenty.map((d) => d.id),
      wybor,
    );
    onWynik(wynik);
  };
  return (
    <PodpisKartaModal
      language={language}
      title={t.zusSendTitle}
      subtitle={sub(t.zusSendSubtitle, { n: dokumenty.length, okres: okresEtykieta })}
      extra={() => (
        <FormSection icon="upload" title={sub(t.zusSendListTitle, { n: dokumenty.length })} description={t.zusSendDesc}>
          {srodowisko && (
            <div className={`callout ${prod ? 'callout--warning' : ''}`}>
              <Icon name={prod ? 'alert-triangle' : 'info'} size={16} />
              <div className="callout__body">
                <span className={`status-badge ${prod ? 'status-error' : 'status-info'}`}>{prod ? t.citEnvProd : t.citEnvTest}</span>{' '}
                {prod ? t.zusSendProdNote : t.zusSendTestNote}
              </div>
            </div>
          )}
          <ul className="podpis-sum__list">
            {dokumenty.slice(0, 40).map((d) => (
              <li key={d.id}>
                <span className="podpis-sum__name">{d.nazwa}</span>
              </li>
            ))}
            {dokumenty.length > 40 && <li className="pod-note">{sub(t.zusSendMore, { n: dokumenty.length - 40 })}</li>}
          </ul>
          <p className="pod-note">{t.zusSendAuthNote}</p>
        </FormSection>
      )}
      submitLabel={sub(t.zusSendSubmit, { n: dokumenty.length })}
      submitDisabled={dokumenty.length === 0 || !srodowisko}
      pinHint={sub(t.zusSendPinHint, { n: dokumenty.length })}
      postep={postep}
      onPrzerwij={() => void window.electronAPI.przerwijWysylkeZus()}
      onPodpisz={podpisz}
      onClose={onClose}
    />
  );
};

/** What one run did: sent and waiting, uncertain, not sent, held back, left unsigned. */
export const WysylkaZusPodsumowanie: React.FC<{
  t: T;
  wynik: PodatkiZusWyslijResult;
  onZaznacz: (ids: string[]) => void;
  onClose: () => void;
}> = ({ t, wynik, onZaznacz, onClose }) => {
  const notify = useNotify();
  const wyslane = wynik.wysylki.filter((w) => w.idPrzesylki && !w.niepewna);
  const niepewne = wynik.wysylki.filter((w) => w.niepewna);
  const nieWyslane = wynik.wysylki.filter((w) => !w.idPrzesylki && !w.niepewna);
  const doPonowienia = [...nieWyslane.map((w) => w.id), ...wynik.pominiete.map((p) => p.id), ...wynik.niepodpisane.map((p) => p.id)];
  const prod = wynik.wysylki.some((w) => w.srodowisko === 'prod');
  const otworz = async (sciezka: string) => {
    if (!(await window.electronAPI.openFile(sciezka))) notify.error(t.zusSumFileMissing);
  };
  const lista = (wpisy: { id: string; nazwa: string; opis: string }[], ikona: IconName) => (
    <ul className="podpis-sum__list podpis-sum__list--skipped">
      {wpisy.map((w, i) => (
        <li key={`${w.id}${i}`}>
          <span className="podpis-sum__name">{w.nazwa}</span>
          {w.opis.split('\n').map((r, j) => (
            <span key={j} className="podpis-sum__reason">
              <Icon name={ikona} size={13} /> {r}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon={wyslane.length > 0 && doPonowienia.length === 0 && niepewne.length === 0 ? 'check-circle' : 'alert-triangle'}
          tone={wyslane.length === 0 ? 'danger' : 'accent'}
          title={t.zusSendSumTitle}
          subtitle={wynik.podpis ? sub(t.zusSendSumSubtitle, { kto: wynik.podpis.podmiot }) : t.zusSendSumSubtitleNone}
        />
        <div className="modal-body modal-body--sectioned">
          {wynik.przerwano && (
            <div className="callout callout--warning" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{sub(t.zusSendSumStopped, { powod: wynik.przerwano })}</div>
            </div>
          )}
          {wyslane.length > 0 && (
            <FormSection icon="upload" title={sub(t.zusSendSumSent, { n: wyslane.length })} description={prod ? t.zusSendSumAuto : t.zusSendSumAutoTest}>
              {lista(
                wyslane.map((w) => ({ id: w.id, nazwa: w.nazwa, opis: w.opis })),
                'check',
              )}
            </FormSection>
          )}
          {niepewne.length > 0 && (
            <FormSection icon="alert-circle" title={sub(t.zusSendSumUncertain, { n: niepewne.length })} description={t.zusSendSumUncertainHint}>
              {lista(
                niepewne.map((w) => ({ id: w.id, nazwa: w.nazwa, opis: w.opis })),
                'alert-circle',
              )}
            </FormSection>
          )}
          {nieWyslane.length > 0 && (
            <FormSection icon="x-circle" title={sub(t.zusSendSumFailed, { n: nieWyslane.length })}>
              {lista(
                nieWyslane.map((w) => ({ id: w.id, nazwa: w.nazwa, opis: w.opis })),
                'alert-circle',
              )}
            </FormSection>
          )}
          {wynik.pominiete.length > 0 && (
            <FormSection icon="alert-triangle" title={sub(t.zusSendSumSkipped, { n: wynik.pominiete.length })}>
              {lista(
                wynik.pominiete.map((p) => ({ id: p.id, nazwa: p.nazwa, opis: p.powod })),
                'alert-circle',
              )}
            </FormSection>
          )}
          {wynik.niepodpisane.length > 0 && (
            <FormSection icon="clock" title={sub(t.zusSendSumUnsigned, { n: wynik.niepodpisane.length })}>
              {lista(
                wynik.niepodpisane.map((p) => ({ id: p.id, nazwa: p.nazwa, opis: '' })),
                'minus',
              )}
            </FormSection>
          )}
          {wynik.folder && <div className="podpis-sum__folder">{sub(t.zusSendSumFolder, { folder: wynik.folder })}</div>}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          secondaryAction={
            doPonowienia.length > 0 ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onZaznacz(doPonowienia);
                  onClose();
                }}
              >
                <Icon name="check-circle" size={14} /> {sub(t.zusSumSelectRest, { n: doPonowienia.length })}
              </button>
            ) : undefined
          }
          onSubmit={wynik.folder ? () => void otworz(wynik.folder) : undefined}
          submitLabel={t.zusSumOpenFolder}
          submitIcon="folder"
          autoFocus={wynik.folder ? 'submit' : 'cancel'}
        />
      </div>
    </div>
  );
};

/** "Sprawdź potwierdzenia": the result as one toast; the sends that changed handed back to swap in. */
export async function sprawdzPotwierdzenia(t: T, notify: ReturnType<typeof useNotify>): Promise<ZusWysylka[]> {
  try {
    const r = await window.electronAPI.sprawdzPotwierdzeniaZus();
    if (r.wyniki.length === 0 && r.bledy.length === 0) {
      notify.info(t.zusConfirmNothing);
      return r.wysylki;
    }
    const ok = r.wyniki.filter((w) => w.etap === 'przyjeta').length;
    const odrz = r.wyniki.filter((w) => w.etap === 'odrzucona').length;
    const czeka = r.wyniki.filter((w) => w.etap === 'czeka').length;
    const msg = sub(t.zusConfirmDone, { n: r.wyniki.length + r.bledy.length, ok, odrz, czeka });
    const bledy = r.bledy.length > 0 ? ` ${sub(t.zusConfirmErrors, { list: r.bledy.map((b) => `${b.nazwa} — ${b.powod}`).join('; ') })}` : '';
    if (odrz > 0 || r.bledy.length > 0) notify.warning(msg + bledy, r.folder ? { file: r.folder } : undefined);
    else notify.success(msg, r.folder ? { file: r.folder } : undefined);
    return r.wysylki;
  } catch (err: unknown) {
    notify.error(bezPrefiksu(err), t.zusConfirmCheckError);
    return [];
  }
}
