/**
 * Audio utilities for PCM16 format conversion
 */

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Remove data URL prefix if present
  const base64Data = base64.includes(",") 
    ? base64.split(",")[1] 
    : base64;

  // Decode base64 to binary string
  const binaryString = atob(base64Data);
  
  // Convert binary string to ArrayBuffer
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to Int16Array (PCM16 format)
 */
export function arrayBufferToInt16Array(buffer: ArrayBuffer): Int16Array {
  return new Int16Array(buffer);
}

/**
 * Convert Int16Array to ArrayBuffer
 */
export function int16ArrayToArrayBuffer(int16Array: Int16Array): ArrayBuffer {
  return int16Array.buffer.slice() as ArrayBuffer;
}

/**
 * Convert base64 PCM16 to Int16Array
 */
export function base64ToInt16Array(base64: string): Int16Array {
  const arrayBuffer = base64ToArrayBuffer(base64);
  return arrayBufferToInt16Array(arrayBuffer);
}

/**
 * Convert Int16Array to base64
 */
export function int16ArrayToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
