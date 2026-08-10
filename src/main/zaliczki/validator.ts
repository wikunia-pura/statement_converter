/**
 * Arithmetic self-checks for an extracted property.
 *
 * These documents carry both the component lines and the totals, so extraction
 * can be checked without any external ground truth: the component fees must add
 * up to the printed "Razem świadczenia", and the four section totals must add up
 * to the printed grand total. A digit misread — the realistic failure mode for
 * OCR of financial scans — breaks one of those sums.
 *
 * Both formulas were confirmed against real data before being encoded here:
 * the świadczenia sum holds for 15/15 properties in a logged production
 * response, and the grand total is `zaliczka + fundusz + świadczenia + odpady`
 * (15/15 in that same response, and 236/338 cells of the hand-verified
 * Podsumowanie_zaliczek_2025all.xlsx — the remaining cells are the ones its
 * author annotated as wrong, plus months carrying a global "Nota" adjustment).
 */

import { PropertyData, ZaliczkiCategory } from './extractor';

/** Fee lines that must add up to `razem_swiadczenia`. */
export const SWIADCZENIA_COMPONENTS: readonly ZaliczkiCategory[] = [
  'co_zmienna',
  'co_stala',
  'ciepla_woda_licznik',
  'ciepla_woda_ryczalt',
  'zw_kanalizacja_licznik',
  'zw_kanalizacja_ryczalt',
  'woda_gospodarcza',
] as const;

/** Section totals that must add up to `razem_total`. */
const TOTAL_COMPONENTS: readonly ZaliczkiCategory[] = [
  'zaliczka_utrzymanie',
  'fundusz_remontowy',
  'razem_swiadczenia',
  'odpady_komunalne',
] as const;

/** Rounding slack, in złoty. Values are printed to the grosz. */
const TOLERANCE = 0.02;

export type ZaliczkiCheckId =
  /** Component fees do not add up to the printed "Razem świadczenia". */
  | 'swiadczenia_sum'
  /** Section totals do not add up to the printed grand total. */
  | 'razem_total_sum'
  /** A total was read but none of the lines behind it were. */
  | 'components_missing'
  /** A property came back with no amounts at all. */
  | 'empty_property'
  /**
   * The page never produced an answer (API error, unparseable response, or no
   * cached entry in cache-only mode). Distinct from the checks above so counting
   * "pages that failed" never mixes with "amounts that disagree".
   */
  | 'page_failed';

export interface ZaliczkiWarning {
  /** Property the finding belongs to, as returned by the model. */
  property: string;
  check: ZaliczkiCheckId;
  /**
   * `error` means the page contradicts itself and is very likely misread — it
   * drives the re-ask. `warning` means "look at this", not "this is wrong".
   */
  severity: 'error' | 'warning';
  message: string;
}

function sum(values: PropertyData['values'], keys: readonly ZaliczkiCategory[]): number {
  return keys.reduce((acc, key) => acc + (values[key] ?? 0), 0);
}

function present(values: PropertyData['values'], keys: readonly ZaliczkiCategory[]): number {
  return keys.filter((key) => values[key] !== null && values[key] !== undefined).length;
}

const money = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * Check one property. An empty array means every check that could be applied
 * passed; checks whose inputs are absent are skipped rather than failed, so a
 * page that genuinely has no świadczenia is not flagged.
 */
export function validateProperty(p: PropertyData): ZaliczkiWarning[] {
  const out: ZaliczkiWarning[] = [];
  const v = p.values;
  const label = p.property || '(bez adresu)';

  const anyValue = (Object.keys(v) as ZaliczkiCategory[]).some(
    (k) => v[k] !== null && v[k] !== undefined,
  );
  if (!anyValue) {
    out.push({
      property: label,
      check: 'empty_property',
      severity: 'error',
      message: 'Model nie odczytał żadnej kwoty z tej strony.',
    });
    return out;
  }

  const razemSw = v.razem_swiadczenia;
  if (razemSw !== null && razemSw !== undefined) {
    const componentCount = present(v, SWIADCZENIA_COMPONENTS);
    if (componentCount === 0) {
      out.push({
        property: label,
        check: 'components_missing',
        severity: 'warning',
        message: `Jest „Razem świadczenia" ${money(razemSw)} zł, ale nie odczytano żadnej pozycji składowej.`,
      });
    } else {
      const componentSum = sum(v, SWIADCZENIA_COMPONENTS);
      const diff = componentSum - razemSw;
      if (Math.abs(diff) > TOLERANCE) {
        out.push({
          property: label,
          check: 'swiadczenia_sum',
          severity: 'error',
          message:
            `Składniki świadczeń sumują się do ${money(componentSum)} zł, ` +
            `a „Razem świadczenia" to ${money(razemSw)} zł ` +
            `(różnica ${money(diff)} zł) — któraś kwota jest odczytana błędnie.`,
        });
      }
    }
  }

  const razemTotal = v.razem_total;
  if (razemTotal !== null && razemTotal !== undefined && present(v, TOTAL_COMPONENTS) > 0) {
    const totalSum = sum(v, TOTAL_COMPONENTS);
    const diff = totalSum - razemTotal;
    if (Math.abs(diff) > TOLERANCE) {
      // A global "Nota …" adjustment legitimately breaks this one, so it is a
      // flag for review rather than proof of a misread.
      out.push({
        property: label,
        check: 'razem_total_sum',
        severity: 'warning',
        message:
          `Zaliczka + fundusz + świadczenia + odpady = ${money(totalSum)} zł, ` +
          `a „RAZEM" to ${money(razemTotal)} zł (różnica ${money(diff)} zł). ` +
          'Zwykle oznacza notę globalną na stronie — sprawdź, czy tak jest.',
      });
    }
  }

  return out;
}

export function validateProperties(properties: PropertyData[]): ZaliczkiWarning[] {
  return properties.flatMap(validateProperty);
}

/** True when the findings include something worth spending a re-ask on. */
export function hasHardError(warnings: ZaliczkiWarning[]): boolean {
  return warnings.some((w) => w.severity === 'error');
}
