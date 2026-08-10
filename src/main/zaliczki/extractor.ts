/**
 * Extract monthly housing-community fee data from scanned PDFs using Claude vision.
 *
 * These files have no text layer at all (verified: `pdftotext` yields zero
 * characters on every sample workbook), so vision is unavoidable. What is
 * avoidable is doing it more than once, and doing it in one giant request.
 *
 * Every page is exactly one community, so a page is the unit of work:
 *   - one request per page, several pages in flight at once, so wall-clock time
 *     is a page instead of a whole document, and a 429 costs one page's retry
 *     rather than the entire file's;
 *   - each answer is checked against the totals printed on that same page
 *     (see validator.ts) and re-asked once if it contradicts itself;
 *   - each answer is cached under the page's content hash, so re-runs, restarts
 *     and re-added files cost nothing.
 *
 * Sending whole documents remains as a fallback for PDFs pdf-lib cannot split.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as crypto from 'crypto';
import * as fs from 'fs';
import logger from '../../shared/logger';
import { parseExtractionResponse } from './jsonExtract';
import { PROMPT_VERSION, readCachedPage, writeCachedPage } from './extractionCache';
import { splitPdfPages } from './pdfSplitter';
import { hasHardError, validateProperties, ZaliczkiWarning } from './validator';

export const ZALICZKI_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
] as const;

export const DEFAULT_ZALICZKI_MODEL = 'claude-sonnet-4-6';

/**
 * Model used to re-ask a page whose numbers contradict the totals printed on it.
 * Only failing pages reach it, so the extra rate applies to a handful of pages
 * per run. If the account cannot use it, the re-ask silently falls back to the
 * primary model — an unavailable escalation model must never break extraction.
 */
const ESCALATION_MODEL = 'claude-opus-5';

/**
 * One page's answer is ~250 tokens, so this is generous headroom for a page that
 * carries many per-lokal lines. Stays well under the limit where a non-streaming
 * request risks an HTTP timeout.
 */
const PAGE_MAX_TOKENS = 8000;

/**
 * The escalation model thinks by default, and thinking counts against the same
 * ceiling as the answer text, so a budget sized for the answer alone would cut
 * the JSON off mid-object. Doubled for the re-ask.
 */
const ESCALATION_MAX_TOKENS = 16000;

/**
 * Page requests in flight across the whole app, not per file. The renderer
 * starts several files at once, and every one of them draws from this budget;
 * without a shared cap the app would fan out files × pages requests and spend
 * the run in 429 backoff.
 */
const PAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.ZALICZKI_PAGE_CONCURRENCY ?? '') || 8,
);

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

export interface ExtractionStats {
  /** Pages the document was split into; 1 when the whole file was sent at once. */
  pages: number;
  /** Pages answered from the cache without an API call. */
  fromCache: number;
  /** Pages re-asked because their numbers contradicted the printed totals. */
  escalated: number;
  /** Pages that produced no usable answer at all. */
  failed: number;
  /** True when the document could not be split and was sent whole. */
  wholeFileFallback: boolean;
}

export interface ExtractionResult {
  filename: string;
  month: number | null;
  year: number | null;
  properties: PropertyData[];
  rawResponse: string;
  /** Arithmetic findings for the whole document, in page order. */
  warnings: ZaliczkiWarning[];
  stats: ExtractionStats;
}

export interface ExtractionProgress {
  filePath: string;
  totalPages: number;
  donePages: number;
  fromCache: number;
  stage: 'splitting' | 'extracting' | 'done';
}

export interface ExtractOptions {
  /** Skip the cache and re-ask the model. Used by "OCR ponownie". */
  force?: boolean;
  /**
   * Answer only from the cache and never touch the network. Used by the accuracy
   * harness so an accidental run cannot spend money; pages with no cached answer
   * are reported as failures instead of being fetched.
   */
  cacheOnly?: boolean;
  onProgress?: (progress: ExtractionProgress) => void;
}

export function monthFromFilename(name: string): { month: number | null; year: number | null } {
  // Longest-first, so XII/XI win before X and IX before I. Bare `X` was missing,
  // which meant October ("… X.2025.pdf") silently fell back to no month.
  const m = name.match(/\b(XII|XI|X|IX|VIII|VII|VI|IV|V|III|II|I)[ .\-_]*(\d{4})/);
  if (!m) return { month: null, year: null };
  return { month: ROMAN_TO_MONTH[m[1]] ?? null, year: parseInt(m[2], 10) };
}

/**
 * Cached answers are keyed by page content and `PROMPT_VERSION` — so any edit
 * below that could change what the model returns must bump `PROMPT_VERSION` in
 * extractionCache.ts, or stale answers keep being served for pages already seen.
 */
const PROMPT = `ZASADA NADRZĘDNA: Twoja odpowiedź MUSI być pojedynczym, poprawnym obiektem JSON. Pierwszy znak odpowiedzi to "{", ostatni to "}". Nie pisz NIC innego — żadnej analizy, żadnych komentarzy, żadnego "Let me analyze...", żadnych "Page 1:", żadnego markdown, żadnych \`\`\`-fencji. Jeśli zaczniesz odpowiedź od czegokolwiek innego niż "{", łamiesz kontrakt.

Jesteś narzędziem do ekstrakcji danych finansowych z dokumentów wspólnot mieszkaniowych.

Otrzymujesz dokument, w którym KAŻDA strona dotyczy JEDNEJ wspólnoty mieszkaniowej (identyfikowanej przez adres) i zawiera jej zaliczki/opłaty za dany miesiąc. Zazwyczaj jest to dokładnie jedna strona, czyli jedna pozycja w "properties". Zwróć jedną pozycję na każdą wspólnotę, którą widzisz.

UWAGA: strony mogą być zeskanowane do góry nogami (obrócone o 180°). Mimo to przeczytaj tekst normalnie — nie odrzucaj strony z powodu orientacji.

Zidentyfikuj MIESIĄC i ROK, których dotyczy dokument (jeśli strony dotyczą różnych miesięcy, podaj miesiąc pierwszej strony) — zazwyczaj w nagłówku jest fraza "Zaliczka ... za <miesiąc> <rok> rok" lub "za m-c <MIESIĄC> <rok>". Polskie nazwy miesięcy mapuj na liczby:
styczeń=1, luty=2, marzec=3, kwiecień=4, maj=5, czerwiec=6, lipiec=7, sierpień=8, wrzesień=9, październik=10, listopad=11, grudzień=12.

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

PRZYKŁAD (ilustracja reguły sumowania i klasyfikacji — nie kopiuj tych kwot):
Strona ze wspólnotą "Bachmacka 6A", lokale mieszkalne, październik 2025, zawiera linie:
  1. Zaliczka na pokrycie kosztów utrzymania   598,92 m² × 3,20 = 1 916,54
  centralne ogrzewanie opłata zmienna          618,62 m² × 5,00 = 3 093,10
  centralne ogrzewanie opłata stała            618,62 m² × 0,70 =   433,03
  ciepła woda                                  23 os × 2,00 m³ × 40,00 = 1 840,00
  ciepła woda lok. 18 i 25                     12 os × 1,00 m³ × 40,00 =   480,00
  zimna woda                                   28 os × 3,00 m³ × 5,90 =   495,60
  odprowadzanie ścieków                        28 os × 3,00 m³ × 9,00 =   756,00
  zimna woda lok. 18                            7 os × 2,00 m³ × 5,90 =    82,60
  odprow. ścieków lok.18                        7 os × 2,00 m³ × 9,00 =   126,00
  Razem świadczenia 7 306,33
  3. Odpady komunalne                          14 gosp × 60,00 =   840,00
  4. Fundusz remontowy                         598,92 m² × 1,50 =   898,38
Poprawny wynik: ciepla_woda_licznik = 1840,00 + 480,00 = 2320.00 (obie linie mają m³ → reguła 3; linia per-lokalowa DOLICZA się do głównej), zw_kanalizacja_licznik = 495,60 + 756,00 + 82,60 + 126,00 = 1460.20 (woda i ścieki razem, główne i per-lokalowe), co_zmienna = 3093.10, co_stala = 433.03, razem_swiadczenia = 7306.33, zaliczka_utrzymanie = 1916.54, odpady_komunalne = 840.00, fundusz_remontowy = 898.38.
Zwróć uwagę: 3093,10 + 433,03 + 2320,00 + 1460,20 = 7306,33, czyli dokładnie "Razem świadczenia".

KONTROLA WŁASNA (wykonaj w myślach przed odpowiedzią, nie opisuj jej w odpowiedzi):
- Suma pól co_zmienna + co_stala + ciepla_woda_licznik + ciepla_woda_ryczalt + zw_kanalizacja_licznik + zw_kanalizacja_ryczalt + woda_gospodarcza musi równać się polu razem_swiadczenia odczytanemu ze strony. Jeśli się nie równa, wróć do linii i popraw odczyt cyfr — najczęstszy błąd to przeoczona linia per-lokalowa albo pomylona cyfra.
- Suma zaliczka_utrzymanie + fundusz_remontowy + razem_swiadczenia + odpady_komunalne musi równać się razem_total, chyba że na stronie jest nota globalna.

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

/**
 * Counting semaphore shared by every concurrent extraction.
 *
 * `release` hands its permit directly to the next waiter instead of
 * incrementing a counter the waiter then decrements — otherwise a fresh caller
 * can slip into the gap between the decrement and the woken waiter's increment,
 * and the number in flight drifts above the limit.
 */
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.permits = limit;
  }

  private async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const pageLimiter = new Semaphore(PAGE_CONCURRENCY);

interface ModelAnswer {
  month: number | null;
  year: number | null;
  properties: PropertyData[];
  rawResponse: string;
}

/** One vision call. Returns the parsed answer, or throws. */
async function askModel(
  client: Anthropic,
  pdfBase64: string,
  model: string,
  label: string,
  maxTokens: number = PAGE_MAX_TOKENS,
): Promise<ModelAnswer> {
  // `document` content blocks (native PDF) are supported by the API but not
  // typed in SDK v0.32, so the message payload is cast. PROMPT goes FIRST with
  // cache_control: it is identical for every page, so after the first response
  // every later page reads the instructions from the prefix cache.
  const resp = await withRateLimitRetry(
    () =>
      client.messages.create({
        model,
        max_tokens: maxTokens,
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
                  data: pdfBase64,
                },
              },
            ],
          },
        ] as unknown as Anthropic.MessageCreateParamsNonStreaming['messages'],
      }),
    label,
  );
  logCacheUsage(label, resp.usage);

  const text = resp.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
  if (resp.stop_reason === 'max_tokens') {
    logger.warn(`[ZALICZKI] ${label}: odpowiedź uciął limit max_tokens`);
  }

  const parsed = parseExtractionResponse(text, label);
  const properties: PropertyData[] = parsed.properties.map((p) => ({
    property: typeof p.property === 'string' ? p.property : '',
    values: Object.fromEntries(
      ZALICZKI_CATEGORIES.map((c) => [
        c,
        toNumber((p.values as Record<string, unknown> | undefined)?.[c]),
      ]),
    ) as Partial<Record<ZaliczkiCategory, number | null>>,
  }));

  const month =
    monthInRange(toNumber(parsed.month), 1, 12) ?? polishMonthNameToNumber(parsed.month);
  const year = monthInRange(toNumber(parsed.year), 2000, 2100);

  return { month, year, properties, rawResponse: text };
}

interface PageResult {
  index: number;
  properties: PropertyData[];
  month: number | null;
  year: number | null;
  warnings: ZaliczkiWarning[];
  rawResponse: string;
  fromCache: boolean;
  escalated: boolean;
  failure?: string;
}

/**
 * Extract one page: cache, then ask, then check the arithmetic, then re-ask once
 * on a stronger model if the page contradicts itself. The better of the two
 * answers wins; if both fail the checks the findings travel with the result so
 * the reviewer sees exactly which rows to look at.
 */
async function extractPage(
  client: Anthropic | null,
  page: { index: number; bytes: Buffer; sha256: string },
  model: string,
  label: string,
  force: boolean,
  /**
   * Output budget for this request. The whole-file fallback answers for every
   * community in the document at once, so it needs far more room than a page.
   */
  maxTokens: number = PAGE_MAX_TOKENS,
): Promise<PageResult> {
  if (!force) {
    const cached = readCachedPage(page.sha256, model);
    if (cached) {
      return {
        index: page.index,
        properties: cached.properties,
        month: cached.month,
        year: cached.year,
        warnings: cached.warnings,
        rawResponse: '',
        fromCache: true,
        escalated: false,
      };
    }
  }

  if (!client) {
    const message = 'brak w cache (tryb tylko-cache)';
    return {
      index: page.index,
      properties: [],
      month: null,
      year: null,
      warnings: [
        {
          property: `strona ${page.index + 1}`,
          check: 'page_failed',
          severity: 'error',
          message: `Strona ${page.index + 1}: ${message}`,
        },
      ],
      rawResponse: '',
      fromCache: false,
      escalated: false,
      failure: message,
    };
  }

  const base64 = page.bytes.toString('base64');

  let primary: ModelAnswer | null = null;
  let primaryError: string | null = null;
  try {
    primary = await pageLimiter.run(() => askModel(client, base64, model, label, maxTokens));
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
    logger.warn(`[ZALICZKI] ${label}: pierwsza próba nie udała się — ${primaryError}`);
  }

  let chosen = primary;
  let chosenWarnings = primary ? validateProperties(primary.properties) : [];
  let usedModel = model;
  let escalated = false;

  const needsRetry = !primary || hasHardError(chosenWarnings);
  if (needsRetry) {
    const retryModel = ESCALATION_MODEL !== model ? ESCALATION_MODEL : model;
    const reason = primary
      ? chosenWarnings.find((w) => w.severity === 'error')?.message ?? 'kontrola arytmetyczna'
      : primaryError;
    logger.info(`[ZALICZKI] ${label}: ponawiam na ${retryModel} — ${reason}`);

    const retryMaxTokens = Math.max(
      maxTokens,
      retryModel === ESCALATION_MODEL ? ESCALATION_MAX_TOKENS : PAGE_MAX_TOKENS,
    );
    let retry: ModelAnswer | null = null;
    try {
      retry = await pageLimiter.run(() =>
        askModel(client, base64, retryModel, `${label} (retry)`, retryMaxTokens),
      );
      escalated = retryModel !== model;
      usedModel = retryModel;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[ZALICZKI] ${label}: ponowienie na ${retryModel} nie udało się — ${message}`);
      // The escalation model may simply not be enabled for this account. Never
      // let that break the page: fall back to one more try on the primary model.
      if (retryModel !== model) {
        try {
          retry = await pageLimiter.run(() =>
            askModel(client, base64, model, `${label} (retry2)`, maxTokens),
          );
          usedModel = model;
        } catch (err2) {
          logger.warn(
            `[ZALICZKI] ${label}: drugie ponowienie też nie udało się — ${err2 instanceof Error ? err2.message : err2}`,
          );
        }
      }
    }

    if (retry) {
      const retryWarnings = validateProperties(retry.properties);
      // Take the retry unless it is strictly worse than a usable first answer.
      const retryIsBetter =
        !primary || !hasHardError(retryWarnings) || hasHardError(chosenWarnings);
      if (retryIsBetter) {
        chosen = retry;
        chosenWarnings = retryWarnings;
      } else {
        usedModel = model;
        escalated = false;
      }
    }
  }

  if (!chosen) {
    return {
      index: page.index,
      properties: [],
      month: null,
      year: null,
      warnings: [
        {
          property: `strona ${page.index + 1}`,
          check: 'page_failed',
          severity: 'error',
          message: `Nie udało się odczytać strony ${page.index + 1}: ${primaryError ?? 'nieznany błąd'}`,
        },
      ],
      rawResponse: '',
      fromCache: false,
      escalated: false,
      failure: primaryError ?? 'nieznany błąd',
    };
  }

  writeCachedPage(page.sha256, model, {
    promptVersion: PROMPT_VERSION,
    model: usedModel,
    month: chosen.month,
    year: chosen.year,
    properties: chosen.properties,
    warnings: chosenWarnings,
    storedAt: new Date().toISOString(),
  });

  return {
    index: page.index,
    properties: chosen.properties,
    month: chosen.month,
    year: chosen.year,
    warnings: chosenWarnings,
    rawResponse: chosen.rawResponse,
    fromCache: false,
    escalated,
  };
}

export async function extractZaliczkiFromPdf(
  pdfPath: string,
  apiKey: string,
  model: string = DEFAULT_ZALICZKI_MODEL,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const { force = false, cacheOnly = false, onProgress } = options;

  if (!apiKey && !cacheOnly) {
    throw new Error('Brak klucza Anthropic API — dodaj wpis anthropic_api_key w tabeli app_config (Supabase) lub lokalnie w config/ai-config.yml.');
  }

  const filename = pdfPath.split(/[\\/]/).pop() ?? pdfPath;
  // Null client in cache-only mode is the enforcement, not just a flag check:
  // there is no object to call, so no code path can reach the network.
  const client = cacheOnly ? null : new Anthropic({ apiKey });

  onProgress?.({ filePath: pdfPath, totalPages: 0, donePages: 0, fromCache: 0, stage: 'splitting' });

  let pages: Array<{ index: number; bytes: Buffer; sha256: string }>;
  let wholeFileFallback = false;
  try {
    pages = await splitPdfPages(pdfPath);
  } catch (err) {
    // Rather than fail the file, fall back to the old behaviour: one request for
    // the whole document. Slower and unvalidated per page, but it still works.
    logger.warn(
      `[ZALICZKI] ${filename}: nie udało się podzielić na strony (${err instanceof Error ? err.message : err}) — wysyłam cały plik w jednym żądaniu`,
    );
    const bytes = fs.readFileSync(pdfPath);
    pages = [
      { index: 0, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
    ];
    wholeFileFallback = true;
  }

  logger.info(
    `[ZALICZKI] ${filename}: ${pages.length} ${wholeFileFallback ? 'żądanie (cały plik)' : 'stron'}, model ${model}${force ? ', wymuszone ponowienie' : ''}`,
  );

  let done = 0;
  let fromCacheCount = 0;
  const report = (stage: ExtractionProgress['stage'] = 'extracting') =>
    onProgress?.({
      filePath: pdfPath,
      totalPages: pages.length,
      donePages: done,
      fromCache: fromCacheCount,
      stage,
    });
  report();

  // The fallback request carries the whole document, so its answer is as long as
  // there are communities in the file rather than one page's worth.
  const perRequestMaxTokens = wholeFileFallback
    ? Math.min(ESCALATION_MAX_TOKENS, PAGE_MAX_TOKENS * 4)
    : PAGE_MAX_TOKENS;

  const runPage = async (page: (typeof pages)[number]): Promise<PageResult> => {
    const label = wholeFileFallback
      ? `${filename} (cały plik)`
      : `${filename} s.${page.index + 1}`;
    const result = await extractPage(
      client,
      page,
      model,
      label,
      force,
      perRequestMaxTokens,
    );
    done++;
    if (result.fromCache) fromCacheCount++;
    report();
    return result;
  };

  // The prompt cache entry only becomes readable once the first response starts
  // coming back, so firing every page at once would have them all miss it. Run
  // the first page that actually needs the model alone, then fan out.
  const results: PageResult[] = new Array(pages.length);
  const needsModel = force
    ? pages.map((p) => p.index)
    : pages.filter((p) => !readCachedPage(p.sha256, model)).map((p) => p.index);

  const warmUpIndex = needsModel.length > 1 ? needsModel[0] : undefined;
  if (warmUpIndex !== undefined) {
    results[warmUpIndex] = await runPage(pages[warmUpIndex]);
  }

  // allSettled, not all: extractPage handles its own failures, but an unexpected
  // throw from one page must not discard the 27 that succeeded.
  const rest = pages.filter((p) => p.index !== warmUpIndex);
  const settled = await Promise.allSettled(rest.map((p) => runPage(p)));
  settled.forEach((outcome, i) => {
    const page = rest[i];
    if (outcome.status === 'fulfilled') {
      results[page.index] = outcome.value;
      return;
    }
    const message =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    logger.error(`[ZALICZKI] ${filename} s.${page.index + 1}: nieoczekiwany błąd — ${message}`);
    results[page.index] = {
      index: page.index,
      properties: [],
      month: null,
      year: null,
      warnings: [
        {
          property: `strona ${page.index + 1}`,
          check: 'page_failed',
          severity: 'error',
          message: `Strona ${page.index + 1} zakończyła się błędem: ${message}`,
        },
      ],
      rawResponse: '',
      fromCache: false,
      escalated: false,
      failure: message,
    };
  });

  done = pages.length;
  report('done');

  const ordered = results.filter(Boolean);
  const properties = ordered.flatMap((r) => r.properties);
  const warnings = ordered.flatMap((r) => r.warnings);
  const failed = ordered.filter((r) => r.failure).length;

  const fromFilename = monthFromFilename(filename);
  const month = ordered.find((r) => r.month !== null)?.month ?? fromFilename.month;
  const year = ordered.find((r) => r.year !== null)?.year ?? fromFilename.year;

  const stats: ExtractionStats = {
    pages: pages.length,
    fromCache: ordered.filter((r) => r.fromCache).length,
    escalated: ordered.filter((r) => r.escalated).length,
    failed,
    wholeFileFallback,
  };

  logger.info(
    `[ZALICZKI] ${filename}: gotowe — ${properties.length} pozycji, ` +
      `${stats.fromCache}/${stats.pages} z cache, ${stats.escalated} ponowionych, ` +
      `${failed} nieudanych, ${warnings.filter((w) => w.severity === 'error').length} błędów kontroli, ` +
      `miesiąc=${month}, rok=${year}`,
  );

  // In cache-only mode an empty result is a legitimate answer ("nothing cached
  // yet"), so the harness gets a report instead of an exception.
  if (properties.length === 0 && !cacheOnly) {
    throw new Error(
      failed > 0
        ? `Nie odczytano żadnej strony (${failed} z ${pages.length} zakończyło się błędem). Zobacz logi.`
        : 'Model nie zwrócił żadnej wspólnoty.',
    );
  }

  return {
    filename,
    month,
    year,
    properties,
    // Only the pages that hit the model have raw text; enough to debug a bad
    // page without carrying tens of kilobytes per cached run into the renderer.
    rawResponse: ordered
      .filter((r) => r.rawResponse)
      .map((r) => `--- strona ${r.index + 1} ---\n${r.rawResponse}`)
      .join('\n\n'),
    warnings,
    stats,
  };
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
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z]/g, '');
  return POLISH_MONTH_NAMES[key] ?? null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.').replace('zł', '');
  if (!s || s.toLowerCase() === 'null') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function logCacheUsage(label: string, usage: unknown): void {
  const u = usage as Record<string, number | undefined> | undefined;
  if (!u) return;
  const created = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  logger.info(
    `[ZALICZKI] ${label}: tokeny in=${input} out=${output} cache(zapis=${created}, odczyt=${read})`,
  );
}

/**
 * Retry on 429 rate_limit_error with Retry-After honor.
 * Anthropic SDK exposes the header via `err.headers['retry-after']` (seconds).
 * Input-token-per-minute limits recover in ≤60s, so we cap waits at 90s.
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = 4,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status;
      const retryable =
        status === 429 ||
        status === 500 ||
        status === 503 ||
        status === 529 ||
        err?.error?.type === 'rate_limit_error' ||
        err?.error?.type === 'overloaded_error';
      if (!retryable || attempt === maxAttempts) throw err;

      const headerRetry = parseFloat(
        err?.headers?.['retry-after'] ?? err?.response?.headers?.get?.('retry-after') ?? '',
      );
      const waitSeconds = Number.isFinite(headerRetry) && headerRetry > 0
        ? Math.min(headerRetry, 90)
        : Math.min(5 * attempt * attempt, 90);
      logger.warn(
        `[ZALICZKI] ${label}: ${status ?? err?.error?.type} (próba ${attempt}/${maxAttempts}), ` +
          `czekam ${waitSeconds}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  throw new Error('withRateLimitRetry: exhausted retries unexpectedly');
}
