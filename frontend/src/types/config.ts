/**
 * Configuration type definitions for the voice agent frontend
 */

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  backendUrl: string; // Backend WebSocket URL (e.g., ws://localhost:3000/ws)
  authToken?: string; // Optional authentication token
}

/**
 * Audio player configuration
 */
export interface AudioConfig {
  sampleRate: number; // Sample rate in Hz (OpenAI uses 24000 for output)
  bytesPerSample: number; // Bytes per sample (16-bit = 2 bytes)
  channels: number; // Number of audio channels (1 = mono)
  maxStreamDurationMs: number; // Maximum stream duration in milliseconds
  maxBufferSize: number; // Maximum buffer size in bytes
}

/**
 * Audio recording configuration
 */
export interface RecordingConfig {
  sampleRate: number; // Sample rate in Hz
  bufferSize: number; // Audio buffer size
  channels: number; // Number of audio channels
  bitsPerSample: number; // Bits per sample
}

/**
 * Conversation state for turn-based flow
 */
export type ConversationState =
  | "idle"
  | "listening"
  | "processing"
  | "playing";

/**
 * Complete frontend configuration
 */
export interface FrontendConfig {
  websocket: WebSocketConfig;
  audio: AudioConfig;
  recording: RecordingConfig;
}
