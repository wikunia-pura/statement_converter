/**
 * How good the CIT classification AI is (src/main/podatki/citAi.ts): accuracy,
 * how often it is sure and still wrong, and whether repeated runs agree.
 *
 *   npx tsx scripts/cit-ai-eval.ts --live                       # built-in set, 3 runs
 *   npx tsx scripts/cit-ai-eval.ts --live --runs 5
 *   npx tsx scripts/cit-ai-eval.ts --live --gold rows.json      # your own labelled rows
 *   npx tsx scripts/cit-ai-eval.ts --live --folds slownik.json  # the office's dictionary, k-fold
 *
 * Sets to measure on:
 * - built-in (default): clear-cut rows of the law, worded so no built-in rule
 *   covers them; the built-in dictionary goes along as examples, as in the app.
 * - `--gold rows.json`: `[{ "nazwa", "strona", "kategoria", "sekcja"? }]`. Rows a
 *   rule of the examples already covers are left out — the app never asks the
 *   AI about them either. `--slownik rules.json` swaps the examples.
 * - `--folds slownik.json`: the office's real dictionary (`[{ "fraza", "strona",
 *   "kategoria" }]`, e.g. `dane.slownik` of the `podatki_cit_ustawienia` row). It
 *   is split into 5 folds; each fold's phrases are classified with the other
 *   four as examples, so the score says how well the AI follows this office.
 *
 * `--live` is required: every run costs API calls (two passes a row). The key
 * comes from ANTHROPIC_API_KEY or `ai.anthropic_api_key` in config/ai-config.yml.
 * `--model` is the fallback when the CIT model is unavailable. Exits non-zero
 * when anything is classified wrong with confidence.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { DEFAULT_AI_MODEL } from '../src/shared/ai-models';
import { defaultCitSlownik, kategorieDlaStrony, regulaDlaNazwy } from '../src/shared/podatki-cit';
import { klasyfikujCitAi } from '../src/main/podatki/citAi';
import { CitAiPozycja, CitAiPrzyklad, CitKategoria, CitSlownikRegula, CitStrona } from '../src/shared/types';

interface Wzorzec {
  nazwa: string;
  strona: CitStrona;
  kategoria: CitKategoria;
  sekcja?: 'fundusz' | 'eksploatacja';
}

/** Rows whose treatment the law settles, none of them containing a built-in phrase. */
const WBUDOWANE: Wzorzec[] = [
  { nazwa: 'Opłata za udostępnienie dachu operatorowi', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
  { nazwa: 'Wpływy z tytułu ustawienia masztu GSM', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
  { nazwa: 'Opłata za umieszczenie szyldu na elewacji', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
  { nazwa: 'Oprocentowanie lokaty bankowej', strona: 'przychod', kategoria: 'przychod_opodatkowany' },
  { nazwa: 'Opłaty eksploatacyjne właścicieli lokali', strona: 'przychod', kategoria: 'przychod_zwolniony' },
  { nazwa: 'Wpłaty na koszty zarządu nieruchomością wspólną', strona: 'przychod', kategoria: 'przychod_zwolniony' },
  { nazwa: 'Rozliczenie mediów z właścicielami – woda', strona: 'przychod', kategoria: 'przychod_zwolniony' },
  { nazwa: 'Centralne ogrzewanie – wpłaty właścicieli', strona: 'przychod', kategoria: 'przychod_zwolniony' },
  { nazwa: 'Przeniesienie nadwyżki z lat ubiegłych', strona: 'przychod', kategoria: 'pomin' },
  { nazwa: 'Odsetki od kredytu termomodernizacyjnego', strona: 'koszt', kategoria: 'koszt_zwolniony', sekcja: 'fundusz' },
  { nazwa: 'Remont dachu', strona: 'koszt', kategoria: 'koszt_zwolniony', sekcja: 'fundusz' },
  { nazwa: 'Prowizja bankowa za prowadzenie rachunku', strona: 'koszt', kategoria: 'koszt_wspolny' },
  { nazwa: 'Sprzątanie klatek schodowych', strona: 'koszt', kategoria: 'koszt_wspolny' },
  { nazwa: 'Wynagrodzenie zarządcy', strona: 'koszt', kategoria: 'koszt_wspolny' },
  { nazwa: 'Ubezpieczenie budynku', strona: 'koszt', kategoria: 'koszt_wspolny' },
  { nazwa: 'Konserwacja dźwigu', strona: 'koszt', kategoria: 'koszt_wspolny' },
  { nazwa: 'Prowizja pośrednika za wynajęcie lokalu użytkowego', strona: 'koszt', kategoria: 'koszt_opodatkowany' },
  { nazwa: 'Ogłoszenie o wolnej powierzchni reklamowej', strona: 'koszt', kategoria: 'koszt_opodatkowany' },
  { nazwa: 'Spłata raty kapitałowej kredytu', strona: 'koszt', kategoria: 'niekoszt' },
  { nazwa: 'Mandat nałożony przez straż miejską', strona: 'koszt', kategoria: 'niekoszt' },
  { nazwa: 'Odpis na fundusz zasobowy z wyniku', strona: 'koszt', kategoria: 'niekoszt' },
];

interface Args {
  live: boolean;
  runs: number;
  model: string;
  gold?: string;
  slownik?: string;
  folds?: string;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    live: argv.includes('--live'),
    runs: Math.max(1, Number(value('runs') ?? 3) || 3),
    model: value('model') ?? DEFAULT_AI_MODEL,
    gold: value('gold'),
    slownik: value('slownik'),
    folds: value('folds'),
  };
}

/** The same key sources as scripts/zaliczki-eval.ts — never Supabase. */
function readApiKey(): string {
  const fromEnv = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;
  const configPath = path.join(process.cwd(), 'config', 'ai-config.yml');
  if (fs.existsSync(configPath)) {
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as { ai?: { anthropic_api_key?: string } } | undefined;
    const key = (parsed?.ai?.anthropic_api_key ?? '').trim();
    if (key) return key;
  }
  return '';
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as T;
}

/** One question to the AI: the rows to classify and the dictionary it follows. */
interface Zadanie {
  wzorce: Wzorzec[];
  przyklady: CitAiPrzyklad[];
}

const asRules = (przyklady: CitAiPrzyklad[]): CitSlownikRegula[] => przyklady.map((r, i) => ({ id: String(i), ...r }));

function zadania(args: Args): Zadanie[] {
  if (args.folds) {
    const slownik = readJson<CitAiPrzyklad[]>(args.folds).filter(
      (r) => r.fraza?.trim() && kategorieDlaStrony(r.strona).includes(r.kategoria),
    );
    const k = 5;
    return Array.from({ length: k }, (_, f) => ({
      wzorce: slownik.filter((_, i) => i % k === f).map((r) => ({ nazwa: r.fraza, strona: r.strona, kategoria: r.kategoria })),
      przyklady: slownik.filter((_, i) => i % k !== f),
    }));
  }
  const przyklady: CitAiPrzyklad[] = args.slownik ? readJson<CitAiPrzyklad[]>(args.slownik) : defaultCitSlownik();
  const wszystkie = args.gold ? readJson<Wzorzec[]>(args.gold) : WBUDOWANE;
  const rules = asRules(przyklady);
  const wzorce = wszystkie.filter((w) => !regulaDlaNazwy(w.nazwa, w.strona, rules));
  if (wzorce.length < wszystkie.length) {
    console.log(`Pominięto ${wszystkie.length - wzorce.length} wierszy pokrytych regułą (aplikacja nie pyta o nie AI).`);
  }
  return [{ wzorce, przyklady }];
}

/** What one run said about a row: a category it is sure of, an uncertain one, or nothing. */
type Werdykt = { kategoria: CitKategoria; niepewne: boolean } | null;

async function jedenPrzebieg(lista: Zadanie[], apiKey: string, model: string): Promise<Werdykt[]> {
  const out: Werdykt[] = [];
  for (const z of lista) {
    const pozycje: CitAiPozycja[] = z.wzorce.map((w, i) => ({
      klucz: String(i),
      nazwa: w.nazwa,
      strona: w.strona,
      sekcja: w.sekcja ?? 'eksploatacja',
      kwota: 0,
    }));
    const { propozycje, zapasowy } = await klasyfikujCitAi(pozycje, apiKey, model, z.przyklady);
    if (zapasowy) console.warn(`  ! model CIT niedostępny — odpowiadał ${model}; wynik nie mierzy docelowego modelu`);
    const wynik = new Map(propozycje.map((p) => [p.klucz, p]));
    z.wzorce.forEach((_, i) => {
      const p = wynik.get(String(i));
      out.push(p ? { kategoria: p.kategoria, niepewne: !!p.niepewne } : null);
    });
  }
  return out;
}

const pct = (n: number, z: number) => (z === 0 ? '—' : `${Math.round((n / z) * 100)}%`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const lista = zadania(args);
  const wzorce = lista.flatMap((z) => z.wzorce);
  console.log(`Zestaw: ${wzorce.length} wierszy, ${args.runs} przebiegi.`);
  if (!args.live) {
    console.log('Dodaj --live, żeby wysłać zapytania do API (każdy przebieg kosztuje).');
    return;
  }
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error('Brak klucza API. Ustaw ANTHROPIC_API_KEY=... albo ai.anthropic_api_key w config/ai-config.yml.');
    process.exit(2);
  }

  const przebiegi: Werdykt[][] = [];
  let zleNaPewno = 0;
  for (let r = 0; r < args.runs; r++) {
    const werdykty = await jedenPrzebieg(lista, apiKey, args.model);
    przebiegi.push(werdykty);
    let dobrze = 0;
    let zle = 0;
    let niepewne = 0;
    let brak = 0;
    werdykty.forEach((w, i) => {
      if (!w) brak++;
      else if (w.niepewne) niepewne++;
      else if (w.kategoria === wzorce[i].kategoria) dobrze++;
      else {
        zle++;
        console.log(`  ✗ przebieg ${r + 1}: „${wzorce[i].nazwa}” (${wzorce[i].strona}) → ${w.kategoria}, oczekiwano ${wzorce[i].kategoria}`);
      }
    });
    zleNaPewno += zle;
    const pewne = dobrze + zle;
    console.log(
      `Przebieg ${r + 1}: trafność pewnych ${pct(dobrze, pewne)} (${dobrze}/${pewne}), pewne i błędne ${zle}, ` +
        `niepewne ${niepewne} (${pct(niepewne, wzorce.length)}), bez odpowiedzi ${brak}`,
    );
  }

  if (args.runs > 1) {
    const klucz = (w: Werdykt) => (w ? `${w.kategoria}${w.niepewne ? '?' : ''}` : '-');
    const stabilne = wzorce.filter((_, i) => new Set(przebiegi.map((p) => klucz(p[i]))).size === 1).length;
    console.log(`Stabilność między przebiegami: ${pct(stabilne, wzorce.length)} (${stabilne}/${wzorce.length}) wierszy z tym samym wynikiem.`);
    wzorce.forEach((w, i) => {
      const odp = przebiegi.map((p) => klucz(p[i]));
      if (new Set(odp).size > 1) console.log(`  ~ „${w.nazwa}”: ${odp.join(' | ')}`);
    });
  }
  process.exit(zleNaPewno > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
