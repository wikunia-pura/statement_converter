import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PodatkiPodpisPostep, PodpisCertyfikat, PodpisCzytnik, PodpisKartaStan, PodpisWybor } from '../../shared/types';
import { translations, Language } from '../translations';
import { FormField, FormSection } from './FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { useNotify } from './Notifications';
import Icon from './Icon';

/*
 * The signing card as the app sees it — Szafir's PKCS#11 library, the readers,
 * the card and its certificates. `PodpisKartaModal` picks a certificate and
 * takes the PIN for one signature; `PodpisKartaUstawienia` is the same picture
 * in Settings, for setting the library up and seeing why a card does not sign.
 */

type T = (typeof translations)['pl'];

/** An IPC rejection carries "Error invoking remote method '…': Error: " before the main process's message. */
export const bezPrefiksu = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');

type Waznosc = 'ok' | 'wygasl' | 'jeszcze';

const waznosc = (c: PodpisCertyfikat): Waznosc => {
  const now = Date.now();
  if (now < Date.parse(c.waznyOd)) return 'jeszcze';
  return now > Date.parse(c.waznyDo) ? 'wygasl' : 'ok';
};

const waznoscText = (t: T, c: PodpisCertyfikat, locale: string): string => {
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  switch (waznosc(c)) {
    case 'wygasl':
      return t.podpisCertExpired.replace('{date}', date(c.waznyDo));
    case 'jeszcze':
      return t.podpisCertNotYet.replace('{date}', date(c.waznyOd));
    default:
      return t.podpisCertValid.replace('{date}', date(c.waznyDo));
  }
};

interface Opcja {
  key: string;
  czytnik: PodpisCzytnik;
  cert: PodpisCertyfikat;
}

/** Every certificate on every card; qualified, signing, valid ones first. */
const opcje = (stan: PodpisKartaStan): Opcja[] => {
  const ranga = (c: PodpisCertyfikat) =>
    (waznosc(c) === 'ok' ? 0 : 4) + (c.kwalifikowany ? 0 : 2) + (c.doPodpisu ? 0 : 1);
  return stan.czytniki
    .flatMap((czytnik) =>
      czytnik.karta ? czytnik.certyfikaty.map((cert) => ({ key: `${czytnik.slot}:${cert.id}:${cert.numerSeryjny}`, czytnik, cert })) : [],
    )
    .sort((a, b) => ranga(a.cert) - ranga(b.cert));
};

const KwalifikowanyBadge: React.FC<{ t: T; cert: PodpisCertyfikat }> = ({ t, cert }) => (
  <span className={`form-section__badge ${cert.kwalifikowany ? 'is-accent' : 'is-neutral'}`}>
    {cert.kwalifikowany ? t.podpisCertQualified : t.podpisCertNotQualified}
  </span>
);

const Callout: React.FC<{ tone: 'warning' | 'danger' | 'muted'; children: React.ReactNode; action?: React.ReactNode }> = ({
  tone,
  children,
  action,
}) => (
  <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
    <Icon name={tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'alert-triangle' : 'info'} size={16} />
    <div className="callout__body callout__body--path">{children}</div>
    {action}
  </div>
);

/** The PIN counters of a card, as a callout — or nothing while all is well. */
const PinOstrzezenie: React.FC<{ t: T; karta: NonNullable<PodpisCzytnik['karta']> }> = ({ t, karta }) =>
  karta.pinZablokowany ? (
    <Callout tone="danger">{t.podpisPinLocked}</Callout>
  ) : karta.pinOstatniaProba ? (
    <Callout tone="danger">{t.podpisPinFinal}</Callout>
  ) : karta.pinMaloProb ? (
    <Callout tone="warning">{t.podpisPinLow}</Callout>
  ) : null;

/**
 * Why there is no certificate to pick — no library, no reader, no card — or a
 * card that could not be read, as one callout; null when all is well.
 */
const Przeszkoda: React.FC<{ t: T; stan: PodpisKartaStan; action?: React.ReactNode }> = ({ t, stan, action }) => {
  if (!stan.biblioteka) return <Callout tone="danger" action={action}>{stan.blad}</Callout>;
  if (stan.czytniki.length === 0) return <Callout tone="warning">{t.podpisNoReader}</Callout>;
  const zKarta = stan.czytniki.filter((c) => c.karta || c.blad);
  if (zKarta.length === 0) return <Callout tone="warning">{t.podpisNoCard}</Callout>;
  // A card that could not be read is named even when another one has certificates.
  const bledy = zKarta.filter((c) => c.blad);
  if (bledy.length > 0) {
    return (
      <Callout tone="danger">
        {bledy.map((c) => (
          <div key={c.slot}>
            {c.nazwa}: {c.blad}
          </div>
        ))}
      </Callout>
    );
  }
  return opcje(stan).length > 0 ? null : <Callout tone="warning">{t.podpisNoCert}</Callout>;
};

// ------------------------------------------------------------------ modal

export interface PodpisKartaModalProps {
  language: Language;
  title: string;
  /** What is being signed: "DN-1 2027 · Wspólnota Mieszkaniowa …". */
  subtitle?: string;
  /**
   * Does the signing; resolves when the file is written. A rejection is shown
   * in the modal (wrong PIN, card pulled out) and the PIN field is cleared.
   */
  onPodpisz: (wybor: PodpisWybor) => Promise<void>;
  onClose: () => void;
  /**
   * What is about to be signed and what to know about it, above the card —
   * given the certificate picked, so it can compare names with its holder.
   */
  extra?: (cert: PodpisCertyfikat | null) => React.ReactNode;
  /** "Podpisz 12 deklaracji" — defaults to "Podpisz". */
  submitLabel?: string;
  /** Nothing to sign (every document held up by missing data). */
  submitDisabled?: boolean;
  /** Under the PIN field: what one PIN does here ("Jednym PIN-em podpiszesz 12 deklaracji…"). */
  pinHint?: string;
  /** A run of signatures in progress — shown as a bar instead of the form. */
  postep?: PodatkiPodpisPostep | null;
  /** Stops a run after the document in hand; offered while signing. */
  onPrzerwij?: () => void;
}

export const PodpisKartaModal: React.FC<PodpisKartaModalProps> = ({
  language,
  title,
  subtitle,
  onPodpisz,
  onClose,
  extra,
  submitLabel,
  submitDisabled,
  pinHint,
  postep,
  onPrzerwij,
}) => {
  const t = translations[language];
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const [stan, setStan] = useState<PodpisKartaStan | null>(null);
  const [checking, setChecking] = useState(false);
  const [wybrany, setWybrany] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [przerywam, setPrzerywam] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const pokaz = useCallback((s: PodpisKartaStan) => {
    setStan(s);
    const lista = opcje(s);
    setWybrany((prev) =>
      prev && lista.some((o) => o.key === prev) ? prev : lista.find((o) => waznosc(o.cert) === 'ok')?.key ?? null,
    );
  }, []);

  /** Reads the card again; `zostawBlad` keeps the message of a failed signature on screen. */
  const sprawdz = useCallback(
    async (zostawBlad = false) => {
      setChecking(true);
      if (!zostawBlad) setError(null);
      try {
        pokaz(await window.electronAPI.getPodpisKarta());
      } catch (err: unknown) {
        setError(bezPrefiksu(err));
      } finally {
        setChecking(false);
      }
    },
    [pokaz],
  );

  useEffect(() => {
    void sprawdz();
  }, [sprawdz]);

  const wskaz = async () => {
    setChecking(true);
    setError(null);
    try {
      const s = await window.electronAPI.wskazPodpisBiblioteke();
      if (s) pokaz(s);
    } catch (err: unknown) {
      setError(bezPrefiksu(err));
    } finally {
      setChecking(false);
    }
  };

  const lista = stan ? opcje(stan) : [];
  const opcja = lista.find((o) => o.key === wybrany) ?? null;
  const karta = opcja?.czytnik.karta ?? null;
  const naCzytniku = !!karta?.pinNaCzytniku;
  const zablokowany = !!karta?.pinZablokowany;
  const gotowe =
    !!opcja &&
    waznosc(opcja.cert) === 'ok' &&
    !zablokowany &&
    (naCzytniku || pin.length > 0) &&
    !checking &&
    !submitDisabled;

  const close = () => {
    if (!signing) onClose();
  };

  const podpisz = async () => {
    if (!opcja || !gotowe || signing) return;
    setSigning(true);
    setPrzerywam(false);
    setError(null);
    try {
      await onPodpisz({ slot: opcja.czytnik.slot, certId: opcja.cert.id, pin: naCzytniku ? null : pin });
      setPin('');
    } catch (err: unknown) {
      setPin('');
      setError(bezPrefiksu(err));
      // Fresh PIN counters: a wrong PIN may have brought the card to its last try.
      await sprawdz(true);
      pinRef.current?.focus();
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={close} ariaLabel={t.close} />
        <ModalHeader icon="signature" title={title} subtitle={subtitle} />
        <div className="modal-body modal-body--sectioned">
          {signing && postep && postep.wszystkie > 1 ? (
            <div className="podpis-postep" role="status" aria-live="polite">
              <div className="ksieg-progress__head">
                <span className="ksieg-progress__label">
                  {przerywam ? t.podpisStopping : t.podpisProgress.replace('{nazwa}', postep.nazwa || '…')}
                </span>
                <span className="ksieg-progress__value">
                  {t.podpisProgressCount
                    .replace('{n}', String(Math.min(postep.zrobione + 1, postep.wszystkie)))
                    .replace('{z}', String(postep.wszystkie))}
                </span>
              </div>
              <div className="ksieg-progress__track">
                <div
                  className="ksieg-progress__fill"
                  style={{ width: `${Math.round((postep.zrobione / postep.wszystkie) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            extra?.(opcja?.cert ?? null)
          )}
          <FormSection
            icon="credit-card"
            title={t.podpisCert}
            aside={
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => void sprawdz()}
                disabled={checking || signing}
              >
                <Icon name={checking ? 'loader' : 'refresh'} size={13} className={checking ? 'icon-spin' : undefined} />{' '}
                {t.podpisRecheck}
              </button>
            }
          >
            {!stan ? (
              <div className="podpis-checking">
                <Icon name="loader" size={14} className="icon-spin" /> {t.podpisChecking}
              </div>
            ) : (
              <>
                <Przeszkoda
                  t={t}
                  stan={stan}
                  action={
                    <button type="button" className="button button-small button-secondary" onClick={() => void wskaz()} disabled={checking}>
                      {t.podpisPickLibrary}
                    </button>
                  }
                />
                {lista.length > 0 && (
                  <div className="podpis-certs" role="radiogroup" aria-label={t.podpisCert}>
                    {lista.map((o) => {
                      const wazny = waznosc(o.cert) === 'ok';
                      return (
                        <button
                          key={o.key}
                          type="button"
                          role="radio"
                          aria-checked={o.key === wybrany}
                          className={`podpis-cert${o.key === wybrany ? ' is-active' : ''}`}
                          onClick={() => setWybrany(o.key)}
                          disabled={!wazny || signing}
                        >
                          <span className="podpis-cert__title">
                            {o.cert.podmiot}
                            <KwalifikowanyBadge t={t} cert={o.cert} />
                          </span>
                          <span className={`podpis-cert__line${wazny ? '' : ' is-danger'}`}>
                            {t.podpisCertIssuer.replace('{issuer}', o.cert.wystawca)} · {waznoscText(t, o.cert, locale)}
                          </span>
                          <span className="podpis-cert__line">
                            {t.podpisCertOn
                              .replace('{card}', o.czytnik.karta?.etykieta || o.czytnik.karta?.model || '—')
                              .replace('{reader}', o.czytnik.nazwa)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {opcja && karta && (
              <>
                <PinOstrzezenie t={t} karta={karta} />
                {naCzytniku ? (
                  <Callout tone="muted">{t.podpisPinOnReader}</Callout>
                ) : (
                  !zablokowany && (
                    <FormField label={t.podpisPin} htmlFor="podpis-pin" hint={pinHint ?? t.podpisPinHint}>
                      <input
                        id="podpis-pin"
                        ref={pinRef}
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void podpisz();
                        }}
                        disabled={signing}
                      />
                    </FormField>
                  )
                )}
              </>
            )}
          </FormSection>

          {error && <Callout tone="danger">{error}</Callout>}
        </div>
        <ModalFooter
          onCancel={close}
          cancelLabel={t.cancel}
          onSubmit={() => void podpisz()}
          submitLabel={submitLabel ?? t.podpisSign}
          submitIcon="signature"
          submitDisabled={!gotowe}
          busy={signing}
          secondaryAction={
            signing && onPrzerwij ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPrzerywam(true);
                  onPrzerwij();
                }}
                disabled={przerywam}
              >
                <Icon name="x-circle" size={14} /> {t.podpisStop}
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ settings

/**
 * Settings → "Podpis kwalifikowany": which library the app uses, a hand-picked
 * one instead, and every reader with its card. Reads the card only on "Sprawdź
 * kartę" — a driver that hangs must not hang the whole Settings screen.
 */
export const PodpisKartaUstawienia: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const notify = useNotify();
  const [stan, setStan] = useState<PodpisKartaStan | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (call: () => Promise<PodpisKartaStan | null>) => {
    setBusy(true);
    try {
      const s = await call();
      if (s) setStan(s);
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.podpisTitle);
    } finally {
      setBusy(false);
    }
  };

  const lib = stan?.biblioteka;

  return (
    <FormSection
      icon="signature"
      title={t.podpisTitle}
      description={t.podpisSectionDesc}
      aside={
        <div className="form-section__actions">
          <button
            type="button"
            className="button button-small button-subtle"
            onClick={() => void run(window.electronAPI.getPodpisKarta)}
            disabled={busy}
          >
            <Icon name={busy ? 'loader' : 'credit-card'} size={13} className={busy ? 'icon-spin' : undefined} />{' '}
            {t.podpisCheck}
          </button>
        </div>
      }
    >
      {!stan ? (
        <Callout tone="muted">{t.podpisNotChecked}</Callout>
      ) : (
        <>
          {lib && (
            <div className="podpis-lib">
              <span className="podpis-lib__label">{t.podpisLibrary}</span>
              <code className="podpis-lib__path">{lib.sciezka}</code>
              <span className="podpis-lib__meta">
                {[lib.producent, lib.opis, lib.wersja].filter(Boolean).join(' · ')} ·{' '}
                {lib.wskazana ? t.podpisLibraryManual : t.podpisLibraryAuto}
              </span>
            </div>
          )}
          {!lib ? (
            <Przeszkoda t={t} stan={stan} />
          ) : stan.czytniki.length === 0 ? (
            <Callout tone="warning">{t.podpisNoReader}</Callout>
          ) : (
            stan.czytniki.map((c) => (
              <div key={c.slot} className="podpis-reader">
                <div className="podpis-reader__head">
                  <Icon name="credit-card" size={14} />
                  <span className="podpis-reader__name">{c.nazwa}</span>
                  <span className="podpis-reader__card">
                    {c.karta
                      ? t.podpisCard.replace('{label}', [c.karta.etykieta, c.karta.model].filter(Boolean).join(' · '))
                      : t.podpisReaderEmpty}
                  </span>
                </div>
                {c.blad && <Callout tone="danger">{c.blad}</Callout>}
                {c.karta && <PinOstrzezenie t={t} karta={c.karta} />}
                {c.karta && !c.blad && c.certyfikaty.length === 0 && <Callout tone="warning">{t.podpisNoCert}</Callout>}
                {c.certyfikaty.map((cert) => (
                  <div key={`${cert.id}:${cert.numerSeryjny}`} className="podpis-reader__cert">
                    <span className="podpis-cert__title">
                      {cert.podmiot}
                      <KwalifikowanyBadge t={t} cert={cert} />
                    </span>
                    <span className={`podpis-cert__line${waznosc(cert) === 'ok' ? '' : ' is-danger'}`}>
                      {t.podpisCertIssuer.replace('{issuer}', cert.wystawca)} · {waznoscText(t, cert, locale)} ·{' '}
                      {cert.klucz.toUpperCase()} · nr {cert.numerSeryjny}
                    </span>
                  </div>
                ))}
                {c.mechanizmy.length > 0 && (
                  <span className="podpis-cert__line">{t.podpisMechanisms.replace('{list}', c.mechanizmy.join(', '))}</span>
                )}
              </div>
            ))
          )}
        </>
      )}
      <div className="section-actions section-actions--start">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void run(window.electronAPI.wskazPodpisBiblioteke)}
          disabled={busy}
        >
          <Icon name="folder" size={14} /> {t.podpisPickLibrary}
        </button>
        {stan?.reczna && (
          <button
            type="button"
            className="button button-subtle"
            onClick={() => void run(window.electronAPI.resetPodpisBiblioteke)}
            disabled={busy}
          >
            <Icon name="refresh" size={14} /> {t.podpisAutoLibrary}
          </button>
        )}
      </div>
    </FormSection>
  );
};
