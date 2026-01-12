/**
 * WebSocket message types
 */

export interface BackendMessage {
  type: "audio" | "audio_done";
  data?: string; // Base64-encoded PCM16 audio (for audio type)
}

export type ConnectionState = 
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
