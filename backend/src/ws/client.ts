/**
 * Client WebSocket handler
 * Simple turn-based conversation: User speaks → AI responds completely → User speaks again
 */

import { VAD } from "../audio/vad";
import { AgentStateMachine, AgentState } from "../agent/state";
import { OpenAIRealtimeConnection } from "./openai";

/**
 * Per-connection client handler
 */
export class ClientHandler {
  private vad: VAD;
  private stateMachine: AgentStateMachine;
  private openai: OpenAIRealtimeConnection | null = null;
  private audioBuffer: Buffer[] = [];
  private sendToClient: (data: string) => void;
  private isOpenAIConnected = false;

  constructor(sendToClient: (data: string) => void) {
    this.sendToClient = sendToClient;
    this.vad = new VAD();
    this.stateMachine = new AgentStateMachine();
  }

  /**
   * Lazy initialization of OpenAI connection
   */
  private ensureOpenAIConnected(): void {
    if (this.openai && this.isOpenAIConnected) return;
    if (this.openai) return;

    console.log("[ClientHandler] Initializing OpenAI connection...");

    this.openai = new OpenAIRealtimeConnection({
      onAudioDelta: (audioBase64: string) => {
        this.handleOpenAIAudio(audioBase64);
      },
      onResponseCompleted: () => {
        this.handleResponseCompleted();
      },
      onError: (error: Error) => {
        console.error("[ClientHandler] OpenAI error:", error);
        this.stateMachine.reset();
        this.audioBuffer = [];
      },
      onConnected: () => {
        console.log("[ClientHandler] OpenAI connected");
        this.isOpenAIConnected = true;
        this.flushAudioBuffer();
      },
      onDisconnected: () => {
        console.log("[ClientHandler] OpenAI disconnected");
        this.isOpenAIConnected = false;
      },
      // Speech detection - ONLY process when we're in IDLE or LISTENING state
      onSpeechStarted: () => {
        const state = this.stateMachine.getState();
        // Only react to speech if we're ready to listen
        if (state === AgentState.IDLE) {
          console.log("[ClientHandler] ✅ User started speaking");
          this.stateMachine.transitionTo(AgentState.LISTENING);
        } else if (state === AgentState.LISTENING) {
          // Already listening, continue
        } else {
          // THINKING or SPEAKING - ignore speech events
          console.log(`[ClientHandler] Ignoring speech_started (state: ${state})`);
        }
      },
      onSpeechStopped: () => {
        const state = this.stateMachine.getState();
        // Only trigger response if we're in LISTENING state
        if (state === AgentState.LISTENING) {
          console.log("[ClientHandler] ✅ User stopped speaking - requesting AI response");
          this.triggerResponse();
        } else {
          console.log(`[ClientHandler] Ignoring speech_stopped (state: ${state})`);
        }
      },
    });

    this.openai.connect();
  }

  /**
   * Send buffered audio to OpenAI after connection
   */
  private flushAudioBuffer(): void {
    if (!this.openai || !this.isOpenAIConnected || this.audioBuffer.length === 0) return;

    console.log(`[ClientHandler] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const chunk of this.audioBuffer) {
      this.openai.appendAudio(chunk.toString("base64"));
    }
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
    // Transition to LISTENING if we're IDLE
    if (this.stateMachine.is(AgentState.IDLE)) {
      this.stateMachine.transitionTo(AgentState.LISTENING);
      this.audioBuffer = [];
    }

    // Buffer the audio
    this.audioBuffer.push(audioBuffer);

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
    const totalSize = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    if (totalSize < 3200) {
      console.log(`[ClientHandler] Audio too short (${totalSize} bytes), ignoring`);
      return;
    }

    console.log(`[ClientHandler] Requesting AI response (${totalSize} bytes of audio)`);

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
    // Transition to SPEAKING when first audio arrives
    if (this.stateMachine.is(AgentState.THINKING)) {
      this.stateMachine.transitionTo(AgentState.SPEAKING);
      console.log("[ClientHandler] AI started speaking");
    }

    // Forward audio to client
    this.sendToClient(JSON.stringify({
      type: "audio",
      data: audioBase64,
    }));
  }

  /**
   * Handle AI response completed - ALL audio has been sent
   */
  private handleResponseCompleted(): void {
    console.log("[ClientHandler] AI response stream completed");

    const state = this.stateMachine.getState();
    
    if (state === AgentState.SPEAKING || state === AgentState.THINKING) {
      // Send "audio_done" to tell client all audio has been sent
      // Client should wait for playback to finish before allowing user to speak
      this.sendToClient(JSON.stringify({ type: "audio_done" }));
      
      // Transition to IDLE
      this.stateMachine.transitionTo(AgentState.IDLE);
      this.audioBuffer = [];
      this.vad.reset();

      // Clear OpenAI's input buffer for fresh start
      if (this.openai && this.isOpenAIConnected) {
        this.openai.clearInputBuffer();
      }

      console.log("[ClientHandler] Waiting for client to finish playback");
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    console.log("[ClientHandler] Cleaning up");
    if (this.openai) {
      this.openai.disconnect();
      this.openai = null;
    }
    this.isOpenAIConnected = false;
    this.vad.reset();
    this.audioBuffer = [];
  }

  getState(): AgentState {
    return this.stateMachine.getState();
  }
}
