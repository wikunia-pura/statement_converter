Official MF schemas (crd.gov.pl) of PIT-11 (29) and PIT-4R (13), with `schemaLocation`s rewritten to
relative paths so `xmllint --noout --schema <schemat.xsd> file.xml` validates offline. Public documents —
no personal data. Used by `scripts/pit-check.ts` to validate what the PIT module generates.
Add a new year's schema here when MF publishes a new variant (and a row in `PIT_WZORY`, src/shared/podatki-pit.ts).
