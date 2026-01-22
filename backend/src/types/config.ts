/**
 * Configuration type definitions for the voice agent backend
 */

/**
 * Audio processing configuration
 */
export interface AudioConfig {
  sampleRate: number; // Sample rate in Hz (e.g., 16000 for 16kHz)
  channels: number; // Number of audio channels (1 = mono, 2 = stereo)
  bitsPerSample: number; // Bits per sample (e.g., 16 PCM16)
  bytesPerSample: number; // Bytes per sample (calculated)
}

/**
 * Audio limits configuration
 */
export interface AudioLimitsConfig {
  maxPacketBytes: number; // Maximum bytes per audio packet (DoS protection)
  maxBufferBytes: number; // Maximum bytes to buffer per connection
}

/**
 * VAD (Voice Activity Detection) configuration
 */
export interface VADConfig {
  frameSizeMs: number; // Frame size in milliseconds
  frameSizeSamples: number; // Frame size in samples (calculated)
  silenceThreshold: number; // RMS energy threshold for silence detection
  silenceDurationMs: number; // Duration of silence to consider speech ended
  silenceFrames: number; // Number of silence frames (calculated)
}

/**
 * OpenAI Realtime API configuration
 */
export interface OpenAIConfig {
  apiKey: string;
  realtimeUrl: string;
  model: string;
}

/**
 * WebSocket authentication configuration
 */
export interface WebSocketAuthConfig {
  required: boolean; // Whether authentication is required
  token?: string; // Expected auth token if required
  secret: string; // Fallback secret token
}

/**
 * CORS configuration
 */
export interface CORSConfig {
  origin: string; // Allowed origin (use "*" for all)
  allowedMethods: string; // Comma-separated allowed HTTP methods
  allowedHeaders: string; // Comma-separated allowed headers
}

/**
 * Complete backend configuration
 */
export interface BackendConfig {
  port: number;
  audio: AudioConfig;
  audioLimits: AudioLimitsConfig;
  vad: VADConfig;
  openai: OpenAIConfig;
  wsAuth: WebSocketAuthConfig;
  cors: CORSConfig;
}
