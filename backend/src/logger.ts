/**
 * Centralized logging configuration using Pino
 * Provides structured logging with appropriate colors for development
 */

import pino from "pino";

/**
 * Environment-sensitive logger configuration
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * Pino logger instance
 * In development: Pretty-printed colored output
 * In production: JSON format for log aggregation
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  // Format: pretty in dev, JSON in prod
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:mm:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  // Redact sensitive data
  redact: {
    paths: ["OPENAI_API_KEY", "wsAuthToken", "token"],
    remove: true,
  },
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  context: Record<string, unknown>,
  bindings?: Record<string, unknown>
): pino.Logger {
  return logger.child({ ...context, ...bindings });
}

/**
 * Create a connection-specific logger
 */
export function createConnectionLogger(connectionId: number): pino.Logger {
  return logger.child({ connectionId }, { msgPrefix: `[${connectionId}] ` });
}
