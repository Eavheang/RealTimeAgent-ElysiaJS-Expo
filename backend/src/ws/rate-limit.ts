/**
 * Rate limiting for WebSocket connections
 * Uses a token bucket algorithm to prevent abuse
 */

/**
 * Rate limiter class for WebSocket connections
 */
export class RateLimiter {
  private messageCount = 0;
  private windowStart = Date.now();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  /**
   * Create a new rate limiter
   * @param maxMessages Maximum messages allowed per window
   * @param windowMs Window duration in milliseconds
   */
  constructor(maxMessages: number, windowMs: number) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
  }

  /**
   * Check if a message should be allowed
   * @returns true if message is within rate limit, false otherwise
   */
  allow(): boolean {
    const now = Date.now();

    // Reset window if time has passed
    if (now - this.windowStart >= this.windowMs) {
      this.messageCount = 0;
      this.windowStart = now;
    }

    // Check if limit exceeded
    if (this.messageCount >= this.maxMessages) {
      return false;
    }

    this.messageCount++;
    return true;
  }

  /**
   * Get remaining messages in current window
   */
  getRemaining(): number {
    const now = Date.now();

    // Reset window if time has passed
    if (now - this.windowStart >= this.windowMs) {
      return this.maxMessages;
    }

    return Math.max(0, this.maxMessages - this.messageCount);
  }

  /**
   * Get when the current window resets
   */
  getResetTime(): Date {
    return new Date(this.windowStart + this.windowMs);
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.messageCount = 0;
    this.windowStart = Date.now();
  }
}

/**
 * Create a rate limiter per connection configuration
 * These are default values, can be overridden via environment
 */
export function createRateLimiter(): RateLimiter {
  const maxMessages = parseInt(
    process.env.WS_RATE_LIMIT_MESSAGES || "100",
    10
  );
  const windowMs = parseInt(
    process.env.WS_RATE_LIMIT_WINDOW_MS || "1000",
    10
  );

  return new RateLimiter(maxMessages, windowMs);
}
