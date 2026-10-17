import { describe, expect, it } from 'vitest';
import { APP_ERRORS, AppError, appErrorText, hasAppErrorCode, localizeErrorMessage, parseAppError } from './app-errors';

describe('AppError', () => {
  it('carries the Polish text for the log and the code for the renderer', () => {
    const err = new AppError('concurrentEdit');
    expect(err.message.startsWith(APP_ERRORS.concurrentEdit.pl)).toBe(true);
    expect(parseAppError(err.message)).toEqual({ code: 'concurrentEdit', params: {} });
  });

  it('survives the prefixes Electron and callers put in front', () => {
    const err = new AppError('zadanieConflict');
    const wrapped = `Error invoking remote method 'db:update-zadanie': Error: updateZadanie: ${err.message}`;
    expect(hasAppErrorCode(wrapped, 'zadanieConflict')).toBe(true);
    expect(hasAppErrorCode(wrapped, 'concurrentEdit')).toBe(false);
    expect(localizeErrorMessage(wrapped, 'en')).toBe(APP_ERRORS.zadanieConflict.en);
  });

  it('fills placeholders from the params, also after a round trip through the message', () => {
    const text = appErrorText('concurrentEdit', { unused: 1 }, 'pl');
    expect(text).toBe(APP_ERRORS.concurrentEdit.pl);
    const params = { n: 3, nazwa: 'Wspólnota "Pod Lipami" ]] [[' };
    const parsed = parseAppError(new AppError('concurrentEdit', params).message);
    expect(parsed?.params).toEqual(params);
  });

  it('leaves a message without a code as it is', () => {
    expect(parseAppError('updateZadanie: network down')).toBeNull();
    expect(localizeErrorMessage('updateZadanie: network down', 'en')).toBe('updateZadanie: network down');
    expect(hasAppErrorCode(new Error('plain'), 'concurrentEdit')).toBe(false);
  });

  it('every code has both languages', () => {
    for (const [code, text] of Object.entries(APP_ERRORS)) {
      expect(text.pl, code).toBeTruthy();
      expect(text.en, code).toBeTruthy();
    }
  });
});
