/**
 * Configuration and constants for the voice agent backend
 */

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

export const PORT = parseInt(process.env.PORT || "3000", 10);

// WebSocket authentication
// Set WS_AUTH_REQUIRED=false to disable authentication for local development
export const WS_AUTH_REQUIRED = process.env.WS_AUTH_REQUIRED !== "false";
export const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN;
export const WS_AUTH_SECRET = process.env.WS_AUTH_SECRET || "default-secret";

// Warn if auth is required but no token is set
if (WS_AUTH_REQUIRED && !WS_AUTH_TOKEN) {
  console.warn(
    "WARNING: WS_AUTH_REQUIRED is true but WS_AUTH_TOKEN is not set. " +
    "Connections will be rejected. Set WS_AUTH_TOKEN in your environment."
  );
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

// VAD constants
export const VAD_FRAME_SIZE_MS = 20; // 20ms frames
export const VAD_FRAME_SIZE_SAMPLES = (AUDIO_SAMPLE_RATE * VAD_FRAME_SIZE_MS) / 1000; // 320 samples
export const VAD_SILENCE_THRESHOLD = 500; // RMS energy threshold
export const VAD_SILENCE_DURATION_MS = 600; // 600ms of silence
export const VAD_SILENCE_FRAMES = VAD_SILENCE_DURATION_MS / VAD_FRAME_SIZE_MS; // 30 frames

// OpenAI Realtime API
export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
export const OPENAI_MODEL = "gpt-4o-realtime-preview";
