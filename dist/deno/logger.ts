import { LogLevel } from './types.ts'

/**
 * Log level hierarchy from most severe to least severe.
 * @internal
 */
const levels: LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug'
]

/**
 * A configurable logger that filters messages based on the current log level.
 *
 * @remarks
 * The logger uses a hierarchical filtering system where setting a level will
 * show all messages at that level and above. For example, setting level to 'warn'
 * will show 'error' and 'warn' messages but filter out 'info' and 'debug'.
 */
export class Logger {
  /**
   * Create a new Logger instance.
   * @param level - The minimum log level to display messages for.
   */
  constructor (private level: LogLevel) {}

  /**
   * Log a message at the specified level.
   *
   * @param level - The log level for this message.
   * @param message - The message to log.
   *
   * @remarks
   * Messages are only displayed if the provided level is at or above the
   * logger's configured minimum level. The message is output using the
   * corresponding console method (console.error, console.warn, etc.).
   *
   * @example
   * ```typescript
   * const logger = new Logger('warn');
   * logger.log('error', 'Critical error occurred'); // Will be shown
   * logger.log('info', 'Info message');            // Will be filtered out
   * ```
   */
  log (level: LogLevel, message: string) {
    if (levels.indexOf(this.level) < levels.indexOf(level)) return
    console[level](message)
  }
}

/**
 * Create a new Logger instance with the specified log level.
 *
 * @param level - The minimum log level to display messages for (default: 'warn').
 * @returns A new Logger instance configured with the specified level.
 *
 * @remarks
 * This is the default export and factory function for creating Logger instances.
 * It provides a convenient way to create loggers without using the `new` keyword.
 *
 * @example
 * ```typescript
 * import getLogger from './logger.ts';
 *
 * const logger = getLogger('debug');
 * logger.log('info', 'Application started');
 * ```
 */
export default (level: LogLevel = 'warn') => {
  return new Logger(level)
}
