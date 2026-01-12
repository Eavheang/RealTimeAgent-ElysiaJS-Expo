/**
 * Voice Activity Detection (VAD) using energy-based detection
 * Processes PCM16 audio frames to detect speech vs silence
 */

import {
  VAD_FRAME_SIZE_SAMPLES,
  VAD_SILENCE_THRESHOLD,
  VAD_SILENCE_FRAMES,
} from "../config";

/**
 * Calculate RMS (Root Mean Square) energy of an audio frame
 */
function calculateRMS(audioFrame: Int16Array): number {
  if (audioFrame.length === 0) return 0;
  
  let sumSquares = 0;
  for (let i = 0; i < audioFrame.length; i++) {
    const sample = audioFrame[i];
    sumSquares += sample * sample;
  }
  
  return Math.sqrt(sumSquares / audioFrame.length);
}

/**
 * VAD detector that tracks silence duration across frames
 */
export class VAD {
  private silenceFrameCount = 0;
  
  /**
   * Process an audio frame and detect if user has stopped speaking
   * @param audioFrame PCM16 audio frame (should be ~320 samples for 20ms @ 16kHz)
   * @returns true if silence detected for long enough (≥600ms), false otherwise
   */
  processFrame(audioFrame: Int16Array): boolean {
    const rms = calculateRMS(audioFrame);
    const isSilent = rms < VAD_SILENCE_THRESHOLD;
    
    if (isSilent) {
      this.silenceFrameCount++;
      
      // Check if we've had enough silence frames (≥600ms = 30 frames)
      if (this.silenceFrameCount >= VAD_SILENCE_FRAMES) {
        return true; // User has stopped speaking
      }
    } else {
      // Reset silence counter when we detect speech
      this.silenceFrameCount = 0;
    }
    
    return false;
  }
  
  /**
   * Reset the VAD state (useful when starting a new interaction)
   */
  reset(): void {
    this.silenceFrameCount = 0;
  }
  
  /**
   * Get the current silence frame count (for debugging)
   */
  getSilenceFrameCount(): number {
    return this.silenceFrameCount;
  }
}
