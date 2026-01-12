/**
 * OpenAI Realtime API WebSocket wrapper
 * Handles connection, message formatting, and audio streaming
 */

import WebSocket from "ws";
import {
  OPENAI_API_KEY,
  OPENAI_REALTIME_URL,
  OPENAI_MODEL,
  AUDIO_SAMPLE_RATE,
} from "../config";
import { SYSTEM_PROMPT } from "../agent/prompt";

/**
 * OpenAI Realtime API message types
 */
type OpenAIRealtimeMessage =
  | { type: "session.update"; session: { modalities: string[]; instructions: string; voice?: string; input_audio_format?: string; output_audio_format?: string; turn_detection?: { type: string; threshold?: number; prefix_padding_ms?: number; silence_duration_ms?: number } } }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" }
  | { type: "response.create"; response: { modalities: string[]; instructions?: string } }
  | { type: "response.cancel" }
  | { type: "response.audio.delta"; delta?: string }
  | { type: "response.completed" }
  | { type: "response.done" }
  | { type: "error"; error: { message: string; code: string } }
  | { type: "response.audio_transcript.delta"; delta?: string }
  | { type: "response.audio_transcript.done"; transcript: string }
  | { type: "conversation.item.create" }
  | { type: "conversation.item.input_audio_transcription.create" }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" };

/**
 * Callbacks for OpenAI WebSocket events
 */
export interface OpenAIRealtimeCallbacks {
  onAudioDelta?: (audioBase64: string) => void;
  onResponseCompleted?: () => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
}

/**
 * OpenAI Realtime WebSocket wrapper
 */
export class OpenAIRealtimeConnection {
  private ws: WebSocket | null = null;
  private callbacks: OpenAIRealtimeCallbacks;
  private isConnected = false;

  constructor(callbacks: OpenAIRealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Connect to OpenAI Realtime API
   */
  connect(): void {
    // Prevent multiple simultaneous connections
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.warn("[OpenAI] Already connected to OpenAI, skipping");
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.warn("[OpenAI] Already connecting to OpenAI, skipping");
      return;
    }

    // Close existing connection if any
    if (this.ws) {
      console.warn("[OpenAI] Closing existing connection before reconnecting");
      this.disconnect();
    }

    console.log("[OpenAI] Connecting to OpenAI Realtime API...");

    // Add model as query parameter to the URL
    const urlWithModel = `${OPENAI_REALTIME_URL}?model=${OPENAI_MODEL}`;

    this.ws = new WebSocket(urlWithModel, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this.ws.on("open", () => {
      console.log("[OpenAI] Connected to OpenAI Realtime API");
      this.isConnected = true;
      this.initializeSession();
      this.callbacks.onConnected?.();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as OpenAIRealtimeMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error("[OpenAI] Error parsing message:", error);
      }
    });

    this.ws.on("error", (error: Error) => {
      console.error("[OpenAI] WebSocket error:", error);
      this.callbacks.onError?.(error);
    });

    this.ws.on("close", () => {
      console.log("[OpenAI] Disconnected from OpenAI Realtime API");
      this.isConnected = false;
      this.callbacks.onDisconnected?.();
    });
  }

  /**
   * Initialize the session with configuration
   */
  private initializeSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    // Send session configuration
    const sessionUpdate: OpenAIRealtimeMessage = {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: SYSTEM_PROMPT,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: "alloy", // Default voice, can be customized
        turn_detection: {
          type: "server_vad",
          threshold: 0.6, // Balanced threshold for speech detection
          prefix_padding_ms: 300, // Include 300ms before speech detected
          silence_duration_ms: 700, // Wait 700ms of silence before considering turn complete
        },
      },
    };

    this.sendMessage(sessionUpdate);
    console.log("[OpenAI] Session initialized with system prompt");
  }

  /**
   * Handle incoming messages from OpenAI
   */
  private handleMessage(message: OpenAIRealtimeMessage): void {
    // Log all message types for debugging (can be removed in production)
    const messageType = message.type;

    switch (messageType) {
      case "response.audio.delta":
        // Audio chunk from OpenAI
        if (message.delta) {
          this.callbacks.onAudioDelta?.(message.delta);
        }
        break;

      case "response.completed":
        // Response completed - but we use response.done as the main trigger
        console.log("[OpenAI] Response completed (waiting for response.done)");
        break;

      case "input_audio_buffer.speech_started":
        console.log("[OpenAI] ✅ Speech started event received");
        this.callbacks.onSpeechStarted?.();
        break;

      case "input_audio_buffer.speech_stopped":
        console.log("[OpenAI] ✅ Speech stopped event received");
        this.callbacks.onSpeechStopped?.();
        break;

      case "error":
        // Ignore empty buffer commit errors (benign)
        if (message.error.code === "input_audio_buffer_commit_empty") {
          console.warn("[OpenAI] Warning:", message.error.message);
          return;
        }

        if (message.error.code === "conversation_already_has_active_response") {
          console.warn("[OpenAI] Warning:", message.error.message);
          return;
        }

        console.error("[OpenAI] API error:", message.error);
        this.callbacks.onError?.(new Error(`${message.error.code}: ${message.error.message}`));
        break;

      case "response.done":
        console.log("[OpenAI] Response done - triggering completion");
        this.callbacks.onResponseCompleted?.();
        break;

      default:
        // Log unhandled message types for debugging
        console.log(`[OpenAI] Received message type: ${messageType}`);
        break;
    }
  }

  /**
   * Send a message to OpenAI
   */
  private sendMessage(message: OpenAIRealtimeMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Append audio to the input buffer
   */
  appendAudio(audioBase64: string): void {
    const message: OpenAIRealtimeMessage = {
      type: "input_audio_buffer.append",
      audio: audioBase64,
    };
    this.sendMessage(message);
  }

  /**
   * Commit the input audio buffer and trigger processing
   */
  commitAudio(): void {
    const message: OpenAIRealtimeMessage = {
      type: "input_audio_buffer.commit",
    };
    this.sendMessage(message);
    console.log("[OpenAI] Audio buffer committed");
  }

  /**
   * Create a response (trigger agent to speak)
   */
  createResponse(): void {
    const message: OpenAIRealtimeMessage = {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
      },
    };
    this.sendMessage(message);
    console.log("[OpenAI] Response creation requested");
  }

  /**
   * Cancel the current response
   */
  cancelResponse(): void {
    const message: OpenAIRealtimeMessage = {
      type: "response.cancel",
    };
    this.sendMessage(message);
    console.log("[OpenAI] Response cancelled");
  }

  /**
   * Clear the input audio buffer (for fresh start on new turn)
   */
  clearInputBuffer(): void {
    const message: OpenAIRealtimeMessage = {
      type: "input_audio_buffer.clear",
    };
    this.sendMessage(message);
    console.log("[OpenAI] Input audio buffer cleared");
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from OpenAI
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
