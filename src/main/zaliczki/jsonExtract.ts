/**
 * Turn a Claude response into the extraction object, tolerating everything the
 * model actually does instead of only the contract it was asked to follow.
 *
 * The prompt demands a bare JSON object, and the model usually complies. When
 * it doesn't, the failure observed in production looks like this:
 *
 *   I need to analyze each page carefully, reading upside-down text normally.
 *   **Page 1: al. Niepodległości 103 (mieszkalne)** - January 2026
 *   - zaliczka_utrzymanie: 566,88 m² × 2,50 = 1417,20        <- 12 kB of prose
 *   {"month":1,"year":2026,"properties":[ ...15 properties... ]}
 *   Wait, I need to double-check some values more carefully.  <- and it revises
 *   **Page 2 ...**
 *   {"month":1,"year":2026,"properties":[ ...15 properties... ]}
 *
 * The previous parser sliced from the first `{` to end-of-string and handed the
 * whole tail to JSON.parse, so every response of this shape died with
 * "Unexpected non-whitespace character after JSON at position 7893" — even
 * though both objects were complete, valid, and (verified against the logged
 * response) identical and arithmetically correct. A whole file's extraction was
 * thrown away because of trailing prose.
 *
 * So instead of guessing where the JSON ends: find every balanced top-level
 * `{...}` run, parse each on its own, and combine them by the rules below.
 * Prose before, between, and after the objects is ignored by construction.
 */

import logger from '../../shared/logger';

/** One balanced `{...}` run found in the response text. */
interface Candidate {
  start: number;
  end: number;
  /** True when the response ended before the object closed (hit max_tokens). */
  unterminated: boolean;
}

export interface ParsedExtraction {
  month: unknown;
  year: unknown;
  properties: Array<Record<string, unknown>>;
  /** How the object was recovered, for the log. Empty when it parsed cleanly. */
  note: string;
}

/**
 * Scan for balanced top-level `{...}` runs, ignoring braces inside strings.
 * A trailing unterminated run is returned too, so a truncated response can
 * still be salvaged.
 */
function findCandidates(s: string): Candidate[] {
  const out: Candidate[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0 && ch === '{') start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === '}' && start >= 0) {
        out.push({ start, end: i + 1, unterminated: false });
        start = -1;
      }
      // A stray closer in prose ("}" in a sentence) would push depth negative;
      // clamp so it doesn't swallow the real object that follows.
      if (depth < 0) depth = 0;
    }
  }
  if (depth > 0 && start >= 0) {
    out.push({ start, end: s.length, unterminated: true });
  }
  return out;
}

/**
 * Balanced scan starting at a known `{`, independent of the whole-text scan.
 *
 * A single malformed object mid-response (extra `}`, unbalanced braces) throws
 * the running depth counter off and can make the rest of the text look like one
 * unterminated object, hiding a perfectly good object that follows. Re-scanning
 * from each schema-looking start offset recovers those.
 */
function scanFrom(s: string, from: number): Candidate | null {
  if (s[from] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return { start: from, end: i + 1, unterminated: false };
      if (depth < 0) return null;
    }
  }
  return { start: from, end: s.length, unterminated: true };
}

/** Offsets of every `{` that begins something shaped like our schema. */
function schemaStarts(s: string): number[] {
  const out: number[] = [];
  const re = /\{\s*"(?:month|year|properties)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m.index);
  return out;
}

function stripFences(s: string): string {
  return s.replace(/```json/gi, '```').split('```').join('\n');
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Close a truncated object after the last complete element of its `properties`
 * array, dropping the half-written element.
 */
function closeTruncated(s: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteElement = -1;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      // depth 0 = outside, 1 = root object, 2 = inside the properties array;
      // a `}` closing back to 2 finished one property element.
      if (depth === 2 && ch === '}') lastCompleteElement = i;
    }
  }
  if (lastCompleteElement < 0) return null;
  return `${s.slice(0, lastCompleteElement + 1)}]}`;
}

function tryParse(chunk: string): Record<string, unknown> | null {
  for (const transform of [(x: string) => x, stripTrailingCommas]) {
    try {
      const value = JSON.parse(transform(chunk));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Try the next transform.
    }
  }
  return null;
}

function propertiesOf(obj: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const raw = obj.properties;
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p),
  );
}

function propertyKey(p: Record<string, unknown>): string {
  return String(p.property ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Combine the schema-shaped objects found in the response.
 *
 * - If one object's property set covers every other object's (the model wrote a
 *   full answer, then restated or revised the whole thing), that object wins on
 *   its own — the latest such object, since a revision supersedes what it
 *   revises.
 * - Otherwise the model split its answer across objects (one per page, or a
 *   truncated attempt followed by the rest), so merge by property name with
 *   later objects overriding earlier ones.
 */
function combine(objects: Array<Record<string, unknown>>): {
  month: unknown;
  year: unknown;
  properties: Array<Record<string, unknown>>;
  note: string;
} {
  const withProps = objects
    .map((obj) => ({ obj, props: propertiesOf(obj) ?? [] }))
    .filter((entry) => entry.props.length > 0);

  if (withProps.length === 0) {
    const last = objects[objects.length - 1] ?? {};
    return { month: last.month, year: last.year, properties: [], note: 'brak properties' };
  }

  const keySets = withProps.map((e) => new Set(e.props.map(propertyKey)));
  const allKeys = new Set<string>();
  for (const set of keySets) for (const k of set) allKeys.add(k);

  // Latest object that covers every key seen anywhere = complete answer.
  for (let i = withProps.length - 1; i >= 0; i--) {
    const covers = [...allKeys].every((k) => keySets[i].has(k));
    if (covers) {
      const note =
        withProps.length > 1
          ? `${withProps.length} obiektów JSON w odpowiedzi, użyto ostatniego pełnego (#${i + 1})`
          : '';
      return {
        month: withProps[i].obj.month,
        year: withProps[i].obj.year,
        properties: withProps[i].props,
        note,
      };
    }
  }

  // Disjoint / partial objects: merge, later wins.
  const merged = new Map<string, Record<string, unknown>>();
  for (const { props } of withProps) {
    for (const p of props) merged.set(propertyKey(p), p);
  }
  const monthSource = withProps.find((e) => e.obj.month !== null && e.obj.month !== undefined);
  return {
    month: monthSource?.obj.month ?? withProps[0].obj.month,
    year: monthSource?.obj.year ?? withProps[0].obj.year,
    properties: [...merged.values()],
    note: `${withProps.length} częściowych obiektów JSON scalono w ${merged.size} pozycji`,
  };
}

/**
 * Extract the model's answer. Throws only when the response contains nothing
 * parseable at all — a response with any usable property is never discarded.
 */
export function parseExtractionResponse(text: string, label: string): ParsedExtraction {
  const cleaned = stripFences(text);

  // Two independent passes, deduped by start offset: the whole-text scan finds
  // objects wherever they are, and the resync pass survives a malformed object
  // that would otherwise desynchronize the depth counter for the rest of the
  // response. Overlapping candidates are harmless — `combine` prefers whichever
  // object covers the most properties.
  const byStart = new Map<number, Candidate>();
  for (const cand of findCandidates(cleaned)) {
    const existing = byStart.get(cand.start);
    if (!existing || (existing.unterminated && !cand.unterminated)) {
      byStart.set(cand.start, cand);
    }
  }
  for (const start of schemaStarts(cleaned)) {
    const cand = scanFrom(cleaned, start);
    if (!cand) continue;
    const existing = byStart.get(start);
    if (!existing || (existing.unterminated && !cand.unterminated)) {
      byStart.set(start, cand);
    }
  }
  const candidates = [...byStart.values()].sort((a, b) => a.start - b.start);

  const objects: Array<Record<string, unknown>> = [];
  let recoveredTruncated = false;

  for (const cand of candidates) {
    const chunk = cleaned.slice(cand.start, cand.end);
    const direct = tryParse(chunk);
    if (direct) {
      objects.push(direct);
      continue;
    }
    if (cand.unterminated) {
      const closed = closeTruncated(chunk);
      const salvaged = closed ? tryParse(closed) : null;
      if (salvaged) {
        objects.push(salvaged);
        recoveredTruncated = true;
      }
    }
  }

  // Keep only objects that look like our schema; prose can contain `{}` runs.
  const schemaShaped = objects.filter(
    (o) => 'properties' in o || 'month' in o || 'year' in o,
  );
  const usable = schemaShaped.length > 0 ? schemaShaped : objects;

  if (usable.length === 0) {
    logger.error(
      `[ZALICZKI] ${label}: brak JSON w odpowiedzi modelu. Surowa odpowiedź:\n${text}`,
    );
    throw new Error(
      `Model nie zwrócił JSON. Początek odpowiedzi: ${text.slice(0, 200)}`,
    );
  }

  const combined = combine(usable);
  const notes = [combined.note, recoveredTruncated ? 'odtworzono ucięty JSON' : '']
    .filter(Boolean)
    .join('; ');

  if (notes) {
    logger.warn(`[ZALICZKI] ${label}: odpowiedź wymagała naprawy — ${notes}`);
  }

  if (combined.properties.length === 0) {
    logger.error(
      `[ZALICZKI] ${label}: JSON bez żadnej pozycji. Surowa odpowiedź:\n${text}`,
    );
    throw new Error('Model zwrócił JSON, ale bez żadnej wspólnoty (pusta lista properties).');
  }

  return { ...combined, note: notes };
}
