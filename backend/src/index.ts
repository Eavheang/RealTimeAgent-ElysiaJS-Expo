/**
 * Elysia server entry point
 * Sets up WebSocket server for real-time voice agent
 */

import { Elysia } from "elysia";
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
      console.log("[Server] Rejecting unauthorized connection", {
        reason: authToken ? "invalid_token" : "no_token",
        timestamp: new Date().toISOString(),
      });
      // Close with policy violation (1008) - unauthorized
      ws.close(1008, "Unauthorized: Invalid or missing authentication token");
      return;
    }

    // Generate stable connection ID
    const connId = ++connectionCounter;

    // Store connection data with proper typing
    const connectionData: WebSocketConnectionData = {
      connId,
      isAuthenticated,
      isClosing: false,
    };
    (ws.data as WebSocketConnectionData) = connectionData;

    // Store WebSocket reference for safe sending
    webSockets.set(connId, ws.raw);

    console.log("[Server] Client connected", {
      connectionId: connId,
      isAuthenticated,
      readyState: ws.readyState,
      timestamp: new Date().toISOString(),
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
        console.error("[Server] Error sending message:", {
          connectionId: connId,
          error,
        });
        return false;
      }
    };

    const clientHandler = new ClientHandler((data: string) => {
      safeSend(data);
    });

    // Store handler in Map using stable connection ID
    clientHandlers.set(connId, clientHandler);
  },

  // Handle incoming messages from client
  message(ws, message) {
    // Retrieve connection data with proper typing
    const connectionData = ws.data as WebSocketConnectionData | undefined;
    const connId = connectionData?.connId;

    if (!connId) {
      console.error("[Server] No connection ID found in ws.data, dropping message");
      return;
    }

    // Get handler using stable connection ID
    const clientHandler = clientHandlers.get(connId);

    // Get rate limiter for this connection
    const rateLimiter = connectionRateLimiters.get(connId);

    // Check rate limit
    if (rateLimiter && !rateLimiter.allow()) {
      console.warn("[Server] Rate limit exceeded", {
        connectionId: connId,
        resetTime: rateLimiter.getResetTime(),
        timestamp: new Date().toISOString(),
      });
      // Close with policy violation (1008)
      ws.close(1008, "Rate limit exceeded. Please slow down.");
      return;
    }

    if (!clientHandler) {
      console.error("[Server] No handler found for connection", {
        connectionId: connId,
        mapSize: clientHandlers.size,
        timestamp: new Date().toISOString(),
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
        console.warn("[Server] Oversized audio packet rejected", {
          connectionId: connId,
          packetSize: audioBuffer.length,
          maxAllowed: MAX_AUDIO_PACKET_BYTES,
          timestamp: new Date().toISOString(),
        });
        ws.close(1008, `Packet too large: ${audioBuffer.length} bytes (max: ${MAX_AUDIO_PACKET_BYTES})`);
        return;
      }

      console.log(`[Server] Received audio chunk: ${audioBuffer.length} bytes`);
      
      // Forward to client handler
      clientHandler.handleAudioChunk(audioBuffer);

    } else if (typeof message === "string") {
      // Handle text messages (for future use, e.g., control messages)
      console.log("[Server] Received text message:", message);
    } else {
      console.warn("[Server] Received unknown message type:", typeof message);
    }
  },

  // Handle client disconnect
  close(ws) {
    // Retrieve connection data with proper typing
    const connectionData = ws.data as WebSocketConnectionData | undefined;
    const connId = connectionData?.connId;

    if (!connId) {
      console.warn("[Server] Client disconnected but no connection ID found");
      return;
    }

    // Mark connection as closing to prevent further sends
    if (connectionData) {
      connectionData.isClosing = true;
    }

    console.log("[Server] Client disconnected", {
      connectionId: connId,
      timestamp: new Date().toISOString(),
    });

    // Get and clean up handler using stable connection ID
    const clientHandler = clientHandlers.get(connId);
    if (clientHandler) {
      // Clean up resources (closes OpenAI connection, clears buffers)
      clientHandler.cleanup();
      // Remove from Map
      clientHandlers.delete(connId);
      // Clean up rate limiter
      connectionRateLimiters.delete(connId);
      // Clean up WebSocket reference
      webSockets.delete(connId);
    } else {
      console.warn("[Server] No handler found for connection during cleanup", {
        connectionId: connId,
      });
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
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

/**
 * Graceful shutdown handler
 * Closes all WebSocket connections and OpenAI connections before exiting
 */
const gracefulShutdown = (signal: string): void => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Mark all connections as closing
  for (const [connId, ws] of webSockets.entries()) {
    const connData = connId && ws ? { connId } : null;
    console.log(`[Shutdown] Closing connection ${connId}`);

    try {
      ws.close(1001, "Server shutting down");
    } catch (error) {
      console.error(`[Shutdown] Error closing WebSocket ${connId}:`, error);
    }
  }

  // Clean up all client handlers (closes OpenAI connections)
  for (const [connId, handler] of clientHandlers.entries()) {
    console.log(`[Shutdown] Cleaning up handler for connection ${connId}`);
    try {
      handler.cleanup();
    } catch (error) {
      console.error(`[Shutdown] Error cleaning up handler ${connId}:`, error);
    }
  }

  // Clear all maps
  webSockets.clear();
  clientHandlers.clear();
  connectionRateLimiters.clear();

  console.log("[Shutdown] All connections closed gracefully");
  process.exit(0);
};

// Handle shutdown signals
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds timeout

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Set a timeout to force exit if graceful shutdown takes too long
    const timeout = setTimeout(() => {
      console.error(`[Shutdown] Timeout reached, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Run graceful shutdown
    try {
      gracefulShutdown(signal);
    } catch (error) {
      console.error("[Shutdown] Error during graceful shutdown:", error);
      clearTimeout(timeout);
      process.exit(1);
    }
  });
}

