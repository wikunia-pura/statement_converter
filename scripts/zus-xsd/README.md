The official KEDU 5.7 schema (`http://www.zus.pl/2026/KEDU_5_7`) as Płatnik 10.02.002 ships it — taken from ZUS's
update package `pobierz.zus.pl/dystrybucja/slowniki/PakietyAktualizacjaP2_X_327.zip` (`kedu_5_7.xsd.zip` inside).
The only change: the `xs:import` of the XML-DSig schema points at the local `xmldsig-core-schema.xsd` (W3C,
www.w3.org/TR/xmldsig-core/) instead of the web, so `xmllint --nonet --noout --schema kedu_5_7.xsd file.xml`
validates offline. Public documents — no personal data. Used by `scripts/zus-check.ts` and
`scripts/zus-roundtrip.ts` to validate what the ZUS module writes.
When ZUS publishes a new KEDU version, put its schema here and move `KEDU_NS` (src/main/podatki/zusKedu.ts) to it.
