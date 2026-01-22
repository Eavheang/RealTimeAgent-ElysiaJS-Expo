/**
 * WebSocket hook for connecting to backend voice agent
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getWebSocketUrl } from "../utils/config";
import { createLogger } from "../utils/logger";
import { ConnectionState, BackendMessage } from "../types/websocket";

const logger = createLogger("WebSocket");

interface ConnectionError {
  code: number;
  reason: string;
  message: string;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  error: ConnectionError | null;
  sendAudio: (audioData: ArrayBuffer | Uint8Array) => void;
  reconnect: () => void;
}

/**
 * Get human-readable error message from WebSocket close code
 */
function getCloseCodeMessage(code: number, reason: string): { message: string; isRetryable: boolean } {
  switch (code) {
    case 1000:
      return { message: "Connection closed normally", isRetryable: false };
    case 1001:
      return { message: "Server is shutting down", isRetryable: true };
    case 1002:
      return { message: "Protocol error", isRetryable: false };
    case 1003:
      return { message: "Unsupported data type", isRetryable: false };
    case 1005:
      return { message: "Connection lost unexpectedly", isRetryable: true };
    case 1006:
      return { message: "Network connection lost", isRetryable: true };
    case 1008:
      return { message: reason || "Authentication failed or unauthorized", isRetryable: false };
    case 1009:
      return { message: "Message too large", isRetryable: false };
    case 1011:
      return { message: "Server error occurred", isRetryable: true };
    default:
      return { message: reason || "Connection closed", isRetryable: false };
  }
}

/**
 * Custom hook for WebSocket connection to backend
 */
export function useWebSocket(
  onAudioReceived?: (audioBase64: string) => void,
  onAudioDone?: () => void
): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<ConnectionError | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onAudioReceivedRef = useRef(onAudioReceived);
  const onAudioDoneRef = useRef(onAudioDone);
  const isConnectingRef = useRef(false);

  // Update refs when callbacks change
  useEffect(() => {
    onAudioReceivedRef.current = onAudioReceived;
  }, [onAudioReceived]);

  useEffect(() => {
    onAudioDoneRef.current = onAudioDone;
  }, [onAudioDone]);

  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  const connect = useCallback(() => {
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    isConnectingRef.current = true;
    setError(null);

    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {
        logger.error("Error closing WebSocket during connect:", e);
      }
      wsRef.current = null;
    }

    const wsUrl = getWebSocketUrl();
    logger.info("Connecting to:", wsUrl);
    setConnectionState("connecting");

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        logger.info("Connected");
        isConnectingRef.current = false;
        setConnectionState("connected");
        setError(null);
        reconnectAttemptsRef.current = 0;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === "string") {
            const message: BackendMessage = JSON.parse(event.data);

            if (message.type === "audio" && message.data) {
              logger.debug("Received audio chunk");
              onAudioReceivedRef.current?.(message.data);
            } else if (message.type === "audio_done") {
              logger.info("All audio received - stream complete");
              onAudioDoneRef.current?.();
            }
          }
        } catch (error) {
          logger.error("Error parsing message:", error);
        }
      };

      ws.onerror = (error) => {
        logger.error("Error:", error);
        isConnectingRef.current = false;
        setConnectionState("error");
        setError({ code: 0, reason: "Connection error", message: "Connection error occurred" });
      };

      ws.onclose = (event) => {
        logger.info("Disconnected:", event.code, event.reason);
        isConnectingRef.current = false;
        wsRef.current = null;

        const { message, isRetryable } = getCloseCodeMessage(event.code, event.reason);

        if (event.code === 1000) {
          // Normal close - don't reconnect
          setConnectionState("disconnected");
        } else if (!isRetryable || reconnectAttemptsRef.current >= maxReconnectAttempts) {
          // Non-retryable error or max attempts reached
          setConnectionState("error");
          setError({
            code: event.code,
            reason: event.reason,
            message: reconnectAttemptsRef.current >= maxReconnectAttempts
              ? "Unable to reconnect after multiple attempts"
              : message,
          });
        } else {
          // Retryable error - schedule reconnection
          setConnectionState("disconnected");
          setError({
            code: event.code,
            reason: event.reason,
            message: `${message}. Reconnecting... (${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`,
          });
          reconnectAttemptsRef.current++;
          logger.info(`Reconnecting (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      logger.error("Connection error:", error);
      isConnectingRef.current = false;
      setConnectionState("error");
      setError({ code: 0, reason: "Failed to connect", message: "Could not establish connection" });
    }
  }, []);

  const sendAudio = useCallback((audioData: ArrayBuffer | Uint8Array) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      wsRef.current.send(audioData);
    } catch (error) {
      logger.error("Error sending audio:", error);
      setError({ code: 0, reason: "Send failed", message: "Could not send audio data" });
    }
  }, []);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    setError(null);
    connect();
  }, [connect]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connectionState, error, sendAudio, reconnect };
}
