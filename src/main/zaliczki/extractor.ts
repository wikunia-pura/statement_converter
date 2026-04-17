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
  'zimna_woda_licznik',
  'zimna_woda_ryczalt',
  'scieki_licznik',
  'scieki_ryczalt',
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
  zimna_woda_licznik: '  Zimna woda - licznik',
  zimna_woda_ryczalt: '  Zimna woda - ryczałt',
  scieki_licznik: '  Ścieki - licznik',
  scieki_ryczalt: '  Ścieki - ryczałt',
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

B) Wyciągnij wartości (w zł, jako liczby dziesiętne z kropką). WAŻNE: NIE sumuj linii "licznik" z "ryczałt" — wpisuj je w osobne pola.

KOREKTY: linie "korekta …" / "cd potr. korekty …" NIE są osobną kategorią. Zostają wliczone (z zachowanym znakiem +/−) do tej kategorii, do której się odnoszą:
- "korekta c.w. lok. X ..." / "ciepła woda korekta" → DODAJ do ciepla_woda_licznik jeśli korekta dotyczy licznika (m³), albo do ciepla_woda_ryczalt jeśli dotyczy ryczałtu (m²/os.)
- "korekta z.w. lok. X ..." → analogicznie do zimna_woda_licznik / zimna_woda_ryczalt
- "korekta ścieków lok. X ..." / "korekta odprowadzanie ścieków" → analogicznie do scieki_licznik / scieki_ryczalt
- Korekta bywa UJEMNA (np. "−4 985,76") — zachowaj znak.
- Domyślnie traktuj korektę wody jako dotyczącą licznika (m³), bo tak jest najczęściej. Tylko jeśli linia jasno mówi o ryczałcie/powierzchni — dodawaj do _ryczalt.

1. zaliczka_utrzymanie — "1. Zaliczka na pokrycie kosztów utrzymania ..." (wartość w ostatniej kolumnie tej linii)
2. co_zmienna — "centralne ogrzewanie - zmienna" / "opłata zmienna" (jeśli jest tylko jedna linia "centralne ogrzewanie" bez podziału — wpisz tę wartość tutaj). Ewentualna korekta CO — wlicz z znakiem.
3. co_stala — "centralne ogrzewanie - opłata stała"

Ciepła woda — rozdziel na licznik i ryczałt:
4. ciepla_woda_licznik — SUMA linii z licznika/zużycia: "c.w. - liczniki radiowe", "ciepła woda liczniki", "ciepła woda licznik lok. X", "podgrzanie wody wg licznika" (jednostka m³), PLUS korekty c.w. dotyczące liczników (ze znakiem).
5. ciepla_woda_ryczalt — SUMA GENUINE linii ryczałtu: "ciepła woda" bez słowa "licznik" (jednostka m² lub os. bez liczników), "ciepła woda lok. X i Y" (ryczałt dla lokali bez licznika). PLUS korekty c.w. dotyczące ryczałtu. NIE wpisuj tu zwykłych korekt licznika!

Zimna woda — rozdziel na licznik i ryczałt:
6. zimna_woda_licznik — SUMA linii z licznika: "z.w. - liczniki radiowe", "zimna woda liczniki", "zimna woda licznik lok. X" (jednostka m³), PLUS korekty z.w. dotyczące liczników.
7. zimna_woda_ryczalt — SUMA linii ryczałtu: "zimna woda" bez "licznik", "woda gospodarcza" (jeśli dotyczy ZW), PLUS korekty z.w. dotyczące ryczałtu. Jeśli zimna woda i ścieki są w JEDNEJ linii ("zimna woda i kanalizacja"), wpisz tu całość i ustaw scieki_licznik/scieki_ryczalt na null.

Ścieki — rozdziel na licznik i ryczałt:
8. scieki_licznik — SUMA głównych linii "odprowadzanie ścieków" powiązanych z licznikami (m³), PLUS korekty ścieków dotyczące liczników.
9. scieki_ryczalt — SUMA linii ryczałtowych ścieków: "odprowadzanie ścieków" powiązane z "wodą gospodarczą", PLUS korekty ścieków dotyczące ryczałtu.

10. razem_swiadczenia — "Razem świadczenia" / "Świadczenia razem"
11. odpady_komunalne — "Razem odpady komunalne" / "Wywóz nieczystości" / "3. Gospodarowanie odpadami komunalnymi"
12. fundusz_remontowy — "4. Fundusz remontowy" / "4. Zaliczka B - Fundusz remontowy"
13. razem_total — ogólna suma "zaliczka A, B i świadczenia" + odpady (zazwyczaj w prawym dolnym rogu w ramce, np. "Razem zal. A, B, św. i odpady")

WAŻNE:
- Jeśli wartości nie ma na stronie — wpisz null (nie 0).
- Nie zgaduj — jeśli nie jesteś pewien, wpisz null.
- Korekty i noty obciążeniowe mogą być ujemne — uwzględnij znak.
- Nie sumuj licznika z ryczałtem pod żadnym pozorem — są to OSOBNE pola.
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
        "zimna_woda_licznik": 545.72,
        "zimna_woda_ryczalt": null,
        "scieki_licznik": 833.14,
        "scieki_ryczalt": null,
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
  const resp = await client.messages.create({
    model,
    max_tokens: 32000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming['messages'],
  });

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
