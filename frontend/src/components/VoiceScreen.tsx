/**
 * Main voice screen - Turn-based conversation
 * Flow: User speaks → AI processes → AI responds COMPLETELY → User can speak again
 */

import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioRecording } from "../hooks/useAudioRecording";
import { AudioPlayer, AudioPlayerHandle } from "./AudioPlayer";
import { createLogger } from "../utils/logger";

const logger = createLogger("VoiceScreen");

type ConversationState = "idle" | "listening" | "processing" | "playing";

export function VoiceScreen() {
  const [audioChunk, setAudioChunk] = useState<string | null>(null);
  const [isStreamComplete, setIsStreamComplete] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [showError, setShowError] = useState(false);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);

  // Ref to access current conversationState in callbacks (prevents stale closure)
  const conversationStateRef = useRef(conversationState);
  const isSessionActiveRef = useRef(isSessionActive);

  // Keep refs updated
  useEffect(() => {
    conversationStateRef.current = conversationState;
  }, [conversationState]);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);

  // Handle audio received from backend
  const handleAudioReceived = useCallback((audioBase64: string) => {
    setAudioChunk(audioBase64);
    // Mark as processing/receiving audio
    setConversationState("processing");
  }, []);

  // Handle audio stream complete - all audio received from AI
  const handleAudioDone = useCallback(() => {
    logger.info("All audio received from AI - ready to play");
    setIsStreamComplete(true);
    setConversationState("playing");
  }, []);

  // WebSocket connection
  const { connectionState, sendAudio, error, reconnect } = useWebSocket(handleAudioReceived, handleAudioDone);

  // Show error when error state is set
  React.useEffect(() => {
    if (connectionState === "error" && error) {
      setShowError(true);
    } else {
      setShowError(false);
    }
  }, [connectionState, error]);

  // Dismiss error when reconnecting
  const handleDismissError = useCallback(() => {
    setShowError(false);
    reconnect();
  }, [reconnect]);

  // Audio recording - only send when we're in listening state
  // Use refs to prevent stale closure issues
  const { isRecording, startRecording, stopRecording, requestPermissions } = useAudioRecording(
    (audioData: ArrayBuffer) => {
      // Only send audio if session active AND we're in idle/listening state
      // Using refs ensures we always have current state values
      const currentSessionActive = isSessionActiveRef.current;
      const currentState = conversationStateRef.current;

      if (currentSessionActive && (currentState === "idle" || currentState === "listening")) {
        sendAudio(audioData);
        if (currentState === "idle") {
          setConversationState("listening");
        }
      }
    }
  );

  // Handle start button press
  const handleStartPress = async () => {
    if (connectionState !== "connected") {
      logger.warn("Not connected");
      return;
    }

    try {
      const granted = await requestPermissions();
      if (!granted) {
        logger.warn("Permissions not granted");
        return;
      }

      logger.info("Starting session...");
      setIsSessionActive(true);
      setConversationState("idle");
      setAudioChunk(null);
      setIsStreamComplete(false);
      audioPlayerRef.current?.clearQueue();
      await startRecording();
    } catch (error) {
      logger.error("Error starting:", error);
      setIsSessionActive(false);
    }
  };

  // Handle stop button press
  const handleStopPress = async () => {
    try {
      logger.info("Stopping session...");
      setIsSessionActive(false);
      setConversationState("idle");
      await stopRecording();
    } catch (error) {
      logger.error("Error stopping:", error);
    }
  };

  // Handle playback complete - user can speak again
  const handlePlaybackComplete = useCallback(() => {
    logger.info("Playback complete - user can speak now");
    setAudioChunk(null);
    setIsStreamComplete(false);
    setConversationState("idle");
  }, []);

  // Handle playback status change
  const handlePlaybackStatusChange = useCallback((isPlaying: boolean) => {
    if (isPlaying) {
      logger.info("AI is speaking...");
      setConversationState("playing");
    }
  }, []);

  // Memoized status calculation to avoid redundant computation
  const statusColor = useMemo((): string => {
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
  }, [connectionState, conversationState, isSessionActive]);

  const statusText = useMemo((): string => {
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
  }, [connectionState, conversationState, isSessionActive]);

  const canUserSpeak = isSessionActive && (conversationState === "idle" || conversationState === "listening");

  return (
    <View style={styles.container}>
      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.title}>Voice Assistant</Text>
      </View>

      {/* Status */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusText}
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

      {/* Error display */}
      {showError && error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleDismissError}
            activeOpacity={0.7}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

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
  errorContainer: {
    padding: 20,
    backgroundColor: "#FFF0F0",
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FFCCCC",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#CC0000",
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 15,
    color: "#660000",
    marginBottom: 12,
    lineHeight: 21,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#CC0000",
    borderRadius: 20,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
