/**
 * Audio player component for playing PCM16 audio from backend
 * Waits for ALL audio to arrive, then plays the entire response as one continuous sound
 */

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Audio } from "expo-av";
import { base64ToArrayBuffer } from "../utils/audioUtils";
import { createLogger } from "../utils/logger";

const logger = createLogger("AudioPlayer");

// Configuration
const SAMPLE_RATE = 24000; // OpenAI uses 24kHz for output audio
const BYTES_PER_SAMPLE = 2; // 16-bit = 2 bytes
const CHANNELS = 1;
const MAX_STREAM_DURATION_MS = 60000; // Max 60 seconds of audio
const MAX_BUFFER_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * (MAX_STREAM_DURATION_MS / 1000); // ~2.88MB
const BYTES_PER_MS = SAMPLE_RATE * BYTES_PER_SAMPLE / 1000; // Bytes per millisecond = 48

interface AudioPlayerProps {
  audioBase64: string | null;
  isStreamComplete: boolean; // True when all audio has been received
  onPlaybackComplete?: () => void;
  onPlaybackStatusChange?: (isPlaying: boolean) => void;
}

export interface AudioPlayerHandle {
  clearQueue: () => void;
}

/**
 * Audio player that waits for ALL audio chunks, then plays as one continuous sound
 * Optimized with single pre-allocated buffer to reduce memory overhead
 */
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  ({ audioBase64, isStreamComplete, onPlaybackComplete, onPlaybackStatusChange }, ref) => {
    // Single pre-allocated buffer with write pointer tracking
    const audioBufferRef = useRef<Uint8Array | null>(null);
    const writeOffsetRef = useRef(0);

    // Playback state
    const soundRef = useRef<Audio.Sound | null>(null);
    const isPlayingRef = useRef(false);
    const hasPlayedRef = useRef(false); // Prevent playing twice

    // Lifecycle
    const isMountedRef = useRef(true);
    const isAudioModeSetRef = useRef(false);

    // Reset state
    const resetState = useCallback(() => {
      audioBufferRef.current = null;
      writeOffsetRef.current = 0;
      hasPlayedRef.current = false;
    }, []);

    // Expose clearQueue method
    useImperativeHandle(ref, () => ({
      clearQueue: () => {
        logger.info("Clearing audio queue");

        if (soundRef.current) {
          soundRef.current.stopAsync().catch((e) => logger.debug("Error stopping async on clear", e));
          soundRef.current.unloadAsync().catch((e) => logger.debug("Error unloading async on clear", e));
          soundRef.current = null;
        }

        if (isPlayingRef.current) {
          isPlayingRef.current = false;
          onPlaybackStatusChange?.(false);
        }

        resetState();
      },
    }), [resetState, onPlaybackStatusChange]);

    // Set audio mode once on mount
    useEffect(() => {
      const setupAudioMode = async () => {
        if (!isAudioModeSetRef.current) {
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: true,
              playsInSilentModeIOS: true,
              staysActiveInBackground: false,
              shouldDuckAndroid: true,
              playThroughEarpieceAndroid: false,
            });
            isAudioModeSetRef.current = true;
            logger.debug("Audio mode configured");
          } catch (error) {
            logger.error("Error setting audio mode:", error);
          }
        }
      };

      setupAudioMode();
      isMountedRef.current = true;

      return () => {
        isMountedRef.current = false;
        if (soundRef.current) {
          soundRef.current.unloadAsync().catch((e) => logger.debug("Error unloading async on unmount", e));
        }
      };
    }, []);

    // Play all accumulated audio as one continuous sound
    const playAllAudio = useCallback(async () => {
      if (!isMountedRef.current || writeOffsetRef.current === 0 || hasPlayedRef.current) {
        return;
      }

      const pcmData = audioBufferRef.current;
      if (!pcmData) {
        logger.warn("No audio buffer available for playback");
        resetState();
        return;
      }

      hasPlayedRef.current = true; // Prevent playing twice

      try {
        // Stop any existing playback
        if (soundRef.current) {
          await soundRef.current.stopAsync().catch((e) => logger.debug("Error stopping async before play", e));
          await soundRef.current.unloadAsync().catch((e) => logger.debug("Error unloading async before play", e));
          soundRef.current = null;
        }

        // Slice the buffer to actual received size
        const actualData = pcmData.slice(0, writeOffsetRef.current);
        const dataLength = actualData.byteLength;
        const durationMs = Math.round(dataLength / BYTES_PER_MS);

        // Create WAV
        const header = createWavHeader(dataLength, SAMPLE_RATE, CHANNELS, 16);
        const wavData = new Uint8Array(header.byteLength + dataLength);
        wavData.set(header);
        wavData.set(actualData, header.byteLength);

        const wavBase64 = uint8ArrayToBase64(wavData);
        const uri = `data:audio/wav;base64,${wavBase64}`;

        logger.info(`Playing COMPLETE response: ${durationMs}ms (${dataLength} bytes)`);

        // Create and play sound
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true }
        );

        soundRef.current = sound;
        isPlayingRef.current = true;
        onPlaybackStatusChange?.(true);

        // Handle playback completion
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!isMountedRef.current) return;

          if (status.isLoaded && status.didJustFinish) {
            logger.info("Playback FINISHED - user can speak now");
            sound.unloadAsync().catch((e) => logger.debug("Error unloading async after finish", e));
            soundRef.current = null;
            isPlayingRef.current = false;
            onPlaybackStatusChange?.(false);
            onPlaybackComplete?.();
            resetState();
          }
        });

      } catch (error) {
        logger.error("Error playing audio:", error);
        isPlayingRef.current = false;
        onPlaybackStatusChange?.(false);
        resetState();
      }
    }, [onPlaybackComplete, onPlaybackStatusChange, resetState]);

    // Handle incoming audio chunks - accumulate into single buffer
    useEffect(() => {
      if (!audioBase64) return;

      // Convert base64 to raw PCM bytes
      const arrayBuffer = base64ToArrayBuffer(audioBase64);
      const chunk = new Uint8Array(arrayBuffer);

      // Initialize buffer on first chunk
      if (!audioBufferRef.current) {
        audioBufferRef.current = new Uint8Array(MAX_BUFFER_SIZE);
      }

      const buffer = audioBufferRef.current;
      const offset = writeOffsetRef.current;

      // Check if we have space
      if (offset + chunk.length > MAX_BUFFER_SIZE) {
        logger.warn(`Audio buffer overflow, dropping ${chunk.length} bytes`);
        return;
      }

      // Copy chunk directly into buffer at write offset
      buffer.set(chunk, offset);
      writeOffsetRef.current = offset + chunk.length;

      // Log accumulation periodically
      if (writeOffsetRef.current % 24000 === 0) { // Every ~1 second at 24kHz
        const currentMs = Math.round(writeOffsetRef.current / BYTES_PER_MS);
        logger.debug(`Buffering... ${currentMs}ms accumulated`);
      }
    }, [audioBase64]);

    // When stream is complete, play all audio
    useEffect(() => {
      if (isStreamComplete && writeOffsetRef.current > 0 && !hasPlayedRef.current) {
        logger.info("Stream complete - playing entire response");
        playAllAudio();
      }
    }, [isStreamComplete, playAllAudio]);

    return null;
  }
);

/**
 * Create WAV header
 */
function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Uint8Array {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

/**
 * Convert Uint8Array to Base64
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
