/**
 * Configuration and constants for the voice agent backend
 */

// Environment variables
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}

export const PORT = parseInt(process.env.PORT || "3000", 10);

// Audio constants
export const AUDIO_SAMPLE_RATE = 16000; // 16kHz
export const AUDIO_CHANNELS = 1; // Mono
export const AUDIO_BITS_PER_SAMPLE = 16; // PCM16
export const AUDIO_BYTES_PER_SAMPLE = 2; // 16 bits = 2 bytes

// VAD constants
export const VAD_FRAME_SIZE_MS = 20; // 20ms frames
export const VAD_FRAME_SIZE_SAMPLES = (AUDIO_SAMPLE_RATE * VAD_FRAME_SIZE_MS) / 1000; // 320 samples
export const VAD_SILENCE_THRESHOLD = 500; // RMS energy threshold
export const VAD_SILENCE_DURATION_MS = 600; // 600ms of silence
export const VAD_SILENCE_FRAMES = VAD_SILENCE_DURATION_MS / VAD_FRAME_SIZE_MS; // 30 frames

// OpenAI Realtime API
export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
export const OPENAI_MODEL = "gpt-4o-realtime-preview";
