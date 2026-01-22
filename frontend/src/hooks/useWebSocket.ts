/**
 * WebSocket hook for connecting to backend voice agent
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getWebSocketUrl } from "../utils/config";
import { ConnectionState, BackendMessage } from "../types/websocket";

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  sendAudio: (audioData: ArrayBuffer | Uint8Array) => void;
  reconnect: () => void;
}

/**
 * Custom hook for WebSocket connection to backend
 */
export function useWebSocket(
  onAudioReceived?: (audioBase64: string) => void,
  onAudioDone?: () => void
): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
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

    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }

    const wsUrl = getWebSocketUrl();
    console.log("[WebSocket] Connecting to:", wsUrl);
    setConnectionState("connecting");

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WebSocket] Connected");
        isConnectingRef.current = false;
        setConnectionState("connected");
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
              console.log("[WebSocket] Received audio chunk");
              onAudioReceivedRef.current?.(message.data);
            } else if (message.type === "audio_done") {
              console.log("[WebSocket] All audio received - stream complete");
              onAudioDoneRef.current?.();
            }
          }
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
        isConnectingRef.current = false;
        setConnectionState("error");
      };

      ws.onclose = (event) => {
        console.log("[WebSocket] Disconnected:", event.code);
        isConnectingRef.current = false;
        setConnectionState("disconnected");
        wsRef.current = null;

        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[WebSocket] Reconnecting (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("[WebSocket] Connection error:", error);
      isConnectingRef.current = false;
      setConnectionState("error");
    }
  }, []);

  const sendAudio = useCallback((audioData: ArrayBuffer | Uint8Array) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      wsRef.current.send(audioData);
    } catch (error) {
      console.error("[WebSocket] Error sending audio:", error);
    }
  }, []);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
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

  return { connectionState, sendAudio, reconnect };
}
