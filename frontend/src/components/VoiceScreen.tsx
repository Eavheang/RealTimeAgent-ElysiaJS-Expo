/**
 * Main voice screen - Turn-based conversation
 * Flow: User speaks → AI processes → AI responds COMPLETELY → User can speak again
 */

import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioRecording } from "../hooks/useAudioRecording";
import { AudioPlayer, AudioPlayerHandle } from "./AudioPlayer";

type ConversationState = "idle" | "listening" | "processing" | "playing";

export function VoiceScreen() {
  const [audioChunk, setAudioChunk] = useState<string | null>(null);
  const [isStreamComplete, setIsStreamComplete] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);

  // Handle audio received from backend
  const handleAudioReceived = useCallback((audioBase64: string) => {
    setAudioChunk(audioBase64);
    // Mark as processing/receiving audio
    setConversationState("processing");
  }, []);

  // Handle audio stream complete - all audio received from AI
  const handleAudioDone = useCallback(() => {
    console.log("[VoiceScreen] All audio received from AI - ready to play");
    setIsStreamComplete(true);
    setConversationState("playing");
  }, []);

  // WebSocket connection
  const { connectionState, sendAudio } = useWebSocket(handleAudioReceived, handleAudioDone);

  // Audio recording - only send when we're in listening state
  const { isRecording, startRecording, stopRecording, requestPermissions } = useAudioRecording(
    (audioData: ArrayBuffer) => {
      // Only send audio if session active AND we're in idle/listening state
      if (isSessionActive && (conversationState === "idle" || conversationState === "listening")) {
        sendAudio(audioData);
        if (conversationState === "idle") {
          setConversationState("listening");
        }
      }
    }
  );

  // Handle start button press
  const handleStartPress = async () => {
    if (connectionState !== "connected") {
      console.warn("[VoiceScreen] Not connected");
      return;
    }

    try {
      const granted = await requestPermissions();
      if (!granted) {
        console.warn("[VoiceScreen] Permissions not granted");
        return;
      }

      console.log("[VoiceScreen] Starting session...");
      setIsSessionActive(true);
      setConversationState("idle");
      setAudioChunk(null);
      setIsStreamComplete(false);
      audioPlayerRef.current?.clearQueue();
      await startRecording();
    } catch (error) {
      console.error("[VoiceScreen] Error starting:", error);
      setIsSessionActive(false);
    }
  };

  // Handle stop button press
  const handleStopPress = async () => {
    try {
      console.log("[VoiceScreen] Stopping session...");
      setIsSessionActive(false);
      setConversationState("idle");
      await stopRecording();
    } catch (error) {
      console.error("[VoiceScreen] Error stopping:", error);
    }
  };

  // Handle playback complete - user can speak again
  const handlePlaybackComplete = useCallback(() => {
    console.log("[VoiceScreen] Playback complete - user can speak now");
    setAudioChunk(null);
    setIsStreamComplete(false);
    setConversationState("idle");
  }, []);

  // Handle playback status change
  const handlePlaybackStatusChange = useCallback((isPlaying: boolean) => {
    if (isPlaying) {
      console.log("[VoiceScreen] AI is speaking...");
      setConversationState("playing");
    }
  }, []);

  // Get status text based on conversation state
  const getStatusText = (): string => {
    if (!isSessionActive) {
      switch (connectionState) {
        case "connecting": return "Connecting...";
        case "connected": return "Ready - Press START";
        case "disconnected": return "Disconnected";
        case "error": return "Connection Error";
        default: return "Unknown";
      }
    }

    switch (conversationState) {
      case "idle": return "🎤 Speak now...";
      case "listening": return "🎤 Listening...";
      case "processing": return "⏳ AI is thinking...";
      case "playing": return "🔊 AI is speaking...";
      default: return "Ready";
    }
  };

  // Get status color
  const getStatusColor = (): string => {
    if (!isSessionActive) {
      switch (connectionState) {
        case "connecting": return "#FFA500";
        case "connected": return "#00AA00";
        case "disconnected": return "#FF0000";
        case "error": return "#FF0000";
        default: return "#000000";
      }
    }

    switch (conversationState) {
      case "idle": return "#00AA00"; // Green - ready to listen
      case "listening": return "#00AA00"; // Green - listening
      case "processing": return "#FFA500"; // Orange - processing
      case "playing": return "#0066FF"; // Blue - AI speaking
      default: return "#000000";
    }
  };

  // Can user speak right now?
  const canUserSpeak = isSessionActive && (conversationState === "idle" || conversationState === "listening");

  return (
    <View style={styles.container}>
      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.title}>Voice Assistant</Text>
      </View>

      {/* Status */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
        <Text style={[styles.statusText, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>
      </View>

      {/* Conversation hint */}
      <View style={styles.hintContainer}>
        {!isSessionActive ? (
          <Text style={styles.hintText}>Press START to begin conversation</Text>
        ) : conversationState === "playing" ? (
          <Text style={styles.hintText}>Please wait for AI to finish speaking...</Text>
        ) : conversationState === "processing" ? (
          <Text style={styles.hintText}>AI is preparing response...</Text>
        ) : (
          <Text style={styles.hintText}>Speak clearly, I'm listening!</Text>
        )}
      </View>

      {/* Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.startButton,
            (isRecording || connectionState !== "connected") && styles.buttonDisabled,
          ]}
          onPress={handleStartPress}
          disabled={isRecording || connectionState !== "connected"}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>START</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.stopButton,
            (!isRecording || connectionState !== "connected") && styles.buttonDisabled,
          ]}
          onPress={handleStopPress}
          disabled={!isRecording || connectionState !== "connected"}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>STOP</Text>
        </TouchableOpacity>
      </View>

      {/* Debug info */}
      {isSessionActive && (
        <Text style={styles.debugText}>
          State: {conversationState} | Can speak: {canUserSpeak ? "Yes" : "No"}
        </Text>
      )}

      {/* Audio player */}
      <AudioPlayer
        ref={audioPlayerRef}
        audioBase64={audioChunk}
        isStreamComplete={isStreamComplete}
        onPlaybackComplete={handlePlaybackComplete}
        onPlaybackStatusChange={handlePlaybackStatusChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 80,
    paddingBottom: 80,
    paddingHorizontal: 20,
  },
  titleContainer: {
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#000000",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  statusIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
  },
  statusText: {
    fontSize: 20,
    fontWeight: "600",
  },
  hintContainer: {
    padding: 24,
    backgroundColor: "#F5F5F5",
    borderRadius: 16,
    marginHorizontal: 20,
    width: "100%",
  },
  hintText: {
    fontSize: 18,
    color: "#333333",
    textAlign: "center",
    lineHeight: 26,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 24,
  },
  actionButton: {
    width: 130,
    height: 65,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  startButton: {
    backgroundColor: "#00AA00",
    borderColor: "#008800",
  },
  stopButton: {
    backgroundColor: "#DD0000",
    borderColor: "#AA0000",
  },
  buttonDisabled: {
    backgroundColor: "#CCCCCC",
    borderColor: "#AAAAAA",
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFFFFF",
    letterSpacing: 1,
  },
  debugText: {
    fontSize: 12,
    color: "#999999",
    textAlign: "center",
  },
});
