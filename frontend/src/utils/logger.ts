/**
 * Frontend logging utility
 * Simple structured logging for React Native
 */

const isDev = __DEV__;

const LOG_LEVEL = isDev ? "debug" : "info";

/**
 * Frontend Logger
 * Provides structured logging with optional module prefix
 */
class Logger {
  constructor(private readonly module?: string) {}

  private formatMessage(message: string): string {
    return this.module ? `[${this.module}] ${message}` : message;
  }

  debug(message: string, ...args: unknown[]): void {
    if (isDev && LOG_LEVEL === "debug") {
      console.debug(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") {
      console.info(this.formatMessage(message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(this.formatMessage(message), ...args);
  }
}

/**
 * Create a logger module with a name prefix
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

/**
 * Default logger (no module prefix)
 */
export const logger = new Logger();
