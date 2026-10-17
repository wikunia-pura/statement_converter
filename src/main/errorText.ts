import { localizeErrorMessage } from '../shared/app-errors';
import type DatabaseService from './database';

/** The language the person picked in Settings — for text the main process words itself. */
export function appLanguage(database: DatabaseService): 'pl' | 'en' {
  return database.getSetting('language') === 'en' ? 'en' : 'pl';
}

/**
 * A failure as text in the app's language, for a reason main hands a view as
 * data rather than as a rejection (a skipped document, why a run stopped): such
 * a reason is shown as it comes, so a coded refusal in it is worded here.
 */
export function errorTextIn(database: DatabaseService, error: unknown): string {
  return localizeErrorMessage(error instanceof Error ? error.message : String(error), appLanguage(database));
}
