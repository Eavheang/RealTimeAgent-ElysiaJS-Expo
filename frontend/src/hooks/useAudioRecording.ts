/**
 * Audio recording hook using react-native-live-audio-stream
 * Records raw PCM16 audio and streams to WebSocket in real-time
 */

import { useCallback, useRef, useState, useEffect } from "react";
import LiveAudioStream from "react-native-live-audio-stream";
import { PermissionsAndroid, Platform } from "react-native";

interface UseAudioRecordingReturn {
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  requestPermissions: () => Promise<boolean>;
}

// Audio configuration for PCM16, 16kHz, mono
const AUDIO_CONFIG = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  audioSource: 7, // VOICE_COMMUNICATION for hardware Echo Cancellation (AEC)
  bufferSize: 4096, // Buffer size in bytes
  wavFile: 'audio.wav', // Required by react-native-live-audio-stream
};

/**
 * Custom hook for audio recording with real-time PCM streaming
 */
export function useAudioRecording(
  onAudioChunk: (audioData: ArrayBuffer) => void,
  onSilenceDetected?: () => void
): UseAudioRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const onAudioChunkRef = useRef(onAudioChunk);
  const isInitializedRef = useRef(false);

  // Keep callback ref updated
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  // Initialize LiveAudioStream once
  useEffect(() => {
    if (!isInitializedRef.current) {
      LiveAudioStream.init(AUDIO_CONFIG);
      isInitializedRef.current = true;
      console.log("[AudioRecording] LiveAudioStream initialized with config:", AUDIO_CONFIG);
    }

    // Set up audio data listener
    const subscription = LiveAudioStream.on("data", (data: string) => {
      try {
        // data is base64 encoded PCM audio
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Send to WebSocket
        onAudioChunkRef.current(bytes.buffer);
      } catch (error) {
        console.error("[AudioRecording] Error processing audio chunk:", error);
      }
    }) as any;

    return () => {
      // Clean up subscription
      if (subscription && typeof subscription.remove === "function") {
        subscription.remove();
      }
    };
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: "Microphone Permission",
            message: "This app needs access to your microphone for voice communication.",
            buttonNeutral: "Ask Me Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK",
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.error("[AudioRecording] Permission denied");
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error("[AudioRecording] Error requesting permissions:", error);
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        throw new Error("Microphone permission not granted");
      }

      console.log("[AudioRecording] Starting PCM recording...");
      LiveAudioStream.start();
      setIsRecording(true);
      console.log("[AudioRecording] Recording started with real-time PCM streaming");
    } catch (error) {
      console.error("[AudioRecording] Error starting recording:", error);
      setIsRecording(false);
      throw error;
    }
  }, [requestPermissions]);

  const stopRecording = useCallback(async () => {
    try {
      console.log("[AudioRecording] Stopping recording...");
      LiveAudioStream.stop();
      setIsRecording(false);

      // Notify that recording stopped
      onSilenceDetected?.();
    } catch (error) {
      console.error("[AudioRecording] Error stopping recording:", error);
      setIsRecording(false);
    }
  }, [onSilenceDetected]);

  return {
    isRecording,
    startRecording,
    stopRecording,
    requestPermissions,
  };
}
