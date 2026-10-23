import React from 'react';
import { Adres, Bank, KontoTyp, ZgnJednostka } from '../../../shared/types';
import { translations, Language } from '../../translations';
import { formatAccount } from '../../../shared/account-extractor';
import Icon from '../Icon';
import Tip from '../Tip';

/** Tabs of the Adresy module: the communities themselves plus their dictionaries. */
/**
 * One community of the list. Memoized, with its bank, city unit and account
 * types handed in from maps built once: the address form keeps its fields in
 * the view's state, so every key typed there used to re-render — and re-search
 * the bank, unit and type lists for — every row of the table.
 */
export const AdresRow = React.memo(function AdresRow({
  adres,
  bank,
  jednostka,
  kontoTypyById,
  missingOf,
  language,
  onEdit,
  onDelete,
  onZarzad,
  onMappings,
}: {
  adres: Adres;
  bank: Bank | undefined;
  jednostka: ZgnJednostka | undefined;
  kontoTypyById: Map<number, KontoTyp>;
  missingOf: (a: Adres) => string[];
  language: Language;
  onEdit: (adres: Adres) => void;
  onDelete: (id: number) => void;
  onZarzad: (id: number) => void;
  onMappings: (id: number) => void;
}) {
  const t = translations[language];
  const altNames = adres.alternativeNames ?? [];
  const swrk = adres.swrkIdentifiers ?? [];
  const accounts = adres.accountNumbers ?? [];
  const zarzadCount = adres.zarzad?.length ?? 0;
  const mappingsCount = adres.apartmentMappings?.length ?? 0;
  const missing = missingOf(adres);
  return (
    <tr>
      <td className="data-table__name nowrap">
        <span className="adres-missing-slot">
          {missing.length > 0 && (
            <Tip
              className="cell-warning"
              ariaLabel={`${t.adresMissingTitle}: ${missing.join(', ')}`}
              content={
                <>
                  <div className="tip__title">{t.adresMissingTitle}</div>
                  <ul className="tip__list">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              }
            >
              <Icon name="alert-triangle" size={14} />
            </Tip>
          )}
        </span>
        {/* Spelling variants are for matching, not for reading the list —
            on hover only (search still finds them). */}
        <span
          className="cell-title"
          data-tip={altNames.length > 0 ? `${t.alternativeNames}:\n${altNames.join('\n')}` : undefined}
        >
          {adres.nazwa}
        </span>
      </td>
      <td className="nowrap">
        {bank ? bank.name : <span className="cell-empty">—</span>}
      </td>
      <td>
        {accounts.length > 0 ? (
          <div className="adres-accounts">
            {accounts.map((acc) => {
              const typId = adres.accountTypes?.[acc];
              const typ = typId != null ? kontoTypyById.get(typId) : undefined;
              return (
                <React.Fragment key={acc}>
                  <span className="adres-account__number">{formatAccount(acc)}</span>
                  <span
                    className="adres-account__type"
                    data-tip={typ ? `${typ.name} (${typ.bankAccountSymbol})` : undefined}
                  >
                    {typ?.name ?? ''}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <span className="cell-warning" data-tip={t.adresNoAccountHint}>
            <Icon name="alert-triangle" size={13} />
            {t.adresNoAccount}
          </span>
        )}
      </td>
      <td>
        {swrk.length > 0 ? (
          <span className="adres-swrk">{swrk.join(', ')}</span>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </td>
      <td>
        {jednostka ? (
          <span className="adres-zgn" data-tip={jednostka.email}>{jednostka.nazwa}</span>
        ) : adres.bezZgn ? (
          <span className="cell-empty" data-tip={t.adresBezZgn}>{t.zgnUnitAbsent}</span>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </td>
      <td>
        <button
          type="button"
          className={`button button-small button-ghost count-button${zarzadCount === 0 ? ' is-zero' : ''}`}
          onClick={() => onZarzad(adres.id)}
          data-tip={
            zarzadCount > 0
              ? adres.zarzad!.map((m) => m.imieNazwisko).join(', ')
              : t.zarzadTitle
          }
          aria-label={`${t.zarzadTitle}: ${zarzadCount}`}
        >
          {zarzadCount > 0 ? (
            <><Icon name="users" size={13} />{zarzadCount}</>
          ) : (
            <><Icon name="plus" size={13} />{t.add}</>
          )}
        </button>
      </td>
      <td>
        <button
          type="button"
          className={`button button-small button-ghost count-button${mappingsCount === 0 ? ' is-zero' : ''}`}
          onClick={() => onMappings(adres.id)}
          data-tip={t.apartmentMappingsTitle}
          aria-label={`${t.apartmentMappings}: ${mappingsCount}`}
        >
          {mappingsCount > 0 ? (
            <><Icon name="clipboard" size={13} />{mappingsCount}</>
          ) : (
            <><Icon name="plus" size={13} />{t.add}</>
          )}
        </button>
      </td>
      <td className="data-table__actions">
        <div className="row-actions">
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => onEdit(adres)}
          >
            <Icon name="edit" size={13} />{' '}{t.edit}
          </button>
          <button
            type="button"
            className="button button-ghost button-icon icon-danger"
            onClick={() => onDelete(adres.id)}
            data-tip={t.delete}
            aria-label={`${t.delete}: ${adres.nazwa}`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
});
