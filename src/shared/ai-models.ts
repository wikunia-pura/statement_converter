/**
 * The Claude models the person can pick in Settings. One choice drives every
 * Claude call in the app: contractor matching during conversion and reading
 * the scanned PDFs in "Podsumowanie zaliczek".
 *
 * The two models differ in more than price, and the call sites must not have to
 * know which one is selected — so every per-model difference lives here.
 */

export interface AiModel {
  id: string;
  label: string;
  /**
   * Thinks unless told otherwise (adaptive thinking on by default): its reply may
   * open with `thinking` blocks, and those thinking tokens count against
   * `max_tokens`. Such a model also rejects any `temperature` other than 1 with an
   * HTTP 400 — with thinking switched off too, so the sampling cannot be pinned.
   */
  adaptiveThinking: boolean;
}

export const AI_MODELS: readonly AiModel[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', adaptiveThinking: true },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', adaptiveThinking: false },
];

/** Applies to installs that predate the setting, too: an absent value reads as this. */
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';

/**
 * The stored setting as a model id this build can call. Anything else — absent,
 * or an id from another build carried in by a restored backup — falls back to
 * the default rather than pinning a model the API no longer serves.
 */
export function resolveAiModel(value: unknown): string {
  return AI_MODELS.some((m) => m.id === value) ? (value as string) : DEFAULT_AI_MODEL;
}

function isAdaptive(model: string): boolean {
  return AI_MODELS.find((m) => m.id === model)?.adaptiveThinking === true;
}

/**
 * Request fields that keep a call as quick and literal as the no-thinking calls
 * this app was built on. An adaptive model gets the lowest effort — the stand-in
 * Anthropic documents for code that used to run without thinking — since it
 * would reject `temperature`. `deterministic` asks for `temperature: 0` from the
 * models that still take it. Models outside `AI_MODELS` (the escalation model)
 * get only that, exactly as before.
 *
 * Thinking stays on for the matching calls too. Switching it off on Haiku 5.5 was
 * measured on the ERSTE test statements and rejected: it raised the model's
 * confidence in wrong readings as much as in right ones, and pushed a date read
 * as an apartment number ("MIESZKANIE 28 052026" → 28) over the auto-approve
 * threshold, where low-effort thinking held it for review.
 *
 * SDK v0.32 does not type `output_config`, so the result is spread in untyped.
 */
export function modelRequestFields(
  model: string,
  { deterministic = false }: { deterministic?: boolean } = {},
): Record<string, unknown> {
  if (isAdaptive(model)) return { output_config: { effort: 'low' } };
  return deterministic ? { temperature: 0 } : {};
}

/**
 * `max_tokens` sized for the answer alone, widened for an adaptive model: its
 * thinking draws on the same ceiling, and its tokenizer counts the same text as
 * roughly 30% more tokens. The ceiling is not billed — only what is generated —
 * so the headroom costs nothing unless it is used.
 */
export function maxTokensFor(model: string, answerTokens: number): number {
  return isAdaptive(model) ? Math.ceil(answerTokens * 1.3) + 4000 : answerTokens;
}
