/**
 * Elysia server entry point
 * Sets up WebSocket server for real-time voice agent
 */

import { Elysia } from "elysia";
import { PORT } from "./config";
import { ClientHandler } from "./ws/client";

const app = new Elysia();

// Map to store client handlers keyed by stable connection ID
// Using connection ID instead of ws object because ws reference is not stable across callbacks
const clientHandlers = new Map<number, ClientHandler>();
// Connection counter for generating unique IDs
let connectionCounter = 0;

// Minimum audio packet size to filter out noise/very small packets (64 bytes = 32 samples @ 16kHz PCM16)
const MIN_AUDIO_PACKET_SIZE = 64;

// WebSocket endpoint for voice agent
app.ws("/ws", {
  // Handle new client connection
  open(ws) {
    // Generate stable connection ID
    const connId = ++connectionCounter;
    
    // Store connection ID in ws.data (persistent across lifecycle events in Bun + Elysia)
    // Using connId property name to avoid conflicts with Bun's internal ws.data.id
    (ws.data as any).connId = connId;

    console.log("[Server] Client connected", {
      connectionId: connId,
      readyState: ws.readyState,
      timestamp: new Date().toISOString(),
      totalConnections: clientHandlers.size + 1,
    });

    // Create per-connection client handler with send callback
    const clientHandler = new ClientHandler((data: string) => {
      // Send message to client
      if (ws.readyState === 1) {
        // 1 = OPEN
        ws.send(data);
      }
    });

    // Store handler in Map using stable connection ID
    clientHandlers.set(connId, clientHandler);
  },

  // Handle incoming messages from client
  message(ws, message) {
    // Retrieve stable connection ID from ws.data
    const connId = (ws.data as any)?.connId as number | undefined;
    
    if (!connId) {
      console.error("[Server] No connection ID found in ws.data, dropping message");
      return;
    }

    // Get handler using stable connection ID
    const clientHandler = clientHandlers.get(connId);

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
    // Retrieve stable connection ID from ws.data
    const connId = (ws.data as any)?.connId as number | undefined;
    
    if (!connId) {
      console.warn("[Server] Client disconnected but no connection ID found");
      return;
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
