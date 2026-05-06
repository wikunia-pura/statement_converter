/**
 * Extract monthly housing-community fee data from scanned PDFs using Claude vision.
 *
 * One request per PDF; the model identifies each property page and returns the 10
 * canonical fee categories (advance, heating, water, sewage, waste, renovation, etc.).
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import logger from '../../shared/logger';

export const ZALICZKI_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
] as const;

export const DEFAULT_ZALICZKI_MODEL = 'claude-sonnet-4-6';

export const ZALICZKI_CATEGORIES = [
  'zaliczka_utrzymanie',
  'co_zmienna',
  'co_stala',
  'ciepla_woda_licznik',
  'ciepla_woda_ryczalt',
  'zw_kanalizacja_licznik',
  'zw_kanalizacja_ryczalt',
  'woda_gospodarcza',
  'razem_swiadczenia',
  'odpady_komunalne',
  'fundusz_remontowy',
  'razem_total',
] as const;

export type ZaliczkiCategory = typeof ZALICZKI_CATEGORIES[number];

export const ZALICZKI_CATEGORY_LABELS: Record<ZaliczkiCategory, string> = {
  zaliczka_utrzymanie: '1. Zaliczka na utrzymanie',
  co_zmienna: '  CO - opłata zmienna',
  co_stala: '  CO - opłata stała',
  ciepla_woda_licznik: '  Ciepła woda - licznik',
  ciepla_woda_ryczalt: '  Ciepła woda - ryczałt',
  zw_kanalizacja_licznik: '  Zimna woda + kanalizacja - licznik',
  zw_kanalizacja_ryczalt: '  Zimna woda + kanalizacja - ryczałt',
  woda_gospodarcza: '  Woda gospodarcza',
  razem_swiadczenia: '2. Razem świadczenia',
  odpady_komunalne: '3. Odpady komunalne',
  fundusz_remontowy: '4. Fundusz remontowy',
  razem_total: 'RAZEM (zal.+św.+odpady)',
};

const ROMAN_TO_MONTH: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

export const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
                            'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export interface PropertyData {
  property: string;
  values: Partial<Record<ZaliczkiCategory, number | null>>;
}

export interface ExtractionResult {
  filename: string;
  month: number | null;
  year: number | null;
  properties: PropertyData[];
  rawResponse: string;
}

export function monthFromFilename(name: string): { month: number | null; year: number | null } {
  const m = name.match(/\b(XII|XI|IX|VIII|VII|VI|IV|V|III|II|I)[ .\-_]*(\d{4})/);
  if (!m) return { month: null, year: null };
  return { month: ROMAN_TO_MONTH[m[1]] ?? null, year: parseInt(m[2], 10) };
}

const PROMPT = `ZASADA NADRZĘDNA: Twoja odpowiedź MUSI być pojedynczym, poprawnym obiektem JSON. Pierwszy znak odpowiedzi to "{", ostatni to "}". Nie pisz NIC innego — żadnej analizy, żadnych komentarzy, żadnego "Let me analyze...", żadnych "Page 1:", żadnego markdown, żadnych \`\`\`-fencji. Jeśli zaczniesz odpowiedź od czegokolwiek innego niż "{", łamiesz kontrakt.

Jesteś narzędziem do ekstrakcji danych finansowych z dokumentów wspólnot mieszkaniowych.

Ten PDF zawiera jedną lub więcej stron — każda strona dotyczy jednej wspólnoty mieszkaniowej (identyfikowanej przez adres) i zawiera zaliczki/opłaty za dany miesiąc.

UWAGA: strony mogą być zeskanowane do góry nogami (obrócone o 180°). Mimo to przeczytaj tekst normalnie — nie odrzucaj stron z powodu orientacji.

Na początku zidentyfikuj MIESIĄC i ROK, których dotyczy dokument — zazwyczaj w nagłówku jest fraza "Zaliczka ... za <miesiąc> <rok> rok" lub "za m-c <MIESIĄC> <rok>". Polskie nazwy miesięcy mapuj na liczby:
styczeń=1, luty=2, marzec=3, kwiecień=4, maj=5, czerwiec=6, lipiec=7, sierpień=8, wrzesień=9, październik=10, listopad=11, grudzień=12.
Jeśli różne strony dotyczą różnych miesięcy — zwróć miesiąc/rok z PIERWSZEJ strony.

Dla KAŻDEJ strony:

A) Zidentyfikuj ADRES wspólnoty — zazwyczaj wpisany jako "Wspólnota Mieszkaniowa <adres>" w górnej części strony (np. "al. Niepodległości 103", "Bokserska 34", "Śniardwy 6", "P.Gruszczyńskiego 14A").
- Jeśli dokument pokazuje "Lokale mieszkalne" / "dot: lokali mieszkalnych" → dopisz " (mieszkalne)"
- Jeśli dokument pokazuje "Lokale użytkowe" / "LOKALE UŻYTKOWE" → dopisz " (użytkowe)"
- Przykłady: "Bokserska 34 (mieszkalne)", "Rzymowskiego 45 (użytkowe)", "al. Niepodległości 103 (mieszkalne)"
- Używaj DOKŁADNIE tej samej formy adresu co na dokumencie (zachowaj polskie znaki, wielkość liter, kropki, cudzysłowy).

B) Wyciągnij wartości (w zł, jako liczby dziesiętne z kropką).

GENERYCZNA REGUŁA KLASYFIKACJI licznik vs ryczałt (stosuje się do KAŻDEJ wspólnoty):
1. Jeśli linia w opisie literalnie zawiera słowo "**ryczałt**" lub "**rycz.**" → wartość trafia do pola **_ryczalt**.
2. Inaczej, jeśli linia w opisie literalnie zawiera słowo "**licznik**" / "**liczniki**" / "**liczb.**" / "**licz.**" → wartość trafia do pola **_licznik**.
3. Inaczej, jeśli w jednostce/wzorze linii pojawia się **m³** (np. "1,00 m³", "47,00 m³", "3 os × 2,00 m³ × 8,29", "118,50 m³ × 40,00") → wartość trafia do pola **_licznik**.
4. Inaczej (linia bez słowa licznik/ryczałt i bez m³, liczona np. tylko per "X os × stawka", "Y m² × stawka", "Z gosp × zł/gosp") → wartość trafia do pola **_ryczalt**.
- Sformułowania pomocnicze ("liczniki radiowe", "(normy ind./os.)", "lok. X") nie wpływają na klasyfikację — liczą się tylko reguły 1–4 wyżej.
- Wyjątek: słowo "woda gospodarcza" (i jej korekty) ma własne, osobne pole woda_gospodarcza — patrz pkt 8 niżej. Nie wrzucaj jej do zw_kanalizacja_*.

REGUŁA ŁĄCZENIA Z.W. + KANALIZACJI (ścieków):
- W jednym wierszu wynikowym łączymy zimną wodę i kanalizację (ścieki). Niezależnie od tego, czy w PDF są to:
  - dwie osobne linie ("zimna woda 18 os × 3 m³ × 5,43" + "odprowadzanie ścieków 18 os × 3 m³ × 8,29") — ZSUMUJ je do zw_kanalizacja_licznik (lub _ryczalt),
  - jedna połączona linia ("zimna woda i kanalizacja - licznik 25 m³ × 14,90 = 372,50") — wpisz wartość 1:1 do zw_kanalizacja_licznik (lub _ryczalt),
- Klasyfikacja licznik vs ryczałt dla części z.w. i ścieków zawsze idzie razem (jeśli z.w. ma m³, to i ścieki w tej samej linii idą do licznika).
- NIE łącz licznika z ryczałtem — to są osobne pola, mimo wspólnej nazwy "Z.W. + kanalizacja".

REGUŁA SUMOWANIA: w ramach jednego pola kategorii ZSUMUJ WSZYSTKIE pasujące linie z tej strony, w tym:
- linię główną (np. "ciepła woda 28 os × 2 m³ × 40 = 2240", "zimna woda i kanalizacja 25 m³"),
- linie per-lokalowe (np. "ciepła woda lok. 18 i 25 12 os × 1 m³ × 40 = 480", "c.w. licznik lok. 16 ...", "z.w. licznik lok. 1", "z.w. licznik lok. 2"),
- korekty lokalne (patrz niżej).
Nie wybieraj tylko jednej linii — jeśli na stronie są DWIE linie "zimna woda i kanalizacja - licznik" (np. lok. 1 i lok. 2), obie idą do tego samego pola zw_kanalizacja_licznik (suma). Pominięcie linii daje błędną sumę.

KOREKTY — odróżnij dwa rodzaje:
A) **Korekta lokalna / per-lokalowa** — linia w opisie ma kontekst konkretnego lokalu lub konkretnej kategorii, np. "korekta c.w. lok. 5", "cd potr. korekty Uchwały ... lok 55", "Korekta za viii/2025 lok.35", "Nota lic. korygująca ... korekta dotyczy zużycia C.W. w lok 1.13". TAKĄ korektę DOLICZ (z zachowanym znakiem +/−) do właściwej kategorii według reguł klasyfikacji 1–4. Większość korekt jest UJEMNA — zachowaj minus.
B) **Nota globalna** — linia "Nota X/Y/Z z dnia DD.MM.RRRR" BEZ kontekstu konkretnego lokalu ani konkretnej kategorii (np. "Nota 3/58/52 z dnia 20.08.2025r." -14 990,63 zł). Taką notę **IGNORUJ** — nie dodawaj do żadnej kategorii. Ona modyfikuje tylko końcowy RAZEM (i tak go odczytasz z ramki w PDF).
Wskazówka rozróżnienia: jeśli w treści linii jest "lok. X", "C.W. w lok X", "z.w. lok X" itp. → korekta lokalna (rodzaj A). Jeśli to gołe "Nota …" bez wskazania lokalu/kategorii → nota globalna (rodzaj B).

1. zaliczka_utrzymanie — "1. Zaliczka na pokrycie kosztów utrzymania ..." (wartość w ostatniej kolumnie tej linii). Doliczaj korekty lokalne zaliczki utrzymania (np. "cd potr. korekty Uchwały ...").
2. co_zmienna — "centralne ogrzewanie - zmienna" / "opłata zmienna" (jeśli jest tylko jedna linia "centralne ogrzewanie" bez podziału — wpisz tę wartość tutaj). Doliczaj korekty CO ze znakiem.
3. co_stala — "centralne ogrzewanie - opłata stała"

Ciepła woda — reguły 1–4:
4. ciepla_woda_licznik — SUMA WSZYSTKICH linii c.w. zaklasyfikowanych jako licznik wg reguł 1–4: "c.w. - liczniki radiowe", "ciepła woda - liczb.", "ciepła woda" z m³ ("28 os × 2 m³ × 40"), "c.w. licznik lok. X"; PLUS korekty lokalne c.w. licznika ze znakiem.
5. ciepla_woda_ryczalt — SUMA linii c.w. zaklasyfikowanych jako ryczałt wg reguł 1–4: "ciepła woda - ryczałt - lok. X", "ciepła woda" bez m³; PLUS korekty lokalne c.w. ryczałtu ze znakiem.

Zimna woda + kanalizacja (ścieki) — łączone w JEDNEJ pozycji, rozdzielone tylko na licznik / ryczałt:
6. zw_kanalizacja_licznik — SUMA wszystkich linii z.w. + ścieków zaklasyfikowanych jako licznik:
    - "zimna woda 33 os × 3 m³ × 5,43" (rule 3, m³),
    - "odprowadzanie ścieków 33 os × 3 m³ × 8,29" (rule 3, m³),
    - "zimna woda i kanalizacja - licznik Lok. X" 5×3×13,72 (rule 2, "licznik"),
    - "z.w. - liczniki radiowe 47,00 m³ × 5,43" (rule 2, "liczniki"),
    - "z.w. licznik lok. X" + "odprow. ścieków lok. X",
    - PLUS korekty lokalne z.w./ścieków klasyfikowane jako licznik ze znakiem.
   Nie wrzucaj tu "wody gospodarczej" (osobne pole nr 8); ALE odpowiadające jej "odprowadzanie ścieków" linijki Z m³ TAK trafiają tutaj.
7. zw_kanalizacja_ryczalt — SUMA z.w. + ścieków zaklasyfikowanych jako ryczałt:
    - "zimna woda i kanalizacja - ryczałt lok. X" (rule 1, "ryczałt"),
    - "z.w. ryczałt" + "odprow. ścieków ryczałt",
    - linie z.w./ścieków bez m³ i bez słów licznik/ryczałt (rule 4),
    - PLUS korekty lokalne z.w./ścieków klasyfikowane jako ryczałt ze znakiem.

8. woda_gospodarcza — OSOBNA pozycja TYLKO na linie literalnie nazwane "woda gospodarcza" (zwykle "X os × Y m³ × stawka_z.w.", np. "14 os × 0,50 m³ × 5,43 = 38,01 zł"). PLUS korekty wody gospodarczej. UWAGA: jeśli przy wodzie gospodarczej jest też linia "odprowadzanie ścieków" liczona po stronie wody gospodarczej (np. "14 os × 0,50 m³ × 8,29 = 58,03"), TĘ linię traktujemy jak zwykłe ścieki licznikowe i wrzucamy do zw_kanalizacja_licznik (NIE do woda_gospodarcza).

9. razem_swiadczenia — "Razem świadczenia" / "Świadczenia razem"
10. odpady_komunalne — "Razem odpady komunalne" / "Wywóz nieczystości" / "3. Gospodarowanie odpadami komunalnymi"
11. fundusz_remontowy — "4. Fundusz remontowy" / "4. Zaliczka B - Fundusz remontowy"
12. razem_total — ogólna suma "zaliczka A, B i świadczenia" + odpady (zazwyczaj w prawym dolnym rogu w ramce, np. "Razem zal. A, B, św. i odpady"). Tu odzwierciedla się też ewentualna nota globalna — odczytaj z ramki, nie licz sam.

WAŻNE:
- Jeśli wartości nie ma na stronie — wpisz null (nie 0). Nie wymyślaj wartości "po analogii" do innych miesięcy.
- Nie zgaduj — jeśli nie jesteś pewien, wpisz null.
- Korekty lokalne mogą być ujemne — uwzględnij znak. Noty globalne ignoruj.
- Klasyfikacja licznik vs ryczałt: priorytet słowa "ryczałt"/"licznik" w opisie linii, dopiero potem reguła m³.
- Pamiętaj sumować WSZYSTKIE pasujące linie (główna + per-lokalowe + korekty), nie tylko jedną.
- Zwróć WYŁĄCZNIE JSON, bez komentarza ani \`\`\`-fences.

Format odpowiedzi:
{
  "month": 1,
  "year": 2025,
  "properties": [
    {
      "property": "<adres (mieszkalne|użytkowe)>",
      "values": {
        "zaliczka_utrzymanie": 1417.20,
        "co_zmienna": 3117.84,
        "co_stala": 396.82,
        "ciepla_woda_licznik": 2075.20,
        "ciepla_woda_ryczalt": null,
        "zw_kanalizacja_licznik": 1378.86,
        "zw_kanalizacja_ryczalt": null,
        "woda_gospodarcza": null,
        "razem_swiadczenia": 6968.72,
        "odpady_komunalne": 720.00,
        "fundusz_remontowy": 1700.64,
        "razem_total": 10806.56
      }
    }
  ]
}

Jeśli nie udało się zidentyfikować miesiąca/roku — wpisz null dla month i/lub year.

KRYTYCZNE ZASADY FORMATU ODPOWIEDZI:
- Odpowiedz WYŁĄCZNIE poprawnym JSON. NIE pisz żadnego tekstu przed ani po JSON.
- NIE pisz analizy stron, komentarzy, notatek, myślnika ani słów "Let me", "Now", "Page 1:" itp.
- NIE używaj \`\`\`-fencji.
- Zacznij odpowiedź od znaku "{" i zakończ znakiem "}".`;

export async function extractZaliczkiFromPdf(
  pdfPath: string,
  apiKey: string,
  model: string = DEFAULT_ZALICZKI_MODEL,
): Promise<ExtractionResult> {
  if (!apiKey) {
    throw new Error('Brak klucza Anthropic API (ai-config.yml lub ANTHROPIC_API_KEY).');
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const base64 = pdfBytes.toString('base64');
  const filename = pdfPath.split(/[\\/]/).pop() ?? pdfPath;

  const client = new Anthropic({ apiKey });
  logger.info(`[ZALICZKI] Extracting ${filename} with ${model}`);

  // `document` content block (native PDF) is supported by the Anthropic API
  // but not yet typed in SDK v0.32. Cast the message payload to bypass the
  // type check — upgrading the SDK would ripple into ai-extractor.ts.
  // PROMPT goes FIRST with cache_control so the 2.6k-token instructions hit
  // the prefix cache across all PDFs in the user's batch (TTL ~5 min).
  const resp = await withRateLimitRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: 32000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: PROMPT,
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
            ],
          },
        ] as unknown as Anthropic.MessageCreateParamsNonStreaming['messages'],
      }),
    filename,
  );
  logCacheUsage(filename, resp.usage);

  const firstBlock = resp.content[0];
  const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';
  if (resp.stop_reason === 'max_tokens') {
    logger.warn(`[ZALICZKI] ${filename}: response hit max_tokens, JSON may be truncated`);
  }
  const parsed = parseJson(text);

  const properties: PropertyData[] = (parsed.properties ?? []).map((p: any) => ({
    property: p.property ?? '',
    values: Object.fromEntries(
      ZALICZKI_CATEGORIES.map((c) => [c, toNumber(p?.values?.[c])]),
    ) as Partial<Record<ZaliczkiCategory, number | null>>,
  }));

  const fromFilename = monthFromFilename(filename);
  const modelMonth =
    monthInRange(toNumber(parsed.month), 1, 12) ?? polishMonthNameToNumber(parsed.month);
  const modelYear = monthInRange(toNumber(parsed.year), 2000, 2100);
  const month = modelMonth ?? fromFilename.month;
  const year = modelYear ?? fromFilename.year;
  logger.info(
    `[ZALICZKI] ${filename}: model returned month=${JSON.stringify(parsed.month)}, ` +
      `year=${JSON.stringify(parsed.year)}; resolved month=${month}, year=${year}`,
  );
  return { filename, month, year, properties, rawResponse: text };
}

function monthInRange(n: number | null, min: number, max: number): number | null {
  if (n === null) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

const POLISH_MONTH_NAMES: Record<string, number> = {
  styczen: 1, stycznia: 1,
  luty: 2, lutego: 2,
  marzec: 3, marca: 3,
  kwiecien: 4, kwietnia: 4,
  maj: 5, maja: 5,
  czerwiec: 6, czerwca: 6,
  lipiec: 7, lipca: 7,
  sierpien: 8, sierpnia: 8,
  wrzesien: 9, wrzesnia: 9,
  pazdziernik: 10, pazdziernika: 10,
  listopad: 11, listopada: 11,
  grudzien: 12, grudnia: 12,
};

function polishMonthNameToNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const key = v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z]/g, '');
  return POLISH_MONTH_NAMES[key] ?? null;
}

function parseJson(text: string): any {
  // Locate the opening of our expected JSON object — it starts with one of the
  // top-level keys we ask for. Skipping any preamble the model might write.
  const startMatch = text.match(/\{\s*"(?:month|year|properties)"/);
  const firstBrace = startMatch?.index ?? text.indexOf('{');
  if (firstBrace < 0) {
    logger.error(`[ZALICZKI] Brak JSON w odpowiedzi modelu. Surowa odpowiedź:\n${text}`);
    throw new Error(`Odpowiedź bez JSON: ${text.slice(0, 300)}`);
  }
  const raw = text.slice(firstBrace);

  const stripFences = (s: string) => s.replace(/```json\s*/gi, '').replace(/```/g, '');
  const stripTrailing = (s: string) => s.replace(/,(\s*[}\]])/g, '$1');

  const attempts: Array<{ label: string; transform: (s: string) => string }> = [
    { label: 'raw', transform: (s) => s },
    { label: 'no-trailing-commas', transform: stripTrailing },
    { label: 'unfenced', transform: stripFences },
    { label: 'unfenced+trailing', transform: (s) => stripTrailing(stripFences(s)) },
    { label: 'recovered-truncated', transform: (s) => recoverTruncatedJson(stripFences(s)) },
  ];
  let lastErr: Error | null = null;
  for (const { label, transform } of attempts) {
    try {
      return JSON.parse(transform(raw));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logger.warn(`[ZALICZKI] JSON parse attempt '${label}' failed: ${lastErr.message}`);
    }
  }
  logger.error(`[ZALICZKI] Wszystkie próby parsowania JSON zawiodły. Surowa odpowiedź:\n${text}`);
  throw new Error(
    `Nieprawidłowy JSON z modelu (${lastErr?.message ?? 'unknown'}). Zobacz logi, aby obejrzeć surową odpowiedź.`,
  );
}

/**
 * If the JSON was truncated mid-array (e.g. hit max_tokens), drop any partial
 * trailing object and close outer structures so what we have parses cleanly.
 */
function recoverTruncatedJson(s: string): string {
  // Find the last character that closes a complete top-level array element
  // (a "}" followed by optional whitespace and "," or "]"). Trim everything
  // after it, then close the outer structures.
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompletePropertyEnd = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      // depth === 2 right after closing means we just finished one property
      // object inside the "properties" array (depth 0 = outside, 1 = top {},
      // 2 = inside properties array element).
      if (depth === 2 && ch === '}') lastCompletePropertyEnd = i;
    }
  }
  if (lastCompletePropertyEnd < 0) return s; // nothing recoverable
  // Keep through that "}" then close: ] for properties, } for root.
  return s.slice(0, lastCompletePropertyEnd + 1) + ']}';
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.').replace('zł', '');
  if (!s || s.toLowerCase() === 'null') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function logCacheUsage(filename: string, usage: unknown): void {
  const u = usage as Record<string, number | undefined> | undefined;
  if (!u) return;
  const created = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const input = u.input_tokens ?? 0;
  if (created || read) {
    logger.info(
      `[ZALICZKI] ${filename}: cache created=${created}, read=${read}, fresh input=${input}`,
    );
  }
}

/**
 * Retry on 429 rate_limit_error with Retry-After honor.
 * Anthropic SDK exposes the header via `err.headers['retry-after']` (seconds).
 * Input-token-per-minute limits recover in ≤60s, so we cap waits at 90s.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  filename: string,
  maxAttempts: number = 4,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.error?.type === 'rate_limit_error';
      if (!isRateLimit || attempt === maxAttempts) throw err;

      const headerRetry = parseFloat(
        err?.headers?.['retry-after'] ?? err?.response?.headers?.get?.('retry-after') ?? '',
      );
      const waitSeconds = Number.isFinite(headerRetry) && headerRetry > 0
        ? Math.min(headerRetry, 90)
        : Math.min(30 * attempt, 90);
      logger.warn(
        `[ZALICZKI] ${filename}: 429 rate_limit_error (attempt ${attempt}/${maxAttempts}), ` +
          `waiting ${waitSeconds}s before retry`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  // Unreachable — loop either returns or throws.
  throw new Error('withRateLimitRetry: exhausted retries unexpectedly');
}
