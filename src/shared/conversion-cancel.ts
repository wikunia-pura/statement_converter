/**
 * Cancelling a running conversion ("Anuluj" under its progress bar).
 *
 * The conversion stops cooperatively: an AbortSignal travels from the main
 * process into the converter, which checks it between its stages and before
 * starting each AI batch. A cancelled conversion throws this error, writes no
 * output file and leaves nothing in the history — the file is simply waiting
 * again, as if it had never been started.
 */
export const CONVERSION_CANCELLED = 'CONVERSION_CANCELLED';

export class ConversionCancelledError extends Error {
  constructor() {
    super(CONVERSION_CANCELLED);
    this.name = 'ConversionCancelledError';
  }
}

/** True for the cancel error — also after it crossed IPC as a plain message. */
export function isConversionCancelled(error: unknown): boolean {
  if (error instanceof ConversionCancelledError) return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes(CONVERSION_CANCELLED);
}

/** Throw the cancel error when the signal says so. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ConversionCancelledError();
}
