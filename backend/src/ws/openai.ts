/**
 * OpenAI Realtime API WebSocket wrapper
 * Handles connection, message formatting, and audio streaming
 */

import WebSocket from "ws";
import { logger } from "../logger";
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
 * Circuit breaker states
 */
enum CircuitBreakerState {
  CLOSED = "CLOSED", // Normal operation, requests flow through
  OPEN = "OPEN", // Circuit is open, requests are blocked
  HALF_OPEN = "HALF_OPEN", // Testing if the service has recovered
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeoutMs: number; // How long to wait before trying again
}

/**
 * Reconnection configuration
 */
interface ReconnectionConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute
};

const DEFAULT_RECONNECTION: ReconnectionConfig = {
  maxAttempts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 500, // Random jitter to prevent thundering herd
};

/**
 * OpenAI Realtime WebSocket wrapper
 * Includes exponential backoff reconnection and circuit breaker
 */
export class OpenAIRealtimeConnection {
  private ws: WebSocket | null = null;
  private callbacks: OpenAIRealtimeCallbacks;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Connection state
  private isConnected = false;

  // Reconnection state
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private shouldReconnect = false;

  // Circuit breaker state
  private circuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private reconnectionConfig: ReconnectionConfig;

  // Connection timeout
  private connectionTimeoutMs = 15000; // 15 seconds to establish connection

  // Logger child for this connection
  private log = logger.child({ component: "OpenAIRealtimeConnection" }, { msgPrefix: "[OpenAI] " });

  constructor(
    callbacks: OpenAIRealtimeCallbacks,
    circuitBreakerConfig: Partial<CircuitBreakerConfig> = {},
    reconnectionConfig: Partial<ReconnectionConfig> = {}
  ) {
    this.callbacks = callbacks;
    this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER, ...circuitBreakerConfig };
    this.reconnectionConfig = { ...DEFAULT_RECONNECTION, ...reconnectionConfig };
  }

  /**
   * Connect to OpenAI Realtime API
   */
  connect(): void {
    // Check circuit breaker state
    if (!this.canAttemptConnection()) {
      this.log.warn("Cannot connect: circuit breaker is open");
      return;
    }

    // Prevent multiple simultaneous connections
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log.warn("Already connected, skipping");
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.log.warn("Already connecting, skipping");
      return;
    }

    // Close existing connection if any
    if (this.ws) {
      this.log.warn("Closing existing connection before reconnecting");
      this.disconnect();
    }

    this.shouldReconnect = true;

    this.log.info("Connecting to Realtime API...");

    // Set connection timeout
    this.connectTimeout = setTimeout(() => {
      this.log.error("Connection timeout");
      this.handleConnectionError(new Error("Connection timeout"));
    }, this.connectionTimeoutMs);

    // Add model as query parameter to the URL
    const urlWithModel = `${OPENAI_REALTIME_URL}?model=${OPENAI_MODEL}`;

    this.ws = new WebSocket(urlWithModel, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this.ws.on("open", () => {
      // Clear connection timeout
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }

      this.log.info("Connected to Realtime API");
      this.isConnected = true;
      this.resetCircuitBreaker();
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.initializeSession();
      this.callbacks.onConnected?.();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as OpenAIRealtimeMessage;
        this.handleMessage(message);
      } catch (error) {
        this.log.error({ error }, "Error parsing message");
      }
    });

    this.ws.on("error", (error: Error) => {
      this.log.error({ error }, "WebSocket error");
      this.handleConnectionError(error);
      this.callbacks.onError?.(error);
    });

    this.ws.on("close", () => {
      // Clear connection timeout
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }

      this.log.info("Disconnected from Realtime API");
      this.isConnected = false;

      // Handle unexpected disconnection (not due to disconnect() call)
      if (this.shouldReconnect) {
        this.handleConnectionError(new Error("Unexpected disconnection"));
      }

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
    this.log.info("Session initialized with system prompt");
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
        this.log.debug("Response completed (waiting for response.done)");
        break;

      case "input_audio_buffer.speech_started":
        this.log.info("Speech started event received");
        this.callbacks.onSpeechStarted?.();
        break;

      case "input_audio_buffer.speech_stopped":
        this.log.info("Speech stopped event received");
        this.callbacks.onSpeechStopped?.();
        break;

      case "error":
        // Ignore empty buffer commit errors (benign)
        if (message.error.code === "input_audio_buffer_commit_empty") {
          this.log.warn({ message: message.error.message }, "Empty buffer commit error");
          return;
        }

        if (message.error.code === "conversation_already_has_active_response") {
          this.log.warn({ message: message.error.message }, "Already has active response");
          return;
        }

        this.log.error({ error: message.error }, "API error");
        this.callbacks.onError?.(new Error(`${message.error.code}: ${message.error.message}`));
        break;

      case "response.done":
        this.log.info("Response done - triggering completion");
        this.callbacks.onResponseCompleted?.();
        break;

      default:
        // Log unhandled message types for debugging
        this.log.debug({ type: messageType }, "Received message type");
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
    this.log.debug("Audio buffer committed");
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
    this.log.debug("Response creation requested");
  }

  /**
   * Cancel the current response
   */
  cancelResponse(): void {
    const message: OpenAIRealtimeMessage = {
      type: "response.cancel",
    };
    this.sendMessage(message);
    this.log.debug("Response cancelled");
  }

  /**
   * Clear the input audio buffer (for fresh start on new turn)
   */
  clearInputBuffer(): void {
    const message: OpenAIRealtimeMessage = {
      type: "input_audio_buffer.clear",
    };
    this.sendMessage(message);
    this.log.debug("Input audio buffer cleared");
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from OpenAI
   * Stops any pending reconnection attempts
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.isReconnecting = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Handle connection errors with circuit breaker and reconnection
   */
  private handleConnectionError(error: Error): void {
    this.isConnected = false;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.log.error(
      {
        message: error.message,
        attempt: this.reconnectAttempts,
        failureCount: this.failureCount,
        circuitBreakerState: this.circuitBreakerState,
      },
      "Connection error"
    );

    // Update circuit breaker state
    if (this.failureCount >= this.circuitBreakerConfig.failureThreshold) {
      this.openCircuitBreaker();
    }

    // Try to reconnect if enabled and within limits
    if (this.shouldReconnect && this.reconnectAttempts < this.reconnectionConfig.maxAttempts) {
      this.scheduleReconnection();
    } else if (this.reconnectAttempts >= this.reconnectionConfig.maxAttempts) {
      this.log.error("Max reconnection attempts reached. Giving up.");
      this.callbacksWithErrorInfo(new Error("Max reconnection attempts reached. Giving up."));
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnection(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Check circuit breaker
    if (!this.canAttemptConnection()) {
      const cooldownEnd = this.lastFailureTime + this.circuitBreakerConfig.resetTimeoutMs;
      const cooldownRemaining = Math.max(0, cooldownEnd - Date.now());
      this.log.info(
        `Circuit breaker is open. Scheduling reconnection in ${cooldownRemaining}ms`
      );
      this.reconnectTimeout = setTimeout(() => {
        this.circuitBreakerState = CircuitBreakerState.HALF_OPEN;
        this.attemptReconnection();
      }, cooldownRemaining);
      return;
    }

    // Calculate delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.reconnectionConfig.initialDelayMs * Math.pow(this.reconnectionConfig.backoffMultiplier, this.reconnectAttempts),
      this.reconnectionConfig.maxDelayMs
    );
    const jitter = Math.random() * this.reconnectionConfig.jitterMs * 2 - this.reconnectionConfig.jitterMs;
    const delay = Math.max(0, baseDelay + jitter);

    this.isReconnecting = true;
    this.reconnectAttempts++;

    this.log.info(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.reconnectionConfig.maxAttempts} in ${Math.round(delay)}ms`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.attemptReconnection();
    }, delay);
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnection(): void {
    if (this.shouldReconnect) {
      this.log.info(`Reconnection attempt ${this.reconnectAttempts}`);
      this.connect();
    }
  }

  /**
   * Open the circuit breaker to prevent further connection attempts
   */
  private openCircuitBreaker(): void {
    this.circuitBreakerState = CircuitBreakerState.OPEN;
    this.lastFailureTime = Date.now();
    this.log.warn(
      `Circuit breaker opened after ${this.failureCount} failures. Next attempt after ${this.circuitBreakerConfig.resetTimeoutMs}ms`
    );
  }

  /**
   * Reset the circuit breaker on successful connection
   */
  private resetCircuitBreaker(): void {
    if (this.circuitBreakerState !== CircuitBreakerState.CLOSED) {
      this.log.info("Circuit breaker reset to CLOSED");
    }
    this.circuitBreakerState = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
  }

  /**
   * Check if a connection attempt can be made based on circuit breaker state
   */
  private canAttemptConnection(): boolean {
    if (this.circuitBreakerState === CircuitBreakerState.CLOSED) {
      return true;
    }

    if (this.circuitBreakerState === CircuitBreakerState.OPEN) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      return timeSinceLastFailure >= this.circuitBreakerConfig.resetTimeoutMs;
    }

    return true; // HALF_OPEN allows connections
  }

  /**
   * Callback helper that includes circuit breaker state in error info
   */
  private callbacksWithErrorInfo(error: Error): void {
    this.callbacks.onError?.(error);
  }
}
