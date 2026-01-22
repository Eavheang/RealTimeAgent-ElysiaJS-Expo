/**
 * Configuration and constants for the voice agent backend
 */

import { logger } from "./logger";

// OpenAI API key validation pattern
// Supports:
// - Standard keys: sk-xxxxxxxxxxxxxxxxxxxxxxxx
// - Project keys: sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
const OPENAI_KEY_PATTERN = /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/;

// Environment variables
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable is required. " +
    "Please set it in your .env file or environment."
  );
}

// Validate API key format
if (!OPENAI_KEY_PATTERN.test(OPENAI_API_KEY)) {
  throw new Error(
    "OPENAI_API_KEY has invalid format. " +
    "Expected format: sk-xxxxxxxxxxxxxxxxxxxxxxxx or sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"
  );
}

const PORT_RAW = parseInt(process.env.PORT || "3000", 10);

// Validate PORT is a valid number (1-65535)
if (isNaN(PORT_RAW) || PORT_RAW < 1 || PORT_RAW > 65535) {
  throw new Error(
    `Invalid PORT value: "${process.env.PORT || "3000"}". Must be a number between 1 and 65535.`
  );
}

export const PORT = PORT_RAW;

// WebSocket authentication
// Set WS_AUTH_REQUIRED=false to disable authentication for local development
export const WS_AUTH_REQUIRED = process.env.WS_AUTH_REQUIRED !== "false";
export const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN;

// Fallback secret for development only (NOT for production)
// Warning: This is a weak fallback. Set WS_AUTH_TOKEN or WS_AUTH_SECRET explicitly for production.
const WS_AUTH_SECRET_DEFAULT = "default-secret-change-me-in-production";
export const WS_AUTH_SECRET = process.env.WS_AUTH_SECRET || WS_AUTH_SECRET_DEFAULT;

// Warn about weak auth configuration
if (WS_AUTH_REQUIRED) {
  if (!WS_AUTH_TOKEN && WS_AUTH_SECRET === WS_AUTH_SECRET_DEFAULT) {
    logger.warn(
      "WS_AUTH_REQUIRED is true but using default fallback secret. " +
      "For production, set WS_AUTH_TOKEN or WS_AUTH_SECRET explicitly."
    );
  }
  if (!WS_AUTH_TOKEN) {
    logger.warn(
      "WS_AUTH_REQUIRED is true but WS_AUTH_TOKEN is not set. " +
      "Connections may be rejected if WS_AUTH_SECRET is also unset."
    );
  }
}

// CORS configuration
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "*"; // Default to allow all (adjust for production)
export const CORS_ALLOWED_METHODS = process.env.CORS_ALLOWED_METHODS || "GET, POST, OPTIONS";
export const CORS_ALLOWED_HEADERS = process.env.CORS_ALLOWED_HEADERS || "Content-Type, Authorization";

// Audio constants
export const AUDIO_SAMPLE_RATE = 16000; // 16kHz
export const AUDIO_CHANNELS = 1; // Mono
export const AUDIO_BITS_PER_SAMPLE = 16; // PCM16
export const AUDIO_BYTES_PER_SAMPLE = 2; // 16 bits = 2 bytes

// Audio packet/buffer size limits (prevent DoS and memory issues)
export const MAX_AUDIO_PACKET_BYTES = parseInt(
  process.env.MAX_AUDIO_PACKET_BYTES || "65536",
  10
); // 64KB max per packet
export const MAX_AUDIO_BUFFER_BYTES = parseInt(
  process.env.MAX_AUDIO_BUFFER_BYTES || "10485760",
  10
); // 10MB max buffered audio per connection

// Minimum audio commit size (200ms @ 16kHz PCM16 = 3200 bytes)
export const MIN_AUDIO_COMMIT_BYTES = parseInt(
  process.env.MIN_AUDIO_COMMIT_BYTES || "3200",
  10
);

// VAD constants
export const VAD_FRAME_SIZE_MS = 20; // 20ms frames
export const VAD_FRAME_SIZE_SAMPLES = (AUDIO_SAMPLE_RATE * VAD_FRAME_SIZE_MS) / 1000; // 320 samples
export const VAD_SILENCE_THRESHOLD = 500; // RMS energy threshold
export const VAD_SILENCE_DURATION_MS = 600; // 600ms of silence
export const VAD_SILENCE_FRAMES = VAD_SILENCE_DURATION_MS / VAD_FRAME_SIZE_MS; // 30 frames

// OpenAI Realtime API
export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
export const OPENAI_MODEL = "gpt-4o-realtime-preview";
