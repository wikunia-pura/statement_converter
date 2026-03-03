/**
 * Centralized logging utility using electron-log
 * Provides consistent logging across main and renderer processes
 */

import log from 'electron-log';

// Configure log levels and output
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Set file location (electron-log handles this automatically)
// Logs are saved to:
// - macOS: ~/Library/Logs/{app name}/{process name}.log
// - Windows: %USERPROFILE%\AppData\Roaming\{app name}\logs\{process name}.log

export const logger = {
  info: (message: string, ...args: any[]) => log.info(message, ...args),
  warn: (message: string, ...args: any[]) => log.warn(message, ...args),
  error: (message: string, ...args: any[]) => log.error(message, ...args),
  debug: (message: string, ...args: any[]) => log.debug(message, ...args),
};

export default logger;
