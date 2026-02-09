/**
 * Utility functions shared across the application
 */

/**
 * Format date to localized string
 * @param dateString ISO date string
 * @param locale Locale code (default: 'pl-PL')
 * @returns Formatted date string
 */
export function formatDate(dateString: string, locale: string = 'pl-PL'): string {
  const date = new Date(dateString);
  return date.toLocaleString(locale);
}

/**
 * Generate unique ID
 * @returns Random ID string
 */
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Get file extension from filename
 * @param fileName File name
 * @returns File extension without dot
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Check if file has valid bank statement extension
 * @param fileName File name to check
 * @returns True if valid extension
 */
export function isValidStatementFile(fileName: string): boolean {
  const validExtensions = ['xml', 'txt', '940', 'mt940', 'csv', 'xlsx', 'xls'];
  const extension = getFileExtension(fileName);
  return validExtensions.includes(extension);
}
