/**
 * Audio utilities for PCM16 format conversion
 */

/**
 * Convert base64 string to ArrayBuffer (optimized with chunked processing)
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Remove data URL prefix if present
  const base64Data = base64.includes(",")
    ? base64.split(",")[1]
    : base64;

  // Decode base64 to binary string
  const binaryString = atob(base64Data);

  // Convert binary string to ArrayBuffer with chunked processing for better cache locality
  const bytes = new Uint8Array(binaryString.length);
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  let i = 0;
  while (i < binaryString.length) {
    const chunkEnd = Math.min(i + CHUNK_SIZE, binaryString.length);
    for (let j = i; j < chunkEnd; j++) {
      bytes[j] = binaryString.charCodeAt(j);
    }
    i = chunkEnd;
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
 * Convert Int16Array to base64 (optimized to avoid string concatenation in loop)
 */
export function int16ArrayToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer);

  // Process in chunks to avoid call stack limits and improve performance
  const chunks: string[] = [];
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
    const chunkEnd = Math.min(i + CHUNK_SIZE, bytes.byteLength);
    const subarray = bytes.subarray(i, chunkEnd);
    // Use apply to avoid creating intermediate arrays for small chunks
    chunks.push(String.fromCharCode.apply(null, Array.from(subarray)));
  }
  return btoa(chunks.join(""));
}
