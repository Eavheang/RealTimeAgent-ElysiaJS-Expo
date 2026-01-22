/**
 * Elysia server entry point
 * Sets up WebSocket server for real-time voice agent
 */

import { Elysia } from "elysia";
import { logger, createConnectionLogger } from "./logger";
import type { Logger } from "pino";
import {
  PORT,
  WS_AUTH_REQUIRED,
  WS_AUTH_TOKEN,
  WS_AUTH_SECRET,
  MAX_AUDIO_PACKET_BYTES,
  CORS_ORIGIN,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS
} from "./config";
import { ClientHandler } from "./ws/client";
import { RateLimiter, createRateLimiter } from "./ws/rate-limit";

/**
 * Extract auth token from WebSocket URL query params
 * Format: ws://host/path?token=xxx
 */
function extractAuthToken(url: string | null): string | null {
  if (!url) return null;
  try {
    const urlObj = new URL(url, "http://dummy");
    return urlObj.searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Validate auth token against configured values
 */
function validateAuthToken(token: string | null): boolean {
  // If auth is not required, always allow
  if (!WS_AUTH_REQUIRED) {
    return true;
  }

  // If auth is required but no token provided, reject
  if (!token) {
    return false;
  }

  // Check against WS_AUTH_TOKEN (exact match)
  if (WS_AUTH_TOKEN && token === WS_AUTH_TOKEN) {
    return true;
  }

  // Check against WS_AUTH_SECRET (fallthack for compatibility)
  if (token === WS_AUTH_SECRET) {
    return true;
  }

  return false;
}

/**
 * WebSocket connection data interface
 * Replaces `any` type for ws.data
 */
interface WebSocketConnectionData {
  connId: number;
  isAuthenticated: boolean;
  isClosing: boolean; // Flag to prevent sends during close
  logger: Logger; // Connection-specific logger
}

const app = new Elysia();

// Map to store client handlers keyed by stable connection ID
const clientHandlers = new Map<number, ClientHandler>();
// Connection counter for generating unique IDs
let connectionCounter = 0;

// Rate limiters per connection (keyed by connection ID)
const connectionRateLimiters = new Map<number, RateLimiter>();

// Keep track of WebSocket references for safe sending
const webSockets = new Map<number, import("ws").WebSocket>();

/**
 * Add CORS middleware
 */
app.onRequest(({ set }) => {
  // Set CORS headers for all HTTP requests
  set.headers["Access-Control-Allow-Origin"] = CORS_ORIGIN;
  set.headers["Access-Control-Allow-Methods"] = CORS_ALLOWED_METHODS;
  set.headers["Access-Control-Allow-Headers"] = CORS_ALLOWED_HEADERS;
  set.headers["Access-Control-Max-Age"] = "86400"; // 24 hours
});

// Handle OPTIONS preflight requests
app.options("/*", () => {
  return new Response(null, {
    status: 204,
  });
});

// Minimum audio packet size to filter out noise/very small packets (64 bytes = 32 samples @ 16kHz PCM16)
const MIN_AUDIO_PACKET_SIZE = 64;

// WebSocket endpoint for voice agent
app.ws("/ws", {
  // Handle new client connection
  open(ws) {
    // Extract and validate auth token
    const authToken = extractAuthToken(ws.raw.url);
    const isAuthenticated = validateAuthToken(authToken);

    if (!isAuthenticated) {
      logger.warn("Rejecting unauthorized connection", {
        reason: authToken ? "invalid_token" : "no_token",
      });
      // Close with policy violation (1008) - unauthorized
      ws.close(1008, "Unauthorized: Invalid or missing authentication token");
      return;
    }

    // Generate stable connection ID
    const connId = ++connectionCounter;

    // Create connection-specific logger
    const connLogger = createConnectionLogger(connId);

    // Store connection data with proper typing
    const connectionData: WebSocketConnectionData = {
      connId,
      isAuthenticated,
      isClosing: false,
      logger: connLogger,
    };
    (ws.data as WebSocketConnectionData) = connectionData;

    // Store WebSocket reference for safe sending
    webSockets.set(connId, ws.raw);

    connLogger.info("Client connected", {
      isAuthenticated,
      readyState: ws.readyState,
      totalConnections: clientHandlers.size + 1,
    });

    // Create per-connection rate limiter
    const rateLimiter = createRateLimiter();
    connectionRateLimiters.set(connId, rateLimiter);

    // Create per-connection client handler with safe send callback
    const safeSend = (data: string): boolean => {
      // Check if connection is marked as closing
      const connData = ws.data as WebSocketConnectionData;
      if (connData?.isClosing) {
        return false;
      }

      // Check WebSocket state
      if (ws.readyState !== 1) {
        // 1 = OPEN
        return false;
      }

      try {
        ws.send(data);
        return true;
      } catch (error) {
        connLogger.error("Error sending message", { error });
        return false;
      }
    };

    const clientHandler = new ClientHandler((data: string) => {
      return safeSend(data);
    }, connLogger);

    // Store handler in Map using stable connection ID
    clientHandlers.set(connId, clientHandler);
  },

  // Handle incoming messages from client
  message(ws, message) {
    // Retrieve connection data with proper typing
    const connectionData = ws.data as WebSocketConnectionData | undefined;
    const connId = connectionData?.connId;
    const connLogger = connectionData?.logger ?? logger;

    if (!connId) {
      logger.error("No connection ID found in ws.data, dropping message");
      return;
    }

    // Get handler using stable connection ID
    const clientHandler = clientHandlers.get(connId);

    // Get rate limiter for this connection
    const rateLimiter = connectionRateLimiters.get(connId);

    // Check rate limit
    if (rateLimiter && !rateLimiter.allow()) {
      connLogger.warn("Rate limit exceeded", {
        resetTime: rateLimiter.getResetTime(),
      });
      // Close with policy violation (1008)
      ws.close(1008, "Rate limit exceeded. Please slow down.");
      return;
    }

    if (!clientHandler) {
      logger.error("No handler found for connection", {
        connectionId: connId,
        mapSize: clientHandlers.size,
      });
      return;
    }


    // Handle binary audio data (PCM16)
    if (message instanceof Buffer || message instanceof ArrayBuffer || message instanceof Uint8Array) {
      // Convert to Buffer if needed
      let audioBuffer: Buffer;
      if (Buffer.isBuffer(message)) {
        audioBuffer = message;
      } else if (message instanceof ArrayBuffer) {
        audioBuffer = Buffer.from(new Uint8Array(message));
      } else {
        audioBuffer = Buffer.from(message);
      }

      // VAD guard: ignore very small packets (likely noise or incomplete data)
      if (audioBuffer.length < MIN_AUDIO_PACKET_SIZE) {
        // Silently ignore small packets to reduce noise
        return;
      }

      // DoS protection: reject oversized packets
      if (audioBuffer.length > MAX_AUDIO_PACKET_BYTES) {
        connLogger.warn("Oversized audio packet rejected", {
          packetSize: audioBuffer.length,
          maxAllowed: MAX_AUDIO_PACKET_BYTES,
        });
        ws.close(1008, `Packet too large: ${audioBuffer.length} bytes (max: ${MAX_AUDIO_PACKET_BYTES})`);
        return;
      }

      connLogger.debug("Received audio chunk", { bytes: audioBuffer.length });

      // Forward to client handler
      clientHandler.handleAudioChunk(audioBuffer);

    } else if (typeof message === "string") {
      // Handle text messages (for future use, e.g., control messages)
      connLogger.info("Received text message", { message });
    } else {
      connLogger.warn("Received unknown message type", { type: typeof message });
    }
  },

  // Handle client disconnect
  close(ws) {
    // Retrieve connection data with proper typing
    const connectionData = ws.data as WebSocketConnectionData | undefined;
    const connId = connectionData?.connId;
    const connLogger = connectionData?.logger ?? logger;

    if (!connId) {
      logger.warn("Client disconnected but no connection ID found");
      return;
    }

    // WebSocket close code meanings (RFC 6455)
    const closeCode = ws.code;
    const closeReason = ws.reason || "No reason provided";
    let closeDescription = "Unknown close";

    switch (closeCode) {
      case 1000: // Normal Closure
        closeDescription = "Normal close";
        connLogger.info("Client disconnected normally", { code: closeCode, reason: closeReason });
        break;
      case 1001: // Going Away
        closeDescription = "Client going away (server shutdown, navigation)";
        connLogger.info("Client disconnected (going away)", { code: closeCode, reason: closeReason });
        break;
      case 1002: // Protocol Error
        closeDescription = "Protocol error";
        connLogger.warn("Client disconnected (protocol error)", { code: closeCode, reason: closeReason });
        break;
      case 1003: // Unsupported Data
        closeDescription = "Unsupported data type";
        connLogger.warn("Client disconnected (unsupported data)", { code: closeCode, reason: closeReason });
        break;
      case 1005: // No Status Received
        closeDescription = "No status received (abnormal close)";
        connLogger.warn("Client disconnected abnormally", { code: closeCode });
        break;
      case 1006: // Abnormal Closure
        closeDescription = "Abnormal closure (network issue)";
        connLogger.warn("Client disconnected (abnormal close, possible network issue)", { code: closeCode });
        break;
      case 1007: // Invalid frame payload data
        closeDescription = "Invalid payload data";
        connLogger.warn("Client disconnected (invalid payload)", { code: closeCode, reason: closeReason });
        break;
      case 1008: // Policy Violation
        closeDescription = "Policy violation";
        connLogger.info("Client disconnected (policy violation - likely auth/rate limit)", { code: closeCode, reason: closeReason });
        break;
      case 1009: // Message Too Big
        closeDescription = "Message too large";
        connLogger.warn("Client disconnected (message too large)", { code: closeCode, reason: closeReason });
        break;
      case 1010: // Missing Extension
        closeDescription = "Missing extension";
        connLogger.warn("Client disconnected (missing extension)", { code: closeCode, reason: closeReason });
        break;
      case 1011: // Internal Error
        closeDescription = "Internal server error";
        connLogger.error("Client disconnected (internal error)", { code: closeCode, reason: closeReason });
        break;
      case 1012: // Service Restart
        closeDescription = "Service restart";
        connLogger.info("Client disconnected (service restart)", { code: closeCode, reason: closeReason });
        break;
      case 1013: // Try Again Later
        closeDescription = "Try again later";
        connLogger.info("Client disconnected (try again later)", { code: closeCode, reason: closeReason });
        break;
      case 1015: // TLS Handshake
        closeDescription = "TLS handshake failure";
        connLogger.error("Client disconnected (TLS handshake failed)", { code: closeCode, reason: closeReason });
        break;
      default:
        connLogger.info("Client disconnected", {
          code: closeCode,
          reason: closeReason,
          description: closeDescription,
        });
    }

    // Mark connection as closing to prevent further sends
    if (connectionData) {
      connectionData.isClosing = true;
    }

    // Get and clean up handler using stable connection ID
    const clientHandler = clientHandlers.get(connId);
    if (clientHandler) {
      // Mark handler as closing to prevent callback sends
      clientHandler.markAsClosing();
      // Clean up resources (closes OpenAI connection, clears buffers)
      clientHandler.cleanup();
      // Remove from Map
      clientHandlers.delete(connId);
      // Clean up rate limiter
      connectionRateLimiters.delete(connId);
      // Clean up WebSocket reference
      webSockets.delete(connId);
    } else {
      connLogger.warn("No handler found for connection during cleanup");
    }
  },
});

// Health check endpoint
app.get("/", () => {
  return {
    status: "ok",
    service: "realtime-voice-agent",
    endpoints: {
      websocket: "/ws",
    },
  };
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

/**
 * Graceful shutdown handler
 * Closes all WebSocket connections and OpenAI connections before exiting
 */
const gracefulShutdown = (signal: string): void => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // First, mark all handlers as closing to prevent callback sends
  for (const [connId, handler] of clientHandlers.entries()) {
    try {
      handler.markAsClosing();
    } catch (error) {
      logger.error("Error marking handler as closing", { connectionId: connId, error });
    }
  }

  // Close all WebSocket connections
  for (const [connId, ws] of webSockets.entries()) {
    const connLogger = createConnectionLogger(connId);
    connLogger.info("Closing connection for shutdown");

    try {
      ws.close(1001, "Server shutting down");
    } catch (error) {
      logger.error("Error closing WebSocket", { connectionId: connId, error });
    }
  }

  // Clean up all client handlers (closes OpenAI connections)
  for (const [connId, handler] of clientHandlers.entries()) {
    const connLogger = createConnectionLogger(connId);
    connLogger.info("Cleaning up handler");

    try {
      handler.cleanup();
    } catch (error) {
      logger.error("Error cleaning up handler", { connectionId: connId, error });
    }
  }

  // Clear all maps
  webSockets.clear();
  clientHandlers.clear();
  connectionRateLimiters.clear();

  logger.info("All connections closed gracefully");
  process.exit(0);
};

// Handle shutdown signals
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds timeout

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Set a timeout to force exit if graceful shutdown takes too long
    const timeout = setTimeout(() => {
      logger.error("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Run graceful shutdown
    try {
      gracefulShutdown(signal);
    } catch (error) {
      logger.error("Error during graceful shutdown", { error });
      clearTimeout(timeout);
      process.exit(1);
    }
  });
}

