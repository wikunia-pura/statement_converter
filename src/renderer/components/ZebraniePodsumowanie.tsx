import React, { useEffect, useMemo, useState } from 'react';
import { MailingPole, ZebranieWersja } from '../../shared/types';
import { ZebranieDane, wersjaLabel, zawiadomienieOf } from '../../shared/zebrania';
import {
  buildKalendarzContext,
  formatPolishDate,
  missingFieldValues,
} from '../../shared/mailing-template';
import { okresLabel } from '../../shared/sprawozdanie';
import { Skrot, planSkrot, sprawozdanieSkrot } from '../../shared/zebranie-podsumowanie';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import { FormSection } from './FormSection';
import Icon from './Icon';

type T = (typeof translations)['pl'];
type Tab = 'zawiadomienie' | 'sprawozdania' | 'plan';
type Stan = 'gotowe' | 'uzupelnij' | 'brak';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Headline figures as tiles, the notes under them — the statement tab's look. */
const SkrotTiles: React.FC<{ t: T; skrot: Skrot }> = ({ t, skrot }) => (
  <>
    <div className="zfin-kpis">
      {skrot.liczby.map((l) => (
        <div key={l.etykieta} className={`zfin-kpi zfin-kpi--${l.ton}`}>
          <span>{l.etykieta}</span>
          <strong>{l.wartosc}</strong>
        </div>
      ))}
    </div>
    {skrot.uwagi.length > 0 && (
      <div className="callout callout--warning">
        <Icon name="alert-triangle" size={16} />
        <div className="callout__body">
          <strong>{t.zfinIntroNotes}</strong>
          <ul className="zfin-notes">
            {skrot.uwagi.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      </div>
    )}
  </>
);

/** A part of the package as an on/off row; a part the version lacks cannot be switched on. */
const PakietSwitch: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  nested?: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, hint, checked, disabled, nested, onChange }) => (
  <label className={`switch-row${nested ? ' zpod-switch--nested' : ''}${disabled ? ' is-disabled' : ''}`}>
    <span className="switch-row__text">
      <span className="switch-row__label">{label}</span>
      <span className="switch-row__hint">{hint}</span>
    </span>
    <span className="toggle-switch">
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-slider"></span>
    </span>
  </label>
);

/**
 * "Podsumowanie" of one version: where each part of the materials stands (the
 * notice, the statement, the plan — each a way to its tab), their headline
 * figures, and "Pakiet PDF": the parts chosen, behind a cover summing them up,
 * in one file to send to whoever needs them.
 */
const ZebraniePodsumowanie: React.FC<{
  language: Language;
  locale: string;
  wersja: ZebranieWersja;
  dane: ZebranieDane;
  onTab: (tab: Tab) => void;
}> = ({ language, locale, wersja, dane, onTab }) => {
  const t = translations[language];
  const notify = useNotify();
  const [pola, setPola] = useState<MailingPole[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [wybor, setWybor] = useState({ zawiadomienie: true, sprawozdanie: true, wstep: true, plan: true });

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .mailingGetPola()
      .then((p) => {
        if (!cancelled) setPola(p);
      })
      .catch(() => {
        if (!cancelled) setPola([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const material = zawiadomienieOf(wersja);
  const spr = wersja.sprawozdanie;
  const plan = wersja.plan;

  // The blanks the notice's own download would refuse — the package refuses them too.
  const missing = useMemo(() => {
    if (!material || !pola) return [];
    return missingFieldValues(
      {
        adresNazwa: dane.adresNazwa,
        dateText: formatPolishDate(new Date()),
        pola,
        values: material.values,
        tableFields: material.tableFields,
        kalendarz: buildKalendarzContext(dane),
      },
      material.temat,
      material.tresc
    );
  }, [material, pola, dane]);

  const planNieaktualny =
    !!plan &&
    !!spr &&
    (plan.sprawozdanieOkres.od !== spr.dane.okresOd || plan.sprawozdanieOkres.do !== spr.dane.okresDo);

  const czesci: {
    tab: Tab;
    icon: React.ComponentProps<typeof Icon>['name'];
    title: string;
    stan: Stan;
    detail: string;
  }[] = [
    {
      tab: 'zawiadomienie',
      icon: 'mail',
      title: t.zebraniaTabNotice,
      stan: !material ? 'brak' : missing.length > 0 ? 'uzupelnij' : 'gotowe',
      detail: !material
        ? t.zebraniaNoticeNone
        : missing.length > 0
          ? t.zpodNoticeMissing.replace('{fields}', missing.join(', '))
          : [
              material.szablonNazwa ? `${t.zebraniaNoticeTemplate}: ${material.szablonNazwa}` : '',
              material.updatedAt
                ? t.zplanChanged
                    .replace('{when}', formatStamp(material.updatedAt, locale))
                    .replace('{who}', material.updatedBy || '—')
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
    },
    {
      tab: 'sprawozdania',
      icon: 'bar-chart',
      title: t.zebraniaTabReports,
      stan: spr ? 'gotowe' : 'brak',
      detail: spr
        ? t.zfinStatementDesc
            .replace('{okres}', okresLabel(spr.dane.okresOd, spr.dane.okresDo))
            .replace('{wydruk}', spr.dane.wydruk || '—')
        : t.zfinEmptyTitle,
    },
    {
      tab: 'plan',
      icon: 'wallet',
      title: t.zebraniaTabPlan,
      stan: !plan ? 'brak' : planNieaktualny ? 'uzupelnij' : 'gotowe',
      detail: !plan
        ? spr
          ? t.zpodPlanNone
          : t.zplanNeedStatementText
        : planNieaktualny
          ? t.zplanStatementChanged
          : [
              t.zplanTitle.replace('{rok}', String(plan.rok)),
              plan.zmieniono
                ? t.zplanChanged
                    .replace('{when}', formatStamp(plan.zmieniono, locale))
                    .replace('{who}', plan.zmienil || '—')
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
    },
  ];
  const stanLabel: Record<Stan, string> = {
    gotowe: t.zpodReady,
    uzupelnij: t.zpodNeedsWork,
    brak: t.zpodMissing,
  };
  const stanTone: Record<Stan, string> = {
    gotowe: 'status-success',
    uzupelnij: 'status-pending',
    brak: 'status-neutral',
  };

  const moze = {
    zawiadomienie: !!material && missing.length === 0,
    sprawozdanie: !!spr,
    plan: !!plan,
  };
  const request = {
    wersjaId: wersja.id,
    zawiadomienie: moze.zawiadomienie && wybor.zawiadomienie,
    sprawozdanie: moze.sprawozdanie && wybor.sprawozdanie,
    wstep: wybor.wstep,
    plan: moze.plan && wybor.plan,
  };
  const anything = request.zawiadomienie || request.sprawozdanie || request.plan;

  const download = async () => {
    setBusy(true);
    try {
      const { filePath } = await window.electronAPI.exportZebraniePakiet(request);
      setLastFile(filePath);
      notify.success(t.zfinDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinDownloadError);
    } finally {
      setBusy(false);
    }
  };

  const v = wersjaLabel(wersja);
  return (
    <div className="page-form zeb-page">
      <FormSection
        icon="clipboard"
        title={t.zpodPartsTitle.replace('{v}', v)}
        description={t.zpodPartsDesc}
      >
        <ul className="zpod-parts">
          {czesci.map((c) => (
            <li key={c.tab}>
              <button type="button" className={`zpod-part zpod-part--${c.stan}`} onClick={() => onTab(c.tab)}>
                <span className="zpod-part__icon">
                  <Icon name={c.icon} size={16} />
                </span>
                <span className="zpod-part__main">
                  <strong>{c.title}</strong>
                  <span>{c.detail}</span>
                </span>
                <span className={`status-badge ${stanTone[c.stan]}`}>{stanLabel[c.stan]}</span>
                <Icon name="chevron-right" size={15} />
              </button>
            </li>
          ))}
        </ul>
      </FormSection>

      {spr && (
        <FormSection
          icon="bar-chart"
          title={t.zpodStatementShort}
          description={t.zpodPeriod.replace('{okres}', okresLabel(spr.dane.okresOd, spr.dane.okresDo))}
        >
          <SkrotTiles t={t} skrot={sprawozdanieSkrot(spr.dane, spr.wstep)} />
        </FormSection>
      )}

      {plan && (
        <FormSection
          icon="wallet"
          title={t.zpodPlanShort.replace('{rok}', String(plan.rok))}
          description={t.zpodPlanShortDesc}
        >
          <SkrotTiles t={t} skrot={planSkrot(plan)} />
        </FormSection>
      )}

      <FormSection icon="download" title={t.zpodPackageTitle} description={t.zpodPackageDesc}>
        <PakietSwitch
          label={t.zebraniaTabNotice}
          hint={
            !material ? t.zpodNotInVersion : missing.length > 0 ? t.zpodNoticeFillFirst : t.zpodNoticeHint
          }
          checked={wybor.zawiadomienie}
          disabled={!moze.zawiadomienie || busy}
          onChange={(value) => setWybor((w) => ({ ...w, zawiadomienie: value }))}
        />
        <PakietSwitch
          label={t.zebraniaTabReports}
          hint={spr ? t.zpodStatementHint : t.zpodNotInVersion}
          checked={wybor.sprawozdanie}
          disabled={!moze.sprawozdanie || busy}
          onChange={(value) => setWybor((w) => ({ ...w, sprawozdanie: value }))}
        />
        <PakietSwitch
          nested
          label={t.zfinIntroInPdf}
          hint={t.zfinIntroInPdfHint}
          checked={wybor.wstep}
          disabled={!request.sprawozdanie || busy}
          onChange={(value) => setWybor((w) => ({ ...w, wstep: value }))}
        />
        <PakietSwitch
          label={t.zebraniaTabPlan}
          hint={plan ? t.zpodPlanHint : t.zpodNotInVersion}
          checked={wybor.plan}
          disabled={!moze.plan || busy}
          onChange={(value) => setWybor((w) => ({ ...w, plan: value }))}
        />
        {!anything && (
          <div className="callout callout--muted">
            <Icon name="info" size={16} />
            <div className="callout__body">
              {moze.zawiadomienie || moze.sprawozdanie || moze.plan ? t.zpodPickSomething : t.zpodNothingYet}
            </div>
          </div>
        )}
        <div className="zeb-doc-actions">
          <div className="zeb-doc-actions__buttons">
            <button
              type="button"
              className="button button-small button-primary"
              onClick={() => void download()}
              disabled={busy || !anything}
            >
              <Icon name={busy ? 'loader' : 'download'} size={13} /> {t.zpodDownload}
            </button>
            {lastFile && (
              <button
                type="button"
                className="button button-small button-ghost"
                onClick={() => void window.electronAPI.mailingShowInFolder(lastFile)}
              >
                <Icon name="folder" size={13} /> {t.zfinShowInFolder}
              </button>
            )}
          </div>
          <span className="zeb-muted">{t.zpodCoverNote}</span>
        </div>
      </FormSection>
    </div>
  );
};

export default ZebraniePodsumowanie;
