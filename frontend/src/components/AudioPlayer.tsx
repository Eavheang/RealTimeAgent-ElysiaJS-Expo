/**
 * Audio player component for playing PCM16 audio from backend
 * Waits for ALL audio to arrive, then plays the entire response as one continuous sound
 */

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Audio } from "expo-av";
import { base64ToArrayBuffer } from "../utils/audioUtils";

// Configuration
const SAMPLE_RATE = 24000; // OpenAI uses 24kHz for output audio
const BYTES_PER_SAMPLE = 2; // 16-bit = 2 bytes
const CHANNELS = 1;

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
 */
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  ({ audioBase64, isStreamComplete, onPlaybackComplete, onPlaybackStatusChange }, ref) => {
    // Accumulated PCM data
    const audioBufferRef = useRef<Uint8Array[]>([]);
    const totalBytesRef = useRef(0);
    
    // Playback state
    const soundRef = useRef<Audio.Sound | null>(null);
    const isPlayingRef = useRef(false);
    const hasPlayedRef = useRef(false); // Prevent playing twice
    
    // Lifecycle
    const isMountedRef = useRef(true);
    const isAudioModeSetRef = useRef(false);

    // Reset state
    const resetState = useCallback(() => {
      audioBufferRef.current = [];
      totalBytesRef.current = 0;
      hasPlayedRef.current = false;
    }, []);

    // Expose clearQueue method
    useImperativeHandle(ref, () => ({
      clearQueue: () => {
        console.log("[AudioPlayer] Clearing audio queue");
        
        if (soundRef.current) {
          soundRef.current.stopAsync().catch(() => {});
          soundRef.current.unloadAsync().catch(() => {});
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
            console.log("[AudioPlayer] Audio mode configured");
          } catch (error) {
            console.error("[AudioPlayer] Error setting audio mode:", error);
          }
        }
      };
      
      setupAudioMode();
      isMountedRef.current = true;
      
      return () => {
        isMountedRef.current = false;
        if (soundRef.current) {
          soundRef.current.unloadAsync().catch(() => {});
        }
      };
    }, []);

    // Combine all buffered audio into single Uint8Array
    const combineBuffers = useCallback((): Uint8Array => {
      const combined = new Uint8Array(totalBytesRef.current);
      let offset = 0;
      for (const chunk of audioBufferRef.current) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return combined;
    }, []);

    // Play all accumulated audio as one continuous sound
    const playAllAudio = useCallback(async () => {
      if (!isMountedRef.current || totalBytesRef.current === 0 || hasPlayedRef.current) {
        return;
      }

      hasPlayedRef.current = true; // Prevent playing twice

      try {
        // Stop any existing playback
        if (soundRef.current) {
          await soundRef.current.stopAsync().catch(() => {});
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }

        // Combine all audio
        const pcmData = combineBuffers();
        const durationMs = Math.round(pcmData.byteLength / SAMPLE_RATE / BYTES_PER_SAMPLE * 1000);
        
        // Create WAV
        const header = createWavHeader(pcmData.byteLength, SAMPLE_RATE, CHANNELS, 16);
        const wavData = new Uint8Array(header.byteLength + pcmData.byteLength);
        wavData.set(header);
        wavData.set(pcmData, header.byteLength);

        const wavBase64 = uint8ArrayToBase64(wavData);
        const uri = `data:audio/wav;base64,${wavBase64}`;

        console.log(`[AudioPlayer] Playing COMPLETE response: ${durationMs}ms (${pcmData.byteLength} bytes)`);

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
            console.log("[AudioPlayer] Playback FINISHED - user can speak now");
            sound.unloadAsync().catch(() => {});
            soundRef.current = null;
            isPlayingRef.current = false;
            onPlaybackStatusChange?.(false);
            onPlaybackComplete?.();
            resetState();
          }
        });

      } catch (error) {
        console.error("[AudioPlayer] Error playing audio:", error);
        isPlayingRef.current = false;
        onPlaybackStatusChange?.(false);
        resetState();
      }
    }, [combineBuffers, onPlaybackComplete, onPlaybackStatusChange, resetState]);

    // Handle incoming audio chunks - just accumulate, don't play yet
    useEffect(() => {
      if (!audioBase64) return;

      // Convert base64 to raw PCM bytes
      const arrayBuffer = base64ToArrayBuffer(audioBase64);
      const pcmData = new Uint8Array(arrayBuffer);
      
      // Add to buffer
      audioBufferRef.current.push(pcmData);
      totalBytesRef.current += pcmData.length;
      
      // Just log accumulation, don't play yet
      const currentMs = Math.round(totalBytesRef.current / SAMPLE_RATE / BYTES_PER_SAMPLE * 1000);
      if (audioBufferRef.current.length % 10 === 0) {
        console.log(`[AudioPlayer] Buffering... ${currentMs}ms accumulated`);
      }
    }, [audioBase64]);

    // When stream is complete, play all audio
    useEffect(() => {
      if (isStreamComplete && totalBytesRef.current > 0 && !hasPlayedRef.current) {
        console.log("[AudioPlayer] Stream complete - playing entire response");
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
