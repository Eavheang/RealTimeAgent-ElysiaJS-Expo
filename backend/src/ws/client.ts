/**
 * Client WebSocket handler
 * Simple turn-based conversation: User speaks → AI responds completely → User speaks again
 */

import type { Logger } from "pino";
import { VAD } from "../audio/vad";
import { AgentStateMachine, AgentState } from "../agent/state";
import { OpenAIRealtimeConnection } from "./openai";
import { MAX_AUDIO_BUFFER_BYTES } from "../config";

/**
 * Per-connection client handler
 * Optimized with single pre-allocated buffer for audio accumulation
 */
export class ClientHandler {
  private vad: VAD;
  private stateMachine: AgentStateMachine;
  private openai: OpenAIRealtimeConnection | null = null;
  private audioBuffer: Buffer | null = null;
  private writeOffset = 0; // Write pointer for the buffer
  private sendToClient: (data: string) => boolean;
  private isOpenAIConnected = false;
  private logger: Logger;
  private isClosing = false; // Flag to prevent sends during close

  // VAD debouncing state
  private speechStartedTime: number | null = null;
  private speechEndedTime: number | null = null;
  private readonly SPEAKING_CONFIRMATION_MS = 200; // Require 200ms of speech to confirm
  private readonly SPEECH_COOLDOWN_MS = 300; // Wait 300ms after speech ends before accepting new speech

  constructor(
    sendToClient: (data: string) => boolean,
    logger: Logger
  ) {
    this.sendToClient = sendToClient;
    this.logger = logger;
    this.vad = new VAD();
    this.stateMachine = new AgentStateMachine();
  }

  /**
   * Check if adding a chunk would exceed the buffer size limit
   */
  private wouldExceedBufferLimit(chunkSize: number): boolean {
    return this.writeOffset + chunkSize > MAX_AUDIO_BUFFER_BYTES;
  }

  /**
   * Reset audio buffer and size tracking
   * Reallocates buffer for fresh start
   */
  private resetAudioBuffer(): void {
    this.audioBuffer = null;
    this.writeOffset = 0;
  }

  /**
   * Get current buffer size
   */
  private getBufferSize(): number {
    return this.writeOffset;
  }

  /**
   * Reset VAD debouncing state
   */
  private resetVADDebouncingState(): void {
    this.speechStartedTime = null;
    this.speechEndedTime = null;
  }

  /**
   * Mark handler as closing to prevent further sends
   */
  markAsClosing(): void {
    this.isClosing = true;
  }

  /**
   * Safe send wrapper with closing check
   */
  private safeSend(data: string): boolean {
    if (this.isClosing) {
      return false;
    }
    return this.sendToClient(data);
  }

  /**
   * Lazy initialization of OpenAI connection
   * Reconnects if existing connection is disconnected
   */
  private ensureOpenAIConnected(): void {
    // Check if already connected using actual connection state
    if (this.openai && this.openai.getIsConnected()) {
      return;
    }

    // If connection exists but is disconnected, trigger reconnect
    if (this.openai) {
      this.logger.info("OpenAI connection exists but disconnected, reconnecting...");
      this.openai.connect();
      return;
    }

    this.logger.info("Initializing OpenAI connection...");

    this.openai = new OpenAIRealtimeConnection({
      onAudioDelta: (audioBase64: string) => {
        this.handleOpenAIAudio(audioBase64);
      },
      onResponseCompleted: () => {
        this.handleResponseCompleted();
      },
      onError: (error: Error) => {
        this.logger.error("OpenAI error", { error });
        this.stateMachine.reset();
        this.resetAudioBuffer();
      },
      onConnected: () => {
        this.logger.info("OpenAI connected");
        this.isOpenAIConnected = true;
        this.flushAudioBuffer();
      },
      onDisconnected: () => {
        this.logger.info("OpenAI disconnected");
        this.isOpenAIConnected = false;
      },
      // Speech detection - ONLY process when we're in IDLE or LISTENING state
      onSpeechStarted: () => {
        const state = this.stateMachine.getState();
        const now = Date.now();

        // VAD deouncing: Check cooldown period
        if (this.speechEndedTime && (now - this.speechEndedTime < this.SPEECH_COOLDOWN_MS)) {
          this.logger.debug("Ignoring speech_started (cooldown)", {
            timeSinceEnd: now - this.speechEndedTime,
            cooldown: this.SPEECH_COOLDOWN_MS,
          });
          return;
        }

        // Only react to speech if we're ready to listen
        if (state === AgentState.IDLE) {
          // Track speech start for confirmation debouncing
          this.speechStartedTime = now;

          // Confirmation debouncing: require speech to last > SPEAKING_CONFIRMATION_MS
          // We'll transition to LISTENING on confirmation
          setTimeout(() => {
            if (this.speechStartedTime === now && this.stateMachine.is(AgentState.IDLE)) {
              // Still in speech started state, confirm speech is real
              this.logger.info("Speech confirmed, transitioning to LISTENING");
              this.stateMachine.transitionTo(AgentState.LISTENING);
            }
          }, this.SPEAKING_CONFIRMATION_MS);

        } else if (state === AgentState.LISTENING) {
          // Already listening, continue
          this.speechStartedTime = null; // No longer debouncing
        } else {
          // THINKING or SPEAKING - ignore speech events
          this.logger.debug("Ignoring speech_started", { state });
        }
      },
      onSpeechStopped: () => {
        const state = this.stateMachine.getState();
        const now = Date.now();

        // Only trigger response if we're in LISTENING state
        if (state === AgentState.LISTENING) {
          // Speech ended - set cooldown timestamp
          this.speechEndedTime = now;
          this.speechStartedTime = null;

          this.logger.info("User stopped speaking - requesting AI response");
          this.triggerResponse();
        } else if (state === AgentState.IDLE && this.speechStartedTime) {
          // Speech started but never confirmed - this was a false positive (noise pop)
          this.logger.debug("Rejected brief speech (false positive)", {
            duration: now - this.speechStartedTime,
          });
          this.resetAudioBuffer();
          this.speechStartedTime = null;
        } else {
          this.logger.debug("Ignoring speech_stopped", { state });
        }
      },
    });

    this.openai.connect();
  }

  /**
   * Send buffered audio to OpenAI after connection
   */
  private flushAudioBuffer(): void {
    if (!this.openai || !this.openai.getIsConnected() || !this.audioBuffer) return;

    const bufferSize = this.writeOffset;
    if (bufferSize === 0) return;

    this.logger.info("Flushing buffered audio", { bytes: bufferSize });

    // Slice the buffer to get actual data and send to OpenAI
    const actualData = this.audioBuffer.subarray(0, bufferSize);
    this.openai.appendAudio(actualData.toString("base64"));
  }

  /**
   * Handle incoming audio chunk from client
   */
  handleAudioChunk(audioBuffer: Buffer): void {
    this.ensureOpenAIConnected();

    const state = this.stateMachine.getState();

    // STRICT RULE: Only accept audio when IDLE or LISTENING
    // Completely ignore audio during THINKING or SPEAKING
    if (state === AgentState.THINKING || state === AgentState.SPEAKING) {
      // Don't even log - just silently ignore
      return;
    }

    // Process audio (IDLE or LISTENING state)
    this.processAudio(audioBuffer);
  }

  /**
   * Process audio: buffer and send to OpenAI
   */
  private processAudio(audioBuffer: Buffer): void {
    // Check buffer size limit
    if (this.wouldExceedBufferLimit(audioBuffer.length)) {
      this.logger.warn("Buffer limit exceeded, resetting", {
        currentSize: this.writeOffset,
        chunkSize: audioBuffer.length,
        maxSize: MAX_AUDIO_BUFFER_BYTES,
      });
      this.resetAudioBuffer();
      this.stateMachine.transitionTo(AgentState.IDLE);
      return;
    }

    // Transition to LISTENING if we're IDLE
    if (this.stateMachine.is(AgentState.IDLE)) {
      this.stateMachine.transitionTo(AgentState.LISTENING);
      this.resetAudioBuffer();
    }

    // Initialize buffer on first chunk
    if (!this.audioBuffer) {
      this.audioBuffer = Buffer.alloc(MAX_AUDIO_BUFFER_BYTES);
    }

    // Copy chunk directly into buffer at write offset
    this.audioBuffer.set(audioBuffer, this.writeOffset);
    this.writeOffset += audioBuffer.length;

    // Send to OpenAI for VAD processing
    if (this.openai && this.isOpenAIConnected) {
      this.openai.appendAudio(audioBuffer.toString("base64"));
    }
  }

  /**
   * Trigger AI response after user stops speaking
   */
  private triggerResponse(): void {
    if (!this.stateMachine.is(AgentState.LISTENING)) return;
    if (!this.openai || !this.isOpenAIConnected) return;

    // Check minimum audio buffer size
    const totalSize = this.getBufferSize();
    if (totalSize < 3200) {
      this.logger.debug("Audio too short, ignoring", { bytes: totalSize });
      return;
    }

    this.logger.info("Requesting AI response", { bytes: totalSize });

    // Transition to THINKING FIRST (before sending to OpenAI)
    this.stateMachine.transitionTo(AgentState.THINKING);

    // Now commit and request response
    this.openai.commitAudio();
    this.openai.createResponse();
  }

  /**
   * Handle audio from OpenAI (AI speaking)
   */
  private handleOpenAIAudio(audioBase64: string): void {
    // Don't send if closing
    if (this.isClosing) return;

    // Transition to SPEAKING when first audio arrives
    if (this.stateMachine.is(AgentState.THINKING)) {
      this.stateMachine.transitionTo(AgentState.SPEAKING);
      this.logger.info("AI started speaking");
    }

    // Forward audio to client
    this.safeSend(JSON.stringify({
      type: "audio",
      data: audioBase64,
    }));
  }

  /**
   * Handle AI response completed - ALL audio has been sent
   */
  private handleResponseCompleted(): void {
    this.logger.info("AI response stream completed");

    // Don't send if closing
    if (this.isClosing) return;

    const state = this.stateMachine.getState();

    if (state === AgentState.SPEAKING || state === AgentState.THINKING) {
      // Send "audio_done" to tell client all audio has been sent
      // Client should wait for playback to finish before allowing user to speak
      this.safeSend(JSON.stringify({ type: "audio_done" }));

      // Transition to IDLE
      this.stateMachine.transitionTo(AgentState.IDLE);
      this.resetAudioBuffer();
      this.vad.reset();
      this.resetVADDebouncingState();

      // Clear OpenAI's input buffer for fresh start
      if (this.openai && this.isOpenAIConnected) {
        this.openai.clearInputBuffer();
      }

      this.logger.info("Waiting for client to finish playback");
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.logger.info("Cleaning up");
    if (this.openai) {
      this.openai.disconnect();
      this.openai = null;
    }
    this.isOpenAIConnected = false;
    this.vad.reset();
    this.resetAudioBuffer();
    this.resetVADDebouncingState();
  }

  getState(): AgentState {
    return this.stateMachine.getState();
  }
}
