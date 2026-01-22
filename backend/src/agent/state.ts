/**
 * Agent State Machine
 * Simple turn-based conversation states
 */

import { logger } from "../logger";

export enum AgentState {
  IDLE = "IDLE",           // Ready for user to speak
  LISTENING = "LISTENING", // User is speaking
  THINKING = "THINKING",   // Processing user input, waiting for AI response
  SPEAKING = "SPEAKING",   // AI is responding
}

/**
 * Valid state transitions (turn-based flow)
 * 
 * IDLE → LISTENING (user starts speaking)
 * LISTENING → THINKING (user stops speaking, AI processing)
 * THINKING → SPEAKING (AI starts responding)
 * THINKING → IDLE (AI response completed without audio, or error)
 * SPEAKING → IDLE (AI finished responding, user's turn)
 */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]: [AgentState.LISTENING],
  [AgentState.LISTENING]: [AgentState.THINKING],
  [AgentState.THINKING]: [AgentState.SPEAKING, AgentState.IDLE],
  [AgentState.SPEAKING]: [AgentState.IDLE],
};

/**
 * Agent State Machine implementation
 */
export class AgentStateMachine {
  private state: AgentState = AgentState.IDLE;
  private transitionCount = 0;
  private log = logger.child({ component: "AgentStateMachine" }, { msgPrefix: "[AgentState] " });

  constructor() {
    this.logTransition(AgentState.IDLE);
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState: AgentState): void {
    const validNextStates = VALID_TRANSITIONS[this.state];

    if (!validNextStates.includes(newState)) {
      this.log.error(
        `Invalid transition: ${this.state} → ${newState}. ` +
        `Valid: ${validNextStates.join(", ")}`
      );
      return; // Don't throw, just log and ignore
    }

    this.state = newState;
    this.logTransition(newState);
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Check if in specific state
   */
  is(state: AgentState): boolean {
    return this.state === state;
  }

  /**
   * Log state transition
   */
  private logTransition(state: AgentState): void {
    this.transitionCount++;
    this.log.debug(`${state} (#${this.transitionCount})`);
  }
  
  /**
   * Reset to IDLE state
   */
  reset(): void {
    this.state = AgentState.IDLE;
    this.logTransition(AgentState.IDLE);
  }
}
