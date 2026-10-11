Official MF schemas (crd.gov.pl) of CIT-8 (34) with its attachments, CIT-8/O (20) among them, with
`schemaLocation`s rewritten to relative paths so `xmllint --noout --schema <schemat.xsd> file.xml` validates
offline. Public documents — no personal data. Used by `scripts/cit-check.ts` to validate what the CIT module
generates. Entry point: `cit8/crd.gov.pl/wzor/2026/01/07/14112/schemat.xsd` (published 2026-01-07, tax years
from 2025). Add a new year's schema here when MF publishes a new variant (and a row in `citWzor`,
src/shared/podatki-cit.ts).
