/**
 * Checks the e-Deklaracje gateway client without filing anything: the envelope, canned answers (taken,
 * processing, refused, SOAP fault, timeout-free HTTP error), and one live `requestUPO` with a made-up refId
 * against the TEST gateway — it must come back as a parsed status, which proves the envelope and headers.
 * Run: `npx tsx scripts/edeklaracje-check.ts` (add `--offline` to skip the live call).
 * Never calls `sendDocument` on a live gateway.
 */
import { FetchLike, koperta, pobierzUpo, wyslijDokument } from '../src/main/podatki/eDeklaracjeBramka';
import { etapStatusu } from '../src/shared/e-deklaracje';

let bledy = 0;
const ok = (warunek: boolean, nazwa: string, extra = '') => {
  if (warunek) console.log(`PASS ${nazwa}`);
  else {
    bledy += 1;
    console.log(`FAIL ${nazwa} ${extra}`);
  }
};

const odpowiedz = (body: string, status = 200): FetchLike => async (_url, init) => {
  ok(init.headers.SOAPAction.startsWith('"urn:'), 'SOAPAction header');
  return { ok: status === 200, status, text: async () => body };
};
const env = (inner: string) =>
  `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

async function main() {
  const k = koperta('sendDocument', [['document', 'PD94bWw+']]);
  ok(k.includes('<ns:sendDocument><ns:document>PD94bWw+</ns:document></ns:sendDocument>'), 'envelope');

  const przyjety = await wyslijDokument(
    odpowiedz(env('<ns2:sendDocumentResponse xmlns:ns2="https://bramka.e-deklaracje.mf.gov.pl/xsd"><ns2:refId>a1b2c3</ns2:refId><ns2:status>300</ns2:status><ns2:statusOpis>Brak dokumentu</ns2:statusOpis></ns2:sendDocumentResponse>')),
    'test',
    '<Deklaracja/>',
  );
  ok(przyjety.refId === 'a1b2c3' && przyjety.status === 300, 'send taken (refId)');

  const nieprzyjety = await wyslijDokument(
    odpowiedz(env('<sendDocumentResponse><status>100</status><statusOpis>Błędny komunikat SOAP</statusOpis></sendDocumentResponse>')),
    'test',
    '<Deklaracja/>',
  );
  ok(nieprzyjety.refId === null && etapStatusu(nieprzyjety.status) === 'blad_transmisji', 'send not taken');

  const upo = await pobierzUpo(
    odpowiedz(env('<x:requestUPOResponse xmlns:x="u"><x:upo>&lt;Potwierdzenie&gt;ok&lt;/Potwierdzenie&gt;</x:upo><x:status>200</x:status><x:statusOpis>Przetwarzanie dokumentu zakończone poprawnie, pobierz UPO</x:statusOpis></x:requestUPOResponse>')),
    'test',
    'a1b2c3',
  );
  ok(upo.upo === '<Potwierdzenie>ok</Potwierdzenie>' && etapStatusu(upo.status) === 'przyjeta', 'UPO 200 unescaped');

  const odrzucony = await pobierzUpo(
    odpowiedz(env('<requestUPOResponse><status>402</status><statusOpis>Brak aktualnego pełnomocnictwa/upoważnienia do podpisywania deklaracji</statusOpis></requestUPOResponse>')),
    'test',
    'a1b2c3',
  );
  ok(odrzucony.upo === null && etapStatusu(odrzucony.status) === 'odrzucona', 'UPO 402 refused');

  try {
    await pobierzUpo(odpowiedz(env('<soapenv:Fault><faultcode>soapenv:Client</faultcode><faultstring>Unmarshalling Error</faultstring></soapenv:Fault>'), 500), 'test', 'x');
    ok(false, 'SOAP fault throws');
  } catch (e) {
    ok(String(e).includes('Unmarshalling Error'), 'SOAP fault throws');
  }
  try {
    await pobierzUpo(odpowiedz('<html>502</html>', 502), 'test', 'x');
    ok(false, 'HTTP error throws');
  } catch (e) {
    ok(String(e).includes('HTTP 502'), 'HTTP error throws');
  }

  if (!process.argv.includes('--offline')) {
    const live = await pobierzUpo(fetch as unknown as FetchLike, 'test', '00000000000000000000000000000000');
    console.log(`live test gateway: ${live.status} ${live.opis}`);
    ok(live.upo === null && live.status >= 100, 'live requestUPO on the TEST gateway parsed');
  }
  console.log(bledy === 0 ? 'ALL PASS' : `${bledy} FAILED`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main();
